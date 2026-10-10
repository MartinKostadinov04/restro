'use client'

// The right-hand side: the open section (or Unsorted) with its items in order. The items are a
// Droppable list: drag the handle (or use the keyboard) to reorder; drop on a row of the tree to
// move to another section.
import { Droppable } from '@hello-pangea/dnd'
import type { NodeId } from '@restro/core'
import { FilterXIcon, InboxIcon, LayoutListIcon, ListChecksIcon, PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import { HiddenBadge, IssuesBadge, OriginBadge } from './badges'
import { useComposer } from './composer-context'
import { UNSORTED_KEY } from './dnd'
import { ItemRow } from './item-row'
import { ItemToolbar } from './item-toolbar'
import { sectionTitle } from './labels'
import { SectionMenu } from './row-menus'
import { SoldOutChip } from './sold-out-chip'
import { filterByTags } from './tag-filter'

/** "New item" for a section (`null` = Unsorted); nothing for a person who may not create items. */
function NewItemButton({
  sectionId,
  testId,
  variant = 'outline',
}: {
  sectionId: NodeId | null
  testId: string
  variant?: 'outline' | 'default'
}) {
  const t = useTranslations('composer')
  const { newItem, canCreateItem } = useComposer()
  if (!canCreateItem) return null
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={() => newItem(sectionId)}
      data-testid={testId}
    >
      <PlusIcon aria-hidden />
      {t('newItem.button')}
    </Button>
  )
}

function ItemList({ sectionId, ids }: { sectionId: NodeId | null; ids: readonly NodeId[] }) {
  const t = useTranslations('composer')
  const { view, tagFilter, clearTagFilter, canCreateItem, hasTill } = useComposer()
  const empty = sectionId === null ? 'noUnsorted' : 'noItems'
  // What an empty section says depends on where its items come from: the till, or this screen.
  const emptyDescription =
    sectionId === null
      ? 'empty.noUnsorted.description'
      : hasTill
        ? 'empty.noItems.descriptionTill'
        : canCreateItem
          ? 'empty.noItems.description'
          : 'empty.noItems.descriptionReadOnly'
  // The tag filter shows only some of the items; the order is the list's.
  const visible = filterByTags(view, ids, tagFilter)
  return (
    <>
      <ItemToolbar visibleIds={visible} totalCount={ids.length} />
      <Droppable droppableId={`items:${sectionId ?? UNSORTED_KEY}`} type="ITEM">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            data-testid="item-list"
            className={cn('min-h-40 rounded-lg', snapshot.isDraggingOver && 'bg-accent/40')}
          >
            {visible.length > 0 ? (
              <ul>
                {visible.map((id, index) => (
                  <ItemRow key={id} itemId={id} sectionId={sectionId} index={index} />
                ))}
              </ul>
            ) : ids.length > 0 ? (
              <Empty className="min-h-40" data-testid="filter-empty">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FilterXIcon aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>{t('empty.noMatches.title')}</EmptyTitle>
                  <EmptyDescription>{t('empty.noMatches.description')}</EmptyDescription>
                </EmptyHeader>
                <Button type="button" variant="outline" size="sm" onClick={clearTagFilter}>
                  {t('toolbar.clearFilter')}
                </Button>
              </Empty>
            ) : (
              <Empty className="min-h-40" data-testid="item-list-empty">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    {sectionId === null ? (
                      <ListChecksIcon aria-hidden />
                    ) : (
                      <InboxIcon aria-hidden />
                    )}
                  </EmptyMedia>
                  <EmptyTitle>{t(`empty.${empty}.title`)}</EmptyTitle>
                  <EmptyDescription>{t(emptyDescription)}</EmptyDescription>
                </EmptyHeader>
                {canCreateItem ? (
                  <EmptyContent>
                    <NewItemButton sectionId={sectionId} testId="new-item-empty" />
                  </EmptyContent>
                ) : null}
              </Empty>
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </>
  )
}

function SectionHeader({ sectionId }: { sectionId: NodeId }) {
  const t = useTranslations('composer')
  const { view, toggleSectionHidden } = useComposer()
  const section = view.sections[sectionId]
  if (!section) return null
  const title = sectionTitle(view, sectionId, t('untitledSection'))
  const count = view.placements[sectionId]?.length ?? 0
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="grid min-w-0 gap-1.5">
        <h2 className="truncate text-lg font-semibold tracking-tight" data-testid="pane-title">
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <OriginBadge origin={section.origin} />
          {section.hidden ? <HiddenBadge hiddenBy="status" /> : null}
          <IssuesBadge issues={section.issues} />
          <span className="text-sm text-muted-foreground">{t('itemCount', { count })}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NewItemButton sectionId={sectionId} testId="new-item" />
        <SoldOutChip />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={!section.hidden}
            onCheckedChange={() => toggleSectionHidden(sectionId)}
            aria-label={t('visibility.toggleSection')}
            data-testid="section-visible"
          />
          <span className="hidden sm:inline">{t('visibility.toggleSection')}</span>
        </div>
        <SectionMenu sectionId={sectionId} />
      </div>
    </header>
  )
}

export function ItemPane() {
  const t = useTranslations('composer')
  const { view, selection, newSection } = useComposer()

  if (selection === null || (selection !== UNSORTED_KEY && !view.sections[selection])) {
    // A menu with no section at all (a venue just made): offer the first one.
    if (view.rootIds.length === 0) {
      return (
        <Empty className="min-h-72" data-testid="pane-no-sections">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutListIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t('empty.noSections.title')}</EmptyTitle>
            <EmptyDescription>{t('empty.noSections.description')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" onClick={() => newSection(null)} data-testid="new-section-empty">
              {t('empty.noSections.action')}
            </Button>
          </EmptyContent>
        </Empty>
      )
    }
    return (
      <Empty className="min-h-72" data-testid="pane-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutListIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t('empty.noSelection.title')}</EmptyTitle>
          <EmptyDescription>{t('empty.noSelection.description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (selection === UNSORTED_KEY) {
    return (
      <section
        className="grid gap-4"
        aria-label={t('listLabel', { section: t('unsorted') })}
        data-testid="item-pane"
        data-pane="unsorted"
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <h2 className="text-lg font-semibold tracking-tight" data-testid="pane-title">
              {t('unsorted')}
            </h2>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">
                {t('itemCount', { count: view.unsortedIds.length })}
              </Badge>
              {t('unsortedHint')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NewItemButton sectionId={null} testId="new-item" />
            <SoldOutChip />
          </div>
        </header>
        <ItemList sectionId={null} ids={view.unsortedIds} />
      </section>
    )
  }

  return (
    <section
      className="grid gap-4"
      aria-label={t('listLabel', { section: sectionTitle(view, selection, t('untitledSection')) })}
      data-testid="item-pane"
      data-pane={selection}
    >
      <SectionHeader sectionId={selection} />
      <ItemList
        sectionId={selection}
        ids={(view.placements[selection] ?? []).map((p) => p.itemId)}
      />
    </section>
  )
}
