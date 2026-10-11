// `buildViewModel(snapshot, overlay, context)`: the population rules R1–R15 in one place. Pure and
// deterministic: the same three inputs always give a deep-equal view model (R14). Nothing here
// reads the clock, a global or the environment; `now` arrives in the context.

import {
  ALLERGENS,
  type Allergen,
  DIETARY_LABELS,
  type DietaryLabel,
  type LiveOverlay,
  type Locale,
  type MenuSnapshot,
  NEW_BADGE,
  type NodeId,
  type TagId,
} from '@restro/core'

import {
  INTERACTIVE_CHANNELS,
  parseContext,
  type ShellContext,
  type ShellContextInput,
} from './context'
import { viewFeatures } from './features'
import { formatField, type SnapshotFieldType } from './fields'
import { viewImage } from './images'
import { viewDelta, viewPrice } from './money'
import { PALETTE_STEPS, type Palette, resolvePalette, textOn } from './palette'
import {
  describeOpening,
  type NextOpening,
  type ScheduleStatus,
  scheduleStatus,
  type ViewSchedule,
} from './schedule'
import { type Strings, stringsFor } from './strings'
import { fallbackChain, pickText, type ViewText } from './text'
import { themeColours } from './theme'
import type {
  ItemState,
  ViewAllergen,
  ViewBadge,
  ViewDietary,
  ViewExtraField,
  ViewItem,
  ViewModel,
  ViewModifierGroup,
  ViewOption,
  ViewPortion,
  ViewSection,
  ViewState,
  ViewTag,
  ViewTheme,
} from './view-model'

/** Everything the rules read, worked out once per call. */
interface Env {
  readonly snapshot: MenuSnapshot
  readonly overlay: LiveOverlay | null
  readonly context: ShellContext
  /** The interface language: money, words, weekday names. */
  readonly locale: Locale
  readonly strings: Strings
  readonly chain: readonly Locale[]
  readonly now: Date
  readonly menuStatus: ScheduleStatus
  readonly palette: Palette
  readonly interactive: boolean
  readonly orderingActive: boolean
}

function has(record: object, key: string): boolean {
  return Object.hasOwn(record, key)
}

/**
 * R5: sold out by the overlay (the overlay can only ever say sold out).
 *
 * The overlay's `version` is deliberately NOT compared with the snapshot's: a mismatched overlay
 * still applies; it can only add caution. Sold-out marks belong to the service day, not to a menu
 * version, so ignoring an overlay that was made for another version would briefly show sold-out
 * items as available, the less cautious error. A mark for an item this snapshot does not have is
 * never looked at (only the snapshot's own items are asked), and an overlay never adds an item or
 * makes one more available. The guest loader fetches the matching overlay again meanwhile
 * (apps/web/src/guest/load.ts).
 */
function overlaySoldOut(overlay: LiveOverlay | null, id: string): boolean {
  return (
    overlay !== null && has(overlay.items, id) && overlay.items[id as NodeId]?.sold_out === true
  )
}

/** When two schedules both keep an item closed, it opens when the later one does. */
function laterOpening(a: NextOpening | null, b: NextOpening | null): NextOpening | null {
  if (a === null) return b
  if (b === null) return a
  return a.order >= b.order ? a : b
}

/** R1: when the item opens if its own schedule or the menu's keeps it closed now, else null. */
function closedUntil(env: Env, item: MenuSnapshot['items'][string]): NextOpening | null {
  const own = scheduleStatus(item.availability.schedule, env.now)
  return laterOpening(own.open ? null : own.next, env.menuStatus.open ? null : env.menuStatus.next)
}

/**
 * R5 (with R1): the item's state, and when it can be had if it is scheduled. Precedence, most
 * cautious first: unavailable, sold out (snapshot or overlay), scheduled, available. An overlay
 * can only move an item down this list, never up.
 */
