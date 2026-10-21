'use client'

// The sub-navigation of the organisation's Settings area, drawn from the one list of sections
// (settings-sections.ts). The open section is read from the URL, because the Settings layout
// does not re-render when the person moves between its pages.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'

import {
  type SettingsSectionDef,
  settingsSectionOf,
  settingsSectionPath,
  visibleSettingsSections,
} from './settings-sections'

/** `isOwner`: the sections that are for owners only (Deleted venues, D76) are drawn too. */
export function SettingsNav({ isOwner = false }: { readonly isOwner?: boolean }) {
  const t = useTranslations()
  const open: SettingsSectionDef | undefined = settingsSectionOf(usePathname())
  const sections = visibleSettingsSections(isOwner)

  return (
    <nav aria-label={t('settings.sectionsLabel')} data-testid="settings-nav">
      <ul className="flex flex-wrap gap-1 border-b">
        {sections.map((section) => {
          const Icon = section.icon
          const isOpen = section.value === open?.value
          return (
            <li key={section.value}>
              <Link
                href={settingsSectionPath(section)}
                aria-current={isOpen ? 'page' : undefined}
                data-testid={`settings-nav-${section.value}`}
                className={cn(
                  '-mb-px inline-flex items-center gap-2 phone:min-h-11 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                  isOpen && 'border-primary text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {t(section.labelKey)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
