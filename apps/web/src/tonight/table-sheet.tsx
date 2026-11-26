'use client'

// One table's details (Patterns: "Everything about one thing"; plan §3): a side sheet on the
// tablet, a bottom drawer on a phone. It shows how long the sitting has been open, its sent orders
// and its bill as last read, and holds "Close for phones" (no dialog, the Undo toast) and "New
// guests" (a dialog that names the consequence, rule 11). Reached by tapping a tile, so closing is
// two taps (plan §10 Q5); a closed table's sheet holds "Open for phones" instead (S16: a tap on a
// status tile opens the thing, never acts at once), with the Undo toast the open always had. The
// phone's drawer closes with a visible "Close" like the other Tonight drawers, the tablet's sheet
// with its X at 44 px (S3). Before phone ordering starts, the sheet says when it does, and on a
// night phones cannot order it says so (S4).
//
// Who is seated is the first thing it says (walk P20, #419): the party's name and its guests, one
// line each, in the ordinary text colour and weight — the sheet is a list of facts, and none of them
// is louder than another. It is empty for a role that does not work tonight's reservations.
//
// One line says the sitting's pay rule and which level set it, where that is worth saying (#334,
// D122 §5): pay first, or a rule the party at the table carries. The rule is set on the
// reservation's own sheet — never here, because this screen is the waiter's and the rule is the
// hostess's (D141).
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
import { WRAPS } from '@/lib/wrapping'
import {
  cancelShareAction,
  closeTableAction,
  newGuestsAction,
  openTableAction,
  tableBillAction,
} from '@/server/tonight/actions'
import type { TableSheetBill, TableSheetGroup } from '@/server/tonight/load'
import type { TableTile, TonightView } from '@/server/tonight/view'

import { useMoney } from './money'
import { readAttempt } from './read-attempt'
import { useTonightRun, wroteSomething } from './run'
import { CLOSE_44 } from './tab-parts'
import { useTableName } from './table-name'

/**
 * The one string for a sitting's pay rule: the rule and the level that set it, in one sentence
 * each, because Bulgarian makes one word do one job and a sentence built out of parts would read
 * wrong in it. Only the cases the tile keeps (`payRuleLine`) have one.
 */
function payRuleKey(rule: NonNullable<TableTile['payRule']>): string {
  if (!rule.payFirst) return 'sh_pr_b_party'
  return rule.level === 'table'
    ? 'sh_pr_f_table'
    : rule.level === 'reservation'
      ? 'sh_pr_f_party'
      : 'sh_pr_f_club'
}

