'use client'

// The labels under an item's name in the list: its tags (at most three, then "+N") and its
// dietary labels (the fixed EU-style list, in a neutral style). Archived tags and ids of another
// venue's tags are not shown: the venue's active tags are the vocabulary.
import { useTranslations } from 'next-intl'

import { useOptionLabel } from '@/fields/option-label'
import { DietaryChip, MoreChip, TagChip } from '@/fields/tag-chip'
import { useComposer } from './composer-context'
import type { ComposerItem } from './view-model'

/** How many tag chips and how many dietary chips a row shows before "+N". */
export const MAX_ROW_CHIPS = 3

const DIETARY_FIELD = { key: 'dietary' } as const

export function ItemChips({ item }: { item: ComposerItem }) {
  const t = useTranslations('composer.chips')
  const { view } = useComposer()
  const dietaryLabel = useOptionLabel(DIETARY_FIELD)

  // In the order of the venue's list.
  const tags = view.tagIds
    .filter((id) => item.tags.includes(id) && view.tags[id]?.archived === false)
    .map((id) => view.tags[id])
    .filter((tag) => tag !== undefined)
  const dietary = item.dietary
  if (tags.length === 0 && dietary.length === 0) return null

  const shownTags = tags.slice(0, MAX_ROW_CHIPS)
  const hiddenTags = tags.slice(MAX_ROW_CHIPS)
  const shownDietary = dietary.slice(0, MAX_ROW_CHIPS)
  const hiddenDietary = dietary.slice(MAX_ROW_CHIPS)

  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="item-chips">
      {shownTags.map((tag) => (
        <TagChip key={tag.id} color={tag.color} tagId={tag.id}>
          {tag.name}
        </TagChip>
      ))}
      {hiddenTags.length > 0 ? (
        <MoreChip
          count={hiddenTags.length}
          title={t('moreTags', { names: hiddenTags.map((tag) => tag.name).join(', ') })}
        />
      ) : null}
      {shownDietary.map((code) => (
        <DietaryChip key={code}>{dietaryLabel(code)}</DietaryChip>
      ))}
      {hiddenDietary.length > 0 ? (
        <MoreChip
          count={hiddenDietary.length}
          title={t('moreDietary', { names: hiddenDietary.map(dietaryLabel).join(', ') })}
        />
      ) : null}
    </div>
  )
}