function itemState(env: Env, id: string, item: MenuSnapshot['items'][string]): ViewState {
  const { strings } = env
  const snapshotState: string = item.availability.state
  if (snapshotState !== 'available' && snapshotState !== 'sold_out') {
    return {
      code: 'unavailable',
      label: { text: strings.unavailable, lang: strings.lang },
      schedule: null,
    }
  }
  if (snapshotState === 'sold_out' || overlaySoldOut(env.overlay, id)) {
    return {
      code: 'sold_out',
      label: { text: strings.soldOut, lang: strings.lang },
      schedule: null,
    }
  }
  const closed = closedUntil(env, item)
  if (closed !== null) {
    const schedule = describeOpening(closed, strings)
    return { code: 'scheduled', label: schedule.text, schedule }
  }
  return { code: 'available', label: null, schedule: null }
}

/** R1/R5: does this state appear on this channel and setting? */
function shown(env: Env, code: ItemState): boolean {
  if (code === 'sold_out') return env.context.soldOutDisplay === 'show'
  return true
}

function viewOption(env: Env, id: string): ViewOption | null {
  const { snapshot } = env
  if (!has(snapshot.options, id)) return null
  const option = snapshot.options[id]
  const name = pickText(option?.name, env.chain)
  if (option === undefined || name === null) return null
  return {
    id: id as NodeId,
    name,
    delta: viewDelta(option.price_delta, snapshot.currency, env.locale),
  }
}

function viewGroup(env: Env, id: string): ViewModifierGroup | null {
  const { snapshot } = env
  if (!has(snapshot.modifier_groups, id)) return null
  const group = snapshot.modifier_groups[id]
  const name = pickText(group?.name, env.chain)
  if (group === undefined || name === null) return null
  const options = group.options
    .map((optionId) => viewOption(env, optionId))
    .filter((option): option is ViewOption => option !== null)
  if (options.length === 0) return null
  return {
    id: id as NodeId,
    name,
    min: group.min,
    max: group.max,
    required: group.min > 0,
    options,
  }
}

function viewAllergen(env: Env, code: Allergen): ViewAllergen {
  return {
    code,
    number: ALLERGENS.indexOf(code) + 1,
    label: { text: env.strings.allergens[code], lang: env.strings.lang },
  }
}

function viewDietary(env: Env, code: DietaryLabel): ViewDietary {
  return { code, label: { text: env.strings.dietary[code], lang: env.strings.lang } }
}

function viewTag(env: Env, id: string): ViewTag | null {
  if (!has(env.snapshot.tags, id)) return null
  const label = pickText(env.snapshot.tags[id as TagId]?.label, env.chain)
  return label === null ? null : { id: id as TagId, label }
}

function viewPortion(
  env: Env,
  portion: MenuSnapshot['items'][string]['portion'],
): ViewPortion | null {
  if (portion === null) return null
  const text = formatField('measurement', portion, fieldContext(env, null))
  return text === null ? null : { value: portion.value, unit: portion.unit, text: text.text }
}

function fieldContext(env: Env, unit: string | null) {
  return {
    locale: env.locale,
    chain: env.chain,
    timeZone: env.context.timeZone,
    currency: env.snapshot.currency,
    unit,
    strings: env.strings,
  }
}

/** R12: public custom fields in template order (the order of `field_types`), formatted per type. */
function extraFields(env: Env, item: MenuSnapshot['items'][string]): ViewExtraField[] {
  const out: ViewExtraField[] = []
  for (const [key, definition] of Object.entries(env.snapshot.field_types)) {
    if (!has(item.fields, key)) continue
    const label = pickText(definition.label, env.chain)
    if (label === null) continue
    const type: SnapshotFieldType = definition.type
    const formatted = formatField(type, item.fields[key], fieldContext(env, definition.unit))
    if (formatted === null) continue
    out.push({ key, type, label, text: formatted.text, lang: formatted.lang })
  }
  return out
}

