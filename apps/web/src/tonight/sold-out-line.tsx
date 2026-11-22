'use client'

// "Sold out tonight" on one line of a sent order (D147, #437): the tap where the bartender is
// already standing. Whoever may review orders may mark, so this is not a manager's control; on a
// shared device the tablet's own account does it without a PIN, exactly as it answers an
// Unconfirmed order (the mark is cautious and can be taken back by the same tap).
//
// One button, which says what it will do: "Sold out tonight" on an item on sale, "Back on sale" on
// one already marked, with the state beside it so nobody has to read the button to know. Taking a
// mark off is the same right as making one, and every tap is in the night's Log (#437 leaves the
// un-mark rule to Martin; this is the cautious reading his ticket names).
//
// The mark is the whole venue's, not this table's: the item goes off the guest menu for everyone
// until the service day ends. Guests see it on their next look at the menu (every 15 s).
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { markSoldOutAction } from '@/server/tonight/actions'
import type { Frame } from '@/server/tonight/night-view'

import { useTonightRun } from './run'

/** What the tap needs to know of the screen. */
export type SoldOutFrame = Pick<Frame, 'venueId' | 'device'> & {
  readonly can: Pick<Frame['can'], 'soldOut'>
}

export function SoldOutLine({
  frame,
  itemId,
  name,
  soldOut,
  onDone,
}: {
  frame: SoldOutFrame
  /** Our own item id, as the sheet read it. */
  itemId: string
  /** The item as the guest menu names it, for the toast. */
  name: string
  /** It already carries tonight's mark. */
  soldOut: boolean
  /** Called after the mark was saved: the sheet reads again. */
  onDone?: () => void
}) {
  const t = useTranslations('tonight')
  const { run, busy } = useTonightRun()
  if (!frame.can.soldOut && !frame.device) return null

  const tap = () =>
    run({
      id: `sold_out:${itemId}`,
      act: async () => {
        const result = await markSoldOutAction({
          venueId: frame.venueId,
          itemId,
          soldOut: !soldOut,
        })
        if (result.ok) onDone?.()
        return result
      },
      done: t(soldOut ? 'sold_back_t' : 'sold_mark_t', { name }),
    })

  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      {soldOut ? (
        <span className="text-muted-foreground" data-testid="sold-out-state">
          {t('sold_is')}
        </span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={tap}
        data-testid={soldOut ? 'sold-out-back' : 'sold-out-mark'}
      >
        {t(soldOut ? 'sold_back' : 'sold_mark')}
      </Button>
    </span>
  )
}
