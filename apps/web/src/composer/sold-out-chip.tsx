'use client'

// The "Sold out (N)" chip in the header of the item pane (brief S3-08, D46) and the quick list it
// opens: every item a manager marked sold out tonight, across the whole menu, each with a
// "Back on sale" button that takes OUR mark off (rule 5: it can never put back on sale an item
// the till has off sale, and such items are not in the list at all). The chip is there for everyone
// who can see the composer once something is marked; the buttons only for owners and admins.
import type { NodeId } from '@restro/core'
import { BanIcon, Undo2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { useComposer } from './composer-context'
import { itemName } from './labels'
import type { ComposerView } from './view-model'

/** The items marked sold out tonight (and not off sale in the till), by name. */
export function soldOutTonightIds(view: ComposerView): NodeId[] {
  return (Object.values(view.items) as ComposerView['items'][NodeId][])
    .filter((item) => item.soldOutTonight && item.offSale === null)
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
    .map((item) => item.id)
}

export function SoldOutChip() {
  const t = useTranslations('composer')
  const { view, canMarkSoldOut, setSoldOut, openItem } = useComposer()
  const [open, setOpen] = useState(false)
  const ids = soldOutTonightIds(view)
  // The list empties as items are put back on sale: close it with the last one.
  if (ids.length === 0) return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="sold-out-chip"
      >
        <BanIcon aria-hidden />
        {t('soldOut.chip', { count: ids.length })}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" data-testid="sold-out-list">
          <DialogHeader>
            <DialogTitle>{t('soldOut.listTitle')}</DialogTitle>
            <DialogDescription>{t('soldOut.listDescription')}</DialogDescription>
          </DialogHeader>
          <ul className="grid max-h-96 gap-1.5 overflow-y-auto">
            {ids.map((id) => {
              const name = itemName(view, id, t('unnamedItem'))
              return (
                <li
                  key={id}
                  data-testid="sold-out-entry"
                  data-item-id={id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      openItem(id)
                    }}
                    className="min-w-0 truncate rounded-sm text-left text-sm font-medium hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {name}
                  </button>
                  {canMarkSoldOut ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSoldOut([id], false)}
                      aria-label={t('soldOut.unmarkFor', { name })}
                      data-testid="sold-out-entry-unmark"
                    >
                      <Undo2Icon aria-hidden />
                      {t('soldOut.unmark')}
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}
