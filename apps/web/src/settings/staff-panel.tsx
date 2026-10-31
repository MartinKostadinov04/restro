'use client'

// Settings › Staff and roles (#87, plan `2026-10-27-settings-staff-roles-plan.md`): People, Roles and
// Shared devices on one page, for someone holding `settings.roles`. Every control saves through a
// server action; the service write path checks the rights again and logs the change.
import { useTranslations } from 'next-intl'

import type { StaffView } from '@/server/settings/staff-view'

import { StaffPeople } from './staff-people'
import { StaffDevices, StaffRoles } from './staff-roles'
import { useSettingsRun } from './use-settings-run'

export function StaffPanel({ view }: { view: StaffView }) {
  const t = useTranslations('ownerSettings')
  const runner = useSettingsRun(view.email)
  return (
    <div className="grid grid-cols-1 gap-8" data-testid="staff-panel" aria-busy={runner.pending}>
      <h2 className="text-xl font-semibold tracking-tight">{t('sf_title')}</h2>
      <StaffPeople view={view} runner={runner} />
      <StaffRoles view={view} runner={runner} />
      <StaffDevices view={view} runner={runner} />
      {runner.dialog}
    </div>
  )
}
