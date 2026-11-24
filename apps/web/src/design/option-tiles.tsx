'use client'

// One option of the Design page's Advanced panel as a row of tiles (D130, ticket 8): radio cards with a
// picture, one per value of the option. A tile's picture is the real renderer drawing only the part
// the option changes (D159, `PART_OF_OPTION`), with that value swapped in, in the draft's colours and
// body font (`ScaledFrame`, as a picture, with the face's specimen view in the frame). The row, its
// label and its values come from the contract file, so an option added there is a row here; until it
// has a part, its tiles draw the menu at its stage (`tilePlanOf`, `design-frame.tsx`).
//
// A tile is as tall as its part. A short part (at most 160 px tall at 320 px: a dish row, the rail)
// takes the row's whole width and is drawn at 1:1, never scaled up; a taller one (a sheet, an open
// dish, four dishes) goes two to a line, scaled down to no less than half, else alone on its line.
//
// A row that does not apply is switched off with its hint under it, and its tiles draw nothing: a
// radio with the value word is all it needs. A tile that cannot draw keeps its value word and radio,
// so the value can always be picked. A member who may not edit still sees every picture.
//
// Each tile works out its own picture and keeps it until something it draws changes: a re-render of
// the page (a keystroke in another box) redraws no frame.
import type {
  DesignChoiceOption,
  DesignPage,
  DesignValues,
  LiveOverlay,
  MenuSnapshot,
  VenueTheme,
} from '@restro/core'
import {
  SPECIMEN_FIXED_PARTS,
  SPECIMEN_PHONE_HEIGHT,
  type SpecimenPart,
  specimenNeedsServices,
} from '@restro/editorial-market/preview'
import { useTranslations } from 'next-intl'
import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

import {
  type RowState,
  shownValues,
  specimenPartOf,
  type TilePlan,
  tilePlanOf,
  valueIn,
  withOptionValue,
} from './advanced-model'
import { themeWithValues } from './design-draft'
import type { Draft } from './preview-draft'
import type { FrameContent } from './preview-frames'
import { previewSnapshot } from './preview-snapshot'
import { ScaledFrame, TileLoading } from './scaled-frame'
import { DEMO_ASSET_BASE, specimenOf } from './specimen'

/** The width a tile's picture is laid out at: the narrowest phone the renderer holds for. */
const TILE_WIDTH = 320

/** The stages whose screens are the guest-feature ones: their tiles run the services preview. */
const SERVICE_STAGES = new Set(['order', 'bag', 'bill', 'call', 'pay', 'receipt'])

/** How far from the screen a tile's picture starts to load: a page has dozens, and each is a renderer. */
const NEAR_MARGIN = '240px'

/** The tallest part, at `TILE_WIDTH`, that takes the row's whole width at 1:1 (D159). */
export const SHORT_PART = 160

/**
 * How tall each part is about to be at `TILE_WIDTH`, before its frame has told: the tile keeps that
 * room while it draws, so the panel hardly moves once the part is measured.
 */
const PART_HEIGHT: Readonly<Record<SpecimenPart, number>> = {
  header: 170,
  rail: 52,
  'header-rail': 222,
  section: 200,
  'section-two': 330,
  switch: 390,
  'dish-row': 150,
  'dish-rows': 420,
  'two-dishes': 300,
  'four-dishes': 560,
  'dish-long': 190,
  'dish-allergens': 420,
  'dish-card': 360,
  'dish-add': 150,
  strip: 290,
  'dish-open': SPECIMEN_PHONE_HEIGHT,
  'order-bar': 330,
  'call-sheet': SPECIMEN_PHONE_HEIGHT,
  'call-kinds': 200,
  'call-foot': 80,
  'bill-lines': 230,
  'bag-lines': 220,
  tip: 120,
  'receipt-top': 150,
}

/** The height a part's tile starts with: a whole screen's own, else the guess above. */
export function partHeightOf(part: SpecimenPart): number {
  return SPECIMEN_FIXED_PARTS.has(part) ? SPECIMEN_PHONE_HEIGHT : PART_HEIGHT[part]
}

/**
 * How a tile of a part sits in the row's two columns. A short part takes both, at 1:1. A tall one
 * takes one where half the row leaves its picture at least half of `TILE_WIDTH`, else both: the row
 * is then at least 364 px (two columns of 160 px pictures in 9 px of border and padding a side, and
 * the 8 px gap).
 */
export function tileSpanOf(height: number): string {
  return height <= SHORT_PART ? 'col-span-2' : 'col-span-2 @min-[364px]:col-span-1'
}

/**
 * Whether a tile is on the screen or close to it; once it has been, it stays so (its picture is kept,
 * not drawn again). Every tile counts as near where the browser cannot tell.
 */
