'use client'

// Settings › Paying (#116, plan `docs/deliverables/2026-10-29-settings-paying-plan.md`; D125, D127,
// D107, D123): connecting the venue's own card-provider account, what is still missing before card
// payments can start (each item with its fix), the smallest card payment and tips, and the venue's
// legal details for the pay screen (#198). Every control saves at once with Undo, except Disconnect
// (a dialog: Undo cannot bring the connection back) and the details card (a form with Save). A role
// without `settings.connect_payments` sees the same, read-only.
import { decimalToMinor, MIN_CARD_MAX_MINOR, MoneyError, minorToDecimal } from '@restro/core'
import { EllipsisIcon, PencilIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  disconnectPayingAction,
  finishConnectionAction,
  savePayingAction,
  startConnectionAction,
  tickPayingCheckAction,
} from '@/server/settings/paying-actions'
import type { PayingView } from '@/server/settings/paying-view'
import { useMoney } from '@/tonight/money'

import { PayingLegalCard } from './paying-legal'
import { useSettingsRun } from './use-settings-run'

/** The owner's two ticks. */
type Tick = 'cardTypeInTill' | 'receiptEmailsOff'

/** What the missing list can hold, in D125's order and then #198's details. */
type Missing = 'account' | 'card' | Tick | 'tables' | 'details'

/** The refusals that mean the provider's form could not be opened or read. */
const CONNECT_ERRORS = [
  'connection_failed',
  'provider_unavailable',
  'provider_refused',
  'no_provider',
  'payments_off',
  'no_address',
]

/** Where the Paying section lives, without `?connection=`. */
const SECTION_QUERY = '?tab=settings&section=paying'

