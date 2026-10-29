'use client'

// One table in the Tables & QR tab (briefs S3-07, S5): a card with its code as a picture (click to
// enlarge), the name guests see (editable by owners and admins; "from {source}: <number>" beside it
// when a till gave the table, a number field of its own when the owner made it), whether its code
// is active, and the menu its code opens (marked when it is the table's own choice). The card's
// menu holds every action: create a code, make a new one or turn it off (the last two stop the
// printed sticker, so they ask first), hide or show the table, move it up or down (and to another
// area, and delete it, on a venue made by hand). Where a connector takes payments the menu also
// marks the table as its bar's payment table (it asks first: the table is hidden and its code stops
// for good) or takes the mark away (one tap, with Undo); a payment table shows its badge and its
// bar instead of a code, and offers neither a code nor Show.
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeIcon,
  EyeOffIcon,
  LandmarkIcon,
  MoreHorizontalIcon,
  MoveRightIcon,
  QrCodeIcon,
  Trash2Icon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useId, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTillLabel } from '@/fields/till-label'
import {
  deleteTableAction,
  issueCodeAction,
  moveTableAction,
  renameTableAction,
  setTableHiddenAction,
  setTableNumberAction,
  turnOffCodeAction,
} from '@/server/tables/actions'
import type { MenuChoice, TableRowView } from '@/server/tables/view'

import { ConfirmDialog } from './confirm-dialog'
import { QrDialog } from './qr-dialog'
import { QrPicture } from './qr-picture'
import { RoutePicker } from './route-picker'
import { usePaymentTable } from './use-payment-table'
import { useRun } from './use-run'

/** What the tab knows about marking payment tables, where a connector takes payments. */
export interface PaymentTableAccess {
  /** The person may mark and unmark (`settings.payment_tables`, on their own sign-in). */
  readonly canMark: boolean
  /** The signed-in person's email, for the password again. */
  readonly email: string
}

