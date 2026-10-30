// The snapshot's look and services (brief SH-01 §10–11): `theme.roles` / `theme.scheme`,
// `features` and `design` (D129) in `menu-snapshot/1`. The builder writes them, the schema keeps
// them optional (a snapshot published before them still parses), the diff counts them, and the
// leak guard never mistakes their fixed words for leaks. `presentation` is no longer written; it
// stays in the schema so that a snapshot published with it still parses.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { BASIC_DESIGN_VALUES } from '../design/record'
import { resolve } from '../resolve'
import { CONTEXT, DocBuilder, nd, ROOT, testId, VENUE_ID } from '../resolve/fixtures'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import { DEFAULT_PALETTE, deriveRoles, paletteRoles } from '../theme/derive'
import { DEFAULT_GUEST_FEATURES, type GuestFeatures } from '../theme/presentation'
import { validateRoles } from '../theme/roles'
import { buildSnapshot, DEFAULT_THEME, type SnapshotContext, snapshotContentHash } from './build'
import { diffSnapshots } from './diff'
import { parseSnapshot, SnapshotError } from './errors'
import { assertSnapshotSafe, collectForbiddenValues, lookPublicStrings } from './leak-guard'
import { MenuSnapshotSchema, menuSnapshotJsonSchema } from './schema'

// biome-ignore lint/suspicious/noExplicitAny: the tests reach into JSON they are about to change
type Poke = Record<string, any>

const BAR = nd('bar')
const WATER = nd('water')
const SODA = nd('soda')

function context(overrides: Partial<SnapshotContext> = {}): SnapshotContext {
  return {
    template: VENUE_MENU_TEMPLATE,
    snapshotId: testId('sn', 'look'),
    version: 1,
    publishedAt: '2026-10-11T21:00:00+03:00',
    menuId: ROOT,
    venueId: VENUE_ID,
    edition: ['master', `venue:${VENUE_ID}`],
    locales: { default: 'bg_BG', available: ['bg_BG', 'en_US'] },
    currency: 'EUR',
    assets: {},
    tagVocabulary: {},
    ...overrides,
  }
}

/** One section, two till items; `note` sets an internal note on each. */
function bar(notes: readonly string[] = []): DocBuilder {
  const builder = new DocBuilder()
    .section(BAR, ROOT, 'active', 'a0')
    .tillItem(WATER, 300)
    .tillItem(SODA, 400)
    .place(WATER, BAR, 'a0')
    .place(SODA, BAR, 'a1')
  notes.forEach((note, index) => {
    builder.set(index === 0 ? WATER : SODA, 'internal_note', 'manual', note)
  })
  return builder
}

const snapshotOf = (ctx = context(), builder = bar()) =>
  buildSnapshot(resolve(VENUE_MENU_TEMPLATE, builder.build(), CONTEXT), ctx)

const PRESENTATION = { face: 'editorial-market', options: { layout: 'two', compact: true } }
const DESIGN = BASIC_DESIGN_VALUES
const FEATURES: GuestFeatures = {
  filters: false,
  call_waiter: { enabled: true, kinds: ['terminal', 'bill', 'waiter'] },
  bill: true,
  ordering: false,
  pay: false,
}

/** A snapshot published before SH-01 (S3-10's demo menu): no roles, scheme, presentation, features. */
function oldSnapshot(): Poke {
  return JSON.parse(
    readFileSync(
      new URL('../../../../docs/guides/shell-handoff/barsy-demo-snapshot.json', import.meta.url),
      'utf8',
    ),
  ) as Poke
}

describe('the default theme', () => {
  it('carries the v1 roles of the default palette, readable, and the auto scheme', () => {
    expect(DEFAULT_THEME.roles).toEqual(paletteRoles(DEFAULT_PALETTE))
    expect(DEFAULT_THEME.roles && validateRoles(DEFAULT_THEME.roles)).toEqual([])
    expect(DEFAULT_THEME.scheme).toBe('auto')
    expect(Object.isFrozen(DEFAULT_THEME.roles?.light)).toBe(true)
  })
})

