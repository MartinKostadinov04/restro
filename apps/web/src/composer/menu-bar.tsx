'use client'

// The top of Structure (brief S6, D88): which of the venue's menus it edits. The switcher lists the
// venue's menus in use (a binned one is not offered), the live one marked; choosing one opens it
// (`?menu=`), and the open section and item are the old menu's, so they go. Menus are added, renamed,
// ordered and binned in Settings > General. The layout for all menus is part of the design (D129): it
// lives on the Design page, saved by Done with the rest.
import { SettingsIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useId, useTransition } from 'react'

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

export function MenuBar({
  venueId,
  venueName,
  menus,
  currentId,
}: {
  venueId: string
  /** What a menu without a header name is called. */
  venueName: string
  menus: readonly MenuChoice[]
  currentId: string
}) {
  const t = useTranslations('composer.menuBar')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const ids = useId()
  const [, startNavigation] = useTransition()

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

  return (
    <section
      className="grid gap-4 rounded-lg border bg-card p-4 text-card-foreground"
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
    </section>
  )
}
