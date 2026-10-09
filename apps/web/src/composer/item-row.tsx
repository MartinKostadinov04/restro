'use client'

import { Draggable } from '@hello-pangea/dnd'
// One item in a section's list (or in Unsorted): a drag handle, the name (opens the item sheet),
// its badges, the price, the shown-to-guests switch and the "more" menu. The switch follows
// rule 5: an item barsy hides cannot be shown from here, and the row says so.
import { formatMoney, type NodeId } from '@restro/core'
import { GripVerticalIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import { HiddenBadge, IssuesBadge, OriginBadge } from './badges'
import { useComposer } from './composer-context'
import { itemName } from './labels'
import { ItemMenu } from './row-menus'
import type { ComposerItem } from './view-model'

/** The sentence under a locked switch, or null when the switch works. */
function lockedReason(item: ComposerItem): 'lockedByBarsy' | 'lockedOther' | null {
  if (item.hiddenBy === 'barsy') return 'lockedByBarsy'
  if (item.hiddenBy === 'other') return 'lockedOther'
  return null
}

export function ItemRow({
  itemId,
  sectionId,
  index,
}: {
  itemId: NodeId
  /** The section whose list this row is in; `null` in Unsorted. */
  sectionId: NodeId | null
  index: number
}) {
  const t = useTranslations('composer')
  const { view, locale, openItem, toggleItemHidden } = useComposer()
  const item = view.items[itemId]
  if (!item) return null
  const name = itemName(view, itemId, t('unnamedItem'))
  const locked = lockedReason(item)
  const hidden = item.hiddenBy !== null

  return (
    <Draggable draggableId={`item:${itemId}`} index={index}>
      {(drag, snapshot) => (
        <li
          ref={drag.innerRef}
          {...drag.draggableProps}
          data-testid="item-row"
          data-item-id={itemId}
          data-hidden-by={item.hiddenBy ?? undefined}
          className={cn(
            'mb-2 flex items-center gap-2 rounded-lg border bg-card px-2 py-2 text-card-foreground shadow-xs sm:gap-3 sm:px-3',
            snapshot.isDragging && 'shadow-lg ring-2 ring-ring',
          )}
        >
          <button
            type="button"
            {...drag.dragHandleProps}
            aria-label={t('actions.dragItem', { name })}
            className="flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
          >
            <GripVerticalIcon className="size-4" aria-hidden />
          </button>

          <div className={cn('grid min-w-0 flex-1 gap-1', hidden && 'opacity-70')}>
            <button
              type="button"
              onClick={() => openItem(itemId)}
              className="min-w-0 truncate rounded-sm text-left text-sm font-medium hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              data-testid="item-open"
            >
              {name}
            </button>
            <div className="flex flex-wrap items-center gap-1.5">
              <OriginBadge origin={item.origin} />
              {item.hiddenBy !== null ? <HiddenBadge hiddenBy={item.hiddenBy} /> : null}
              <IssuesBadge issues={item.issues} />
            </div>
          </div>

          <span className="hidden shrink-0 text-sm tabular-nums text-muted-foreground sm:block">
            {item.price
              ? formatMoney(item.price.amount_minor, item.price.currency, locale)
              : t('noPrice')}
          </span>

          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <Switch
              checked={!hidden}
              disabled={locked !== null}
              onCheckedChange={() => toggleItemHidden(itemId)}
              aria-label={t('visibility.toggleItem', { name })}
              data-testid="item-visible"
            />
            {locked ? (
              <span className="max-w-32 text-right text-[11px] leading-tight text-muted-foreground">
                {t(`visibility.${locked}`)}
              </span>
            ) : null}
          </div>

          <ItemMenu itemId={itemId} sectionId={sectionId} />
        </li>
      )}
    </Draggable>
  )
}
