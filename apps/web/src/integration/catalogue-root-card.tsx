'use client'

// The catalogue-root picker (D56): one barsy installation holds several menus in one category
// tree ("Каса Kiosk", "English", "Showx", "Публично меню" in the demo), so each venue says which
// category its menu starts from. The tree is the cached PUBLIC tree the connection check read;
// nothing is fetched here. A category's own id is only handed back to the server action; it is
// never drawn.
import { ChevronDownIcon, ChevronRightIcon, FolderTreeIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useMemo, useOptimistic, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { FormSection } from '@/components/ui/form-section'
import { chooseCatalogueRootAction } from '@/server/integration/actions'
import type { CategoryNode, IntegrationErrorCode, IntegrationView } from '@/server/integration/view'

import { ErrorNote } from './error-note'
import { useMoment } from './use-moment'

/** The ids of the ancestors of `target`, so the chosen category is visible when the tree opens. */
function ancestorsOf(tree: readonly CategoryNode[], target: number | null): number[] {
  if (target === null) return []
  const path: number[] = []
  const walk = (nodes: readonly CategoryNode[]): boolean => {
    for (const node of nodes) {
      if (node.id === target) return true
      if (walk(node.children)) {
        path.push(node.id)
        return true
      }
    }
    return false
  }
  walk(tree)
  return path
}

function containsId(tree: readonly CategoryNode[], id: number | null): boolean {
  return id !== null && tree.some((node) => node.id === id || containsId(node.children, id))
}

interface TreeProps {
  readonly nodes: readonly CategoryNode[]
  readonly chosen: number | null
  readonly open: ReadonlySet<number>
  readonly groupName: string
  readonly disabled: boolean
  readonly onToggle: (id: number) => void
  readonly onChoose: (id: number) => void
}

function Tree({ nodes, chosen, open, groupName, disabled, onToggle, onChoose }: TreeProps) {
  const t = useTranslations('integration.catalogue')
  return (
    <ul className="grid gap-1">
      {nodes.map((node) => {
        const expanded = open.has(node.id)
        return (
          <li key={node.id} data-testid="category-node">
            <div className="flex items-center gap-1">
              {node.children.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-expanded={expanded}
                  aria-label={t(expanded ? 'collapse' : 'expand', { name: node.name })}
                  onClick={() => onToggle(node.id)}
                >
                  {expanded ? <ChevronDownIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}
                </Button>
              ) : (
                <span className="size-6 shrink-0" aria-hidden />
              )}
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:opacity-60">
                <input
                  type="radio"
                  name={groupName}
                  className="size-4 shrink-0 accent-primary"
                  checked={chosen === node.id}
                  disabled={disabled}
                  onChange={() => onChoose(node.id)}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t('children', { count: node.children.length })}
                </span>
              </label>
            </div>
            {expanded && node.children.length > 0 ? (
              <div className="mt-1 ms-6 border-s ps-2">
                <Tree
                  nodes={node.children}
                  chosen={chosen}
                  open={open}
                  groupName={groupName}
                  disabled={disabled}
                  onToggle={onToggle}
                  onChoose={onChoose}
                />
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export function CatalogueRootCard({ venueId, view }: { venueId: string; view: IntegrationView }) {
  const t = useTranslations('integration.catalogue')
  const moment = useMoment(view.timeZone)
  const groupName = useId()
  const tree = view.tree
  const [chosen, setChosen] = useOptimistic(view.rootCatId)
  const [open, setOpen] = useState<ReadonlySet<number>>(
    () =>
      new Set([...(tree ?? []).map((node) => node.id), ...ancestorsOf(tree ?? [], view.rootCatId)]),
  )
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [pending, startTransition] = useTransition()
  const rootGone = useMemo(
    () => tree !== null && view.rootCatId !== null && !containsId(tree, view.rootCatId),
    [tree, view.rootCatId],
  )

  function toggle(id: number) {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function choose(catId: number) {
    if (catId === chosen) return
    setError(null)
    startTransition(async () => {
      setChosen(catId)
      const result = await chooseCatalogueRootAction({ venueId, catId })
      if (!result.ok) setError(result.error)
    })
  }

  const readAt = moment(view.treeFetchedAt)

  return (
    <FormSection title={t('title')} description={t('description')}>
      {!view.venueMapped ? (
        <p className="text-sm text-muted-foreground" data-testid="catalogue-need-venue">
          {t('needVenue')}
        </p>
      ) : tree === null || tree.length === 0 ? (
        <Empty className="min-h-40" data-testid="catalogue-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderTreeIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t('empty.title')}</EmptyTitle>
            <EmptyDescription>{t('empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <fieldset className="grid gap-2" data-testid="catalogue-tree">
          <legend className="sr-only">{t('legend')}</legend>
          <Tree
            nodes={tree}
            chosen={chosen}
            open={open}
            groupName={groupName}
            disabled={!view.canManage || pending}
            onToggle={toggle}
            onChoose={choose}
          />
          {readAt ? (
            <p className="text-xs text-muted-foreground">{t('readAt', { when: readAt })}</p>
          ) : null}
          {rootGone ? (
            <p role="alert" className="text-sm text-destructive">
              {t('unknownRoot')}
            </p>
          ) : null}
        </fieldset>
      )}
      <ErrorNote code={error} />
    </FormSection>
  )
}
