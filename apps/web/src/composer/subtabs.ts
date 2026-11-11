// The Studio's two subtabs (D92, D129), declared once like the workspace tabs: Structure (the menu's
// sections and items, and the Guest functions card) and Design (the venue's design, a page of its
// own). The Studio's URL is `?tab=studio`; the old `sub=design` leads to the Design page.
import { LayoutListIcon, PaletteIcon } from 'lucide-react'

import type { WorkspaceTabDef } from '@/components/admin/workspace-tab-defs'

export const COMPOSER_SUBTAB_DEFS = [
  { value: 'structure', labelKey: 'composer.subtabs.structure', icon: LayoutListIcon },
  { value: 'design', labelKey: 'composer.subtabs.design', icon: PaletteIcon },
] as const satisfies readonly WorkspaceTabDef[]

/** One subtab of the Studio. */
export type ComposerSubtab = (typeof COMPOSER_SUBTAB_DEFS)[number]['value']