describe('buildSnapshot: look and services', () => {
  it('always writes the features (the defaults when unset), never a presentation', () => {
    const snapshot = snapshotOf()
    expect(snapshot.features).toEqual(DEFAULT_GUEST_FEATURES)
    expect(snapshot).not.toHaveProperty('presentation')
    expect(snapshot.theme).toEqual(DEFAULT_THEME)
    expect(snapshotOf(context({ design: null, features: null }))).toEqual(snapshot)
    expect(snapshotOf(context({ design: DESIGN }))).not.toHaveProperty('presentation')
  })

  it('writes the design and the services the venue chose, request kinds in vocabulary order', () => {
    const snapshot = snapshotOf(context({ design: DESIGN, features: FEATURES }))
    expect(snapshot.design).toEqual(DESIGN)
    expect(snapshot.features).toEqual({
      ...FEATURES,
      call_waiter: { enabled: true, kinds: ['waiter', 'bill', 'terminal'] },
    })
    // The same choices in another order are the same snapshot.
    const reordered = snapshotOf(
      context({
        design: DESIGN,
        features: {
          ...FEATURES,
          call_waiter: { enabled: true, kinds: ['bill', 'waiter', 'terminal'] },
        },
      }),
    )
    expect(reordered.snapshot.hash).toBe(snapshot.snapshot.hash)
  })

  it('passes the roles and the scheme through, and leaves them out for a theme without them', () => {
    const roles = deriveRoles({ primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: '#e0a43a' })
    const withRoles = snapshotOf(context({ theme: { ...DEFAULT_THEME, roles, scheme: 'dark' } }))
    expect(withRoles.theme.roles).toEqual(roles)
    expect(withRoles.theme.scheme).toBe('dark')
    const { roles: _r, scheme: _s, ...bare } = DEFAULT_THEME
    const without = snapshotOf(context({ theme: bare }))
    expect(without.theme).not.toHaveProperty('roles')
    expect(without.theme).not.toHaveProperty('scheme')
  })

  it('changes the hash when the look or the services change', () => {
    const plain = snapshotOf().snapshot.hash
    expect(snapshotOf(context({ design: DESIGN })).snapshot.hash).not.toBe(plain)
    expect(snapshotOf(context({ features: FEATURES })).snapshot.hash).not.toBe(plain)
    expect(
      snapshotOf(context({ theme: { ...DEFAULT_THEME, scheme: 'light' } })).snapshot.hash,
    ).not.toBe(plain)
  })
})

describe('menu-snapshot/1 stays readable (parser first)', () => {
  it('parses a snapshot published before the new fields, which keeps its hash', () => {
    const old = oldSnapshot()
    expect(old.theme).not.toHaveProperty('roles')
    expect(old).not.toHaveProperty('features')
    const parsed = MenuSnapshotSchema.safeParse(old)
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true)
    expect(() => parseSnapshot(old)).not.toThrow()
    // The content hash of a stored snapshot is unchanged: only new snapshots carry new fields.
    expect(snapshotContentHash(old as never)).toBe(old.snapshot.hash)
  })

  it('stays strict: an unknown key, an upper-case role or an unknown scheme fails', () => {
    const fails = (change: (snapshot: Poke) => void) => {
      const snapshot = snapshotOf(context({ design: DESIGN, features: FEATURES })) as Poke
      snapshot.presentation = structuredClone(PRESENTATION)
      change(snapshot)
      expect(MenuSnapshotSchema.safeParse(snapshot).success).toBe(false)
    }
    fails((s) => Object.assign(s, { layout: 'two' }))
    fails((s) => Object.assign(s.theme, { colors: {} }))
    fails((s) => Object.assign(s.theme.roles.light, { text: '#ABCDEF' }))
    fails((s) => Object.assign(s.theme.roles.dark, { link: '#000000' }))
    fails((s) => Object.assign(s.theme, { scheme: 'sepia' }))
    fails((s) => Object.assign(s.presentation, { theme: 'x' }))
    fails((s) => Object.assign(s.presentation.options, { snake_key: true }))
    fails((s) => Object.assign(s.features, { tips: true }))
    fails((s) => Object.assign(s.features.call_waiter, { kinds: ['taxi'] }))
    fails((s) => Object.assign(s.design.items, { layout: 'grid' }))
    fails((s) => Object.assign(s.design.items, { sparkle: 'on' }))
    fails((s) => Object.assign(s.design, { footer: {} }))
    fails((s) => delete s.design.items.layout)
  })

  it('still parses a snapshot published with a presentation (the field stays, optional)', () => {
    const snapshot = snapshotOf() as Poke
    snapshot.presentation = structuredClone(PRESENTATION)
    expect(MenuSnapshotSchema.safeParse(snapshot).success).toBe(true)
  })

  it('exports the new fields in the JSON Schema for faces', () => {
    const schema = menuSnapshotJsonSchema() as Poke
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['presentation', 'features', 'design']),
    )
    expect(schema.required).not.toContain('presentation')
    expect(schema.required).not.toContain('design')
    expect(schema.required).not.toContain('features')
    expect(Object.keys(schema.properties.theme.properties)).toEqual(
      expect.arrayContaining(['roles', 'scheme']),
    )
  })
})

