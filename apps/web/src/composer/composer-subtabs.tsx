'use client'

// The composer's subtabs, Structure and Design (D92, brief S6), mirrored in the URL as `?sub=`
// beside `?tab=composer`: the same tab bar (large screens) and select (small screens) as the
// workspace tabs and the Settings sections.
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { UrlTabs, useUrlTab } from '@/components/admin/workspace-tabs'

import {
  COMPOSER_SUBTAB_DEFS,
  type ComposerSubtab,
  composerSubtabOf,
  isComposerSubtab,
  SUBTAB_PARAM,
} from './subtabs'

export function ComposerSubtabs({
  contents,
}: {
  /** The content of each subtab (the page renders only the open one's data). */
  contents: Record<ComposerSubtab, ReactNode>
}) {
  const t = useTranslations('composer.subtabs')
  const [current, select] = useUrlTab<ComposerSubtab>(
    SUBTAB_PARAM,
    composerSubtabOf,
    isComposerSubtab,
  )
  return (
    <div data-testid="composer-subtabs">
      <UrlTabs
        defs={COMPOSER_SUBTAB_DEFS}
        current={current}
        select={select}
        contents={contents}
        label={t('label')}
      />
    </div>
  )
}
