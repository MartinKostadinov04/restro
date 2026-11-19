'use client'

// One option of the Design page's Advanced panel as a row of tiles (D130, ticket 8): radio cards with a
// picture, one per value of the option. A tile's picture is the real renderer drawing a specimen of
// the part with that value swapped in, in the draft's colours and body font (`ScaledFrame`, as a
// picture); a tile of a screen's page opens that screen first (`design-frame.tsx`). The row, its
// label and its values come from the contract file, so an option added there is a row here.
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
import { useTranslations } from 'next-intl'
import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'

import {
  type RowState,
  shownValues,
  type TilePlan,
  tilePlanOf,
  valueIn,
  withOptionValue,
} from './advanced-model'
import { themeWithValues } from './design-draft'
import type { Draft } from './preview-draft'
import type { FrameContent } from './preview-frames'
import { previewSnapshot } from './preview-snapshot'
import { ScaledFrame } from './scaled-frame'
import { DEMO_ASSET_BASE, specimenOf } from './specimen'

/** The width a tile's picture is laid out at: the narrowest phone the renderer holds for. */
const TILE_WIDTH = 320

/** The stages whose screens are the guest-feature ones: their tiles run the services preview. */
const SERVICE_STAGES = new Set(['order', 'bag', 'bill', 'call', 'pay', 'receipt'])

/** How far from the screen a tile's picture starts to load: a page has dozens, and each is a whole renderer. */
const NEAR_MARGIN = '240px'

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

/** What a tile's picture draws: the specimen with this tile's value swapped into the draft's look. */
function useTileContent({
  specimen,
  overlay,
  look,
  pageId,
  optionId,
  value,
  scheme,
  services,
  plan,
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
      stage: plan.stage,
      focus: plan.focus,
      assetBase: DEMO_ASSET_BASE,
    }
  }, [specimen, overlay, look, pageId, optionId, value, scheme, services, plan])
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
  onPick: () => void
}) {
  const drawn = !blank && (content !== null || loading)
  const [box, near] = useNear()
  return (
    <label
      data-testid="design-tile"
      data-value={value}
      className="grid min-w-0 cursor-pointer content-start gap-2 rounded-md border p-2 has-checked:border-primary has-checked:bg-accent/40 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-70 phone:min-h-11"
    >
      {drawn ? (
        <div
          ref={box}
          className="h-28 overflow-hidden rounded-sm bg-muted/40"
          data-testid="design-tile-picture"
        >
          {content === null || !near ? (
            <Skeleton className="size-full rounded-none" />
          ) : (
            <ScaledFrame
              venueId={venueId}
              slot={slot}
              width={TILE_WIDTH}
              title={label}
              content={content}
              picture
              testId="design-tile-specimen"
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
  const current = valueIn(values, page.id, option.id)
  const services = SERVICE_STAGES.has(plan.stage)
  const strip = page.id === 'sections' && option.id === 'strip_card_size'

  // Typing a colour must stay smooth: the pictures follow a moment later.
  const look = useDeferredValue(useMemo(() => ({ theme, values }), [theme, values]))
  const specimen = useMemo<MenuSnapshot | null>(
    () =>
      draft.state === 'ready' && !state.disabled
        ? specimenOf(draft.snapshot, { services, strip })
        : null,
    [draft, state.disabled, services, strip],
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
      <div className="grid grid-cols-2 gap-2">
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
  })
  return (
    <Tile
      venueId={venueId}
      slot={`tile-${pageId}-${optionId}-${value}`}
      label={label}
      content={content}
      loading={loading}
      checked={checked}
      disabled={disabled}
      blank={blank}
      groupName={groupName}
      value={value}
      onPick={() => onPick(value)}
    />
  )
}