function badges(env: Env, item: MenuSnapshot['items'][string]): ViewBadge[] {
  const out: ViewBadge[] = []
  for (const badge of item.badges) {
    if (badge === NEW_BADGE) {
      out.push({ kind: 'new', label: { text: env.strings.newBadge, lang: env.strings.lang } })
    } else if (badge.startsWith('tg_')) {
      // Shown in the tags slot already; a face never draws one twice.
      if (item.tags.includes(badge as TagId)) continue
      const tag = viewTag(env, badge)
      if (tag !== null) out.push({ kind: 'tag', id: tag.id, label: tag.label })
    } else if (DIETARY_LABELS.includes(badge as DietaryLabel)) {
      if (item.dietary.includes(badge as DietaryLabel)) continue
      const dietary = viewDietary(env, badge as DietaryLabel)
      out.push({ kind: 'dietary', code: dietary.code, label: dietary.label })
    }
  }
  return out
}

function viewItem(env: Env, id: string): ViewItem | null {
  const { snapshot, context } = env
  if (!has(snapshot.items, id)) return null
  const item = snapshot.items[id]
  const name = item === undefined ? null : pickText(item.name, env.chain)
  if (item === undefined || name === null) return null

  // R1 first: outside its schedule an item is left out on print and tv whatever its state.
  if (!env.interactive && closedUntil(env, item) !== null) return null
  const state = itemState(env, id, item)
  if (!shown(env, state.code)) return null

  const description = pickText(item.description, env.chain)
  const image = viewImage(item.image, snapshot.assets, context.images.item, env.chain, name)
  const available = state.code === 'available'
  return {
    id: id as NodeId,
    name,
    price: viewPrice(item.price, item.price_from, snapshot.currency, env.locale, env.strings),
    state,
    allergens: item.allergens.map((code) => viewAllergen(env, code)),
    description: description === null ? null : { ...description, truncatable: env.interactive },
    image,
    noImage: image === null,
    badges: badges(env, item),
    portion: viewPortion(env, item.portion),
    dietary: item.dietary.map((code) => viewDietary(env, code)),
    tags: item.tags.map((tag) => viewTag(env, tag)).filter((tag): tag is ViewTag => tag !== null),
    extraFields: extraFields(env, item),
    modifierGroups: item.modifier_groups
      .map((groupId) => viewGroup(env, groupId))
      .filter((group): group is ViewModifierGroup => group !== null),
    order: {
      // R11: orderable item, ordering on for the venue, a channel that orders, a table token.
      controls:
        available && env.orderingActive && item.orderable && item.order_mode === 'orderable',
      askWaiter:
        available && env.interactive && item.order_mode === 'ask_waiter'
          ? { text: env.strings.askWaiter, lang: env.strings.lang }
          : null,
    },
  }
}

function viewSections(env: Env, ids: readonly string[], seen: Set<string>): ViewSection[] {
  const { snapshot, context } = env
  const out: ViewSection[] = []
  for (const id of ids) {
    if (!has(snapshot.sections, id) || seen.has(id)) continue
    seen.add(id)
    const section = snapshot.sections[id]
    const title = section === undefined ? null : pickText(section.title, env.chain)
    if (section === undefined || title === null) continue

    const sections = viewSections(env, section.sections, seen)
    const items: ViewItem[] = []
    for (const itemId of section.items) {
      const item = viewItem(env, itemId)
      if (item !== null) items.push(item)
    }
    // Nothing left to show (everything hidden for this channel or setting): the section goes too.
    if (sections.length === 0 && items.length === 0) continue

    const color = section.hints.color
    out.push({
      id: id as NodeId,
      title,
      description: pickText(section.description, env.chain),
      image: viewImage(section.image, snapshot.assets, context.images.section, env.chain, title),
      hints: {
        color,
        onColor: color === null ? null : textOn(color, env.palette),
        icon: section.hints.icon,
      },
      sections,
      items,
    })
  }
  return out
}

/**
 * R13: the palette steps, the semantic colours and the rest of the theme tokens. The colours are
 * the snapshot's published roles, each text-on-colour pair checked again (a failing one is
 * replaced by a colour that reads); a snapshot without roles gets the colours derived from its
 * palette, as before. `scheme` is the venue's light/dark policy, `auto` when it set none.
 */
