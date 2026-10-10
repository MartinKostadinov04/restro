'use client'

// The bar at the bottom of the screen while items are ticked (brief S3-06): "Add tag…",
// "Remove tag…" and "Clear selection". Adding or removing is one atomic change for the whole
// selection: every ticked item changes, or none does.
import { PlusIcon, TagIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TagChip } from '@/fields/tag-chip'
import { useComposer } from './composer-context'
import { activeTagIds } from './tag-filter'

export function SelectionBar() {
  const t = useTranslations('composer.selection')
  const { view, selected, setItemTags, clearSelection, openTagsPanel } = useComposer()
  const items = [...selected].filter((id) => view.items[id] !== undefined)
  if (items.length === 0) return null

  const tags = activeTagIds(view).flatMap((id) => {
    const tag = view.tags[id]
    return tag ? [tag] : []
  })
  /** How many of the ticked items hold each tag. */
  const held = new Map<string, number>()
  for (const id of items) {
    for (const tag of view.items[id]?.tags ?? []) held.set(tag, (held.get(tag) ?? 0) + 1)
  }
  const removable = tags.filter((tag) => (held.get(tag.id) ?? 0) > 0)

  return (
    <section
      aria-label={t('label')}
      data-testid="selection-bar"
      className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-2 rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
    >
      <span className="px-2 text-sm font-medium" data-testid="selection-count" aria-live="polite">
        {t('count', { count: items.length })}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" data-testid="add-tag">
            <PlusIcon aria-hidden />
            {t('addTag')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="center"
          side="top"
          className="max-h-80 min-w-56 overflow-y-auto"
        >
          <DropdownMenuLabel>{t('addTagTitle', { count: items.length })}</DropdownMenuLabel>
          {tags.length === 0 ? (
            <DropdownMenuItem onSelect={openTagsPanel}>
              <TagIcon aria-hidden />
              {t('noTags')}
            </DropdownMenuItem>
          ) : (
            tags.map((tag) => (
              <DropdownMenuItem
                key={tag.id}
                onSelect={() => setItemTags(items, [tag.id], [])}
                data-testid="add-tag-option"
                data-tag-id={tag.id}
              >
                <TagChip color={tag.color}>{tag.name}</TagChip>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={removable.length === 0}
            data-testid="remove-tag"
          >
            {t('removeTag')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="center"
          side="top"
          className="max-h-80 min-w-56 overflow-y-auto"
        >
          <DropdownMenuLabel>{t('removeTagTitle')}</DropdownMenuLabel>
          {removable.map((tag) => (
            <DropdownMenuItem
              key={tag.id}
              onSelect={() => setItemTags(items, [], [tag.id])}
              data-testid="remove-tag-option"
              data-tag-id={tag.id}
            >
              <TagChip color={tag.color}>{tag.name}</TagChip>
              <span className="ml-auto text-xs text-muted-foreground">
                {held.get(tag.id)}/{items.length}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={clearSelection}
        data-testid="clear-selection"
      >
        <XIcon aria-hidden />
        {t('clear')}
      </Button>
    </section>
  )
}
