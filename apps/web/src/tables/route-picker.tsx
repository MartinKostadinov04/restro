'use client'

// The menu picker of an area header and of a table card (brief S5, D95, adjustments M2): which menu
// the code opens. The venue's live menu is the default; an area's choice overrides the venue's
// and a table's overrides its area's; the first item of the list takes the choice away
// ("Same as the venue" on an area, "Same as the area" on a table). A binned menu is not offered
// (the view lists only menus in use). Owners and admins choose; everyone else reads.
import { useTranslations } from 'next-intl'
import { useId } from 'react'

import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { setMenuRouteAction } from '@/server/tables/actions'
import type { MenuChoice, MenuShown } from '@/server/tables/view'

import { useRun } from './use-run'

/** The value of the item that takes the choice away: a menu id is never this. */
const INHERIT = '__inherit__'

export type RouteTarget = { readonly areaId: string } | { readonly tableId: string }

export function RoutePicker({
  venueId,
  target,
  targetName,
  menus,
  value,
  effective,
  canManage,
}: {
  venueId: string
  target: RouteTarget
  /** What the picker is for, in the sentence "Menu for {target}": "the area Terrace", "table 12". */
  targetName: string
  menus: readonly MenuChoice[]
  /** The menu the target's own entry names, or null. */
  value: string | null
  /** The menu a guest gets from the target, or null when nothing is published. */
  effective: MenuShown | null
  canManage: boolean
}) {
  const t = useTranslations('tables.route')
  const { pending, run } = useRun()
  const noteId = useId()
  const isArea = 'areaId' in target

  const own = value === null ? undefined : menus.find((menu) => menu.id === value)
  const label =
    own !== undefined
      ? t('value', { menu: own.name })
      : effective === null
        ? t('value', { menu: t('inheritNone') })
        : t('value', {
            menu: t(effective.level === 'area' ? 'inheritArea' : 'inheritVenue', {
              menu: effective.name,
            }),
          })
  // The target chose a menu that is not published yet: guests get the next level up meanwhile.
  const fallback =
    own !== undefined && (effective === null || effective.id !== own.id)
      ? effective === null
        ? t('notPublishedNone')
        : t('notPublished', { menu: effective.name })
      : null

  function choose(next: string) {
    const menuId = next === INHERIT ? null : next
    if (menuId === value) return
    run(
      () => setMenuRouteAction({ venueId, target, menuId }),
      menuId === null ? t('cleared') : t('saved'),
    )
  }

  const overrides = effective !== null && effective.level === (isArea ? 'area' : 'table')

  return (
    <div className="grid min-w-0 gap-1" data-testid="route-picker">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {canManage ? (
          <Select value={value ?? INHERIT} onValueChange={choose} disabled={pending}>
            <SelectTrigger
              size="sm"
              className="max-w-full min-w-0"
              aria-label={t('label', { target: targetName })}
              aria-describedby={fallback === null ? undefined : noteId}
              data-testid="route-select"
            >
              <SelectValue>{label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT} data-testid="route-inherit">
                {t(isArea ? 'sameAsVenue' : 'sameAsArea')}
              </SelectItem>
              {menus.map((menu) => (
                <SelectItem key={menu.id} value={menu.id} data-testid="route-option">
                  {menu.live ? t('liveMark', { name: menu.name }) : menu.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm" data-testid="route-text">
            {label}
          </span>
        )}
        {overrides ? <OverridesBadge /> : null}
      </div>
      {fallback === null ? null : (
        <p id={noteId} className="text-xs text-muted-foreground" data-testid="route-fallback">
          {fallback}
        </p>
      )}
    </div>
  )
}

function OverridesBadge() {
  const t = useTranslations('tables.row')
  return (
    <Badge variant="info" data-testid="menu-overrides">
      {t('overrides')}
    </Badge>
  )
}