function useNear(): [(element: HTMLDivElement | null) => void, boolean] {
  const [element, box] = useState<HTMLDivElement | null>(null)
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near || element === null) return undefined
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          watcher.disconnect()
        }
      },
      { rootMargin: NEAR_MARGIN },
    )
    watcher.observe(element)
    return () => watcher.disconnect()
  }, [element, near])
  return [box, near]
}

/**
 * What a tile's picture draws: the specimen with this tile's value swapped into the draft's look; the
 * part alone when the option has one (D159), else the menu at the plan's stage.
 */
export function useTileContent({
  specimen,
  overlay,
  look,
  pageId,
  optionId,
  value,
  scheme,
  services,
  plan,
  part = null,
}: {
  specimen: MenuSnapshot | null
  overlay: LiveOverlay | null
  look: { readonly theme: VenueTheme; readonly values: DesignValues }
  pageId: string
  optionId: string
  value: string
  scheme: 'light' | 'dark'
  services: boolean
  plan: TilePlan
  /** The part the tile draws alone, or null for the menu at the plan's stage. */
  part?: SpecimenPart | null
}): FrameContent | null {
  return useMemo(() => {
    if (specimen === null || overlay === null) return null
    const own = withOptionValue(look.values, pageId, optionId, value)
    return {
      snapshot: previewSnapshot(specimen, themeWithValues(look.theme, own), own),
      overlay,
      scheme:
        pageId === 'general' && optionId === 'screen' && value !== 'auto'
          ? (value as 'light' | 'dark')
          : scheme,
      services,
      assetBase: DEMO_ASSET_BASE,
      ...(part === null ? { stage: plan.stage, focus: plan.focus } : { specimen: part }),
    }
  }, [specimen, overlay, look, pageId, optionId, value, scheme, services, plan, part])
}

function Tile({
  venueId,
  slot,
  label,
  content,
  loading,
  checked,
  disabled,
  blank,
  groupName,
  value,
  part,
  onPick,
}: {
  venueId: string
  slot: string
  label: string
  /** What the picture draws, or null for none. */
  content: FrameContent | null
  loading: boolean
  checked: boolean
  /** The radio cannot be picked: the row does not apply, or the person may not edit. */
  disabled: boolean
  /** The row does not apply: the tile draws no picture. */
  blank: boolean
  groupName: string
  value: string
  /** The part the picture draws alone, or null for the menu. */
  part: SpecimenPart | null
  onPick: () => void
}) {
  const drawn = !blank && (content !== null || loading)
  const [box, near] = useNear()
  // The part's height at `TILE_WIDTH`: the guess until its frame tells it; a whole screen's is fixed.
  // A tile is keyed by its slot (`OptionTile`), so a height told for another option is never kept.
  const [told, setTold] = useState<number | null>(null)
  const height =
    part === null
      ? null
      : SPECIMEN_FIXED_PARTS.has(part)
        ? SPECIMEN_PHONE_HEIGHT
        : (told ?? partHeightOf(part))
  return (
    <label
      data-testid="design-tile"
      data-value={value}
      data-part={part ?? undefined}
      className={cn(
        // The row's width is the part's, not each value's: every tile of a row sits alike.
        part !== null && tileSpanOf(partHeightOf(part)),
        'grid min-w-0 cursor-pointer content-start gap-2 rounded-md border p-2 has-checked:border-primary has-checked:bg-accent/40 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-70 phone:min-h-11',
      )}
    >
      {drawn ? (
        <div
          ref={box}
          className={cn(
            'relative overflow-hidden rounded-sm bg-muted/40',
            height === null && 'h-28',
          )}
          // As tall as the part at the scale the box's width gives it, and never taller than the part:
          // the frame inside is laid out at `TILE_WIDTH` and scaled down to the box, never up.
          style={
            height === null
              ? undefined
              : { width: '100%', aspectRatio: `${TILE_WIDTH} / ${height}`, maxHeight: height }
          }
          data-testid="design-tile-picture"
        >
          {content === null || !near ? (
            <TileLoading />
          ) : (
            <ScaledFrame
              venueId={venueId}
              slot={slot}
              width={TILE_WIDTH}
              title={label}
              content={content}
              picture
              testId="design-tile-specimen"
              onHeight={part === null ? undefined : setTold}
            />
          )}
        </div>
      ) : null}
      <span className="flex min-h-8 min-w-0 items-center gap-2 pl-1 text-sm font-medium">
        <input
          type="radio"
          name={groupName}
          value={value}
          checked={checked}
          disabled={disabled}
          // A click, not a change: picking the chosen value again does nothing, as it should.
          onChange={() => undefined}
          onClick={onPick}
          className="size-4 shrink-0 accent-primary"
        />
        <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
      </span>
    </label>
  )
}

