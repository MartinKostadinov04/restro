// The guest-feature options a template declares and the venue's value for each (brief SH-05b; on the
// Design tab since D92, brief S7). Pure. A template declares an option with `group: 'feature'` in
// its manifest; the venue's value is the saved one, else the template's default, for the options
// the template declares only.
import type { Presentation } from '@restro/core'
import { type FaceManifest, resolveOptions } from '@restro/shell'

import type {
  FeatureOptionDeclaration,
  TemplateFeatureOptions,
} from '@/composer/guest-features-panel'

export function featureOptionsOf(
  manifest: FaceManifest,
  presentation: Presentation | null,
): TemplateFeatureOptions {
  const values = resolveOptions(manifest, presentation?.options)
  const declared = Object.entries(manifest.options).flatMap(([key, option]) => {
    if (option.group !== 'feature') return []
    const base = { key, default: option.default, label: option.label }
    const declaration: FeatureOptionDeclaration =
      option.type === 'enum'
        ? { ...base, type: 'enum', values: option.values }
        : { ...base, type: 'boolean' }
    return [declaration]
  })
  return {
    declared,
    values: Object.fromEntries(
      declared.map((option) => [option.key, values[option.key] ?? option.default] as const),
    ),
  }
}
