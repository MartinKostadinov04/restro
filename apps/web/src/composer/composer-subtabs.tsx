'use client'

// The Studio's subtabs, Structure and Design (D92, D129), with the same tab bar (large screens) and
// select (small screens) as the workspace tabs and the Settings sections. Structure is what the tab
// shows; Design is a page of its own, and choosing it leaves for that page. A whole page load, on
// purpose: from then on the browser's Back leaves a document, so the page's warning about unsaved
// edits fires for it too.
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { UrlTabs } from '@/components/admin/workspace-tabs'

import { designPagePath } from './design-path'
import { MENU_PARAM } from './menu-bar'
import { COMPOSER_SUBTAB_DEFS } from './subtabs'

export function ComposerSubtabs({
  venueId,
  structure,
}: {
  venueId: string
  /** The content of Structure; Design has none here. */
  structure: ReactNode
}) {
  const t = useTranslations('composer.subtabs')
  const menu = useSearchParams().get(MENU_PARAM)
  return (
    <div data-testid="composer-subtabs">
      <UrlTabs
        defs={COMPOSER_SUBTAB_DEFS}
        current="structure"
        select={(value) => {
          if (value === 'design') window.location.assign(designPagePath(venueId, menu))
        }}
        contents={{ structure }}
        label={t('label')}
      />
    </div>
  )
}
