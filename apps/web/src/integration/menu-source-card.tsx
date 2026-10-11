'use client'

// The Menu source card of a venue's Settings tab (CF-09b, D73): where this venue's menu comes
// from. Three cases:
//
//   linked          its venue in the till (read-only, "Change…" is deliberate and warns, T62), the
//                   menu category its menu is read from, which price it shows (per venue, because
//                   the till prices by venue), when it was last synced, the held-sync warning and
//                   "Sync this venue";
//   not linked      an integration exists: "Link a barsy venue", with the ones that serve no venue;
//   no integration  a sentence and a link to Settings -> Integrations, where the connection is made.
//
// A till venue's own number is only handed back to the server actions; it is never drawn. Owners
// and admins change things; everyone else sees what is set.
import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormSection } from '@/components/ui/form-section'
import {
  chooseTillVenueAction,
  saveVenuePriceAction,
  syncNowAction,
} from '@/server/integration/actions'
import type {
  IntegrationErrorCode,
  LinkedMenuSource,
  MenuSourceView,
  PriceSource,
  TillVenueOption,
} from '@/server/integration/view'

import { CategoryPicker } from './category-picker'
import { ErrorNote, Notice } from './error-note'
import { LiveRefresh } from './live-refresh'
import { useClearWhenIdle } from './use-clear-when-idle'
import { useMoment } from './use-moment'

/** The radios of the venues a venue could serve; one that serves another venue is shown, not offered. */
function TillVenueChoice({
  options,
  chosen,
  onChoose,
  disabled,
  legend,
}: {
  options: readonly TillVenueOption[]
  chosen: number | null
  onChoose: (key: number) => void
  disabled: boolean
  legend: string
}) {
  const t = useTranslations('menuSource.choice')
  const groupName = useId()
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.key}
          className="flex items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:opacity-60"
          data-testid="till-venue-option"
        >
          <input
            type="radio"
            name={groupName}
            className="mt-0.5 size-4 accent-primary"
            checked={chosen === option.key}
            disabled={option.usedBy !== null}
            onChange={() => onChoose(option.key)}
          />
          <span className="grid gap-0.5">
            <span className="font-medium">{option.name}</span>
            {option.address ? (
              <span className="text-xs text-muted-foreground" data-testid="venue-address">
                {option.address}
              </span>
            ) : null}
            {option.publicMenuSetUp ? (
              <span className="text-xs text-muted-foreground" data-testid="venue-public-menu">
                {t('publicMenu')}
              </span>
            ) : null}
            {option.usedBy !== null ? (
              <span className="text-xs text-muted-foreground">
                {t('usedBy', { venue: option.usedBy })}
              </span>
            ) : null}
            {option.notUsed ? (
              <span className="text-xs text-muted-foreground">{t('notUsed')}</span>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/** "Link a barsy venue" for a venue that has none. */
function LinkForm({
  venueId,
  options,
  canManage,
}: {
  venueId: string
  options: readonly TillVenueOption[]
  canManage: boolean
}) {
  const t = useTranslations('menuSource.unlinked')
  const [chosen, setChosen] = useState<number | null>(null)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (chosen === null) return
    setError(null)
    startTransition(async () => {
      const result = await chooseTillVenueAction({ venueId, bid: chosen })
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-3" data-testid="link-form">
      <p className="text-sm text-muted-foreground">{t('text')}</p>
      <h4 className="text-sm font-medium">{t('title')}</h4>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="link-none">
          {t('none')}
        </p>
      ) : (
        <>
          <TillVenueChoice
            options={options}
            chosen={chosen}
            onChoose={setChosen}
            disabled={!canManage || pending}
            legend={t('legend')}
          />
          <p className="text-xs text-muted-foreground">{t('warning')}</p>
          {canManage ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={pending || chosen === null}>
                {pending ? t('linking') : t('button')}
              </Button>
            </div>
          ) : null}
        </>
      )}
      <ErrorNote code={error} />
    </form>
  )
}

