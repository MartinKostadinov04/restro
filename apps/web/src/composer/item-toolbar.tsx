'use client'

// The strip above an item list (brief S3-06): "select all in this section" and the tag filter.
// The filter shows only the items that hold at least one of the chosen tags; everything is a real
// button, checkbox or menu item, so it works with the keyboard.
import type { NodeId } from '@restro/core'
import { FilterIcon, TagsIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TagChip } from '@/fields/tag-chip'
import { useComposer } from './composer-context'
import { activeTagIds } from './tag-filter'

export function ItemToolbar({
  visibleIds,
  totalCount,
}: {
  /** The items the list shows now (after the filter). */
  visibleIds: readonly NodeId[]
  /** The items in the section, filtered or not. */
  totalCount: number
}) {
  const t = useTranslations('composer.toolbar')
  const { view, selected, tagFilter, selectItems, toggleTagFilter, clearTagFilter, openTagsPanel } =
    useComposer()
  const checkbox = useRef<HTMLInputElement>(null)
  const tickedHere = visibleIds.filter((id) => selected.has(id)).length
  const all = visibleIds.length > 0 && tickedHere === visibleIds.length

  // A checkbox's "some" state is a property, not an attribute.
  useEffect(() => {
    if (checkbox.current) checkbox.current.indeterminate = tickedHere > 0 && !all
  }, [tickedHere, all])

  const tags = activeTagIds(view).flatMap((id) => {
    const tag = view.tags[id]
    return tag ? [tag] : []
  })
  const chosen = tags.filter((tag) => tagFilter.has(tag.id))

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="item-toolbar">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          ref={checkbox}
          type="checkbox"
          className="size-4 accent-primary"
          checked={all}
          disabled={visibleIds.length === 0}
          onChange={() => selectItems(visibleIds, !all)}
          data-testid="select-all"
        />
        {t('selectAll')}
      </label>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" data-testid="tag-filter">
            <FilterIcon aria-hidden />
            {t('filter')}
            {chosen.length > 0 ? (
              <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                {chosen.length}
              </span>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
          <DropdownMenuLabel>{t('filterBy')}</DropdownMenuLabel>
          {tags.length === 0 ? (
            <DropdownMenuItem onSelect={openTagsPanel}>
              <TagsIcon aria-hidden />
              {t('noTags')}
            </DropdownMenuItem>
          ) : (
            tags.map((tag) => (
              <DropdownMenuCheckboxItem
                key={tag.id}
                checked={tagFilter.has(tag.id)}
                // Stay open, so several tags can be ticked in a row.
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => toggleTagFilter(tag.id)}
                data-testid="tag-filter-option"
                data-tag-id={tag.id}
              >
                <TagChip color={tag.color}>{tag.name}</TagChip>
              </DropdownMenuCheckboxItem>
            ))
          )}
          {chosen.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={clearTagFilter}>{t('clearFilter')}</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {chosen.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="active-filter">
          {chosen.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTagFilter(tag.id)}
              aria-label={t('removeFilter', { tag: tag.name })}
              className="rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <TagChip color={tag.color} className="pr-1">
                {tag.name}
                <XIcon className="size-3" aria-hidden />
              </TagChip>
            </button>
          ))}
          <span className="text-sm text-muted-foreground" data-testid="filter-count">
            {t('showing', { shown: visibleIds.length, total: totalCount })}
          </span>
        </div>
      ) : null}
    </div>
  )
}