export function PayingPanel({
  view,
  connection,
}: {
  view: PayingView
  connection: 'return' | 'refresh' | undefined
}) {
  const t = useTranslations('ownerSettings')
  const money = useMoney()
  const router = useRouter()
  const pathname = usePathname()
  const runner = useSettingsRun(view.email)
  const { pending, run } = runner
  const can = view.canConnect
  const venueId = view.venueId
  const provider = { provider: view.provider }
  const [leaving, setLeaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [editingMin, setEditingMin] = useState(false)
  const [minText, setMinText] = useState('')
  const [minProblem, setMinProblem] = useState<'low' | 'high' | 'bad' | null>(null)
  const returned = useRef(false)

  /** The words for the refusals this screen words itself (the others use the shared sentences). */
  const words = (error: string): string | undefined => {
    if (error === 'payment_in_flight') return t('pa_err_inflight')
    if (CONNECT_ERRORS.includes(error)) return t('pa_err_connect', provider)
    return undefined
  }

  // Back from the provider's form: read the account back once, say what happened, drop the query.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per return; the rest only names sentences
  useEffect(() => {
    if (connection !== 'return' || returned.current || !can) return
    returned.current = true
    run(() => finishConnectionAction({ venueId }), {
      words,
      onOk: (answer) => {
        const ready = answer.ok && answer.ready
        toast.success(ready ? t('pa_back_ok', provider) : t('pa_back_more', provider))
        router.replace(`${pathname}${SECTION_QUERY}`)
        router.refresh()
      },
      onFail: () => router.replace(`${pathname}${SECTION_QUERY}`),
    })
  }, [connection, can])

  /** Leaves for the provider's hosted form (connect, continue and reconnect are one call). */
  function leave() {
    run(() => startConnectionAction({ venueId }), {
      words,
      onOk: (answer) => {
        if (!answer.ok) return
        setLeaving(true)
        window.location.assign(answer.url)
      },
    })
  }

  function tick(check: Tick, done: boolean) {
    run(() => tickPayingCheckAction({ venueId, check, done }), {
      done: t('st_saved'),
      undo: () => tickPayingCheckAction({ venueId, check, done: !done }),
    })
  }

  function setMin(next: number | null) {
    const previous = view.minCardMinor
    run(() => savePayingAction({ venueId, changes: { minCardMinor: next } }), {
      done: t('st_saved'),
      undo: () => savePayingAction({ venueId, changes: { minCardMinor: previous } }),
    })
  }

  function startMin() {
    setMinText(minorToDecimal(view.minCardMinor ?? view.providerMinimumMinor))
    setMinProblem(null)
    setEditingMin(true)
  }

  function saveMin() {
    let minor: number
    try {
      minor = decimalToMinor(minText.trim().replace(',', '.'))
    } catch (error) {
      if (!(error instanceof MoneyError)) throw error
      setMinProblem('bad')
      return
    }
    if (minor < view.providerMinimumMinor) return setMinProblem('low')
    if (minor > MIN_CARD_MAX_MINOR) return setMinProblem('high')
    setEditingMin(false)
    if (minor !== view.minCardMinor) setMin(minor)
  }

  const state = view.state
  const lost = state === 'lost_access'
  const connected = state === 'connected'
  const connecting = state === 'connecting'
  const never = state === null || state === 'disconnected'
  const providerAsks = connected && view.checks[0]?.passed === false
  const missing = view.payingOn ? [] : missingItems(view)
  const expired = connection === 'refresh' && (connecting || connected)

  return (
    <div className="grid gap-4" data-testid="paying-panel" aria-busy={pending}>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t('pa_title')}</h2>
        {never ? (
          <p className="mt-1 text-sm text-muted-foreground">{t('pa_lede', provider)}</p>
        ) : null}
      </div>
      {can ? null : (
        <p className="text-sm text-muted-foreground" data-testid="paying-readonly">
          {t('pa_readonly')}
        </p>
      )}

      {lost ? (
        <Alert variant="destructive" data-testid="paying-lost">
          <AlertDescription className="grid gap-3">
            <span>
              {view.lostReason === 'account_restricted'
                ? t('pa_lost_restricted', provider)
                : t('pa_lost_access', provider)}
            </span>
            {can ? (
              <div>
                <Button
                  onClick={leave}
                  disabled={pending || leaving}
                  data-testid="paying-reconnect"
                >
                  {t('pa_reconnect')}
                </Button>
              </div>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {view.payingOn ? (
        <Alert data-testid="paying-on">
          <AlertDescription>{t('pa_on')}</AlertDescription>
        </Alert>
      ) : null}

      {never ? (
        <div className="grid gap-3 rounded-lg border bg-card p-3">
          <p className="text-sm text-muted-foreground">{t('pa_connect_d', provider)}</p>
          {can ? (
            <div>
              <Button onClick={leave} disabled={pending || leaving} data-testid="paying-connect">
                {t('pa_connect', provider)}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {connecting || expired ? (
        <div className="grid gap-3 rounded-lg border bg-card p-3" data-testid="paying-connecting">
          <p className="text-sm">
            {expired ? t('pa_expired', provider) : t('pa_connecting', provider)}
          </p>
          {can ? (
            <div>
              <Button onClick={leave} disabled={pending || leaving} data-testid="paying-continue">
                {t('pa_continue', provider)}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {connected || lost ? (
        <div
          className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3"
          data-testid="paying-account"
        >
          <p className="min-w-0 break-words font-medium">
            {view.accountName === null
              ? t('pa_back_ok', provider)
              : t('pa_connected', { name: view.accountName })}
          </p>
          {can ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('st_more')}
                  disabled={pending}
                  data-testid="paying-account-menu"
                >
                  <EllipsisIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDisconnecting(true)}>
                  {t('pa_disconnect')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}

      {missing.length > 0 ? (
        <section className="grid gap-2 rounded-lg border bg-card p-3" data-testid="paying-missing">
          <h3 className="font-medium">{t('pa_missing_t')}</h3>
          <ul className="grid divide-y">
            {missing.map((item) => (
              <li
                key={item}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2"
                data-testid={`paying-missing-${item}`}
              >
                {item === 'cardTypeInTill' || item === 'receiptEmailsOff' ? (
                  <MissingTick
                    check={item}
                    label={
                      item === 'cardTypeInTill'
                        ? t('pa_m_till', { source: view.source })
                        : t('pa_m_emails', provider)
                    }
                    can={can}
                    pending={pending}
                    onChange={(done) => tick(item, done)}
                  />
                ) : (
                  <p className="min-w-0 flex-1 basis-56 break-words text-sm">
                    {item === 'account'
                      ? t('pa_m_account', provider)
                      : item === 'card'
                        ? t('pa_m_card', provider)
                        : item === 'tables'
                          ? t('pa_m_tables')
                          : t('pa_m_details')}
                  </p>
                )}
                {can && item === 'card' && providerAsks ? (
                  <Button variant="outline" size="sm" onClick={leave} disabled={pending || leaving}>
                    {t('pa_continue', provider)}
                  </Button>
                ) : null}
                {can && item === 'tables' ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/venues/${venueId}?tab=tables`}>{t('pa_m_tables_go')}</Link>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid divide-y rounded-lg border bg-card">
        <div className="grid gap-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <Label htmlFor="pay-min" className="min-w-0 flex-1 basis-56 break-words font-normal">
              {t('pa_min')}
            </Label>
            {editingMin ? (
              <Input
                id="pay-min"
                inputMode="decimal"
                className="w-32"
                value={minText}
                autoFocus
                aria-invalid={minProblem === null ? undefined : true}
                aria-describedby={minProblem === null ? undefined : 'pay-min-problem'}
                onChange={(event) => {
                  setMinText(event.target.value)
                  setMinProblem(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveMin()
                  if (event.key === 'Escape') setEditingMin(false)
                }}
                onBlur={() => {
                  if (minProblem === null) setEditingMin(false)
                }}
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-medium tabular-nums" data-testid="paying-min-value">
                  {view.minCardMinor === null
                    ? t('pa_min_default', {
                        amt: money(view.providerMinimumMinor, view.currency),
                        ...provider,
                      })
                    : money(view.minCardMinor, view.currency)}
                </span>
                {can ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={startMin}
                    aria-label={t('pa_min')}
                    disabled={pending}
                    data-testid="paying-min-edit"
                  >
                    <PencilIcon aria-hidden />
                  </Button>
                ) : null}
              </div>
            )}
          </div>
          {editingMin && minProblem !== null ? (
            <p id="pay-min-problem" className="text-sm text-destructive" role="alert">
              {minProblem === 'low'
                ? t('pa_min_err_low', {
                    amt: money(view.providerMinimumMinor, view.currency),
                    ...provider,
                  })
                : minProblem === 'high'
                  ? t('pa_min_err_high', { amt: money(MIN_CARD_MAX_MINOR, view.currency) })
                  : t('err.invalid')}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">{t('pa_min_d')}</p>
          {can && view.minCardMinor !== null && !editingMin ? (
            <div>
              <Button variant="ghost" size="sm" onClick={() => setMin(null)} disabled={pending}>
                {t('pa_min_reset', provider)}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="grid gap-1 p-3">
          <p className="font-medium">{t('pa_tips')}</p>
          <p className="text-sm text-muted-foreground" data-testid="paying-tips">
            {view.tips
              ? t('pa_tips_on', { source: view.source })
              : t('pa_tips_off', { source: view.source })}
          </p>
        </div>
      </div>

      <PayingLegalCard view={view} runner={runner} />

      <Dialog open={disconnecting} onOpenChange={setDisconnecting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pa_dc_t', provider)}</DialogTitle>
            <DialogDescription>{t('pa_dc_b', provider)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnecting(false)}>
              {t('pa_dc_keep')}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              data-testid="paying-disconnect-confirm"
              onClick={() =>
                run(() => disconnectPayingAction({ venueId }), {
                  done: t('pa_dc_toast', provider),
                  words,
                  onOk: () => setDisconnecting(false),
                  onFail: () => setDisconnecting(false),
                })
              }
            >
              {t('pa_dc_ok')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {runner.dialog}
    </div>
  )
}

/** The server's missing list as items, in its order: D125's checks, then the venue's details. */
function missingItems(view: PayingView): Missing[] {
  return view.missing.map((check): Missing => {
    if (check === 'cardPayments') return view.state === 'connected' ? 'card' : 'account'
    if (check === 'paymentTables') return 'tables'
    if (check === 'legalDetails') return 'details'
    return check
  })
}

/** One of the owner's two ticks: saves at once, with Undo. */
function MissingTick({
  check,
  label,
  can,
  pending,
  onChange,
}: {
  check: Tick
  label: string
  can: boolean
  pending: boolean
  onChange: (done: boolean) => void
}) {
  const id = `pay-tick-${check}`
  if (!can) return <p className="min-w-0 flex-1 basis-56 break-words text-sm">{label}</p>
  return (
    <div className="flex min-w-0 flex-1 basis-56 items-start gap-3">
      <Checkbox
        id={id}
        checked={false}
        disabled={pending}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <Label htmlFor={id} className="min-w-0 break-words font-normal leading-snug">
        {label}
      </Label>
    </div>
  )
}
