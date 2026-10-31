'use client'

// The Style tiles of the Design page (D128, D129): radio cards with a picture. A tile's picture is the
// real renderer drawing the top of the venue's menu with that Style's values, in the draft's colours
// and body font (`ScaledFrame`, as a picture). Only Styles that have a file are offered; later Styles
// appear as their files land. Picking the Style already chosen fills its options in again: that is
// how a person starts over.
import type {
  DesignStyleOption,
  DesignValues,
  LiveOverlay,
  MenuSnapshot,
  PremadeStyleId,
  VenueTheme,
} from '@restro/core'
import { DESIGN_PAGES } from '@restro/core'
import { useTranslations } from 'next-intl'
import { useDeferredValue, useId, useMemo } from 'react'

import { availableStyles, themeWithValues, valuesOfStyle } from './design-draft'
import type { Draft } from './preview-draft'
import type { FrameContent } from './preview-frames'
import { previewSnapshot, specimenSnapshot } from './preview-snapshot'
import { ScaledFrame } from './scaled-frame'

/** The width a tile's picture is laid out at: a phone's. */
const SPECIMEN_WIDTH = 390

/** The contract's Style option: its values name every premade Style. */
function styleOption(): DesignStyleOption {
  const option = DESIGN_PAGES[0].options.find((entry) => entry.id === 'style')
  if (option === undefined || option.kind !== 'style') {
    throw new Error('the design contract has no Style option')
  }
  return option as DesignStyleOption
}

function Specimen({
  venueId,
  styleId,
  name,
  snapshot,
  overlay,
  theme,
  values,
}: {
  venueId: string
  styleId: PremadeStyleId
  name: string
  snapshot: MenuSnapshot
  overlay: LiveOverlay
  theme: VenueTheme
  values: DesignValues
}) {
  const content = useMemo<FrameContent | null>(() => {
    const own = valuesOfStyle(styleId, values)
    if (own === null) return null
    return {
      snapshot: previewSnapshot(snapshot, themeWithValues(theme, own), own),
      overlay,
      scheme: own.general.screen === 'dark' ? 'dark' : 'light',
      services: false,
    }
  }, [styleId, snapshot, overlay, theme, values])
  return (
    <ScaledFrame
      venueId={venueId}
      slot={`style-${styleId}`}
      width={SPECIMEN_WIDTH}
      title={name}
      content={content}
      picture
      testId="design-style-specimen"
    />
  )
}

export function StyleTiles({
  venueId,
  locale,
  current,
  draft,
  theme,
  values,
  canEdit,
  onPick,
}: {
  venueId: string
  locale: 'bg' | 'en'
  /** The draft's Style. */
  current: PremadeStyleId
  draft: Draft
  /** The draft's look, whole. */
  theme: VenueTheme
  values: DesignValues
  canEdit: boolean
  onPick: (styleId: PremadeStyleId) => void
}) {
  const t = useTranslations('design.styles')
  const name = useId()
  const styles = availableStyles(styleOption().values)
  // Typing a colour must stay smooth: the pictures follow a moment later.
  const look = useDeferredValue(useMemo(() => ({ theme, values }), [theme, values]))
  const specimen = useMemo(
    () => (draft.state === 'ready' ? specimenSnapshot(draft.snapshot) : null),
    [draft],
  )
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0" data-testid="design-style-tiles">
      <legend className="sr-only">{t('title')}</legend>
      <div className="grid grid-cols-2 gap-3">
        {styles.map((style) => {
          const label = style[locale]
          const id = style.id as PremadeStyleId
          const chosen = current === id
          return (
            <label
              key={style.id}
              data-testid="design-style-tile"
              data-style={id}
              className="grid cursor-pointer gap-2 rounded-md border p-2 has-checked:border-primary has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-70"
            >
              <div className="h-32 overflow-hidden rounded-sm bg-muted/40">
                {specimen !== null && draft.state === 'ready' ? (
                  <Specimen
                    venueId={venueId}
                    styleId={id}
                    name={label}
                    snapshot={specimen}
                    overlay={draft.overlay}
                    theme={look.theme}
                    values={look.values}
                  />
                ) : null}
              </div>
              <span className="flex min-h-8 min-w-0 items-center gap-2 pl-2 text-sm font-medium">
                <input
                  type="radio"
                  name={name}
                  value={style.id}
                  checked={chosen}
                  disabled={!canEdit}
                  // A click, not a change: picking the chosen Style again fills it in again (D129).
                  onChange={() => undefined}
                  onClick={() => onPick(id)}
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