export function TableSheet({
  tile,
  bar,
  view,
  onClose,
  onOpenForPhones,
}: {
  tile: TableTile
  bar: string | null
  view: TonightView
  onClose: () => void
  /** A closed table's one action: open it for phones (the grid asks first where it is booked). */
  onOpenForPhones: () => void
}) {
  const t = useTranslations('tonight')
  const isMobile = useIsMobile()
  const { run, busy } = useTonightRun()
  const [newGuests, setNewGuests] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [bill, setBill] = useState<TableSheetBill | null | undefined>(undefined)
  // The party's other tables and its total, where this table is in a linked group (#540).
  const [group, setGroup] = useState<TableSheetGroup | null>(null)
  const money = useMoney()
  const tableName = useTableName()
  const name = tableName(tile.label, tile.numbered)

  useEffect(() => {
    let live = true
    void readAttempt(() => tableBillAction({ venueId: view.venueId, tableId: tile.id })).then(
      (result) => {
        if (!live) return
        setBill(result.ok ? result.bill : null)
        setGroup(result.ok ? (result.group ?? null) : null)
      },
    )
    return () => {
      live = false
    }
  }, [view.venueId, tile.id])

  /** One seated party: its name (or that it has none) and, where the book has it, its guests. */
  const partyLine = (party: TableTile['parties'][number]) => {
    const who = party.name ?? t('sh_party_noname')
    return party.size === null ? who : t('sh_party', { name: who, k: party.size })
  }
  /** Every table of the venue by id, so a group's members are named as their own tiles are. */
  const tiles = new Map(
    [...view.groups.flatMap((bar) => bar.tables), ...view.paymentTables].map((one) => [
      one.id,
      one,
    ]),
  )
  const closed = tile.state === 'closed'
  const since = tile.since ?? ''
  const sub = closed
    ? bar === null
      ? t('sh_sub_closed_nobar')
      : t('sh_sub_closed', { bar })
    : bar === null
      ? t('sh_sub_nobar', { since })
      : t('sh_sub', { bar, since })
  const details = (
    <dl className="space-y-1 px-4 text-base">
      {tile.parties.map((party) => (
        <div key={party.id} className="flex justify-between gap-3">
          <dt className="[overflow-wrap:anywhere]" data-testid="sh-party">
            {partyLine(party)}
          </dt>
        </div>
      ))}
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
      {group === null ? null : (
        <>
          <div className="flex justify-between gap-3" data-testid="sh-group">
            <dt>{t('sh_group', { n: group.tables.length })}</dt>
          </div>
          <div className="flex justify-between gap-3">
            <dt
              className="text-muted-foreground [overflow-wrap:anywhere]"
              data-testid="sh-group-tables"
            >
              {group.tables
                .map((member) => tableName(member.label, tiles.get(member.id)?.numbered ?? false))
                .join(', ')}
            </dt>
          </div>
          <div className="flex justify-between gap-3" data-testid="sh-group-total">
            <dt className="text-muted-foreground">{t('sh_group_total')}</dt>
            <dd className="font-medium tabular-nums">{money(group.totalMinor, group.currency)}</dd>
          </div>
          {group.tables
            .filter((member) => member.updating)
            .map((member) => (
              <div key={member.id} className="flex justify-between gap-3">
                <dt className="[overflow-wrap:anywhere]" data-testid="sh-group-updating">
                  {t('sh_group_updating', { name: member.label })}
                </dt>
              </div>
            ))}
          {group.final ? null : (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground" data-testid="sh-group-not-final">
                {t('sh_group_not_final')}
              </dt>
            </div>
          )}
        </>
      )}
      {tile.share === undefined ? null : (
        <div className="flex justify-between gap-3">
          <dt className="[overflow-wrap:anywhere]" data-testid="sh-share">
            {tile.share.minutesLeft === null
              ? t('sh_share_start', {
                  held: money(tile.share.heldMinor, view.currency),
                  total: money(tile.share.sharedMinor, view.currency),
                })
              : t('sh_share', {
                  held: money(tile.share.heldMinor, view.currency),
                  total: money(tile.share.sharedMinor, view.currency),
                  m: tile.share.minutesLeft,
                })}
          </dt>
        </div>
      )}
      {tile.payRule === null ? null : (
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground" data-testid="sh-pay-rule">
            {t(payRuleKey(tile.payRule))}
          </dt>
        </div>
      )}
      {view.phoneOrders === null ? null : (
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground" data-testid="sh-orders-start">
            {view.phoneOrders.state === 'later'
              ? t('orders_start', { time: view.phoneOrders.at })
              : t('orders_none')}
          </dt>
        </div>
      )}
    </dl>
  )
  const actions = !view.can.openClose ? null : closed ? (
    <Button
      type="button"
      className={WRAPS}
      // A closed night opens nothing: the page says so (S13).
      disabled={busy || view.nightEnd !== null}
      data-testid="sh-open"
      onClick={() => {
        onClose()
        onOpenForPhones()
      }}
    >
      {t('sh_open')}
    </Button>
  ) : (
    <>
      {tile.share === undefined ? null : (
        // The primary action while a share gathers (#545): one tap here, one on the confirmation.
        <Button
          type="button"
          className={WRAPS}
          disabled={busy}
          data-testid="sh-cancel-share"
          onClick={() => setCancelling(true)}
        >
          {t('sh_cancel')}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        className={WRAPS}
        disabled={busy}
        onClick={() => {
          onClose()
          run({
            id: `table:${tile.id}`,
            act: () => closeTableAction({ venueId: view.venueId, tableId: tile.id }),
            done: t('t_closed', { table: name }),
            undo: (_, undo) => openTableAction({ venueId: view.venueId, tableId: tile.id, undo }),
            undoWhen: wroteSomething,
          })
        }}
      >
        {t('sh_close')}
      </Button>
      <Button
        type="button"
        variant="outline"
        className={WRAPS}
        disabled={busy}
        onClick={() => setNewGuests(true)}
      >
        {t('sh_new')}
      </Button>
    </>
  )

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
            <DrawerFooter>
              {actions}
              <Button type="button" variant="ghost" className={WRAPS} onClick={onClose}>
                {t('close')}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open onOpenChange={(open) => !open && onClose()}>
          <SheetContent data-testid="table-sheet" className={CLOSE_44}>
            <SheetHeader className="pr-14">
              <SheetTitle className="[overflow-wrap:anywhere]">{name}</SheetTitle>
              <SheetDescription>{sub}</SheetDescription>
            </SheetHeader>
            {details}
            <SheetFooter>{actions}</SheetFooter>
          </SheetContent>
        </Sheet>
      )}
      <Dialog open={cancelling && tile.share !== undefined} onOpenChange={setCancelling}>
        <DialogContent className={CLOSE_44}>
          <DialogHeader className="pr-8">
            <DialogTitle>{t('cs_t')}</DialogTitle>
            <DialogDescription>{t('cs_b')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="h-11"
              onClick={() => setCancelling(false)}
            >
              {t('cs_keep')}
            </Button>
            <Button
              type="button"
              className="h-11"
              disabled={busy}
              data-testid="sh-cancel-share-ok"
              onClick={() => {
                const share = tile.share
                setCancelling(false)
                if (share === undefined) return
                onClose()
                // No Undo: the guests lose what they had gathered, and nothing brings a hold back.
                run({
                  id: `share:${share.paymentId}`,
                  act: () =>
                    cancelShareAction({
                      venueId: view.venueId,
                      tableId: tile.id,
                      paymentId: share.paymentId,
                    }),
                  done: t('cs_toast'),
                })
              }}
            >
              {t('sh_cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={newGuests} onOpenChange={setNewGuests}>
        <DialogContent className={CLOSE_44}>
          <DialogHeader className="pr-8">
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
