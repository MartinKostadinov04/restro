'use client'

// The bar above the Settings pages: "Settings › Integrations". The Settings layout draws it, so it
// reads the open section from the URL (a layout does not re-render when the person moves between
// its pages, so the other admin pages, which pass their trail as props, cannot be used here).
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { AdminHeader } from './admin-header'
import { SETTINGS_PATH, settingsSectionOf } from './settings-sections'

export function SettingsHeader() {
  const t = useTranslations()
  const section = settingsSectionOf(usePathname())

  return section ? (
    <AdminHeader
      trail={[{ label: t('settings.title'), href: SETTINGS_PATH }]}
      current={t(section.labelKey)}
    />
  ) : (
    <AdminHeader current={t('settings.title')} />
  )
}
