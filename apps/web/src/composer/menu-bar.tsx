'use client'

// The top of the composer's Structure subtab (brief S6; D88, D92): which of the venue's menus it
// edits, and how that menu is laid out for guests.
//
// - The switcher lists the venue's menus in use (a binned one is not offered), the live one
//   marked; choosing one opens it (`?menu=`), and the open section and item are the old menu's,
//   so they go. Menus are added, renamed, ordered and binned in Settings › General.
// - "Menu layout" is the layout guests start in (a list, one column, two columns) and whether
//   they may switch it (D92: once a template option, now a setting of the menu). Saved at once
//   with S4's menu actions; it reaches guests with the menu's next publish.
import { MENU_LAYOUTS, type MenuLayout, type MenuSettings } from '@restro/core'
import { SettingsIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Segmented } from '@/design/segmented'
import { setMenuSettingsAction } from '@/server/menus-actions'

import { ITEM_PARAM, SECTION_PARAM } from './item-param'

/** A menu as the switcher lists it. */
export interface MenuChoice {
  readonly id: string
  /** The header name; null = the venue's name. */
  readonly name: string | null
  readonly live: boolean
}

/** The query parameter that names the composer's menu. */
export const MENU_PARAM = 'menu'

/** The layout a menu that set none starts in, and whether guests may switch it (core's default). */
const DEFAULT_LAYOUT: MenuLayout = 'list'

export function MenuBar({
  venueId,
  venueName,
  menus,
  currentId,
  settings,
  canEdit,
}: {
  venueId: string
  /** What a menu without a header name is called. */
  venueName: string
  menus: readonly MenuChoice[]
  currentId: string
  /** The open menu's settings as saved (a key left out is the default). */
  settings: MenuSettings
  /** Owners and admins change the layout; everyone sees it. */
  canEdit: boolean
}) {
  const t = useTranslations('composer.menuBar')
  const tErrors = useTranslations('venueMenus.errors')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const ids = useId()
  const [, startNavigation] = useTransition()
  const [pending, startSaving] = useTransition()
  const saved = {
    layout: settings.layout ?? DEFAULT_LAYOUT,
    layoutSwitch: settings.layout_switch ?? false,
  }
  // What the controls show: the saved settings until a change, then the change (and back to the
  // saved ones if it fails).
  const [shown, setShown] = useState(saved)

  const nameOf = (menu: MenuChoice) => menu.name ?? venueName

  function openMenu(menuId: string) {
    if (menuId === currentId) return
    const params = new URLSearchParams(searchParams.toString())
    params.set(MENU_PARAM, menuId)
    // The open section and item belong to the menu that was open.
    params.delete(SECTION_PARAM)
    params.delete(ITEM_PARAM)
    startNavigation(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }))
  }

  function save(next: typeof shown) {
    const before = shown
    setShown(next)
    startSaving(async () => {
      const result = await setMenuSettingsAction({
        venueId,
        menuId: currentId,
        settings: { layout: next.layout, layout_switch: next.layoutSwitch },
      }).catch(() => ({ ok: false, error: 'failed' }) as const)
      if (result.ok) {
        toast.success(t('saved'))
      } else {
        setShown(before)
        toast.error(tErrors(result.error))
      }
    })
  }

  return (
    <section
      className="grid gap-4 rounded-lg border bg-card p-4 text-card-foreground sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      aria-label={t('label')}
      data-testid="menu-bar"
    >
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${ids}-menu`}>{t('menu')}</Label>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Select value={currentId} onValueChange={openMenu}>
            <SelectTrigger
              id={`${ids}-menu`}
              className="w-full min-w-0 sm:w-72"
              data-testid="menu-switcher"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {menus.map((menu) => (
                <SelectItem key={menu.id} value={menu.id} data-testid="menu-option">
                  <span className="truncate">{nameOf(menu)}</span>
                  {menu.live ? (
                    <Badge variant="success" className="ml-1" data-testid="menu-live">
                      {t('live')}
                    </Badge>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href={`/venues/${venueId}?tab=settings&section=general`}>
              <SettingsIcon aria-hidden />
              {t('manage')}
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-1.5" data-testid="menu-layout">
        <p className="text-sm font-medium" id={`${ids}-layout`}>
          {t('layout')}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label={t('layout')}
            value={shown.layout}
            options={MENU_LAYOUTS.map((layout) => ({
              value: layout,
              label: t(`layouts.${layout}`),
            }))}
            disabled={!canEdit || pending}
            onChange={(layout) => {
              if (layout !== shown.layout) save({ ...shown, layout })
            }}
          />
          <div className="flex items-center gap-2">
            <Switch
              id={`${ids}-switch`}
              checked={shown.layoutSwitch}
              disabled={!canEdit || pending}
              onCheckedChange={(on) => save({ ...shown, layoutSwitch: on })}
              data-testid="menu-layout-switch"
            />
            <Label htmlFor={`${ids}-switch`} className="font-normal">
              {t('guestSwitch')}
            </Label>
          </div>
        </div>
      </div>
    </section>
  )
}
