'use client'

// The section tree on the left. Ported from the Platform's builder (Ontology/Show.jsx 951-1049,
// @hello-pangea/dnd: a handle on the left, Draggable rows in a Droppable list), with these
// changes: row ids are the node ids (the Platform keys rows by array index, so a reorder
// renames them), the order is persisted with one fractional key per drop, and the tree nests.
//
// How the drops are wired (the library cannot drag a row into a nested list of the same kind):
// - every sibling list is its own Droppable with its own type, `SECTIONS:<parent>`, so a section
//   can be reordered among its siblings by drag and drop, with the whole subtree travelling along
//   with it; moving a section under another parent is "Move to…" in the row's menu, which offers
//   only the places `canNest` allows (a person cannot even ask for a depth-4 section);
// - every row is also a Droppable of type `ITEM`: drop an item on a row and it moves to the end
//   of that section. Unsorted is such a target too (dropping there takes the item out).
import { Draggable, Droppable } from '@hello-pangea/dnd'
import type { NodeId } from '@restro/core'
import { ChevronRightIcon, EyeOffIcon, GripVerticalIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'

import { useComposer } from './composer-context'
import { DROP_TARGET_ATTR, UNSORTED_KEY } from './dnd'
import { sectionTitle } from './labels'
import { SectionMenu } from './row-menus'
import { ROOT_KEY } from './tree'

function Count({ value }: { value: number }) {
  return <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{value}</span>
}

function SectionNode({ id, index }: { id: NodeId; index: number }) {
  const t = useTranslations('composer')
  const { view, selection, expanded, select, toggleExpanded, overTarget } = useComposer()
  const section = view.sections[id]
  if (!section) return null
  const title = sectionTitle(view, id, t('untitledSection'))
  const hasChildren = section.childIds.length > 0
  const open = expanded.has(id)
  const selected = selection === id

  return (
    <Draggable draggableId={`section:${id}`} index={index}>
      {(drag, snapshot) => (
        <li
          ref={drag.innerRef}
          {...drag.draggableProps}
          data-testid="section-node"
          data-section-id={id}
          className={cn(
            snapshot.isDragging && 'rounded-md bg-background shadow-lg ring-2 ring-ring',
          )}
        >
          <Droppable droppableId={`target:${id}`} type="ITEM">
            {(drop, dropSnapshot) => (
              <div
                ref={drop.innerRef}
                {...drop.droppableProps}
                data-testid="section-row"
                {...{ [DROP_TARGET_ATTR]: id }}
                data-selected={selected || undefined}
                className={cn(
                  'relative flex items-center gap-0.5 rounded-md py-0.5 pr-0.5 pl-0.5 text-sm',
                  selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                  (dropSnapshot.isDraggingOver || overTarget === id) &&
                    'bg-accent ring-2 ring-ring',
                )}
              >
                {/* A div, not a button: the library does not start a drag from an interactive element. */}
                {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the handle props add role="button" and tabIndex */}
                <div
                  {...drag.dragHandleProps}
                  aria-label={t('actions.dragSection', { name: title })}
                  className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
                >
                  <GripVerticalIcon className="size-4" aria-hidden />
                </div>
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(id)}
                    aria-expanded={open}
                    aria-label={
                      open
                        ? t('actions.collapse', { name: title })
                        : t('actions.expand', { name: title })
                    }
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <ChevronRightIcon
                      className={cn('size-4 transition-transform', open && 'rotate-90')}
                      aria-hidden
                    />
                  </button>
                ) : (
                  <span className="size-6 shrink-0" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => select(id)}
                  aria-current={selected ? 'true' : undefined}
                  className={cn(
                    'min-w-0 flex-1 truncate rounded-sm py-1 text-left font-medium focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                    section.hidden && 'text-muted-foreground',
                  )}
                  data-testid="section-select"
                >
                  {title}
                </button>
                {section.hidden ? (
                  <EyeOffIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                ) : null}
                <Count value={view.placements[id]?.length ?? 0} />
                <SectionMenu sectionId={id} />
                {/* The library appends its drop placeholder here; it must not move the row. */}
                <div className="pointer-events-none absolute h-0 w-0 overflow-hidden">
                  {drop.placeholder}
                </div>
              </div>
            )}
          </Droppable>
          {hasChildren && open ? <SectionList parentId={id} ids={section.childIds} /> : null}
        </li>
      )}
    </Draggable>
  )
}

/** A list of sibling sections; the top level is the menu's children. */
function SectionList({ parentId, ids }: { parentId: NodeId | null; ids: readonly NodeId[] }) {
  const parentKey = parentId ?? ROOT_KEY
  return (
    <Droppable droppableId={`children:${parentKey}`} type={`SECTIONS:${parentKey}`}>
      {(provided) => (
        <ul
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={cn('grid gap-0.5', parentId !== null && 'ml-3.5 border-l pl-1')}
        >
          {ids.map((id, index) => (
            <SectionNode key={id} id={id} index={index} />
          ))}
          {provided.placeholder}
        </ul>
      )}
    </Droppable>
  )
}

/** The Unsorted entry: select it to see the loose items; drop an item on it to take it out. */
function UnsortedRow() {
  const t = useTranslations('composer')
  const { view, selection, select, overTarget } = useComposer()
  const selected = selection === UNSORTED_KEY
  return (
    <Droppable droppableId={`target:${UNSORTED_KEY}`} type="ITEM">
      {(drop, snapshot) => (
        <div
          ref={drop.innerRef}
          {...drop.droppableProps}
          data-testid="unsorted-row"
          {...{ [DROP_TARGET_ATTR]: UNSORTED_KEY }}
          data-selected={selected || undefined}
          className={cn(
            'relative flex items-center gap-1 rounded-md py-0.5 pr-1 pl-2 text-sm',
            selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
            (snapshot.isDraggingOver || overTarget === UNSORTED_KEY) &&
              'bg-accent ring-2 ring-ring',
          )}
        >
          <button
            type="button"
            onClick={() => select(UNSORTED_KEY)}
            aria-current={selected ? 'true' : undefined}
            className="min-w-0 flex-1 truncate rounded-sm py-1.5 text-left font-medium focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            data-testid="unsorted-select"
          >
            {t('unsorted')}
          </button>
          <Count value={view.unsortedIds.length} />
          <div className="pointer-events-none absolute h-0 w-0 overflow-hidden">
            {drop.placeholder}
          </div>
        </div>
      )}
    </Droppable>
  )
}

export function SectionTree() {
  const t = useTranslations('composer')
  const { view } = useComposer()
  return (
    <nav aria-label={t('treeLabel')} className="grid gap-2" data-testid="section-tree">
      <SectionList parentId={null} ids={view.rootIds} />
      <div className="border-t pt-2">
        <UnsortedRow />
      </div>
    </nav>
  )
}
