'use client'

// Tonight, screen 1: "Actions and tables" (#85; plan `docs/deliverables/2026-10-21-tonight-screen-1-plan.md`).
// Two columns on the bar tablet, "Needs you" first and the tables beside it, each scrolling on its
// own; one column on a phone with a segmented control between the two (Needs you is open first).
// The page keeps itself current by asking the server again every few seconds; a new row is
// announced to a screen reader and by one short sound that can be muted on the device. Nothing
// moves: no animation, no reordering for style.
import { EllipsisIcon, Volume2Icon, VolumeXIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { cn } from '@/lib/utils'
import {
  closeAllTablesAction,
  liftOrderingAction,
  openAllTablesAction,
  pauseOrderingAction,
  undoOpenAllAction,
} from '@/server/tonight/actions'
import type { TonightView } from '@/server/tonight/view'

import { ActionRowItem, OutOfStockNotice, useAgo } from './action-rows'
import { callKindsText } from './call-kinds'
import { moneyTitleKey } from './money-rows'
import { PauseBanners } from './pause-banners'
import { RunProvider, useTonightRun } from './run'
import { useTableName } from './table-name'
import { TablesGrid } from './tables-grid'

/** How often the screen asks the server for the night as it is now. */
const REFRESH_MS = 5000
const MUTE_KEY = 'restro.tonight.muted'

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

/** One short beep; browsers that have not been tapped yet stay silent, which is fine. */
function beep() {
  try {
    const Context = window.AudioContext
    const audio = new Context()
    const tone = audio.createOscillator()
    const gain = audio.createGain()
    tone.frequency.value = 880
    gain.gain.value = 0.08
    tone.connect(gain)
    gain.connect(audio.destination)
    tone.start()
    tone.stop(audio.currentTime + 0.18)
    tone.onended = () => void audio.close()
  } catch {
    // No audio on this device: the announcement and the row are still there.
  }
}

function PauseMenu({ view }: { view: TonightView }) {
  const t = useTranslations('tonight')
  const { run, busy } = useTonightRun()
  const named = view.groups.some((group) => group.name !== null)
  const choices = [
    ...(view.canPauseAll ? [{ barId: null as string | null, name: t('p_all') }] : []),
    ...view.pausableBars.map((bar) => ({ barId: bar.id as string | null, name: bar.name })),
  ]
  if (!view.can.pause || choices.length === 0) return null

  function pause(barId: string | null, name: string) {
    run({
      id: `pause:${barId ?? 'all'}`,
      act: () => pauseOrderingAction({ venueId: view.venueId, barId }),
      done: t('p_toast', { scope: name }),
      // Lifting needs a manager; without that right the toast has no Undo.
      ...(view.can.lift && !view.device
        ? {
            undo: (done: { details: Record<string, string | number | boolean | null> }) =>
              liftOrderingAction({ venueId: view.venueId, pauseId: String(done.details.pauseId) }),
          }
        : {}),
    })
  }

  const label = t('pause')
  // With no bars to choose from, the pause is one tap.
  if (!named && choices.length === 1) {
    const only = choices[0]
    return (
      <Button
        type="button"
        variant="outline"
        className="h-11"
        disabled={busy}
        onClick={() => only && pause(only.barId, only.name)}
      >
        {label}
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="h-11" disabled={busy}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {choices.map((choice) => (
          <DropdownMenuItem
            key={choice.barId ?? 'all'}
            className="min-h-11 [overflow-wrap:anywhere]"
            onSelect={() => pause(choice.barId, choice.name)}
          >
            {choice.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Content({ view }: { view: TonightView }) {
  const t = useTranslations('tonight')
  const router = useRouter()
  const { run, busy } = useTonightRun()
  const ago = useAgo(view.now)
  const tableName = useTableName()
  const [part, setPart] = useState<'needs' | 'tables'>('needs')
  const [muted, setMuted] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [closeAll, setCloseAll] = useState(false)
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => setMuted(readMuted()), [])
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [router])

  // A row that was not there on the last render is announced, and sounds once (not the first load).
  useEffect(() => {
    const ids = new Set(view.rows.map((row) => row.id))
    const before = seen.current
    seen.current = ids
    if (before === null) return
    const fresh = view.rows.filter((row) => !before.has(row.id))
    if (fresh.length === 0) return
    setAnnouncement(
      fresh
        .map((row) =>
          row.money !== undefined
            ? t(moneyTitleKey(row.money))
            : row.kind === 'call'
              ? t('c_t', {
                  table: tableName(row.table, row.numbered),
                  kinds: callKindsText(t, row.callKinds ?? ['waiter']),
                })
              : row.kind === 'paused'
                ? t('g_t', { table: tableName(row.table, row.numbered) })
                : row.kind === 'approval'
                  ? t('a_t')
                  : t('s_t'),
        )
        .join('. '),
    )
    if (!readMuted()) beep()
  }, [view.rows, t, tableName])

  const toggleMute = useCallback(() => {
    const next = !muted
    setMuted(next)
    try {
      window.localStorage.setItem(MUTE_KEY, next ? '1' : '0')
    } catch {
      // The choice lasts until the page is closed.
    }
  }, [muted])

  const closedIds = view.groups
    .flatMap((g) => g.tables)
    .filter((x) => x.state === 'closed')
    .map((x) => x.id)
  const nothingOpen = view.openCount === 0
  // The empty block (with its one filled "Open all") shows while nothing waits at all; a stock notice
  // alone keeps the header's button, so a night with a notice can still be opened.
  const emptyShown = view.rows.length === 0 && view.outOfStock.length === 0
  // A payment stopped before closing waits under "Later", with the stock notice (paying plan).
  const nowRows = view.rows.filter((row) => row.kind !== 'stopped')
  const laterRows = view.rows.filter((row) => row.kind === 'stopped')
  const emptyNight = emptyShown && nothingOpen && view.tableCount > 0

  function openAll() {
    run({
      id: 'open-all',
      ...(view.device
        ? {
            pin: {
              level: 'own' as const,
              title: t('openall'),
              body: t('oa_b', { k: closedIds.length }),
            },
          }
        : {}),
      act: (pin) => openAllTablesAction({ venueId: view.venueId, pin }),
      done: t('oa_toast', { k: closedIds.length }),
      undo: () => undoOpenAllAction({ venueId: view.venueId, tableIds: closedIds }),
    })
  }
  function confirmCloseAll() {
    setCloseAll(false)
    run({
      id: 'close-all',
      ...(view.device
        ? {
            pin: {
              level: 'own' as const,
              title: t('ca_ok'),
              body: t('ca_b', { source: view.source }),
            },
          }
        : {}),
      act: (pin) => closeAllTablesAction({ venueId: view.venueId, pin }),
      done: t('ca_toast'),
    })
  }

  const openAllButton =
    view.can.openClose && closedIds.length > 0 ? (
      <Button
        type="button"
        variant={emptyNight ? 'default' : 'outline'}
        className="h-11"
        disabled={busy}
        onClick={openAll}
      >
        {t('openall')}
      </Button>
    ) : null

  const needs = (
    <section aria-labelledby="needs-title" className="min-w-0 space-y-3">
      <h2 id="needs-title" className="text-lg font-semibold">
        {t('needs')}
        {view.rows.length > 0 ? (
          <span className="ml-2 text-muted-foreground" data-testid="needs-count">
            {view.rows.length}
          </span>
        ) : null}
      </h2>
      {view.rows.length === 0 && view.outOfStock.length === 0 ? (
        <Empty className="p-6 md:p-6">
          <EmptyHeader>
            <EmptyTitle>{nothingOpen ? t('e_night_t') : t('e_open_t')}</EmptyTitle>
            <EmptyDescription>{nothingOpen ? t('e_night_d') : t('e_open_d')}</EmptyDescription>
          </EmptyHeader>
          {nothingOpen ? openAllButton : null}
        </Empty>
      ) : (
        <>
          {nowRows.length > 0 ? (
            <>
              {view.outOfStock.length > 0 || laterRows.length > 0 ? (
                <h3 className="text-sm font-medium text-muted-foreground">{t('now')}</h3>
              ) : null}
              <ul className="space-y-3">
                {nowRows.map((row, index) => (
                  <ActionRowItem
                    key={row.id}
                    row={row}
                    view={view}
                    primary={index === 0}
                    ago={ago(row.at)}
                  />
                ))}
              </ul>
            </>
          ) : null}
          {view.outOfStock.length > 0 || laterRows.length > 0 ? (
            <>
              {view.rows.length > 0 ? (
                <h3 className="text-sm font-medium text-muted-foreground">{t('later')}</h3>
              ) : null}
              <ul className="space-y-3">
                {laterRows.map((row) => (
                  <ActionRowItem
                    key={row.id}
                    row={row}
                    view={view}
                    primary={false}
                    ago={ago(row.at)}
                  />
                ))}
                {view.outOfStock.length > 0 ? (
                  <OutOfStockNotice names={view.outOfStock} source={view.source} />
                ) : null}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  )

  const tables = (
    <section aria-labelledby="tables-title" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="tables-title" className="text-lg font-semibold">
            {t('tables')}
          </h2>
          <p className="text-sm text-muted-foreground" data-testid="open-count">
            {t('openof', { o: view.openCount, t: view.tableCount })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {emptyNight ? null : openAllButton}
          {view.can.openClose && view.openCount > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11"
                  aria-label={t('more')}
                >
                  <EllipsisIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="min-h-11" onSelect={() => setCloseAll(true)}>
                  {t('closeall')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      {view.tableCount === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noTables')}</p>
      ) : (
        <TablesGrid view={view} />
      )}
    </section>
  )

  return (
    <div className="space-y-4" data-testid="tonight">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight">
          {t('title')}
          <span className="ml-2 text-base font-normal text-muted-foreground">{t('tab_act')}</span>
        </h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-pressed={muted}
            aria-label={muted ? t('sound_off') : t('sound_on')}
            onClick={toggleMute}
          >
            {muted ? <VolumeXIcon aria-hidden /> : <Volume2Icon aria-hidden />}
          </Button>
          <PauseMenu view={view} />
        </div>
      </div>
      <PauseBanners view={view} />
      <p role="status" aria-live="polite" className="sr-only" data-testid="announcement">
        {announcement}
      </p>
      {/* The phone's one switch (Patterns: pick one of a few); from lg both parts stand side by side. */}
      <fieldset className="m-0 flex min-w-0 gap-1 rounded-lg border-0 bg-muted p-1 lg:hidden">
        <legend className="sr-only">{t('title')}</legend>
        {(
          [
            ['needs', `${t('ph_needs')}${view.rows.length > 0 ? ` ${view.rows.length}` : ''}`],
            ['tables', t('ph_tables')],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant={part === value ? 'default' : 'ghost'}
            aria-pressed={part === value}
            className="h-11 flex-1"
            onClick={() => setPart(value)}
          >
            {label}
          </Button>
        ))}
      </fieldset>
      {/* Each part is drawn once: below lg the switch shows one, from lg both stand side by side. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6">
        <div
          className={cn(
            part === 'needs' ? '' : 'hidden',
            'lg:block lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto lg:pr-1',
          )}
        >
          {needs}
        </div>
        <div
          className={cn(
            part === 'tables' ? '' : 'hidden',
            'lg:block lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto lg:pr-1',
          )}
        >
          {tables}
        </div>
      </div>
      <Dialog open={closeAll} onOpenChange={setCloseAll}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ca_t')}</DialogTitle>
            <DialogDescription>{t('ca_b', { source: view.source })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="h-11"
              onClick={() => setCloseAll(false)}
            >
              {t('ca_keep')}
            </Button>
            <Button type="button" variant="destructive" className="h-11" onClick={confirmCloseAll}>
              {t('ca_ok')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** The Tonight screen for one venue. */
export function TonightPanel({ view }: { view: TonightView }) {
  const t = useTranslations('tonight')
  // A venue with no POS still reads right where a sentence names its system.
  const named = view.source === '' ? { ...view, source: t('source_none') } : view
  return (
    <RunProvider>
      <Content view={named} />
    </RunProvider>
  )
}
