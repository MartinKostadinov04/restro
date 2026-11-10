'use client'

// Taking one spot out of use (#327; D137: a block carries a reason, and with no dates it stays on
// until somebody lifts it). One dialog, one required field (Patterns: "one field, then the write"):
// the reason, as a segmented pick of five words — no free text, because the reason is stored as a
// code and read back in whichever language the next person works in.
//
// Nothing is chosen for the person: a reason nobody picked would be a reason nobody meant, so the
// confirming button stays off until one is picked. That is the ticket's budget exactly — the sheet's
// "Block…", the reason, "Block spot".
//
// The nights are optional and plain date fields, so the keyboard reaches them like any other form
// (2.1.1). Left empty, the block starts now; the night the plan is showing is filled in when it is
// not tonight, so blocking a spot on Saturday's plan does not quietly block it this evening.
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { WRAPS } from '@/lib/wrapping'

import { BLOCK_REASONS, type BlockReason } from './block-reasons'
import { useBlockReasonWord } from './plan-words'

/** What the dialog asks for: the reason, and the nights where somebody set them. */
export interface BlockChoice {
  readonly reason: BlockReason
  readonly from?: string
  readonly until?: string
}

export function BlockDialog({
  spotName,
  day,
  today,
  busy,
  onLeave,
  onBlock,
}: {
  spotName: string
  /** The night the plan is showing. */
  day: string
  /** The venue's current service day. */
  today: string
  busy: boolean
  onLeave: () => void
  onBlock: (choice: BlockChoice) => void
}) {
  const t = useTranslations('reservations')
  const word = useBlockReasonWord()
  const [reason, setReason] = useState<BlockReason | null>(null)
  const [from, setFrom] = useState(day === today ? '' : day)
  const [until, setUntil] = useState('')

  return (
    <Dialog open onOpenChange={(open) => !open && onLeave()}>
      <DialogContent className="max-w-md" data-testid="rv-block-dialog">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">
            {t('p_block_t', { spot: spotName })}
          </DialogTitle>
          <DialogDescription>{t('p_block_b')}</DialogDescription>
        </DialogHeader>
        <fieldset className="flex min-w-0 flex-wrap gap-2">
          <legend className="mb-2 text-sm font-medium">{t('p_reason')}</legend>
          {BLOCK_REASONS.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={reason === value ? 'default' : 'outline'}
              aria-pressed={reason === value}
              className="min-h-11"
              data-testid={`rv-reason-${value}`}
              onClick={() => setReason(value)}
            >
              {word(value)}
            </Button>
          ))}
        </fieldset>
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('p_block_dates')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <span className="space-y-1">
              <Label htmlFor="rv-block-from">{t('p_from')}</Label>
              <input
                id="rv-block-from"
                type="date"
                className="h-11 min-w-0 rounded-md border bg-background px-3 text-base"
                value={from}
                data-testid="rv-block-from"
                onChange={(event) => setFrom(event.target.value)}
              />
            </span>
            <span className="space-y-1">
              <Label htmlFor="rv-block-until">{t('p_until_day')}</Label>
              <input
                id="rv-block-until"
                type="date"
                className="h-11 min-w-0 rounded-md border bg-background px-3 text-base"
                value={until}
                data-testid="rv-block-until"
                onChange={(event) => setUntil(event.target.value)}
              />
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{t('p_open_ended')}</p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            className={WRAPS}
            disabled={reason === null || busy}
            data-testid="rv-block-do"
            onClick={() => {
              if (reason === null) return
              onBlock({
                reason,
                ...(from === '' ? {} : { from }),
                ...(until === '' ? {} : { until }),
              })
            }}
          >
            {t('p_block_ok')}
          </Button>
          <Button type="button" variant="ghost" className={WRAPS} onClick={onLeave}>
            {t('p_block_no')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
