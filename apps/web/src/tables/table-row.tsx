'use client'

// One table in the Tables & QR tab (brief S3-07): its code as a picture (click to enlarge), the
// name a guest sees (editable by owners and admins), barsy's number, whether barsy marks it
// public, and what can be done with its code: create it, make a new one or turn it off (the last
// two stop the printed sticker, so they ask first), and download it as PNG or SVG.
import { QrCodeIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { issueCodeAction, renameTableAction, turnOffCodeAction } from '@/server/tables/actions'
import type { TableRowView, TablesActionResult } from '@/server/tables/view'

import { ConfirmDialog } from './confirm-dialog'
import { QrDialog, QrDownloads } from './qr-dialog'
import { QrPicture } from './qr-picture'
import { useFailureText } from './use-failure-text'

export function TableRow({ row, canManage }: { row: TableRowView; canManage: boolean }) {
  const t = useTranslations('tables')
  const failureText = useFailureText()
  const nameId = useId()
  const [name, setName] = useState(row.label ?? '')
  const [confirm, setConfirm] = useState<'new' | 'off' | null>(null)
  const [enlarged, setEnlarged] = useState(false)
  const [pending, startTransition] = useTransition()
  const shown = row.shownAs ?? t('row.noNumber')

  // After a change the page brings the saved name back; show it.
  useEffect(() => setName(row.label ?? ''), [row.label])

  function run(action: () => Promise<TablesActionResult>, done: string, after?: () => void) {
    startTransition(async () => {
      const result = await action()
      after?.()
      if (!result.ok) {
        toast.error(failureText(result))
        setName(row.label ?? '')
        return
      }
      toast.success(done)
      if (!result.queued) toast.warning(t('queuedLate'))
    })
  }

  function saveName() {
    if (name.trim().replace(/\s+/g, ' ') === (row.label ?? '')) return
    run(
      () => renameTableAction({ tableId: row.id, label: name.trim() === '' ? null : name }),
      t('row.nameSaved'),
    )
  }

  const hasCode = row.token !== null

  return (
    <li
      className="grid gap-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
      data-testid="table-row"
      data-table-id={row.id}
      data-has-code={hasCode}
    >
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

      <div className="grid min-w-0 gap-1.5">
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
            aria-label={t('row.nameLabel', { number: row.number ?? t('row.noNumber') })}
            maxLength={40}
            disabled={pending}
            autoComplete="off"
            className="max-w-xs"
            data-testid="table-name"
          />
        ) : (
          <p className="font-medium" data-testid="table-name-text">
            {shown}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span data-testid="table-number">
            {t('row.number', { number: row.number ?? t('row.noNumber') })}
          </span>
          <Badge variant={row.isPublic ? 'secondary' : 'outline'}>
            {row.isPublic ? t('row.public') : t('row.hidden')}
          </Badge>
          <Badge variant={hasCode ? 'success' : 'outline'} data-testid="code-status">
            {hasCode ? t('row.codeActive') : t('row.codeNone')}
          </Badge>
          {row.state === 'missing' ? <Badge variant="warning">{t('row.missing')}</Badge> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {hasCode ? <QrDownloads tableId={row.id} /> : null}
        {canManage && !hasCode ? (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => run(() => issueCodeAction({ tableId: row.id }), t('row.codeCreated'))}
            data-testid="create-code"
          >
            {t('row.createCode')}
          </Button>
        ) : null}
        {canManage && hasCode ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setConfirm('new')}
              data-testid="new-code"
            >
              {t('row.newCode')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setConfirm('off')}
              data-testid="turn-off-code"
            >
              {t('row.turnOff')}
            </Button>
          </>
        ) : null}
      </div>

      <QrDialog row={row} open={enlarged} onOpenChange={setEnlarged} />
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
    </li>
  )
}
