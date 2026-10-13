'use client'

// "Delete …?" before a section or an item leaves the menu (brief S6, D89, D92). Deleting a section
// moves its items to Unsorted; deleting an item takes it out of every menu. The history keeps the
// record of both (rule 2), so the words say "delete", not "erase".
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** What is about to be deleted. */
export interface DeleteTarget {
  readonly kind: 'section' | 'item'
  readonly name: string
}

export function DeleteDialog({
  target,
  onConfirm,
  onOpenChange,
}: {
  /** Open while there is something to confirm. */
  target: DeleteTarget | null
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations('composer.delete')
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      {target === null ? null : (
        <DialogContent data-testid="delete-dialog">
          <DialogHeader>
            <DialogTitle>{t(`${target.kind}.title`, { name: target.name })}</DialogTitle>
            <DialogDescription>{t(`${target.kind}.description`)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirm}
              data-testid="delete-confirm"
            >
              {t(`${target.kind}.confirm`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
