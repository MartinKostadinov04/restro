'use client'

// Settings › Ordering (#87, plan `2026-10-27-settings-hours-ordering-plan.md` §4, D118's box): open
// tables only, the cap per sent order, the venue's spot (only by "I'm at the venue – use this spot",
// no map library, Martin 10-27) and, under "More", the location check, its radius and pass, the
// pace limit and how long a waiter call waits. Every control saves at once with Undo; the labels say
// "order". Writes go through `settings.ordering_set`.
import { decimalToMinor, MoneyError, minorToDecimal } from '@restro/core'
import { ChevronDownIcon, PencilIcon } from 'lucide-react'
import Link from 'next/link'
import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { saveOrderingAction } from '@/server/settings/ordering-actions'
import type { OrderingView } from '@/server/settings/ordering-view'
import { useMoney } from '@/tonight/money'

import { CHOICES, SPOT_ACCURACY_LIMIT_METRES } from './hours'
import { MinutesSelect } from './hours-panel'
import { ReadOnlyLine } from './section-notices'
import { useSettingsRun } from './use-settings-run'

/** The cap a switched-on cap starts at: D118's €150. */
const DEFAULT_CAP_MINOR = 15_000

/** A place on the map for a plain "See on a map" link (a link only: no map library, no tiles). */
function mapLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`
}

export function OrderingPanel({ view }: { view: OrderingView }) {
  const t = useTranslations('ownerSettings')
  const money = useMoney()
  const runner = useSettingsRun(view.email)
  const { pending, run } = runner
  const settings = view.settings
  const can = view.canChange
  const [editingCap, setEditingCap] = useState(false)
  const [capText, setCapText] = useState('')
  const [capProblem, setCapProblem] = useState(false)
  const [reading, setReading] = useState(false)

  /** Saves some keys; Undo puts the same keys back to what they were. */
  function save(changes: Record<string, unknown>, previous: Record<string, unknown>) {
    run(() => saveOrderingAction({ venueId: view.venueId, changes }), {
      done: t('st_saved'),
      undo: () => saveOrderingAction({ venueId: view.venueId, changes: previous }),
    })
  }

  function startCap() {
    setCapText(minorToDecimal(settings.capMinor ?? DEFAULT_CAP_MINOR))
    setCapProblem(false)
    setEditingCap(true)
  }

  function saveCap() {
    let minor: number
    try {
      minor = decimalToMinor(capText.trim().replace(',', '.'))
    } catch (error) {
      if (!(error instanceof MoneyError)) throw error
      setCapProblem(true)
      return
    }
    if (minor < 1 || minor > 1_000_000) {
      setCapProblem(true)
      return
    }
    setEditingCap(false)
    if (minor !== settings.capMinor) save({ capMinor: minor }, { capMinor: settings.capMinor })
  }

  function useThisSpot() {
    if (!('geolocation' in navigator)) {
      toast.error(t('st_loc_denied'), { duration: Number.POSITIVE_INFINITY })
      return
    }
    setReading(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setReading(false)
        const { latitude, longitude, accuracy } = position.coords
        if (accuracy > SPOT_ACCURACY_LIMIT_METRES) {
          toast.error(t('st_loc_rough', { n: Math.round(accuracy) }), {
            duration: Number.POSITIVE_INFINITY,
          })
          return
        }
        save({ spot: { lat: round6(latitude), lng: round6(longitude) } }, { spot: settings.spot })
      },
      () => {
        setReading(false)
        toast.error(t('st_loc_denied'), { duration: Number.POSITIVE_INFINITY })
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    )
  }

  return (
    <div className="grid gap-4" data-testid="ordering-panel" aria-busy={pending}>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t('st_ordering')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('st_ordering_lede')}</p>
      </div>
      {can ? null : <ReadOnlyLine />}

      <div className="grid divide-y rounded-lg border bg-card">
        <Row label={t('st_open_only')} htmlFor="ord-open-only">
          {can ? (
            <Switch
              id="ord-open-only"
              checked={settings.onlyOpenTables}
              disabled={pending}
              onCheckedChange={(on) =>
                save({ onlyOpenTables: on }, { onlyOpenTables: settings.onlyOpenTables })
              }
            />
          ) : (
            <Value>{settings.onlyOpenTables ? t('st_open') : t('st_off')}</Value>
          )}
        </Row>

        <Row label={t('st_cap')} htmlFor="ord-cap">
          {editingCap ? (
            <div className="grid gap-1">
              <Input
                id="ord-cap"
                inputMode="decimal"
                className="w-32"
                value={capText}
                autoFocus
                aria-invalid={capProblem ? true : undefined}
                aria-describedby={capProblem ? 'ord-cap-problem' : undefined}
                onChange={(event) => {
                  setCapText(event.target.value)
                  setCapProblem(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveCap()
                  if (event.key === 'Escape') setEditingCap(false)
                }}
                onBlur={() => setEditingCap(false)}
              />
              {capProblem ? (
                <p id="ord-cap-problem" className="text-sm text-destructive" role="alert">
                  {t('st_cap_bad', { max: money(1_000_000, view.currency) })}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {settings.capMinor === null ? (
                <Value>{t('st_cap_off')}</Value>
              ) : (
                <>
                  <Value testId="ord-cap-value">{money(settings.capMinor, view.currency)}</Value>
                  {can ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={startCap}
                      aria-label={t('st_cap_edit')}
                      disabled={pending}
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                  ) : null}
                </>
              )}
              {can ? (
                <Switch
                  checked={settings.capMinor !== null}
                  disabled={pending}
                  aria-label={t('st_cap')}
                  onCheckedChange={(on) =>
                    save(
                      { capMinor: on ? DEFAULT_CAP_MINOR : null },
                      { capMinor: settings.capMinor },
                    )
                  }
                />
              ) : null}
            </div>
          )}
        </Row>

        <div className="grid gap-2 p-3">
          {settings.spot === null ? (
            <p className="text-sm text-destructive" data-testid="ord-spot-unset">
              {t('st_spot_unset')}
            </p>
          ) : (
            <SpotLine view={view} />
          )}
          {can ? (
            <div>
              <Button
                variant={settings.spot === null ? 'default' : 'outline'}
                className="h-auto max-w-full whitespace-normal py-2 text-left"
                disabled={pending || reading}
                onClick={useThisSpot}
              >
                {settings.spot === null ? t('st_spot_use') : t('st_spot_again')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <Collapsible className="rounded-lg border bg-card">
        <CollapsibleTrigger className="flex w-full items-center justify-between p-3 text-left font-medium">
          {t('st_more')}
          <ChevronDownIcon aria-hidden className="size-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid divide-y border-t">
          <Row label={t('st_loc')} htmlFor="ord-loc">
            {can ? (
              <Switch
                id="ord-loc"
                checked={settings.locationCheck}
                disabled={pending}
                onCheckedChange={(on) =>
                  save({ locationCheck: on }, { locationCheck: settings.locationCheck })
                }
              />
            ) : (
              <Value>{settings.locationCheck ? t('st_open') : t('st_off')}</Value>
            )}
          </Row>
          {settings.locationCheck ? null : (
            <p className="p-3 text-sm text-muted-foreground" data-testid="ord-loc-off">
              {t('st_loc_off')}
            </p>
          )}
          <Row label={t('st_radius')} htmlFor="ord-radius">
            <ChoiceSelect
              id="ord-radius"
              can={can}
              pending={pending}
              value={settings.radiusMetres}
              choices={CHOICES.radiusMetres}
              word={(n) => t('st_m', { n })}
              onChange={(n) => save({ radiusMetres: n }, { radiusMetres: settings.radiusMetres })}
            />
          </Row>
          <Row label={t('st_pass')} htmlFor="ord-pass">
            {can ? (
              <div className="w-40 max-w-full">
                <MinutesSelect
                  id="ord-pass"
                  label=""
                  value={settings.passMinutes}
                  choices={CHOICES.passMinutes}
                  onChange={(n) => save({ passMinutes: n }, { passMinutes: settings.passMinutes })}
                />
              </div>
            ) : (
              <MinutesValue minutes={settings.passMinutes} />
            )}
          </Row>
          <Row label={t('st_pace')} htmlFor="ord-pace">
            <ChoiceSelect
              id="ord-pace"
              can={can}
              pending={pending}
              value={settings.pacePer15Minutes}
              choices={CHOICES.pace}
              off={t('st_off')}
              word={(n) => String(n)}
              onChange={(n) =>
                save({ pacePer15Minutes: n }, { pacePer15Minutes: settings.pacePer15Minutes })
              }
            />
          </Row>
          <Row label={t('st_call')} htmlFor="ord-call">
            {can ? (
              <div className="w-40 max-w-full">
                <MinutesSelect
                  id="ord-call"
                  label=""
                  value={settings.callLapseMinutes}
                  choices={CHOICES.callLapseMinutes}
                  onChange={(n) =>
                    save({ callLapseMinutes: n }, { callLapseMinutes: settings.callLapseMinutes })
                  }
                />
              </div>
            ) : (
              <MinutesValue minutes={settings.callLapseMinutes} />
            )}
          </Row>
          <p className="p-3 text-sm text-muted-foreground">
            <Link
              href={`/venues/${view.venueId}?tab=composer`}
              className="underline underline-offset-2"
            >
              {t('st_call_where')}
            </Link>
          </p>
        </CollapsibleContent>
      </Collapsible>
      {runner.dialog}
    </div>
  )
}

/** Six decimals: about a tenth of a metre, plenty for a venue's spot. */
function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/** "Set on 27 Oct, 21:40 · See on a map". */
function SpotLine({ view }: { view: OrderingView }) {
  const t = useTranslations('ownerSettings')
  const format = useFormatter()
  const spot = view.settings.spot
  if (spot === null) return null
  const link = (chunks: React.ReactNode) => (
    <a
      href={mapLink(spot.lat, spot.lng)}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
    >
      {chunks}
    </a>
  )
  return (
    <p className="text-sm" data-testid="ord-spot-set">
      {view.spotSetAt === null
        ? t.rich('st_spot_set_nodate', { map: link })
        : t.rich('st_spot_set', {
            date: format.dateTime(new Date(view.spotSetAt), {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: view.timezone,
            }),
            map: link,
          })}
    </p>
  )
}

/** A label above its control on a phone and beside it on a wide screen. */
function Row({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3">
      <Label htmlFor={htmlFor} className="min-w-0 flex-1 basis-56 break-words font-normal">
        {label}
      </Label>
      {children}
    </div>
  )
}

function Value({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <span className="font-medium tabular-nums" data-testid={testId}>
      {children}
    </span>
  )
}

function MinutesValue({ minutes }: { minutes: number }) {
  const t = useTranslations('ownerSettings')
  return (
    <Value>{minutes < 60 ? t('st_min', { n: minutes }) : t('st_h', { n: minutes / 60 })}</Value>
  )
}

/** A Select of numbers, optionally with "Off" for null. */
function ChoiceSelect({
  id,
  can,
  pending,
  value,
  choices,
  word,
  off,
  onChange,
}: {
  id: string
  can: boolean
  pending: boolean
  value: number | null
  choices: readonly number[]
  word: (n: number) => string
  off?: string
  onChange: (value: number | null) => void
}) {
  const current = value === null ? 'off' : String(value)
  if (!can) return <Value>{value === null ? (off ?? '') : word(value)}</Value>
  return (
    <Select
      value={current}
      disabled={pending}
      onValueChange={(next) => onChange(next === 'off' ? null : Number(next))}
    >
      <SelectTrigger id={id} className="w-40 max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {off === undefined ? null : <SelectItem value="off">{off}</SelectItem>}
        {choices.map((n) => (
          <SelectItem key={n} value={String(n)}>
            {word(n)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
