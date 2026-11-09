'use client'

// Everything one spot holds (#327; Patterns: "Everything about one thing"): a side sheet on the
// tablet, a bottom drawer on a phone, opened by tapping the spot on the plan — one tap, as the
// screen plan's budget says.
//
// What it says, in this order: the state in a word, the seats, the Table its orders go onto (a
// spot that is not a table says so plainly — log 1.68), then every party and block on it this
// night, each with its hours. The whole of a name the tile had to clip is here.
//
// Two writes and one more read live on it: Block… opens the dialog, Unblock lifts the block in one
// tap, and History reads the spot's lines out of the one Log (D141) — the second tap of the budget,
// not a screen of its own. A role that may not block is told who may, in one line; on the venue's
// shared device the button is there and the PIN sheet asks for a name (D141 12.11).
import { useTranslations } from 'next-intl'
import { useCallback, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { WRAPS } from '@/lib/wrapping'
import { spotHistoryAction } from '@/server/reservations/actions'
import type {
  RvFrame,
  RvHoldView,
  RvKindView,
  RvSpotHistoryList,
  RvSpotView,
} from '@/server/reservations/view'
import { READ_FAILED, readAttempt } from '@/tonight/read-attempt'
import { ReadFailed } from '@/tonight/tab-parts'
import { useWho } from '@/tonight/who'
import { KindSymbol, StateMark } from './plan-shape'
import { useHoldText, useSpotHistoryText, useSpotStateWord } from './plan-words'
import { useGuestsText } from './reservation-words'

/** One labelled line; nothing is drawn where there is nothing to say. */
function Line({ label, value }: { label: string; value: string | null }) {
  if (value === null || value === '') return null
  return (
    <p className="[overflow-wrap:anywhere]">
      <span className="text-muted-foreground">{label}</span> {value}
    </p>
  )
}

/** One party or block on the spot, with its hours. */
function Hold({ hold }: { hold: RvHoldView }) {
  const t = useTranslations('reservations')
  const text = useHoldText()
  const guests = useGuestsText()
  const { main, until } = text(hold)
  const name = hold.kind === 'block' ? null : (hold.name ?? t('no_name'))
  return (
    <li
      className="flex flex-wrap items-baseline gap-x-2 [overflow-wrap:anywhere]"
      data-testid="rv-spot-hold"
      data-now={hold.now}
    >
      {name === null ? null : <span className="font-medium">{name}</span>}
      {hold.partySize === null ? null : (
        <span className="text-muted-foreground">{guests(hold.partySize)}</span>
      )}
      <span>{main}</span>
      {until === '' ? null : <span className="text-muted-foreground">{until}</span>}
    </li>
  )
}

export function SpotSheet({
  spot,
  kind,
  frame,
  day,
  busy,
  sayWhoBlocks,
  onBlock,
  onUnblock,
  onClose,
}: {
  spot: RvSpotView
  /** The venue's own kind of this spot, for its symbol and its word. */
  kind: RvKindView | null
  frame: RvFrame
  /** The night the plan is showing, so the history knows which night it is read from. */
  day: string
  busy: boolean
  /**
   * Whether to say who may block instead: this night may be written, but this role may not block.
   * A night that has passed says so in its own banner, so the line would only repeat it.
   */
  sayWhoBlocks: boolean
  /** Opens the Block dialog; absent where this role may not block. */
  onBlock: (() => void) | null
  /** Lifts the block that holds the spot now, by its reservation. */
  onUnblock: ((reservationId: string) => void) | null
  onClose: () => void
}) {
  const t = useTranslations('reservations')
  const stateWord = useSpotStateWord()
  const sentence = useSpotHistoryText()
  const who = useWho()
  // undefined before History is tapped, null when the read never got through.
  const [history, setHistory] = useState<RvSpotHistoryList | null | undefined>(undefined)
  const [reading, setReading] = useState(false)

  const read = useCallback(() => {
    setReading(true)
    void readAttempt(() => spotHistoryAction({ venueId: frame.venueId, spotId: spot.id })).then(
      (result) => {
        setReading(false)
        setHistory(result === READ_FAILED || !result.ok ? null : result.history)
      },
    )
  }, [frame.venueId, spot.id])

  /** The block holding the spot now: what Unblock lifts. */
  const block = spot.holds.find((hold) => hold.kind === 'block' && hold.now) ?? null
  const lines = (history?.lines ?? [])
    .map((line) => ({ line, words: sentence(line) }))
    .filter((one): one is { line: typeof one.line; words: string } => one.words !== null)

  const body = (
    <div className="space-y-4 overflow-y-auto px-4 text-sm" data-testid="rv-spot-body">
      <p className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" data-testid="rv-spot-state">
          <StateMark state={spot.state} className="size-3.5" />
          {stateWord(spot.state)}
        </Badge>
        {kind === null ? null : (
          <span className="flex items-center gap-1 text-muted-foreground">
            <KindSymbol symbol={kind.symbol} className="size-3.5" />
            {kind.label}
          </span>
        )}
      </p>
      <Line label={t('p_seats')} value={spot.seats === null ? null : String(spot.seats)} />
      {spot.table === null ? (
        <p className="text-muted-foreground" data-testid="rv-spot-no-table">
          {t('p_no_table')}
        </p>
      ) : (
        <div className="space-y-1" data-testid="rv-spot-table">
          <Line label={t('p_table')} value={spot.table.label} />
          <p className="text-muted-foreground">
            {spot.table.hasCode ? t('p_code_yes') : t('p_code_no')}
          </p>
        </div>
      )}
      <section className="space-y-1">
        <h3 className="font-medium">{t('p_holds')}</h3>
        {spot.holds.length === 0 ? (
          <p className="text-muted-foreground" data-testid="rv-spot-nothing">
            {t('p_nothing')}
          </p>
        ) : (
          <ul className="space-y-1" data-testid="rv-spot-holds">
            {spot.holds.map((hold) => (
              <Hold key={`${hold.reservationId}:${hold.time}`} hold={hold} />
            ))}
          </ul>
        )}
      </section>
      {sayWhoBlocks ? (
        <p className="text-muted-foreground" data-testid="rv-no-block">
          {t('p_no_block')}
        </p>
      ) : null}
      <section className="space-y-1">
        <h3 className="font-medium">{t('p_history_t', { spot: spot.name })}</h3>
        {history === undefined ? (
          <Button
            type="button"
            variant="outline"
            className={WRAPS}
            disabled={reading}
            data-testid="rv-spot-history"
            onClick={read}
          >
            {t('sh_history')}
          </Button>
        ) : history === null ? (
          <ReadFailed onRetry={read} />
        ) : lines.length === 0 ? (
          <p className="text-muted-foreground" data-testid="rv-history-empty">
            {t('p_history_empty')}
          </p>
        ) : (
          <ul className="space-y-1 text-muted-foreground" data-testid="rv-spot-log">
            {lines.map(({ line, words }) => (
              <li key={line.seq} className="[overflow-wrap:anywhere]">
                <span className="tabular-nums">
                  {line.day === day ? line.time : `${line.day} ${line.time}`}
                </span>
                {' · '}
                {line.name === null ? words : `${words} — ${line.name}`}
                {' · '}
                {who(line.by)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )

  const buttons = (
    <>
      {block !== null && onUnblock !== null ? (
        <Button
          type="button"
          className={WRAPS}
          disabled={busy}
          data-testid="rv-unblock"
          onClick={() => onUnblock(block.reservationId)}
        >
          {t('p_unblock')}
        </Button>
      ) : null}
      {block === null && onBlock !== null ? (
        <Button
          type="button"
          variant="outline"
          className={WRAPS}
          disabled={busy}
          data-testid="rv-block"
          onClick={onBlock}
        >
          {t('p_block')}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        className="h-12"
        data-testid="rv-spot-close"
        onClick={onClose}
      >
        {t('close')}
      </Button>
    </>
  )

  const isMobile = useIsMobile()
  const sub = [kind?.label, spot.seats === null ? null : `${t('p_seats')} ${spot.seats}`]
    .filter((part): part is string => part !== null && part !== undefined)
    .join(' · ')

  return isMobile ? (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent data-testid="rv-spot-sheet">
        <DrawerHeader>
          <DrawerTitle className="[overflow-wrap:anywhere]">{spot.name}</DrawerTitle>
          <DrawerDescription>{sub}</DrawerDescription>
        </DrawerHeader>
        {body}
        <DrawerFooter>{buttons}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  ) : (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent data-testid="rv-spot-sheet">
        <SheetHeader>
          <SheetTitle className="[overflow-wrap:anywhere]">{spot.name}</SheetTitle>
          <SheetDescription>{sub}</SheetDescription>
        </SheetHeader>
        {body}
        <SheetFooter>{buttons}</SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
