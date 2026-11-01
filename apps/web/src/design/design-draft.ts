// What the Design page edits, and its rules (D129). Pure: no React, no I/O, so the rules are tested
// without a screen.
//
// The draft is a whole design: the Style, every option's value, the three colours and hand-set roles
// (the look's form state, `LookState`) and the logo. Nothing is saved until Done. The values are the
// truth for the font, corners, depth and screen; the look's own copies of them are filled in only
// when it is worked out (`lookOf`).
//
// Picking a Style fills every option of the draft from the Style's file, and keeps the colours, the
// roles, the logo and the body font: those are the venue's. One of the organisation's own saved
// Styles, and the design in use at another of its venues (D129, My styles), are picked the same way
// and keep the same things: a saved Style and a copy carry values only.
//
// Undo takes back the last step. A step is one action of the person: a burst of changes to one
// control (typing a colour, dragging a picker) is one step.
import {
  CORNER_RADIUS,
  DEPTH_SHADOW,
  type DesignContent,
  type DesignValues,
  designValuesOfStyle,
  type PremadeStyleId,
  type SnapshotLayout,
  type StyleValues,
  type ThemeFontId,
  type VenueTheme,
} from '@restro/core'
import { PREMADE_STYLES } from '@restro/shell'

import type { LogoState } from './logo-field'
import { type LookState, type LookView, lookStateOf, lookViewOf } from './look-state'

/**
 * Which tile the panel shows as chosen: one of Restro's premade Styles, one of the organisation's
 * own (D129), or the design in use at another of its venues. It is not stored: the design record
 * keeps only `style`, the premade Style the values came from.
 */
export type PickedStyle =
  | { readonly kind: 'premade' }
  | { readonly kind: 'saved'; readonly id: string }
  | { readonly kind: 'venue'; readonly venueId: string }

export interface DesignDraft {
  readonly style: PremadeStyleId
  readonly values: DesignValues
  /** The colours and the roles as typed, and the logo's id. */
  readonly look: LookState
  /** What the page shows of the logo. */
  readonly logo: LogoState | null
  /** The tile shown as chosen; a saved design always opens on its premade Style. */
  readonly picked: PickedStyle
}

/** The saved design as the page holds it. */
export interface SavedDesign {
  readonly design: DesignContent
  readonly theme: VenueTheme
  readonly logo: { readonly assetId: string; readonly url: string | null } | null
}

export function draftOf({ design, theme, logo }: SavedDesign): DesignDraft {
  return {
    style: design.style,
    values: design.values,
    look: lookStateOf(theme),
    logo: logo === null ? null : { assetId: logo.assetId, url: logo.url },
    picked: { kind: 'premade' },
  }
}

/** The form state of the colour controls, with what the option values say about the rest. */
export function lookOf({ look, values }: Pick<DesignDraft, 'look' | 'values'>): LookState {
  const { general } = values
  return {
    ...look,
    font: general.body_font as ThemeFontId,
    radius: CORNER_RADIUS[general.corners],
    shadow: DEPTH_SHADOW[general.depth],
    scheme: general.screen,
  }
}

/** What the draft works out to: the whole look, or which colours are not colours yet. */
export function lookViewOfDraft(draft: Pick<DesignDraft, 'look' | 'values'>): LookView {
  return lookViewOf(lookOf(draft))
}

/** A whole look with the font, corners, depth and screen these values say. */
export function themeWithValues(theme: VenueTheme, values: DesignValues): VenueTheme {
  const { general } = values
  return {
    ...theme,
    font: general.body_font as ThemeFontId,
    radius: CORNER_RADIUS[general.corners],
    shadow: DEPTH_SHADOW[general.depth],
    scheme: general.screen,
  }
}

/** The whole design Done saves; `theme` is the draft's whole look. */
export function designOf(
  { style, values }: Pick<DesignDraft, 'style' | 'values'>,
  theme: VenueTheme,
): DesignContent {
  return {
    style,
    values,
    ...(theme.colors === undefined ? {} : { colors: theme.colors }),
    ...(theme.overrides === undefined ? {} : { overrides: theme.overrides }),
    logo_asset_id: theme.logo_asset_id,
  }
}

/** The design as one comparable string: what "has anything changed" is measured with. */
export const keyOfDesign = (design: DesignContent): string => JSON.stringify(design)