/** "Change…": a deliberate move to another venue of the till, after the warning (T62). */
function ChangeDialog({
  venueId,
  options,
  open,
  onClose,
}: {
  venueId: string
  options: readonly TillVenueOption[]
  open: boolean
  onClose: () => void
}) {
  const t = useTranslations('menuSource.change')
  const [chosen, setChosen] = useState<number | null>(null)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [pending, startTransition] = useTransition()

  function close() {
    if (pending) return
    setChosen(null)
    setError(null)
    onClose()
  }

  function confirm() {
    if (chosen === null) return
    setError(null)
    startTransition(async () => {
      const result = await chooseTillVenueAction({ venueId, bid: chosen })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setChosen(null)
      onClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      {open ? (
        <DialogContent data-testid="change-dialog">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <TillVenueChoice
            options={options}
            chosen={chosen}
            onChoose={setChosen}
            disabled={pending}
            legend={t('legend')}
          />
          <p className="text-sm text-muted-foreground" data-testid="change-warning">
            {t('warning')}
          </p>
          <ErrorNote code={error} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={close}>
              {t('cancel')}
            </Button>
            <Button type="button" disabled={pending || chosen === null} onClick={confirm}>
              {pending ? t('changing') : t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

/** Which price the menu shows: the venue's own setting. */
function PriceForm({ venueId, view }: { venueId: string; view: LinkedMenuSource }) {
  const t = useTranslations('menuSource.price')
  const formId = useId()
  const [priceSource, setPriceSource] = useState<PriceSource>(view.priceSource)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await saveVenuePriceAction({ venueId, priceSource })
      if (result.ok) setSaved(true)
      else setError(result.error)
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-3" data-testid="price-form">
      <fieldset className="grid gap-2" disabled={!view.canManage}>
        <legend className="mb-1 text-sm font-medium">{t('legend')}</legend>
        {(
          [
            ['actual_price', 'actual'],
            ['current_price', 'current'],
          ] as const
        ).map(([value, key]) => (
          <label
            key={value}
            className="flex items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:opacity-70"
          >
            <input
              type="radio"
              name={`${formId}-price`}
              className="mt-0.5 size-4 accent-primary"
              checked={priceSource === value}
              onChange={() => {
                setPriceSource(value)
                setSaved(false)
              }}
            />
            <span className="grid gap-0.5">
              <span className="font-medium">
                {t(key)}
                {value === 'actual_price' ? (
                  <span className="ms-1.5 font-normal text-muted-foreground">({t('default')})</span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">{t(`${key}Help`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">{t('help')}</p>
      <ErrorNote code={error} />
      {saved ? <Notice>{t('saved')}</Notice> : null}
      {view.canManage ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || priceSource === view.priceSource}>
            {pending ? t('saving') : t('save')}
          </Button>
        </div>
      ) : null}
    </form>
  )
}

/** The last sync, the held warning and "Sync this venue". */
function SyncBlock({ venueId, view }: { venueId: string; view: LinkedMenuSource }) {
  const t = useTranslations('menuSource.sync')
  const moment = useMoment(view.timeZone)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [queued, setQueued] = useState(false)
  const [pending, startTransition] = useTransition()
  useClearWhenIdle(view.activeJob, () => setQueued(false))
  const { gate, heldSync: held } = view
  const lastSynced = moment(view.lastSyncedAt)

  function press() {
    setError(null)
    setQueued(false)
    startTransition(async () => {
      const result = await syncNowAction({ venueId })
      if (result.ok) setQueued(true)
      else setError(result.error)
    })
  }

  return (
    <div className="grid gap-3">
      {held ? (
        <Alert
          className="border-warning/40 [&>svg]:text-warning"
          data-testid="sync-held"
          data-reason={held.reason}
        >
          <AlertTriangleIcon aria-hidden />
          <AlertTitle>{t('held.title')}</AlertTitle>
          <AlertDescription>
            {t(`held.${held.reason}`, { wouldHide: held.wouldHide, active: held.active })}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={press} disabled={!gate.enabled || pending}>
          <RefreshCwIcon aria-hidden className={pending ? 'animate-spin' : undefined} />
          {pending ? t('starting') : t('button')}
        </Button>
        {!gate.enabled ? (
          <p className="text-sm text-muted-foreground" data-testid="sync-blocked">
            {t(`blocked.${gate.reason}`)}
          </p>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground" data-testid="sync-last">
        {lastSynced ? t('lastSynced', { when: lastSynced }) : t('neverSynced')}
      </p>
      {queued ? <Notice>{t('queued')}</Notice> : null}
      <ErrorNote code={error} />
    </div>
  )
}

function Linked({ venueId, view }: { venueId: string; view: LinkedMenuSource }) {
  const t = useTranslations('menuSource')
  const [changing, setChanging] = useState(false)
  return (
    <div className="grid gap-6">
      <LiveRefresh active={view.activeJob !== null} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <span className="text-sm font-medium">{t('venue.label')}</span>
          <span className="text-sm text-muted-foreground" data-testid="menu-source-venue">
            {view.tillVenueName}
          </span>
        </div>
        {view.canManage ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setChanging(true)}>
            {t('venue.change')}
          </Button>
        ) : null}
      </div>
      <ChangeDialog
        venueId={venueId}
        options={view.options}
        open={changing}
        onClose={() => setChanging(false)}
      />
      <CategoryPicker
        venueId={venueId}
        tree={view.tree}
        treeFetchedAt={view.treeFetchedAt}
        rootCatId={view.rootCatId}
        timeZone={view.timeZone}
        canManage={view.canManage}
      />
      <PriceForm venueId={venueId} view={view} />
      <SyncBlock venueId={venueId} view={view} />
    </div>
  )
}

export function MenuSourceCard({ venueId, view }: { venueId: string; view: MenuSourceView }) {
  const t = useTranslations('menuSource')
  return (
    <div id="menu-source" data-testid="menu-source">
      <FormSection title={t('title')} description={t('description')}>
        {view.canManage ? null : (
          <p
            className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground"
            data-testid="read-only"
          >
            {t('readOnly')}
          </p>
        )}
        {view.state === 'no_integration' ? (
          <div className="grid gap-2" data-testid="menu-source-none">
            <p className="text-sm text-muted-foreground">{t('none.text')}</p>
            <div>
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/integrations">{t('none.link')}</Link>
              </Button>
            </div>
          </div>
        ) : view.state === 'unlinked' ? (
          <LinkForm venueId={venueId} options={view.options} canManage={view.canManage} />
        ) : (
          <Linked venueId={venueId} view={view} />
        )}
      </FormSection>
    </div>
  )
}