describe('diffSnapshots: the look and the menu areas', () => {
  const live = () => snapshotOf(context({ design: DESIGN, features: FEATURES }))

  it('counts a change of the design as the look, and the layout with it', () => {
    const next = snapshotOf(
      context({
        design: { ...DESIGN, items: { ...DESIGN.items, layout: 'one' } },
        features: FEATURES,
      }),
    )
    expect(diffSnapshots(live(), next).areas).toEqual(['look'])
  })

  it('counts a guest service change as the menu', () => {
    const next = snapshotOf(context({ design: DESIGN, features: { ...FEATURES, pay: true } }))
    expect(diffSnapshots(live(), next).areas).toEqual(['menu'])
  })

  it('counts dropping a published template as the look', () => {
    const before = live() as Poke
    before.presentation = structuredClone(PRESENTATION)
    expect(diffSnapshots(before as never, live()).areas).toEqual(['look'])
  })

  it('finds both against a snapshot published before them', () => {
    const before = snapshotOf() as Poke
    delete before.features
    delete before.theme.roles
    delete before.theme.scheme
    before.snapshot.hash = '0'.repeat(64)
    expect(diffSnapshots(before as never, snapshotOf()).areas).toEqual(['look', 'menu'])
  })
})

describe('the leak guard and the new words', () => {
  it('never takes a feature word for an internal note: "bill" in a note and in the services', () => {
    const doc = bar(['bill', 'two']).build()
    const forbidden = collectForbiddenValues({
      template: VENUE_MENU_TEMPLATE,
      doc,
      externalIds: [],
      publicStrings: lookPublicStrings(DEFAULT_THEME),
    })
    expect(forbidden.has('bill')).toBe(false)
    expect(forbidden.has('two')).toBe(false)
    const snapshot = buildSnapshot(resolve(VENUE_MENU_TEMPLATE, doc, CONTEXT), {
      ...context({ design: DESIGN, features: FEATURES }),
    })
    expect(() => assertSnapshotSafe(snapshot, forbidden)).not.toThrow()
  })

  it('still refuses an internal note that is not a public word', () => {
    const doc = bar(['zebra']).build()
    const forbidden = collectForbiddenValues({
      template: VENUE_MENU_TEMPLATE,
      doc,
      externalIds: [],
      publicStrings: lookPublicStrings(DEFAULT_THEME),
    })
    expect(forbidden.get('zebra')).toBe('internal_value')
    const snapshot = snapshotOf(context({ design: DESIGN }), bar()) as Poke
    snapshot.sections[BAR].title = { bg_BG: 'zebra' }
    expect(() => assertSnapshotSafe(snapshot, forbidden)).toThrow(SnapshotError)
  })

  it('no longer takes the retired presentation\'s words for vocabulary', () => {
    const doc = bar(['face', 'presentation']).build()
    const forbidden = collectForbiddenValues({
      template: VENUE_MENU_TEMPLATE,
      doc,
      externalIds: [],
    })
    expect(forbidden.get('face')).toBe('internal_value')
    expect(forbidden.get('presentation')).toBe('internal_value')
  })

  it('treats every fixed word of the new fields as vocabulary, keys included', () => {
    const words = [
      'roles',
      'scheme',
      'design',
      'features',
      'light',
      'dark',
      'auto',
      'background',
      'surface',
      'accent',
      'on_accent',
      'text',
      'muted',
      'accent_text',
      'border',
      'filters',
      'call_waiter',
      'enabled',
      'kinds',
      'bill',
      'ordering',
      'pay',
      'waiter',
      'bill',
      'ice',
      'water',
      'glasses',
      'clean_table',
      'terminal',
    ]
    const doc = new DocBuilder().section(BAR, ROOT, 'active', 'a0').tillItem(WATER, 300)
    // A word that is no part of the snapshot's structure stays forbidden (the control).
    doc.set(WATER, 'internal_note', 'manual', 'zebra')
    for (const [index, word] of words.entries()) {
      const item = nd(`note${index}`)
      doc.item(item).place(item, BAR, `a${index}`)
      doc.set(item, 'internal_note', 'manual', word)
    }
    const forbidden = collectForbiddenValues({
      template: VENUE_MENU_TEMPLATE,
      doc: doc.build(),
      externalIds: [],
    })
    for (const word of words) expect(forbidden.has(word), word).toBe(false)
    expect(forbidden.get('zebra')).toBe('internal_value')
  })

  it('lists the look strings: font, palette and role colours', () => {
    const roles = deriveRoles({ primary: '#ffffff', secondary: '#eeeeee', tertiary: '#123456' })
    const strings = lookPublicStrings({ ...DEFAULT_THEME, roles })
    expect(strings).toEqual(
      expect.arrayContaining([
        'Inter',
        ...DEFAULT_THEME.palette,
        ...Object.values(roles.light),
        ...Object.values(roles.dark),
      ]),
    )
  })
})
