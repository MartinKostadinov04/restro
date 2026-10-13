// The composer's two subtabs (D92, brief S6), declared once like the workspace tabs: Structure
// (the menu's sections and items) and Design (the venue's template, look and guest features).
// Kept in the URL as `?tab=composer&sub=structure|design`; Structure when absent or unknown.
import { LayoutListIcon, PaletteIcon } from 'lucide-react'

import type { WorkspaceTabDef } from '@/components/admin/workspace-tab-defs'

export const COMPOSER_SUBTAB_DEFS = [
  { value: 'structure', labelKey: 'composer.subtabs.structure', icon: LayoutListIcon },
  { value: 'design', labelKey: 'composer.subtabs.design', icon: PaletteIcon },
] as const satisfies readonly WorkspaceTabDef[]

/** One subtab of the composer. */
export type ComposerSubtab = (typeof COMPOSER_SUBTAB_DEFS)[number]['value']

/** The query parameter of the subtab. */
export const SUBTAB_PARAM = 'sub'

export function isComposerSubtab(value: unknown): value is ComposerSubtab {
  return COMPOSER_SUBTAB_DEFS.some((def) => def.value === value)
}

/** The subtab a `?sub=` value opens: Structure unless it names Design. */
export function composerSubtabOf(requested: unknown): ComposerSubtab {
  return isComposerSubtab(requested) ? requested : 'structure'
}