/**
 * The key of a draft as the page would save it, or null while a box holds half a colour. Something is
 * unsaved when the draft's key differs from the key of the draft the page opened or last saved: a look
 * saved the old way (one brand colour) opens as its three colours and counts as nothing changed.
 */
export function keyOfDraft(draft: DesignDraft): string | null {
  const { theme } = lookViewOfDraft(draft)
  return theme === null ? null : keyOfDesign(designOf(draft, theme))
}

/** The Styles that have a file, in the contract's order of `ids`. */
export function availableStyles<T extends { readonly id: string }>(ids: readonly T[]): T[] {
  return ids.filter((entry) => PREMADE_STYLES[entry.id as PremadeStyleId] !== undefined)
}

/** The option values of a Style, with the venue's body font: what picking it fills in. */
export function valuesOfStyle(styleId: PremadeStyleId, values: DesignValues): DesignValues | null {
  const file = PREMADE_STYLES[styleId]
  if (file === undefined) return null
  return {
    ...file.values,
    general: { ...file.values.general, body_font: values.general.body_font },
  } as DesignValues
}

/** Picks a Style: every option comes from it; the colours, roles, logo and body font stay. */
export function withStyle(draft: DesignDraft, styleId: PremadeStyleId): DesignDraft {
  const values = valuesOfStyle(styleId, draft.values)
  return values === null ? draft : { ...draft, style: styleId, values, picked: { kind: 'premade' } }
}

/**
 * Picks one of the organisation's saved Styles, or the design in use at another of its venues
 * (D129): every option comes from it, and this venue's colours, roles, logo and body font stay —
 * the Style carries none of them (D128). `style` keeps the premade Style the values came from.
 */
export function withStyleValues(
  draft: DesignDraft,
  from: { readonly style: PremadeStyleId; readonly values: StyleValues },
  picked: PickedStyle,
): DesignDraft {
  return {
    ...draft,
    style: from.style,
    values: designValuesOfStyle(from.values, draft.values.general.body_font),
    picked,
  }
}

export function withBodyFont(draft: DesignDraft, font: string): DesignDraft {
  const general = { ...draft.values.general, body_font: font } as DesignValues['general']
  return { ...draft, values: { ...draft.values, general } }
}

export function withHeadingFont(draft: DesignDraft, font: string): DesignDraft {
  const general = { ...draft.values.general, heading_font: font } as DesignValues['general']
  return { ...draft, values: { ...draft.values, general } }
}

/** The layout guests start in and whether they may switch it, for every menu of the venue. */
export function withLayout(draft: DesignDraft, layout: SnapshotLayout): DesignDraft {
  const items = {
    ...draft.values.items,
    layout: layout.default,
    guest_switch: layout.guest_switch ? 'on' : 'off',
  } as DesignValues['items']
  return { ...draft, values: { ...draft.values, items } }
}

export function withLogo(draft: DesignDraft, logo: LogoState | null): DesignDraft {
  return { ...draft, logo, look: { ...draft.look, logoAssetId: logo?.assetId ?? null } }
}

// --- Undo ----------------------------------------------------------------------------------------

/** The draft and the steps behind it. */
export interface DraftHistory {
  readonly draft: DesignDraft
  readonly past: readonly DesignDraft[]
  /** The control last changed and when, for telling a burst from a new step. */
  readonly burst: { readonly key: string; readonly at: number } | null
}

/** How long a pause ends a burst of changes to one control (a colour being typed). */
export const BURST_MS = 800
/** How many steps Undo can go back. */
const MAX_STEPS = 100

export const historyOf = (draft: DesignDraft): DraftHistory => ({ draft, past: [], burst: null })

/** A new draft. `key` names a control whose burst of changes is one step; without it, one step. */
export function changed(
  history: DraftHistory,
  next: DesignDraft,
  change: { readonly key?: string; readonly now: number },
): DraftHistory {
  if (JSON.stringify(next) === JSON.stringify(history.draft)) return history
  const { key, now } = change
  const burst = key === undefined ? null : { key, at: now }
  if (
    key !== undefined &&
    history.burst !== null &&
    history.burst.key === key &&
    now - history.burst.at < BURST_MS
  ) {
    return { draft: next, past: history.past, burst }
  }
  return { draft: next, past: [...history.past, history.draft].slice(-MAX_STEPS), burst }
}

/** Takes back the last step. */
export function undone(history: DraftHistory): DraftHistory {
  const last = history.past.at(-1)
  if (last === undefined) return history
  return { draft: last, past: history.past.slice(0, -1), burst: null }
}
