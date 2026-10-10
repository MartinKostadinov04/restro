'use client'

// The Tags panel (brief S3-06, D60): the venue's own list of tags, opened from the button above
// the section tree. Create (a name in each language and a colour), rename and recolour, put in
// order by dragging (the same @hello-pangea/dnd pattern as the sections), archive and restore.
// An archived tag is hidden from the pickers and from the next menus; the items keep its id, so
// restoring it brings everything back, and old snapshots still name it.
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { type Locale, newId, type TagId } from '@restro/core'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { TagChip } from '@/fields/tag-chip'
import { TagForm } from '@/fields/tag-form'
import { cn } from '@/lib/utils'

import { useComposer } from './composer-context'
import type { ComposerTag } from './view-model'

/** How many items hold a tag, for the panel's rows. */
function usage(items: ReturnType<typeof useComposer>['view']['items'], id: TagId): number {
  return Object.values(items).filter((item) => item.tags.includes(id)).length
}

export function TagsPanel({
  open,
  onOpenChange,
  defaultLocale,
  enabledLocales,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultLocale: Locale
  enabledLocales: readonly Locale[]
}) {
  const t = useTranslations('composer.tags')
  const { view, createTag, updateTag, moveTag, setTagArchived } = useComposer()
  /** The tag being edited, or `'new'` for the create form. */
  const [editing, setEditing] = useState<TagId | 'new' | null>(null)
  const [busy, setBusy] = useState(false)

  const all = view.tagIds.flatMap((id) => {
    const tag = view.tags[id]
    return tag ? [tag] : []
  })
  const active = all.filter((tag) => !tag.archived)
  const archived = all.filter((tag) => tag.archived)

  function onDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result
    if (!destination || destination.index === source.index) return
    const moved = active.find((tag) => tag.id === draggableId)
    if (!moved) return
    // The tag goes before whichever tag sits at the drop place once it has left its own.
    const rest = active.filter((tag) => tag.id !== moved.id)
    moveTag(moved.id, rest[destination.index]?.id ?? null)
  }

  async function save(
    id: TagId | 'new',
    value: { label: ComposerTag['label']; color: ComposerTag['color'] },
  ) {
    setBusy(true)
    try {
      const ok = id === 'new' ? await createTag(newId('tg'), value) : await updateTag(id, value)
      if (ok) setEditing(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md" data-testid="tags-panel">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-4">
            {editing === 'new' ? (
              <div className="rounded-lg border bg-card p-3" data-testid="tag-create">
                <TagForm
                  defaultLocale={defaultLocale}
                  enabledLocales={enabledLocales}
                  submitLabel={t('create')}
                  busy={busy}
                  onSubmit={(value) => void save('new', value)}
                  onCancel={() => setEditing(null)}
                />
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="justify-self-start"
                onClick={() => setEditing('new')}
                data-testid="tag-new"
              >
                <PlusIcon aria-hidden />
                {t('new')}
              </Button>
            )}

            {active.length === 0 && editing !== 'new' ? (
              <Empty className="min-h-40" data-testid="tags-empty">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <PlusIcon aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>{t('empty.title')}</EmptyTitle>
                  <EmptyDescription>{t('empty.description')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <DragDropContext onDragEnd={onDragEnd} dragHandleUsageInstructions={t('dragHint')}>
                <Droppable droppableId="tags" type="TAG">
                  {(provided, snapshot) => (
                    <ul
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      aria-label={t('listLabel')}
                      data-testid="tag-list"
                      className={cn(
                        'grid gap-2 rounded-lg',
                        snapshot.isDraggingOver && 'bg-accent/40',
                      )}
                    >
                      {active.map((tag, index) => (
                        <Draggable key={tag.id} draggableId={tag.id} index={index}>
                          {(drag, dragState) => (
                            <li
                              ref={drag.innerRef}
                              {...drag.draggableProps}
                              data-testid="tag-row"
                              data-tag-id={tag.id}
                              className={cn(
                                'rounded-lg border bg-card p-2 text-card-foreground shadow-xs',
                                dragState.isDragging && 'shadow-lg ring-2 ring-ring',
                              )}
                            >
                              {editing === tag.id ? (
                                <TagForm
                                  defaultLocale={defaultLocale}
                                  enabledLocales={enabledLocales}
                                  initial={{ label: tag.label, color: tag.color }}
                                  submitLabel={t('save')}
                                  busy={busy}
                                  onSubmit={(value) => void save(tag.id, value)}
                                  onCancel={() => setEditing(null)}
                                />
                              ) : (
                                <div className="flex items-center gap-2">
                                  {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the handle props add role="button" and tabIndex */}
                                  <div
                                    {...drag.dragHandleProps}
                                    aria-label={t('drag', { name: tag.name })}
                                    className="flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
                                  >
                                    <GripVerticalIcon className="size-4" aria-hidden />
                                  </div>
                                  <div className="grid min-w-0 flex-1 gap-1">
                                    <span className="min-w-0">
                                      <TagChip color={tag.color} tagId={tag.id}>
                                        {tag.name}
                                      </TagChip>
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {t('usedBy', { count: usage(view.items, tag.id) })}
                                    </span>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                    aria-label={t('edit', { name: tag.name })}
                                    onClick={() => setEditing(tag.id)}
                                    data-testid="tag-edit"
                                  >
                                    <PencilIcon aria-hidden />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                    aria-label={t('archive', { name: tag.name })}
                                    onClick={() => setTagArchived(tag.id, true)}
                                    data-testid="tag-archive"
                                  >
                                    <ArchiveIcon aria-hidden />
                                  </Button>
                                </div>
                              )}
                            </li>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </ul>
                  )}
                </Droppable>
              </DragDropContext>
            )}

            {archived.length > 0 ? (
              <section className="grid gap-2" aria-label={t('archivedTitle')}>
                <h3 className="text-sm font-semibold text-muted-foreground">
                  {t('archivedTitle')} ({archived.length})
                </h3>
                <p className="text-xs text-muted-foreground">{t('archivedHint')}</p>
                <ul className="grid gap-2" data-testid="tag-archived-list">
                  {archived.map((tag) => (
                    <li
                      key={tag.id}
                      className="flex items-center gap-2 rounded-lg border border-dashed p-2"
                      data-testid="tag-archived-row"
                      data-tag-id={tag.id}
                    >
                      <span className="min-w-0 flex-1 opacity-70">
                        <TagChip color={tag.color} tagId={tag.id}>
                          {tag.name}
                        </TagChip>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setTagArchived(tag.id, false)}
                        aria-label={t('restore', { name: tag.name })}
                        data-testid="tag-restore"
                      >
                        <ArchiveRestoreIcon aria-hidden />
                        {t('restoreShort')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
