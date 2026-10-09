'use client'

// STUB. The item sheet is built by S2-06b (Details, Translations, Media, History) and that task
// replaces this file; nothing else in the composer depends on what is inside it.
//
// The contract with the composer: it mounts `<ItemSheet itemId={…} />` while the URL carries
// `?item=<nd_ id>` and unmounts it when the parameter goes. So the sheet is open as soon as it is
// mounted, and closes itself by calling `clearOpenItem()` (./item-param.ts), which removes the
// parameter. It loads whatever it shows from the id; the stub only reads the name from the
// composer's own view.
import type { NodeId } from '@restro/core'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

import { useComposer } from './composer-context'
import { clearOpenItem } from './item-param'
import { itemName } from './labels'

export function ItemSheet({ itemId }: { itemId: NodeId }) {
  const t = useTranslations('composer')
  const { view } = useComposer()
  const [open, setOpen] = useState(true)

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) clearOpenItem()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg" data-testid="item-sheet">
        <SheetHeader>
          <SheetTitle>{itemName(view, itemId, t('unnamedItem'))}</SheetTitle>
          <SheetDescription>{t('itemSheet.stub')}</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  )
}
