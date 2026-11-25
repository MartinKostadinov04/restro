'use client'

// A write the person must accept the consequence of (#328; Patterns: "A write the person must
// accept the consequence of"; copy rule 11): a dialog that names the action in its question, says
// the consequence and whether it can be undone, and has two buttons that say the action and the
// way out — at equal weight, neither of them OK or Cancel. Never a disabled control instead.
//
// Cancel and Delete are told apart here, in one line each, because the two look alike and are not
// (D135, log 13.12): Cancel is the guest's doing and keeps the booking on the night; Delete removes
// a booking that should never have existed.
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { WRAPS } from '@/lib/wrapping'

export function ConfirmDialog({
  title,
  body,
  doLabel,
  keepLabel,
  testId,
  busy,
  onDo,
  onKeep,
}: {
  title: string
  body: string
  /** The action, in its own words: "Delete reservation". */
  doLabel: string
  /** The way out, in its own words: "Keep reservation". */
  keepLabel: string
  testId: string
  busy: boolean
  onDo: () => void
  onKeep: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onKeep()}>
      <DialogContent className="max-w-md" data-testid={testId}>
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{title}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className={WRAPS}
            disabled={busy}
            data-testid={`${testId}-do`}
            onClick={onDo}
          >
            {doLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={WRAPS}
            data-testid={`${testId}-keep`}
            onClick={onKeep}
          >
            {keepLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
