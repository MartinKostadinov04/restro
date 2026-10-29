'use client'

// The composer: the section tree on the left, the items of the open section on the right, drag
// and drop between them. The server hands it a view (./view-model.ts); every change is applied to
// that view at once (useOptimistic + ./reducer.ts) while a server action (./actions.ts) writes
// it through apply(). If the action fails, the optimistic view is dropped: the base view never
// changed, so the screen goes back by itself and a toast says why.
//
// Layout and interaction are ported from the Platform's builder (tree + side sheet + drag-and-drop
// lists, Ontology/Show.jsx and RenderGraph.jsx); the layout lives apart from the schema here
// (placements and sort keys), where the Platform freezes it inside the ontology.
//
// It is the Structure subtab of the venue's composer (D92) and edits one menu, the one in the URL
// (`?menu=`, brief S6): every action names it. What a venue may do depends on its source (D89,
// D90, D92): one without a till creates, renames and deletes sections and items; one with a till
// moves, reorders, hides, renames over the till's text and has sections of its own.
import {
  DragDropContext,
  type DragStart,
  type DragUpdate,
  type DropResult,
  type ResponderProvided,
} from '@hello-pangea/dnd'
import {
  type Currency,
  isId,
  type Locale,
  type LocalizedText,
  type NodeId,
  newId,
  type PaymentMode,
  type SectionLayout,
  type TagId,
} from '@restro/core'
import { PlusIcon, TagsIcon } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { pickLocalized } from '@/fields/localized'
import { parseMoneyInput } from '@/fields/money-input'
import { TillLabelProvider } from '@/fields/till-label'
import { isAdminLocale, toDataLocale } from '@/i18n/locales'
import type { ActionResult } from './action-result'
import {
  createItemAction,
  createSectionAction,
  deleteItemAction,
  deleteSectionAction,
  moveSectionAction,
  placeItemAction,
  renameItemAction,
  renameSectionAction,
  setItemHiddenAction,
  setSectionHiddenAction,
  setSectionLayoutAction,
} from './actions'
import {
  type ComposerActions,
  ComposerProvider,
  type RenameTarget,
  type Selection,
  type TagDraft,
} from './composer-context'
import { DeleteDialog } from './delete-dialog'
import {
  DROP_TARGET_ATTR,
  parseDraggable,
  parseItemDroppable,
  parseSectionList,
  resolveDrop,
  resolvePointerDrop,
  UNSORTED_KEY,
} from './dnd'
import { ItemPane } from './item-pane'
import {
  clearOpenItem,
  ITEM_PARAM,
  itemIdFromParam,
  replaceSearchParams,
  SECTION_PARAM,
} from './item-param'
import { ItemSheet } from './item-sheet'
import { itemName, sectionTitle } from './labels'
import { NewItemDialog } from './new-item-dialog'
import { NewSectionDialog } from './new-section-dialog'
import { setItemPaymentModeAction } from './payment-mode-actions'
import { type KeyedId, keyAtEnd, planKeys } from './plan'
import { type ComposerOp, reduceView } from './reducer'
import { SectionTree } from './section-tree'
import { SelectionBar } from './selection-bar'
import { setItemsSoldOutAction } from './sold-out-actions'
import {
  createTagAction,
  moveTagAction,
  setItemTagsAction,
  setTagArchivedAction,
  updateTagAction,
} from './tag-actions'
import { TagsPanel } from './tags-panel'
import { childIdsOf, flattenSections } from './tree'
import type {
  ComposerIssue,
  ComposerItem,
  ComposerSection,
  ComposerTag,
  ComposerView,
} from './view-model'

interface ComposerProps {
  readonly venueId: string
  /** The menu the composer edits (`?menu=`, brief S6): every action names it. */
  readonly menuId: NodeId
  readonly view: ComposerView
  readonly defaultLocale: Locale
  readonly enabledLocales: readonly Locale[]
  /** The venue's currency: the price of a new item is in it. */
  readonly currency: Currency
  /** The person may mark items sold out tonight (owner or admin, D46). */
  readonly canMarkSoldOut: boolean
  /** The person may create items by hand (owner or admin, CF-01). */
  readonly canCreateItem: boolean
  /** The venue has a till: its items come from the till only, none are made by hand (D66). */
  readonly hasTill: boolean
  /** The person may delete sections of the venue's own and items made by hand (owner or admin). */
  readonly canDelete: boolean
  /** The venue's item default where pay first can take effect (D122 §8); null = no such row. */
  readonly payFirstDefault: PaymentMode | null
}

