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
import { useDeferredValue, useMemo } from 'react'

import { availableStyles, themeWithValues, valuesOfStyle } from './design-draft'
import type { Draft } from './preview-draft'
import type { FrameContent } from './preview-frames'
import { previewSnapshot, specimenSnapshot } from './preview-snapshot'
import { ScaledFrame } from './scaled-frame'

/** The width a tile's picture is laid out at: a phone's. */
export const SPECIMEN_WIDTH = 390

/** The contract's Style option: its values name every premade Style. */
function styleOption(): DesignStyleOption {
  const option = DESIGN_PAGES[0].options.find((entry) => entry.id === 'style')
  if (option === undefined || option.kind !== 'style') {
    throw new Error('the design contract has no Style option')
  }
  return option as DesignStyleOption
}

/**
 * A tile's picture: the renderer drawing the top of the venue's menu with `own` (a Style's option
 * values, with the venue's own body font already put back), in the venue's colours. Shared with the
 * My styles group, whose tiles draw the organisation's own Styles and the other venues' designs.
 */
export function StyleSpecimen({
  venueId,
  slot,
  name,
  snapshot,
  overlay,
  theme,
  own,
  testId,
}: {
  venueId: string
  slot: string
  name: string
  snapshot: MenuSnapshot
  overlay: LiveOverlay
  theme: VenueTheme
  /** The whole option values this tile draws. */
  own: DesignValues
  testId: string
}) {
  const content = useMemo<FrameContent>(
    () => ({
      snapshot: previewSnapshot(snapshot, themeWithValues(theme, own), own),
      overlay,
      scheme: own.general.screen === 'dark' ? 'dark' : 'light',
      services: false,
    }),
    [snapshot, overlay, theme, own],
  )
  return (
    <ScaledFrame
      venueId={venueId}
      slot={slot}
      width={SPECIMEN_WIDTH}
      title={name}
      content={content}
      picture
      testId={testId}
    />
  )
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
  const own = useMemo(() => valuesOfStyle(styleId, values), [styleId, values])
  if (own === null) return null
  return (
    <StyleSpecimen
      venueId={venueId}
      slot={`style-${styleId}`}
      name={name}
      snapshot={snapshot}
      overlay={overlay}
      theme={theme}
      own={own}
      testId="design-style-specimen"
    />
  )
}

export function StyleTiles({
  venueId,
  locale,
  current,
  chosen,
  groupName,
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
  /** False while one of the organisation's own Styles, or another venue's design, is the chosen tile. */
  chosen: boolean
  /** The radio group both tile groups share, so exactly one tile is ticked. */
  groupName: string
  draft: Draft
  /** The draft's look, whole. */
  theme: VenueTheme
  values: DesignValues
  canEdit: boolean
  onPick: (styleId: PremadeStyleId) => void
}) {
  const t = useTranslations('design.styles')
  const styles = availableStyles(styleOption().values)
  // Typing a colour must stay smooth: the pictures follow a moment later.
  const look = useDeferredValue(useMemo(() => ({ theme, values }), [theme, values]))
  const specimen = useMemo(
    () => (draft.state === 'ready' ? specimenSnapshot(draft.snapshot) : null),
    [draft],
  )
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0" data-testid="design-style-tiles">
      <legend className="sr-only">{t('restro')}</legend>
      <div className="grid grid-cols-2 gap-3">
        {styles.map((style) => {
          const label = style[locale]
          const id = style.id as PremadeStyleId
          const ticked = chosen && current === id
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
                  name={groupName}
                  value={style.id}
                  checked={ticked}
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
