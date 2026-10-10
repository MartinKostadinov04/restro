'use client'

// The sale state of an item on the Details tab (brief S3-08, D46): on sale, sold out tonight (a
// manager's mark), or off sale in barsy. Managers get "Mark sold out tonight" / "Back on sale".
//
// Rule 5 shapes this card. "Back on sale" only takes OUR mark off. An item barsy has off sale shows
// "Not on sale in barsy" and has NO button at all, not even a disabled "Back on sale": our layers
// can only add caution, and such a button would promise what nothing here can do.
import { BanIcon, Undo2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { SheetSale } from '@/server/item-sheet/types'

export interface ItemSheetSaleProps {
  sale: SheetSale
  /** True while a save is under way. */
  busy: boolean
  /** Marks (`true`) or unmarks (`false`) the item; resolves true when it was saved. */
  onChange: (soldOut: boolean) => Promise<boolean>
}

export function ItemSheetSale({ sale, busy, onChange }: ItemSheetSaleProps) {
  const t = useTranslations('itemSheet.details.sale')
  const state =
    sale.offSale !== null ? `off_${sale.offSale}` : sale.soldOutTonight ? 'tonight' : 'on'
  return (
    <section
      className="grid gap-2 rounded-lg border bg-card p-3"
      aria-label={t('title')}
      data-testid="item-sheet-sale"
      data-state={state}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">{t('title')}</h3>
          <div className="flex flex-wrap items-center gap-2" data-testid="sale-state">
            {sale.offSale === 'barsy' ? (
              <Badge variant="warning">{t('offSaleBarsy')}</Badge>
            ) : sale.offSale === 'other' ? (
              <Badge variant="warning">{t('offSaleOther')}</Badge>
            ) : sale.soldOutTonight ? (
              <Badge variant="danger">{t('soldOutTonight')}</Badge>
            ) : (
              <Badge variant="success">{t('onSale')}</Badge>
            )}
          </div>
        </div>
        {sale.canMark && sale.offSale === null ? (
          sale.soldOutTonight ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void onChange(false)}
              data-testid="sale-unmark"
            >
              <Undo2Icon aria-hidden />
              {t('unmark')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void onChange(true)}
              data-testid="sale-mark"
            >
              <BanIcon aria-hidden />
              {t('mark')}
            </Button>
          )
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="sale-note">
        {sale.offSale === 'barsy'
          ? t('offSaleBarsyNote')
          : sale.offSale === 'other'
            ? t('offSaleOtherNote')
            : sale.soldOutTonight
              ? t('lapsesNote')
              : sale.canMark
                ? t('markNote')
                : t('managersOnly')}
      </p>
    </section>
  )
}