/** The section to open first: the one in the URL, else the first one, else Unsorted. */
function initialSelection(view: ComposerView, requested: string | null): Selection | null {
  if (requested === UNSORTED_KEY) return UNSORTED_KEY
  if (requested !== null && isId('nd', requested) && view.sections[requested]) return requested
  return view.rootIds[0] ?? (view.unsortedIds.length > 0 ? UNSORTED_KEY : null)
}

export function Composer({
  venueId,
  menuId,
  view: serverView,
  defaultLocale,
  enabledLocales,
  currency,
  canMarkSoldOut,
  canCreateItem,
  hasTill,
  canDelete,
  payFirstDefault,
}: ComposerProps) {
  const t = useTranslations('composer')
  const owner = useTranslations('ownerSettings')
  const modes = useTranslations('options.payment_mode')
  const uiLocale = useLocale()
  const locale = toDataLocale(isAdminLocale(uiLocale) ? uiLocale : 'bg')
  const searchParams = useSearchParams()
  const router = useRouter()
  const [view, applyOptimistic] = useOptimistic(serverView, reduceView)
  const [, startTransition] = useTransition()

  const [requested, setRequested] = useState<Selection | null>(() =>
    initialSelection(serverView, searchParams.get(SECTION_PARAM)),
  )
  const [collapsed, setCollapsed] = useState<ReadonlySet<NodeId>>(new Set())
  const [dialog, setDialog] = useState<{ open: boolean; parentId: NodeId | null }>({
    open: false,
    parentId: null,
  })
  const [itemDialog, setItemDialog] = useState<{ open: boolean; sectionId: NodeId | null }>({
    open: false,
    sectionId: null,
  })

  // A section that vanished (or a first visit) falls back to the first one.
  const selection: Selection | null =
    requested === UNSORTED_KEY || (requested !== null && view.sections[requested])
      ? requested
      : initialSelection(view, null)
  const openItemId = itemIdFromParam(searchParams.get(ITEM_PARAM))

  const expanded = useMemo(
    () => new Set((Object.keys(view.sections) as NodeId[]).filter((id) => !collapsed.has(id))),
    [view.sections, collapsed],
  )

  // Ticked items (bulk tags) and the tag filter belong to the screen, not to the document.
  const [ticked, setTicked] = useState<ReadonlySet<NodeId>>(new Set())
  const [filterIds, setFilterIds] = useState<ReadonlySet<TagId>>(new Set())
  const [tagsOpen, setTagsOpen] = useState(false)
  // The name being edited in place, and what waits for "Delete?" to be confirmed.
  const [renaming, setRenaming] = useState<RenameTarget | null>(null)
  const [deleting, setDeleting] = useState<RenameTarget | null>(null)
  // A rename writes the language the composer shows; one the venue does not use is its main one.
  const renameLocale = enabledLocales.includes(locale) ? locale : defaultLocale
  // Only items and tags that still exist and are active count.
  const selected = useMemo(
    () => new Set([...ticked].filter((id) => view.items[id] !== undefined)),
    [ticked, view.items],
  )
  const tagFilter = useMemo(
    () => new Set([...filterIds].filter((id) => view.tags[id]?.archived === false)),
    [filterIds, view.tags],
  )

  /**
   * Applies a change on screen now and writes it in the background; a refusal rolls it back.
   * Resolves true when the write was saved (callers that must wait for it, such as a new tag the
   * item sheet is about to use, await it).
   */
  function mutate(op: ComposerOp, write: () => Promise<ActionResult>): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        applyOptimistic(op)
        let result: ActionResult
        try {
          result = await write()
        } catch {
          result = { ok: false, error: 'failed' }
        }
        if (!result.ok) toast.error(t(`errors.${result.error}`, { source: view.tillLabel }))
        else if (result.warning === 'live_not_queued') toast.warning(t('soldOut.liveLater'))
        resolve(result.ok)
      })
    })
  }

  const select = (next: Selection) => {
    setRequested(next)
    setTicked(new Set())
    replaceSearchParams({ [SECTION_PARAM]: next })
  }

  /** A tag as the view shows it, from what the form or the sheet gave. */
  function tagOf(id: TagId, draft: TagDraft, archived: boolean): ComposerTag {
    return {
      id,
      name: pickLocalized(draft.label, locale) ?? '',
      label: draft.label,
      color: draft.color,
      archived,
    }
  }

  /** Keys that put `itemId` at `index` of a section's list (the end if no index). */
  function itemKeys(toSectionId: NodeId, itemId: NodeId, index: number | undefined) {
    const others: KeyedId<NodeId>[] = (view.placements[toSectionId] ?? [])
      .filter((placement) => placement.itemId !== itemId)
      .map((placement) => ({ id: placement.itemId, key: placement.sortKey }))
    return index === undefined
      ? [{ id: itemId, key: keyAtEnd(others) }]
      : planKeys(others, itemId, index)
  }

  function placeItem(
    itemId: NodeId,
    fromSectionId: NodeId | null,
    toSectionId: NodeId | null,
    index?: number,
  ) {
    const keys = toSectionId === null ? [] : itemKeys(toSectionId, itemId, index)
    mutate({ type: 'placeItem', itemId, fromSectionId, toSectionId, keys }, () =>
      placeItemAction({ venueId, menuId, itemId, fromSectionId, toSectionId, keys }),
    )
  }

  function moveSection(sectionId: NodeId, parentId: NodeId | null, index?: number) {
    const others: KeyedId<NodeId>[] = childIdsOf(view, parentId)
      .filter((id) => id !== sectionId)
      .map((id) => ({ id, key: view.sections[id]?.sortKey ?? '' }))
    const keys =
      index === undefined
        ? [{ id: sectionId, key: keyAtEnd(others) }]
        : planKeys(others, sectionId, index)
    mutate({ type: 'moveSection', sectionId, parentId, keys }, () =>
      moveSectionAction({ venueId, menuId, sectionId, parentId, keys }),
    )
    if (parentId !== null) {
      setCollapsed((current) => {
        const next = new Set(current)
        next.delete(parentId)
        return next
      })
    }
  }

  function createSection(parentId: NodeId | null, title: LocalizedText) {
    const id = newId('nd')
    const siblings = childIdsOf(view, parentId).map((sibling) => ({
      id: sibling,
      key: view.sections[sibling]?.sortKey ?? '',
    }))
    const sortKey = keyAtEnd(siblings)
    const section: ComposerSection = {
      id,
      parentId,
      title: title[locale] ?? title[defaultLocale] ?? Object.values(title)[0] ?? '',
      origin: 'owned',
      hidden: false,
      shown: false,
      sortKey,
      childIds: [],
      issues: [],
      nameFromTill: false,
      layout: 'vertical',
    }
    mutate({ type: 'addSection', section }, () =>
      createSectionAction({ venueId, menuId, id, parentId, title, sortKey }),
    )
    select(id)
    if (parentId !== null) {
      setCollapsed((current) => {
        const next = new Set(current)
        next.delete(parentId)
        return next
      })
    }
  }

  // Items made by hand are for venues without a till, and for owners and admins.
  const mayCreateItem = canCreateItem && !hasTill

  /**
   * Creates an item by hand at the end of a section (or in Unsorted), then opens its sheet so the
   * person can fill in allergens, description and photo. The price goes to the server as typed;
   * the screen shows it at once, converted by the same rule (core's money module).
   */
  function createItem(sectionId: NodeId | null, name: LocalizedText, price: string) {
    const id = newId('nd')
    const others: KeyedId<NodeId>[] =
      sectionId === null
        ? []
        : (view.placements[sectionId] ?? []).map((placement) => ({
            id: placement.itemId,
            key: placement.sortKey,
          }))
    const sortKey = keyAtEnd(others)
    const money = parseMoneyInput(price, currency)
    // What the resolver will say about a new item: no allergens yet (V4), and a missing name in
    // each enabled language that has none (V7). Shown at once so the badge does not flash in.
    const issues: ComposerIssue[] = [
      { code: 'V4', severity: 'warning', fieldKey: 'allergens' },
      ...enabledLocales
        .filter((language) => !name[language])
        .map(
          (language): ComposerIssue => ({
            code: 'V7',
            severity: 'warning',
            fieldKey: 'name',
            locale: language,
          }),
        ),
    ]
    const item: ComposerItem = {
      id,
      name: name[locale] ?? name[defaultLocale] ?? Object.values(name)[0] ?? '',
      price: money === undefined || money === 'invalid' ? null : money,
      origin: 'owned',
      hiddenBy: null,
      shown: false,
      issues,
      tags: [],
      dietary: [],
      soldOutTonight: false,
      offSale: null,
      nameFromTill: false,
      reviewFields: [],
    }
    void mutate({ type: 'addItem', item, sectionId, sortKey, locale }, () =>
      createItemAction({
        venueId,
        menuId,
        id,
        sectionId,
        name,
        ...(price === '' ? {} : { price }),
        sortKey,
      }),
    ).then((saved) => {
      if (saved) replaceSearchParams({ [ITEM_PARAM]: id })
    })
  }

  const actions: ComposerActions = {
    select,
    openItem: (itemId) => replaceSearchParams({ [ITEM_PARAM]: itemId }),
    toggleExpanded: (sectionId) =>
      setCollapsed((current) => {
        const next = new Set(current)
        if (!next.delete(sectionId)) next.add(sectionId)
        return next
      }),
    toggleItemHidden: (itemId) => {
      const item = view.items[itemId]
      // The till's hide (and any other layer's) is not ours to undo (rule 5).
      if (!item || item.hiddenBy === 'till' || item.hiddenBy === 'other') return
      const hidden = item.hiddenBy === null
      mutate({ type: 'setItemHidden', itemId, hidden }, () =>
        setItemHiddenAction({ venueId, menuId, itemId, hidden }),
      )
    },
    toggleSectionHidden: (sectionId) => {
      const section = view.sections[sectionId]
      if (!section) return
      const hidden = !section.hidden
      mutate({ type: 'setSectionHidden', sectionId, hidden }, () =>
        setSectionHiddenAction({ venueId, menuId, sectionId, hidden }),
      )
    },
    setSectionLayout: (sectionId, layout: SectionLayout) => {
      const section = view.sections[sectionId]
      if (!section || section.layout === layout) return
      mutate({ type: 'setSectionLayout', sectionId, layout }, () =>
        setSectionLayoutAction({ venueId, menuId, sectionId, layout }),
      )
    },
    startRename: setRenaming,
    renameSection: (sectionId, title) => {
      setRenaming(null)
      mutate({ type: 'renameSection', sectionId, title }, () =>
        renameSectionAction({ venueId, menuId, sectionId, title: { [renameLocale]: title } }),
      )
    },
    renameItem: (itemId, name) => {
      setRenaming(null)
      mutate({ type: 'renameItem', itemId, name }, () =>
        renameItemAction({ venueId, menuId, itemId, name: { [renameLocale]: name } }),
      )
    },
    deleteSection: (sectionId) => {
      if (view.sections[sectionId]) setDeleting({ kind: 'section', id: sectionId })
    },
    deleteItem: (itemId) => {
      if (view.items[itemId]) setDeleting({ kind: 'item', id: itemId })
    },
    moveItemToSection: (itemId, fromSectionId, toSectionId) =>
      placeItem(itemId, fromSectionId, toSectionId),
    moveSectionTo: (sectionId, parentId) => moveSection(sectionId, parentId),
    newSection: (parentId = null) => setDialog({ open: true, parentId }),
    newItem: (sectionId) => {
      if (mayCreateItem) setItemDialog({ open: true, sectionId })
    },

    createTag: (id, draft) =>
      mutate({ type: 'upsertTag', tag: tagOf(id, draft, false) }, () =>
        createTagAction({ venueId, id, label: draft.label, color: draft.color }),
      ),
    updateTag: (id, draft) => {
      const current = view.tags[id]
      if (!current) return Promise.resolve(false)
      const next = tagOf(
        id,
        { label: draft.label ?? current.label, color: draft.color ?? current.color },
        current.archived,
      )
      return mutate({ type: 'upsertTag', tag: next }, () =>
        updateTagAction({ venueId, id, ...draft }),
      )
    },
    moveTag: (id, beforeId) => {
      void mutate({ type: 'moveTag', tagId: id, beforeId }, () =>
        moveTagAction({ venueId, id, beforeId }),
      )
    },
    setTagArchived: (id, archived) => {
      const current = view.tags[id]
      if (!current) return
      void mutate({ type: 'upsertTag', tag: { ...current, archived } }, () =>
        setTagArchivedAction({ venueId, id, archived }),
      )
    },
    setItemTags: (itemIds, add, remove) => {
      void mutate({ type: 'setItemTags', itemIds, add, remove }, () =>
        setItemTagsAction({ venueId, itemIds: [...itemIds], add: [...add], remove: [...remove] }),
      )
    },
    openTagsPanel: () => setTagsOpen(true),

    setPaymentMode: (itemIds, mode) => {
      if (payFirstDefault === null || itemIds.length === 0) return
      const inSentence = (value: PaymentMode) =>
        uiLocale === 'bg' ? modes(value).toLocaleLowerCase('bg') : modes(value)
      startTransition(async () => {
        let result: ActionResult
        try {
          result = await setItemPaymentModeAction({ venueId, itemIds: [...itemIds], mode })
        } catch {
          result = { ok: false, error: 'failed' }
        }
        if (!result.ok) {
          toast.error(
            result.error === 'failed' || result.error === 'rejected'
              ? owner('pf_err_save')
              : t(`errors.${result.error}`, { source: view.tillLabel }),
          )
          return
        }
        // In a sentence: lower case in Bulgarian, "Като на заведението" too (the plan's words).
        const same = owner('pf_i_same', { mode: inSentence(payFirstDefault) })
        toast.success(
          owner('pf_sel_toast', {
            count: itemIds.length,
            mode:
              mode === null
                ? uiLocale === 'bg'
                  ? same.toLocaleLowerCase('bg')
                  : same
                : inSentence(mode),
          }),
        )
      })
    },

    setSoldOut: (itemIds, soldOut) => {
      if (!canMarkSoldOut) return
      // An item the till has off sale is not ours to touch (rule 5): nothing to mark or clear.
      const ids = itemIds.filter(
        (id) => view.items[id] !== undefined && view.items[id]?.offSale === null,
      )
      if (ids.length === 0) return
      void mutate({ type: 'setSoldOut', itemIds: ids, soldOut }, () =>
        setItemsSoldOutAction({ venueId, itemIds: ids, soldOut }),
      )
    },

    toggleSelected: (itemId) =>
      setTicked((current) => {
        const next = new Set(current)
        if (!next.delete(itemId)) next.add(itemId)
        return next
      }),
    selectItems: (itemIds, on) =>
      setTicked((current) => {
        const next = new Set(current)
        for (const id of itemIds) {
          if (on) next.add(id)
          else next.delete(id)
        }
        return next
      }),
    clearSelection: () => setTicked(new Set()),
    toggleTagFilter: (tagId) =>
      setFilterIds((current) => {
        const next = new Set(current)
        if (!next.delete(tagId)) next.add(tagId)
        return next
      }),
    clearTagFilter: () => setFilterIds(new Set()),
  }

  /** The venue's active tags, for the tags editor of the item sheet. */
  const sheetTags = view.tagIds.flatMap((id) => {
    const tag = view.tags[id]
    return tag && !tag.archived ? [{ id: tag.id, name: tag.name, color: tag.color }] : []
  })
  /** A new tag from the item sheet: saved first, so the item save that follows can use it. */
  async function createSheetTag(draft: TagDraft) {
    const id = newId('tg')
    const saved = await actions.createTag(id, draft)
    return saved ? { id, name: pickLocalized(draft.label, locale) ?? '', color: draft.color } : null
  }

  // --- drag and drop ---------------------------------------------------------------------------
  function describe(draggableId: string): string {
    const dragged = parseDraggable(draggableId)
    if (!dragged) return ''
    return dragged.kind === 'item'
      ? itemName(view, dragged.id, t('unnamedItem'))
      : sectionTitle(view, dragged.id, t('untitledSection'))
  }

  function listSize(droppableId: string): number {
    const items = parseItemDroppable(droppableId)
    if (items?.kind === 'list') {
      return items.sectionId === null
        ? view.unsortedIds.length
        : (view.placements[items.sectionId]?.length ?? 0)
    }
    const list = parseSectionList(droppableId)
    return list ? childIdsOf(view, list.parentId).length : 0
  }

  // While an item is dragged with a mouse or a finger, follow the pointer: a tree row can only be
  // reached by the pointer (the dragged row is wider than the tree, so its centre cannot).
  const overRef = useRef<string | null>(null)
  const [overTarget, setOverTarget] = useState<string | null>(null)
  const stopPointer = useRef<(() => void) | null>(null)
  useEffect(() => () => stopPointer.current?.(), [])

  function followPointer() {
    stopPointer.current?.()
    const onMove = (event: PointerEvent) => {
      const row = document
        .elementsFromPoint(event.clientX, event.clientY)
        .map((element) => element.closest(`[${DROP_TARGET_ATTR}]`))
        .find((element) => element !== null)
      const next = row?.getAttribute(DROP_TARGET_ATTR) ?? null
      if (next !== overRef.current) {
        overRef.current = next
        setOverTarget(next)
      }
    }
    window.addEventListener('pointermove', onMove)
    stopPointer.current = () => window.removeEventListener('pointermove', onMove)
  }

  /** Ends the tracking; returns the tree row the pointer was over at the end, if any. */
  function stopFollowingPointer(): string | null {
    stopPointer.current?.()
    stopPointer.current = null
    const over = overRef.current
    overRef.current = null
    setOverTarget(null)
    return over
  }

  function onDragStart(start: DragStart, provided: ResponderProvided) {
    if (parseDraggable(start.draggableId)?.kind === 'item') followPointer()
    provided.announce(
      t('dnd.lifted', {
        name: describe(start.draggableId),
        position: start.source.index + 1,
        total: listSize(start.source.droppableId),
      }),
    )
  }

  function onDragUpdate(update: DragUpdate, provided: ResponderProvided) {
    const { destination } = update
    if (!destination) return
    const name = describe(update.draggableId)
    const target = parseItemDroppable(destination.droppableId)
    if (target?.kind === 'target') {
      const section =
        target.sectionId === null
          ? t('unsorted')
          : sectionTitle(view, target.sectionId, t('untitledSection'))
      provided.announce(t('dnd.overSection', { name, section }))
      return
    }
    provided.announce(
      t('dnd.moved', {
        name,
        position: destination.index + 1,
        total: listSize(destination.droppableId),
      }),
    )
  }

  function onDragEnd(result: DropResult, provided: ResponderProvided) {
    const name = describe(result.draggableId)
    const over = stopFollowingPointer()
    if (over !== null && result.reason === 'DROP') {
      // The pointer is on a tree row: the item goes to that section, wherever the library put it.
      const target = resolvePointerDrop(result, over)
      if (target?.kind === 'placeItem') {
        placeItem(target.itemId, target.fromSectionId, target.toSectionId)
        const section =
          target.toSectionId === null
            ? t('unsorted')
            : sectionTitle(view, target.toSectionId, t('untitledSection'))
        provided.announce(t('dnd.droppedInSection', { name, section }))
      } else {
        provided.announce(t('dnd.cancelled', { name }))
      }
      return
    }
    const intent = resolveDrop(result)
    if (!result.destination) {
      provided.announce(t('dnd.cancelled', { name }))
      return
    }
    if (intent === null) {
      provided.announce(
        t('dnd.dropped', {
          name,
          position: result.source.index + 1,
          total: listSize(result.source.droppableId),
        }),
      )
      return
    }
    if (intent.kind === 'moveSection') {
      moveSection(intent.sectionId, intent.parentId, intent.index)
      provided.announce(
        t('dnd.dropped', {
          name,
          position: intent.index + 1,
          total: childIdsOf(view, intent.parentId).length,
        }),
      )
      return
    }
    placeItem(intent.itemId, intent.fromSectionId, intent.toSectionId, intent.index)
    if (intent.toSectionId !== intent.fromSectionId) {
      const section =
        intent.toSectionId === null
          ? t('unsorted')
          : sectionTitle(view, intent.toSectionId, t('untitledSection'))
      provided.announce(t('dnd.droppedInSection', { name, section }))
    } else {
      provided.announce(
        t('dnd.dropped', {
          name,
          position: (intent.index ?? 0) + 1,
          total: listSize(result.destination.droppableId),
        }),
      )
    }
  }

  const sectionOptions = flattenSections(view)

  /** Deletes what the dialog asked about, once it is confirmed. */
  function confirmDelete() {
    const target = deleting
    setDeleting(null)
    if (target === null) return
    if (target.kind === 'section') {
      mutate({ type: 'deleteSection', sectionId: target.id }, () =>
        deleteSectionAction({ venueId, menuId, sectionId: target.id }),
      )
      return
    }
    if (openItemId === target.id) clearOpenItem()
    mutate({ type: 'deleteItem', itemId: target.id }, () =>
      deleteItemAction({ venueId, menuId, itemId: target.id }),
    )
  }

  return (
    <TillLabelProvider label={view.tillLabel}>
      <ComposerProvider
        value={{
          ...actions,
          view,
          selection,
          expanded,
          locale,
          overTarget,
          selected,
          tagFilter,
          canMarkSoldOut,
          canCreateItem: mayCreateItem,
          hasTill,
          canDelete,
          payFirstDefault,
          renaming,
        }}
      >
        <DragDropContext
          onDragStart={onDragStart}
          onDragUpdate={onDragUpdate}
          onDragEnd={onDragEnd}
          dragHandleUsageInstructions={t('dnd.instructions')}
        >
          <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]" data-testid="composer">
            <aside className="grid content-start gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-muted-foreground">{t('sections')}</h2>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => actions.newSection(null)}
                  data-testid="new-section"
                >
                  <PlusIcon aria-hidden />
                  {t('newSection')}
                </Button>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-start"
                onClick={() => setTagsOpen(true)}
                data-testid="open-tags"
              >
                <TagsIcon aria-hidden />
                {t('tags.open')}
                <span className="ml-auto text-muted-foreground" data-testid="tag-count">
                  {view.tagIds.filter((id) => view.tags[id]?.archived === false).length}
                </span>
              </Button>

              {/* Small screens: a picker instead of the tree (its drops need room). */}
              <div className="lg:hidden">
                <Select
                  value={selection ?? ''}
                  onValueChange={(value) => select(value as Selection)}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={t('chooseSection')}
                    data-testid="section-picker"
                  >
                    <SelectValue placeholder={t('chooseSection')} />
                  </SelectTrigger>
                  <SelectContent>
                    {sectionOptions.map(({ id, depth }) => (
                      <SelectItem key={id} value={id}>
                        <span style={{ paddingInlineStart: `${(depth - 1) * 0.75}rem` }}>
                          {sectionTitle(view, id, t('untitledSection'))}
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value={UNSORTED_KEY}>
                      {t('unsorted')} ({view.unsortedIds.length})
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="hidden lg:block">
                <SectionTree />
              </div>
            </aside>

            <ItemPane />
          </div>
        </DragDropContext>

        <SelectionBar />
        {/* Outside the drag-and-drop context above: the panel has a list of its own to reorder. */}
        <TagsPanel
          open={tagsOpen}
          onOpenChange={setTagsOpen}
          defaultLocale={defaultLocale}
          enabledLocales={enabledLocales}
        />
        <DeleteDialog
          target={
            deleting === null
              ? null
              : {
                  kind: deleting.kind,
                  name:
                    deleting.kind === 'section'
                      ? sectionTitle(view, deleting.id, t('untitledSection'))
                      : itemName(view, deleting.id, t('unnamedItem')),
                }
          }
          onConfirm={confirmDelete}
          onOpenChange={(open) => {
            if (!open) setDeleting(null)
          }}
        />

        {openItemId ? (
          <ItemSheet
            key={openItemId}
            itemId={openItemId}
            menuId={menuId}
            tags={sheetTags}
            onCreateTag={createSheetTag}
            onOpenChange={(open) => {
              if (open) return
              clearOpenItem()
              // The sheet saves through its own actions; reload the composer's view so names,
              // badges and issue counts match what was saved.
              router.refresh()
            }}
          />
        ) : null}

        <NewItemDialog
          open={itemDialog.open}
          onOpenChange={(open) => setItemDialog((current) => ({ ...current, open }))}
          defaultLocale={defaultLocale}
          enabledLocales={enabledLocales}
          currency={currency}
          sectionLabel={
            itemDialog.sectionId === null
              ? t('unsorted')
              : sectionTitle(view, itemDialog.sectionId, t('untitledSection'))
          }
          onCreate={({ name, price }) => createItem(itemDialog.sectionId, name, price)}
        />

        <NewSectionDialog
          open={dialog.open}
          onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
          view={view}
          defaultLocale={defaultLocale}
          enabledLocales={enabledLocales}
          initialParentId={dialog.parentId}
          onCreate={({ parentId, title }) => createSection(parentId, title)}
        />
      </ComposerProvider>
    </TillLabelProvider>
  )
}
