import { redirect } from 'next/navigation'

import { SETTINGS_SECTIONS, settingsSectionPath } from '@/components/admin/settings-sections'
import { requireTenant } from '@/server/session'

// `/settings` has no content of its own: it opens the first section.
export default async function SettingsPage() {
  await requireTenant()
  const [first] = SETTINGS_SECTIONS
  redirect(settingsSectionPath(first))
}