export function OptionTiles({
  venueId,
  locale,
  page,
  option,
  values,
  theme,
  draft,
  scheme,
  state,
  canEdit,
  onPick,
}: {
  venueId: string
  locale: 'bg' | 'en'
  page: DesignPage
  option: DesignChoiceOption
  /** The draft's values. */
  values: DesignValues
  /** The draft's look, whole. */
  theme: VenueTheme
  draft: Draft
  /** The screen the preview shows, for a value that does not say light or dark. */
  scheme: 'light' | 'dark'
  state: RowState
  canEdit: boolean
  onPick: (value: string) => void
}) {
  const t = useTranslations('design.advanced')
  const group = useId()
  const hint = useId()
  const plan = useMemo(() => tilePlanOf(page.id, option.id), [page.id, option.id])
  const part = useMemo(() => specimenPartOf(page.id, option.id), [page.id, option.id])
  const current = valueIn(values, page.id, option.id)
  const services = part === null ? SERVICE_STAGES.has(plan.stage) : specimenNeedsServices(part)
  const strip = page.id === 'sections' && option.id === 'strip_card_size'

  // Typing a colour must stay smooth: the pictures follow a moment later.
  const look = useDeferredValue(useMemo(() => ({ theme, values }), [theme, values]))
  const specimen = useMemo<MenuSnapshot | null>(
    () =>
      draft.state === 'ready' && !state.disabled
        ? specimenOf(draft.snapshot, { services, strip, part })
        : null,
    [draft, state.disabled, services, strip, part],
  )

  const note =
    state.note === null
      ? null
      : state.note.kind === 'bleed'
        ? t('notes.bleed')
        : t('notes.heavy', { font: state.note.font, weight: state.note.heaviest })

  return (
    <fieldset
      className="m-0 grid min-w-0 gap-2 border-0 p-0"
      disabled={!canEdit || state.disabled}
      aria-describedby={note === null ? undefined : hint}
      data-testid="design-option"
      data-page={page.id}
      data-option={option.id}
      data-disabled={state.disabled ? 'true' : undefined}
    >
      <legend className="mb-2 text-sm font-semibold">{option[locale]}</legend>
      {note === null ? null : (
        <p id={hint} className="text-sm text-muted-foreground" data-testid="design-option-note">
          {note}
        </p>
      )}
      <div className="@container grid grid-cols-2 gap-2">
        {shownValues(option.values).map((entry) => (
          <OptionTile
            key={entry.id}
            venueId={venueId}
            pageId={page.id}
            optionId={option.id}
            value={entry.id}
            label={entry[locale]}
            specimen={specimen}
            overlay={draft.state === 'ready' ? draft.overlay : null}
            look={look}
            scheme={scheme}
            services={services}
            plan={plan}
            part={part}
            loading={draft.state === 'loading'}
            checked={current === entry.id}
            disabled={!canEdit || state.disabled}
            blank={state.disabled}
            groupName={group}
            onPick={onPick}
          />
        ))}
      </div>
    </fieldset>
  )
}

/** One value's tile, with its own picture (`useTileContent`). */
function OptionTile({
  venueId,
  pageId,
  optionId,
  value,
  label,
  specimen,
  overlay,
  look,
  scheme,
  services,
  plan,
  part,
  loading,
  checked,
  disabled,
  blank,
  groupName,
  onPick,
}: {
  venueId: string
  pageId: string
  optionId: string
  value: string
  label: string
  specimen: MenuSnapshot | null
  overlay: LiveOverlay | null
  look: { readonly theme: VenueTheme; readonly values: DesignValues }
  scheme: 'light' | 'dark'
  services: boolean
  plan: TilePlan
  part: SpecimenPart | null
  loading: boolean
  checked: boolean
  disabled: boolean
  blank: boolean
  groupName: string
  onPick: (value: string) => void
}) {
  const content = useTileContent({
    specimen,
    overlay,
    look,
    pageId,
    optionId,
    value,
    scheme,
    services,
    plan,
    part,
  })
  const slot = `tile-${pageId}-${optionId}-${value}`
  return (
    <Tile
      // Two options can share an id and a value (Title size on Header and on Sections): the panel
      // keeps the row, so the tile is keyed by its slot and starts again for the other option.
      key={slot}
      venueId={venueId}
      slot={slot}
      label={label}
      content={content}
      loading={loading}
      checked={checked}
      disabled={disabled}
      blank={blank}
      groupName={groupName}
      value={value}
      part={part}
      onPick={() => onPick(value)}
    />
  )
}
