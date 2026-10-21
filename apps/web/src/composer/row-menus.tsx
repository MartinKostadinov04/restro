'use client'

// The "more" menus of an item row and a section row. They hold the actions that drag and drop
// cannot reach everywhere: move to another section (also from a phone, or by keyboard), take an
// item out of its section, hide a section, move a section under another or to the top; and the
// structure edits of brief S6 (D89, D92): rename, lay a section out as a horizontal row, delete a
// section of the venue's own or an item made by hand.
import { MAX_SECTION_DEPTH, type NodeId } from '@restro/core'
import {
  BanIcon,
  EyeIcon,
  EyeOffIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  Undo2Icon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { useComposer } from './composer-context'
import { itemName, sectionTitle } from './labels'
import { canDeleteSection, depthOf, flattenSections, moveTargets } from './tree'

function Indent({ depth, children }: { depth: number; children: React.ReactNode }) {
  return (
    <span style={{ paddingInlineStart: `${Math.max(0, depth - 1) * 0.75}rem` }}>{children}</span>
  )
}

/** Actions of one item row. `sectionId` is the section whose list the row is in (`null` = Unsorted). */
export function ItemMenu({ itemId, sectionId }: { itemId: NodeId; sectionId: NodeId | null }) {
  const t = useTranslations('composer')
  const {
    view,
    openItem,
    moveItemToSection,
    canMarkSoldOut,
    setSoldOut,
    hasTill,
    canDelete,
    startRename,
    deleteItem,
  } = useComposer()
  const name = itemName(view, itemId, t('unnamedItem'))
  const targets = flattenSections(view).filter(({ id }) => id !== sectionId)
  const item = view.items[itemId]
  // Sold out tonight (D46): managers mark and unmark; an item the till has off sale has no control,
  // since ours can only add caution (rule 5) and "back on sale" would be a lie.
  const soldOutControl =
    canMarkSoldOut && item !== undefined && item.offSale === null
      ? item.soldOutTonight
        ? 'unmark'
        : 'mark'
      : null
  // Items made by hand are renamed in place and deleted here (D89); a till's item keeps its name
  // in the till, with ours over it in the sheet, and leaves only when the till drops it.
  const handMade = !hasTill && item?.origin === 'owned'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={t('actions.more', { name })}
          data-testid="item-menu"
        >
          <MoreHorizontalIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 min-w-56">
        <DropdownMenuItem onSelect={() => openItem(itemId)}>
          {t('actions.open', { name })}
        </DropdownMenuItem>
        {handMade ? (
          <DropdownMenuItem
            data-testid="item-rename"
            onSelect={() => startRename({ kind: 'item', id: itemId })}
          >
            <PencilIcon aria-hidden />
            {t('actions.rename')}
          </DropdownMenuItem>
        ) : null}
        {soldOutControl !== null ? (
          <DropdownMenuItem
            data-testid={soldOutControl === 'mark' ? 'item-mark-sold-out' : 'item-unmark-sold-out'}
            onSelect={() => setSoldOut([itemId], soldOutControl === 'mark')}
          >
            {soldOutControl === 'mark' ? <BanIcon aria-hidden /> : <Undo2Icon aria-hidden />}
            {soldOutControl === 'mark' ? t('soldOut.mark') : t('soldOut.unmark')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={targets.length === 0}>
            {t('actions.moveTo')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 min-w-52 overflow-y-auto">
            {targets.map(({ id, depth }) => (
              <DropdownMenuItem
                key={id}
                data-testid="move-target"
                onSelect={() => moveItemToSection(itemId, sectionId, id)}
              >
                <Indent depth={depth}>{sectionTitle(view, id, t('untitledSection'))}</Indent>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {sectionId !== null ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => moveItemToSection(itemId, sectionId, null)}>
              {t('actions.removeFromSection')}
            </DropdownMenuItem>
          </>
        ) : null}
        {handMade && canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              data-testid="item-delete"
              onSelect={() => deleteItem(itemId)}
            >
              <Trash2Icon aria-hidden />
              {t('actions.deleteItem')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Actions of one section: rename, hide or show, lay out as a row, move under another section or
 * to the top level, delete (the venue's own sections only).
 */
export function SectionMenu({ sectionId }: { sectionId: NodeId }) {
  const t = useTranslations('composer')
  const {
    view,
    select,
    toggleSectionHidden,
    moveSectionTo,
    newSection,
    setSectionLayout,
    startRename,
    deleteSection,
    canDelete,
  } = useComposer()
  const section = view.sections[sectionId]
  const name = sectionTitle(view, sectionId, t('untitledSection'))
  const targets = moveTargets(view, sectionId)
  if (!section) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={t('actions.more', { name })}
          data-testid="section-menu"
        >
          <MoreHorizontalIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 min-w-56">
        <DropdownMenuItem
          data-testid="section-rename"
          onSelect={() => {
            // The title is edited in the open section's header.
            select(sectionId)
            startRename({ kind: 'section', id: sectionId })
          }}
        >
          <PencilIcon aria-hidden />
          {t('actions.rename')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toggleSectionHidden(sectionId)}>
          {section.hidden ? <EyeIcon aria-hidden /> : <EyeOffIcon aria-hidden />}
          {section.hidden ? t('visibility.showSection') : t('visibility.hideSection')}
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem
          checked={section.layout === 'horizontal'}
          onCheckedChange={(checked) =>
            setSectionLayout(sectionId, checked === true ? 'horizontal' : 'vertical')
          }
          data-testid="section-layout-item"
        >
          {t('layout.horizontal')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem
          disabled={depthOf(view, sectionId) >= MAX_SECTION_DEPTH}
          onSelect={() => newSection(sectionId)}
        >
          {t('actions.newInside')}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={targets.length === 0}>
            {t('actions.moveTo')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 min-w-52 overflow-y-auto">
            {targets.map(({ id, depth }) => (
              <DropdownMenuItem
                key={id ?? 'top'}
                data-testid="move-target"
                onSelect={() => moveSectionTo(sectionId, id)}
              >
                <Indent depth={depth + 1}>
                  {id === null
                    ? t('actions.topLevel')
                    : sectionTitle(view, id, t('untitledSection'))}
                </Indent>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {canDelete && canDeleteSection(view, sectionId) ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              data-testid="section-delete"
              onSelect={() => deleteSection(sectionId)}
            >
              <Trash2Icon aria-hidden />
              {t('actions.deleteSection')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