export function TableCard({
  row,
  venueId,
  canManage,
  fromTill,
  areaPublic,
  payment,
  menus,
  otherAreas,
  index,
  count,
}: {
  row: TableRowView
  venueId: string
  canManage: boolean
  /** A till gave the venue its tables: no new, deleted or renumbered ones, no move to another area. */
  fromTill: boolean
  /** False when the table's area is hidden. */
  areaPublic: boolean
  /** Payment tables, where a connector can take payments; null elsewhere. */
  payment: PaymentTableAccess | null
  menus: readonly MenuChoice[]
  /** The venue's other areas, for "Move to …". */
  otherAreas: readonly { readonly id: string; readonly name: string; readonly tableCount: number }[]
  /** The table's place in its area, and how many tables the area has. */
  index: number
  count: number
}) {
  const t = useTranslations('tables')
  const tp = useTranslations('ownerSettings')
  const source = useTillLabel()
  const { pending: running, run } = useRun()
  const nameId = useId()
  const numberId = useId()
  const [name, setName] = useState(row.label ?? '')
  const [number, setNumber] = useState(row.number ?? '')
  const [confirm, setConfirm] = useState<'new' | 'off' | 'delete' | 'payment' | null>(null)
  const [enlarged, setEnlarged] = useState(false)
  const shown = row.shownAs ?? t('row.noNumber')
  const paymentTable = usePaymentTable({
    venueId,
    tableId: row.id,
    shown,
    email: payment?.email ?? '',
  })
  const pending = running || paymentTable.pending
  // A payment table never gets a code, Show or a menu back, even if the connector stops offering paying.
  const isPaymentTable = row.isPaymentTable
  // The mark is the venue role's right; the rest of the menu is the organisation's owners and admins.
  const canMark = payment?.canMark === true
  const barName = row.bar?.name ?? tp('pt_no_bar_group')

  // After a change the page brings the saved values back; show them.
  useEffect(() => setName(row.label ?? ''), [row.label])
  useEffect(() => setNumber(row.number ?? ''), [row.number])

  const hasCode = row.hasCode
  const active = row.isPublic && areaPublic
  const codeStatus = hasCode ? (active ? 'codeActive' : 'codePaused') : 'codeNone'

  function saveName() {
    if (name.trim().replace(/\s+/g, ' ') === (row.label ?? '')) return
    run(
      () => renameTableAction({ tableId: row.id, label: name.trim() === '' ? null : name }),
      t('row.nameSaved'),
      (ok) => {
        if (!ok) setName(row.label ?? '')
      },
    )
  }

  function saveNumber() {
    if (number.trim().replace(/\s+/g, ' ') === (row.number ?? '')) return
    run(
      () =>
        setTableNumberAction({
          venueId,
          tableId: row.id,
          number: number.trim() === '' ? null : number,
        }),
      t('row.numberSaved'),
      (ok) => {
        if (!ok) setNumber(row.number ?? '')
      },
    )
  }

  function move(areaId: string | undefined, position: number, done: string) {
    run(() => moveTableAction({ venueId, tableId: row.id, areaId, position }), done)
  }

  return (
    <li
      className="grid min-w-0 gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-xs"
      data-testid="table-card"
      data-table-id={row.id}
      data-has-code={hasCode}
      data-hidden={!row.isPublic}
    >
      <div className="flex items-start gap-3">
        <div className="size-16 shrink-0">
          {row.qrSvg !== null ? (
            <button
              type="button"
              className="block size-16 overflow-hidden rounded-md border bg-white focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              aria-label={t('row.enlarge', { table: shown })}
              onClick={() => setEnlarged(true)}
              data-testid="qr-thumb"
            >
              <QrPicture
                svg={row.qrSvg}
                alt={t('row.qrAlt', { table: shown })}
                className="size-full"
              />
            </button>
          ) : (
            <div
              className="grid size-16 place-items-center rounded-md border border-dashed text-muted-foreground"
              aria-hidden
            >
              <QrCodeIcon className="size-6" />
            </div>
          )}
        </div>

        <div className="grid min-w-0 flex-1 gap-1.5">
          <Label htmlFor={nameId} className="text-xs text-muted-foreground">
            {t('row.nameLabel')}
          </Label>
          {canManage ? (
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={saveName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') setName(row.label ?? '')
              }}
              placeholder={row.number ?? t('row.namePlaceholder')}
              maxLength={40}
              disabled={pending}
              autoComplete="off"
              data-testid="table-name"
            />
          ) : (
            <p id={nameId} className="font-medium" data-testid="table-name-text">
              {shown}
            </p>
          )}
          {fromTill ? (
            <span className="text-xs text-muted-foreground" data-testid="table-number">
              {t('row.fromSource', { source, number: row.number ?? t('row.noNumber') })}
            </span>
          ) : canManage ? (
            <div className="flex items-center gap-2">
              <Label htmlFor={numberId} className="text-xs text-muted-foreground">
                {t('row.numberLabel')}
              </Label>
              <Input
                id={numberId}
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                onBlur={saveNumber}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') setNumber(row.number ?? '')
                }}
                maxLength={40}
                disabled={pending}
                autoComplete="off"
                className="h-8 max-w-28"
                data-testid="table-number-input"
              />
            </div>
          ) : (
            <span className="text-xs text-muted-foreground" data-testid="table-number">
              {t('row.numberLabel')}: {row.number ?? t('row.noNumber')}
            </span>
          )}
        </div>

        {canManage || canMark ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label={t('row.actions', { table: shown })}
                disabled={pending}
                data-testid="table-menu"
              >
                <MoreHorizontalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              {!canManage || isPaymentTable ? null : hasCode ? (
                <>
                  <DropdownMenuItem onSelect={() => setConfirm('new')} data-testid="new-code">
                    {t('row.newCode')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setConfirm('off')} data-testid="turn-off-code">
                    {t('row.turnOff')}
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem
                  disabled={!active}
                  onSelect={() =>
                    run(() => issueCodeAction({ tableId: row.id }), t('row.codeCreated'))
                  }
                  data-testid="create-code"
                >
                  {t('row.createCode')}
                </DropdownMenuItem>
              )}
              {canMark ? (
                <DropdownMenuItem
                  onSelect={() => (isPaymentTable ? paymentTable.unmark() : setConfirm('payment'))}
                  data-testid={isPaymentTable ? 'unmark-payment-table' : 'mark-payment-table'}
                >
                  <LandmarkIcon aria-hidden />
                  {isPaymentTable ? tp('pt_unmark') : tp('pt_mark')}
                </DropdownMenuItem>
              ) : null}
              {!canManage || isPaymentTable ? null : (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() =>
                      run(
                        () =>
                          setTableHiddenAction({ venueId, tableId: row.id, hidden: row.isPublic }),
                        row.isPublic ? t('row.hiddenDone') : t('row.shownDone'),
                      )
                    }
                    data-testid="toggle-hidden"
                  >
                    {row.isPublic ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
                    {row.isPublic ? t('row.hide') : t('row.show')}
                  </DropdownMenuItem>
                </>
              )}
              {canManage ? (
                <>
                  <DropdownMenuItem
                    disabled={index === 0}
                    onSelect={() => move(undefined, index - 1, t('row.moved'))}
                    data-testid="move-up"
                  >
                    <ArrowUpIcon aria-hidden />
                    {t('row.moveUp')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index >= count - 1}
                    onSelect={() => move(undefined, index + 1, t('row.moved'))}
                    data-testid="move-down"
                  >
                    <ArrowDownIcon aria-hidden />
                    {t('row.moveDown')}
                  </DropdownMenuItem>
                  {fromTill
                    ? null
                    : otherAreas.map((area) => (
                        <DropdownMenuItem
                          key={area.id}
                          onSelect={() => move(area.id, area.tableCount, t('row.moved'))}
                          data-testid="move-to-area"
                        >
                          <MoveRightIcon aria-hidden />
                          {t('row.moveTo', { area: area.name })}
                        </DropdownMenuItem>
                      ))}
                  {fromTill ? null : (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setConfirm('delete')}
                        data-testid="delete-table"
                      >
                        <Trash2Icon aria-hidden />
                        {t('row.delete')}
                      </DropdownMenuItem>
                    </>
                  )}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {isPaymentTable ? (
          <Badge variant="secondary" data-testid="payment-table-badge">
            {tp('pt_badge')}
          </Badge>
        ) : (
          <>
            {row.isPublic ? null : (
              <Badge variant="outline" data-testid="table-hidden">
                {t('row.hidden')}
              </Badge>
            )}
            <Badge
              variant={codeStatus === 'codeActive' ? 'success' : 'outline'}
              data-testid="code-status"
            >
              {t(`row.${codeStatus}`)}
            </Badge>
          </>
        )}
        {payment !== null ? (
          <Badge variant="outline" className="h-auto whitespace-normal" data-testid="table-bar">
            {row.bar === null ? tp('pt_no_bar', { source }) : tp('pt_bar', { bar: row.bar.name })}
          </Badge>
        ) : null}
      </div>

      {isPaymentTable ? null : (
        <RoutePicker
          venueId={venueId}
          target={{ tableId: row.id }}
          targetName={t('route.table', { table: shown })}
          menus={menus}
          value={row.routeMenuId}
          effective={row.menu}
          canManage={canManage}
        />
      )}

      <QrDialog row={row} open={enlarged} onOpenChange={setEnlarged} />
      {paymentTable.dialog}
      <ConfirmDialog
        open={confirm === 'payment'}
        onOpenChange={(open) => setConfirm(open ? 'payment' : null)}
        title={tp('pt_mark_t', { table: shown })}
        description={tp(hasCode ? 'pt_mark_b' : 'pt_mark_b_nocode', { bar: barName })}
        confirmLabel={tp('pt_mark_ok')}
        cancelLabel={tp('pt_mark_keep')}
        pending={pending}
        testId="confirm-payment-table"
        onConfirm={() => {
          setConfirm(null)
          paymentTable.mark()
        }}
      />
      <ConfirmDialog
        open={confirm === 'new'}
        onOpenChange={(open) => setConfirm(open ? 'new' : null)}
        title={t('confirmNew.title', { table: shown })}
        description={t('confirmNew.description')}
        confirmLabel={t('confirmNew.confirm')}
        pending={pending}
        testId="confirm-new-code"
        onConfirm={() =>
          run(
            () => issueCodeAction({ tableId: row.id }),
            t('row.codeRenewed'),
            () => setConfirm(null),
          )
        }
      />
      <ConfirmDialog
        open={confirm === 'off'}
        onOpenChange={(open) => setConfirm(open ? 'off' : null)}
        title={t('confirmOff.title', { table: shown })}
        description={t('confirmOff.description')}
        confirmLabel={t('confirmOff.confirm')}
        pending={pending}
        testId="confirm-turn-off-code"
        onConfirm={() =>
          run(
            () => turnOffCodeAction({ tableId: row.id }),
            t('row.codeOff'),
            () => setConfirm(null),
          )
        }
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => setConfirm(open ? 'delete' : null)}
        title={t('confirmDeleteTable.title', { table: shown })}
        description={t('confirmDeleteTable.description')}
        confirmLabel={t('confirmDeleteTable.confirm')}
        pending={pending}
        testId="confirm-delete-table"
        onConfirm={() =>
          run(
            () => deleteTableAction({ venueId, tableId: row.id }),
            t('row.deleted'),
            () => setConfirm(null),
          )
        }
      />
    </li>
  )
}
