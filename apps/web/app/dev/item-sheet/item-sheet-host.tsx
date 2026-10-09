'use client'

// Development harness only: opens the item sheet for the item named in the URL and closes it by
// dropping `?item=` again. The real owner of the sheet is the composer (S2-06a).
import { usePathname, useRouter } from 'next/navigation'

import { ItemSheet } from '@/composer/item-sheet'

export function ItemSheetHost({ itemId, venueId }: { itemId: string; venueId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  return (
    <ItemSheet
      itemId={itemId}
      venueId={venueId}
      onOpenChange={(open) => {
        if (!open) router.replace(pathname)
      }}
    />
  )
}
