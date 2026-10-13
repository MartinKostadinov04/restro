'use client'

import { Draggable } from '@hello-pangea/dnd'
// One item in a section's list (or in Unsorted): a drag handle, the name (opens the item sheet),
// its badges, the price, the shown-to-guests switch and the "more" menu. The switch follows
// rule 5: an item the till hides cannot be shown from here, and the row says so.
import { formatMoney, type NodeId } from '@restro/core'
import { GripVerticalIcon, PencilIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import {
  HiddenBadge,
  IssuesBadge,
  NameFromTillBadge,
  OriginBadge,
  ReviewBadge,
  SaleBadge,
} from './badges'
import { useComposer } from './composer-context'
import { ItemChips } from './item-chips'
import { itemName } from './labels'
import { RenameField } from './rename-field'
import { ItemMenu } from './row-menus'
import type { ComposerItem } from './view-model'

/** The sentence under a locked switch, or null when the switch works. */
function lockedReason(item: ComposerItem): 'lockedByTill' | 'lockedOther' | null {
  if (item.hiddenBy === 'till') return 'lockedByTill'
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
  const {
    view,
    locale,
    openItem,
    toggleItemHidden,
    selected,
    toggleSelected,
    tagFilter,
    hasTill,
    renaming,
    startRename,
    renameItem,
  } = useComposer()
  const item = view.items[itemId]
  if (!item) return null
  const name = itemName(view, itemId, t('unnamedItem'))
  const locked = lockedReason(item)
  const source = view.tillLabel
  const hidden = item.hiddenBy !== null
  const isSelected = selected.has(itemId)
  const selecting = selected.size > 0
  // Items made by hand are renamed in place (D89); a till's item is named in its sheet.
  const renamable = !hasTill && item.origin === 'owned'
  const editing = renamable && renaming?.kind === 'item' && renaming.id === itemId

  return (
    // Reordering a filtered list would compute its places from a partial list: off while filtered.
    <Draggable draggableId={`item:${itemId}`} index={index} isDragDisabled={tagFilter.size > 0}>
      {(drag, snapshot) => (
        <li
          ref={drag.innerRef}
          {...drag.draggableProps}
          data-testid="item-row"
          data-item-id={itemId}
          data-hidden-by={item.hiddenBy ?? undefined}
          data-selected={isSelected ? 'true' : undefined}
          className={cn(
            'group mb-2 flex items-center gap-2 rounded-lg border bg-card px-2 py-2 text-card-foreground shadow-xs sm:gap-3 sm:px-3',
            isSelected && 'border-primary bg-primary/5',
            snapshot.isDragging && 'shadow-lg ring-2 ring-ring',
          )}
        >
          {/* Shown on hover and focus (always on a touch screen, and once something is ticked). */}
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelected(itemId)}
            aria-label={t('selection.select', { name })}
            data-testid="item-select"
            className={cn(
              'size-4 shrink-0 accent-primary focus-visible:opacity-100',
              !isSelected &&
                !selecting &&
                'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
            )}
          />
          {/* A div, not a button: the library does not start a drag from an interactive element. */}
          {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the handle props add role="button" and tabIndex */}
          <div
            {...drag.dragHandleProps}
            aria-label={t('actions.dragItem', { name })}
            className="flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
          >
            <GripVerticalIcon className="size-4" aria-hidden />
          </div>

          <div className={cn('grid min-w-0 flex-1 gap-1', hidden && 'opacity-70')}>
            {editing ? (
              <RenameField
                initial={item.name}
                label={t('rename.itemLabel', { name })}
                onSave={(next) => renameItem(itemId, next)}
                onCancel={() => startRename(null)}
                testId="item-rename-field"
              />
            ) : (
              <div className="flex min-w-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => openItem(itemId)}
                  className="min-w-0 truncate rounded-sm text-left text-sm font-medium hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  data-testid="item-open"
                >
                  {name}
                </button>
                {renamable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                    aria-label={t('rename.item', { name })}
                    onClick={() => startRename({ kind: 'item', id: itemId })}
                    data-testid="item-rename-start"
                  >
                    <PencilIcon aria-hidden />
                  </Button>
                ) : null}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <OriginBadge origin={item.origin} />
              {item.nameFromTill ? <NameFromTillBadge /> : null}
              {item.reviewFields.length > 0 ? (
                <ReviewBadge count={item.reviewFields.length} />
              ) : null}
              {item.hiddenBy !== null ? <HiddenBadge hiddenBy={item.hiddenBy} /> : null}
              <SaleBadge soldOutTonight={item.soldOutTonight} offSale={item.offSale} />
              <IssuesBadge issues={item.issues} />
            </div>
            <ItemChips item={item} />
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
                {t(`visibility.${locked}`, { source })}
              </span>
            ) : null}
          </div>

          <ItemMenu itemId={itemId} sectionId={sectionId} />
        </li>
      )}
    </Draggable>
  )
}
