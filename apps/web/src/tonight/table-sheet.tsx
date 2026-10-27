'use client'

// One table's details (Patterns: "Everything about one thing"; plan §3): a side sheet on the
// tablet, a bottom drawer on a phone. It shows how long the sitting has been open, its sent orders
// and its bill as last read, and holds "Close for phones" (no dialog, the Undo toast) and "New
// guests" (a dialog that names the consequence, rule 11). Reached by tapping an open tile, so
// closing is two taps (plan §10 Q5).
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

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
import {
  closeTableAction,
  newGuestsAction,
  openTableAction,
  tableBillAction,
} from '@/server/tonight/actions'
import type { TableSheetBill } from '@/server/tonight/load'
import type { TableTile, TonightView } from '@/server/tonight/view'

import { useMoney } from './money'
import { useTonightRun } from './run'
import { useTableName } from './table-name'

export function TableSheet({
  tile,
  bar,
  view,
  onClose,
}: {
  tile: TableTile
  bar: string | null
  view: TonightView
  onClose: () => void
}) {
  const t = useTranslations('tonight')
  const isMobile = useIsMobile()
  const { run, busy } = useTonightRun()
  const [newGuests, setNewGuests] = useState(false)
  const [bill, setBill] = useState<TableSheetBill | null | undefined>(undefined)
  const money = useMoney()
  const tableName = useTableName()
  const name = tableName(tile.label, tile.numbered)

  useEffect(() => {
    let live = true
    void tableBillAction({ venueId: view.venueId, tableId: tile.id }).then((result) => {
      if (live) setBill(result.ok ? result.bill : null)
    })
    return () => {
      live = false
    }
  }, [view.venueId, tile.id])

  const since = tile.since ?? ''
  const sub = bar === null ? t('sh_sub_nobar', { since }) : t('sh_sub', { bar, since })
  const details = (
    <dl className="space-y-1 px-4 text-base">
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">{t('sh_f1', { k: tile.sentOrders })}</dt>
      </div>
      {bill === undefined || bill === null ? null : (
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">
            {t('sh_f2', { amt: money(bill.totalMinor, bill.currency) })}
          </dt>
        </div>
      )}
    </dl>
  )
  const actions = view.can.openClose ? (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-12 whitespace-normal"
        disabled={busy}
        onClick={() => {
          onClose()
          run({
            id: `table:${tile.id}`,
            act: () => closeTableAction({ venueId: view.venueId, tableId: tile.id }),
            done: t('t_closed', { table: name }),
            undo: () => openTableAction({ venueId: view.venueId, tableId: tile.id }),
          })
        }}
      >
        {t('sh_close')}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-12 whitespace-normal"
        disabled={busy}
        onClick={() => setNewGuests(true)}
      >
        {t('sh_new')}
      </Button>
    </>
  ) : null

  return (
    <>
      {isMobile ? (
        <Drawer open onOpenChange={(open) => !open && onClose()}>
          <DrawerContent data-testid="table-sheet">
            <DrawerHeader>
              <DrawerTitle className="[overflow-wrap:anywhere]">{name}</DrawerTitle>
              <DrawerDescription>{sub}</DrawerDescription>
            </DrawerHeader>
            {details}
            <DrawerFooter>{actions}</DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open onOpenChange={(open) => !open && onClose()}>
          <SheetContent data-testid="table-sheet">
            <SheetHeader>
              <SheetTitle className="[overflow-wrap:anywhere]">{name}</SheetTitle>
              <SheetDescription>{sub}</SheetDescription>
            </SheetHeader>
            {details}
            <SheetFooter>{actions}</SheetFooter>
          </SheetContent>
        </Sheet>
      )}
      <Dialog open={newGuests} onOpenChange={setNewGuests}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ng_t', { table: name })}</DialogTitle>
            <DialogDescription>{t('ng_b', { source: view.source })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="h-11"
              onClick={() => setNewGuests(false)}
            >
              {t('ng_keep')}
            </Button>
            <Button
              type="button"
              className="h-11"
              disabled={busy}
              onClick={() => {
                setNewGuests(false)
                onClose()
                run({
                  id: `table:${tile.id}`,
                  act: () =>
                    newGuestsAction({
                      venueId: view.venueId,
                      tableId: tile.id,
                      ...(tile.sittingId === null ? {} : { sittingId: tile.sittingId }),
                    }),
                  done: t('ng_toast', { table: name }),
                })
              }}
            >
              {t('ng_ok')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