function viewTheme(env: Env, menuTitle: ViewText | null): ViewTheme {
  const { snapshot } = env
  const { palette } = env
  const steps = Object.fromEntries(PALETTE_STEPS.map((step) => [String(step), palette[step]]))
  const { colors, colorsDark } = themeColours(snapshot.theme.roles, palette)
  return {
    palette: steps as ViewTheme['palette'],
    colors,
    colorsDark,
    scheme: snapshot.theme.scheme ?? 'auto',
    font: snapshot.theme.font,
    radius: snapshot.theme.radius,
    shadow: snapshot.theme.shadow,
    logo: viewImage(
      snapshot.theme.logo,
      snapshot.assets,
      env.context.images.logo,
      env.chain,
      menuTitle,
    ),
  }
}

/** Walks the view in reading order and collects what is really on the menu. */
function collect(sections: readonly ViewSection[]): {
  allergens: Set<Allergen>
  tags: ViewTag[]
  dietary: Set<DietaryLabel>
} {
  const allergens = new Set<Allergen>()
  const dietary = new Set<DietaryLabel>()
  const tags = new Map<TagId, ViewTag>()
  const visit = (list: readonly ViewSection[]) => {
    for (const section of list) {
      for (const item of section.items) {
        for (const allergen of item.allergens) allergens.add(allergen.code)
        for (const label of item.dietary) dietary.add(label.code)
        for (const tag of item.tags) if (!tags.has(tag.id)) tags.set(tag.id, tag)
      }
      visit(section.sections)
    }
  }
  visit(sections)
  return { allergens, tags: [...tags.values()], dietary }
}

/**
 * Applies R1–R15 to a snapshot, the live overlay (or null) and the context. Throws only when the
 * context is malformed; the snapshot is trusted as validated by the loader, and anything in it
 * that does not resolve (an unknown id, a text in no language) is left out rather than guessed.
 */
export function buildViewModel(
  snapshot: MenuSnapshot,
  overlay: LiveOverlay | null,
  contextInput: ShellContextInput,
): ViewModel {
  const context = parseContext(contextInput)
  const { locales } = snapshot
  const locale = locales.available.includes(context.locale) ? context.locale : locales.default
  const now = new Date(context.now)
  const env: Env = {
    snapshot,
    // Used whatever its `version` (see `overlaySoldOut`): a mismatched overlay can only add caution.
    overlay,
    context,
    locale,
    strings: stringsFor(locale),
    chain: fallbackChain(context.locale, locales.default, locales.available),
    now,
    menuStatus: scheduleStatus(snapshot.menu.availability, now),
    palette: resolvePalette(snapshot.theme.palette),
    interactive: INTERACTIVE_CHANNELS.includes(context.channel),
    orderingActive:
      context.orderingEnabled &&
      INTERACTIVE_CHANNELS.includes(context.channel) &&
      context.tableToken !== null,
  }

  const sections = viewSections(env, snapshot.menu.sections, new Set())
  const onMenu = collect(sections)
  const title = pickText(snapshot.menu.title, env.chain)
  const menuSchedule: ViewSchedule | null = env.menuStatus.open
    ? null
    : describeOpening(env.menuStatus.next, env.strings)
  const filters = {
    tags: onMenu.tags,
    dietary: DIETARY_LABELS.filter((code) => onMenu.dietary.has(code)).map((code) =>
      viewDietary(env, code),
    ),
  }

  return {
    locale,
    currency: snapshot.currency,
    channel: context.channel,
    menu: {
      id: snapshot.menu.id as NodeId,
      title,
      intro: pickText(snapshot.menu.intro, env.chain),
      schedule: menuSchedule,
    },
    sections,
    allergenLegend: ALLERGENS.filter((code) => onMenu.allergens.has(code)).map((code) =>
      viewAllergen(env, code),
    ),
    filters,
    ordering: { enabled: env.orderingActive },
    features: viewFeatures({
      features: snapshot.features,
      capabilities: context.capabilities,
      interactive: env.interactive,
      tableToken: context.tableToken,
      chips: filters.tags.length + filters.dietary.length,
      orderingEnabled: env.orderingActive,
    }),
    theme: viewTheme(env, title),
  }
}
