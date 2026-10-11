// Deriving the eight roles (brief SH-01 §4). Property tests pin the three invariants: derived roles
// always read, overrides are kept verbatim, and the derivation is pure and deterministic.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { hexToOklab, hexToOklch } from './colour'
import { contrastRatio } from './contrast'
import {
  DEFAULT_PALETTE,
  deriveRoles,
  generatePalette,
  PALETTE_STEPS,
  paletteRoles,
  rolesFromSemantic,
  semanticColours,
  semanticColoursDark,
  withOverrides,
} from './derive'
import {
  REQUIRED_PAIRS,
  ROLE_MODES,
  ROLE_NAMES,
  type RoleName,
  type RoleOverrides,
  type ThemeColours,
  ThemeRolesSchema,
  validateRoles,
} from './roles'

const hexColour = fc
  .integer({ min: 0, max: 0xffffff })
  .map((n) => `#${n.toString(16).padStart(6, '0')}`)

const colours: fc.Arbitrary<ThemeColours> = fc.record({
  primary: hexColour,
  secondary: hexColour,
  tertiary: hexColour,
})

/** Some roles of one scheme, each a random colour. */
const someRoles = (roles: readonly RoleName[]) =>
  fc.dictionary(fc.constantFrom(...roles), hexColour, { maxKeys: roles.length })

const overridesOf = (roles: readonly RoleName[]): fc.Arbitrary<RoleOverrides> =>
  fc.record({ light: someRoles(roles), dark: someRoles(roles) }, { requiredKeys: [] })

/** The roles that sit on others (text roles), plus the accent fill. */
const FOREGROUND_ROLES: readonly RoleName[] = [
  'accent',
  'on_accent',
  'text',
  'muted',
  'accent_text',
  'border',
]

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Colours a guest could meet: hand-picked hard cases beside the random ones. */
const HARD_CASES: ThemeColours[] = [
  // A black page with white panels: only a grey between them reads on both.
  { primary: '#000000', secondary: '#ffffff', tertiary: '#ff0000' },
  { primary: '#ffffff', secondary: '#000000', tertiary: '#ffffff' },
  // Page and panels just either side of mid-grey: no colour reads on both as chosen.
  { primary: '#717171', secondary: '#7a7a7a', tertiary: '#777777' },
  { primary: '#7a7a7a', secondary: '#717171', tertiary: '#00ff00' },
  // A dark page in the light scheme, and everything the same colour.
  { primary: '#101828', secondary: '#1f2937', tertiary: '#facc15' },
  { primary: '#3366cc', secondary: '#3366cc', tertiary: '#3366cc' },
  // A pale highlight on a pale page (lime on linen, the Botanical case).
  { primary: '#f4efe6', secondary: '#e8dfcf', tertiary: '#d9f26b' },
  { primary: '#ffff00', secondary: '#00ffff', tertiary: '#ff00ff' },
]

describe('deriveRoles: derived roles always read', () => {
  it('passes every required pair in both schemes for the hard cases', () => {
    for (const input of HARD_CASES) {
      expect(validateRoles(deriveRoles(input)), JSON.stringify(input)).toEqual([])
    }
  })

  it('passes every required pair in both schemes for any three colours', () => {
    fc.assert(
      fc.property(colours, (input) => {
        expect(validateRoles(deriveRoles(input))).toEqual([])
      }),
      { numRuns: 400 },
    )
  })

  it('also when the page is overridden (the panels move to share an ink with it)', () => {
    fc.assert(
      fc.property(colours, hexColour, hexColour, (input, light, dark) => {
        const set = deriveRoles(input, { light: { background: light }, dark: { background: dark } })
        expect(validateRoles(set)).toEqual([])
      }),
      { numRuns: 200 },
    )
  })

  it('every colour is a lower-case #rrggbb the snapshot accepts', () => {
    fc.assert(
      fc.property(colours, (input) => {
        const set = deriveRoles({
          primary: input.primary.toUpperCase(),
          secondary: input.secondary,
          tertiary: input.tertiary.toUpperCase(),
        })
        expect(ThemeRolesSchema.safeParse(set.light).success).toBe(true)
        expect(ThemeRolesSchema.safeParse(set.dark).success).toBe(true)
      }),
      { numRuns: 100 },
    )
  })
})

describe('deriveRoles: overrides are kept verbatim', () => {
  it('returns every override unchanged, whatever it is', () => {
    fc.assert(
      fc.property(colours, overridesOf(ROLE_NAMES), (input, overrides) => {
        const set = deriveRoles(input, overrides)
        for (const mode of ROLE_MODES) {
          for (const [role, value] of Object.entries(overrides[mode] ?? {})) {
            expect(set[mode][role as RoleName]).toBe(value)
          }
        }
      }),
      { numRuns: 300 },
    )
  })

  it('lets validateRoles name the overrides that fail: derived roles around them still read', () => {
    fc.assert(
      fc.property(colours, overridesOf(FOREGROUND_ROLES), (input, overrides) => {
        for (const issue of validateRoles(deriveRoles(input, overrides))) {
          const own = overrides[issue.mode] ?? {}
          // Only an overridden role can be the failing side of a pair.
          expect(own[issue.fg] !== undefined || own[issue.bg] !== undefined).toBe(true)
          if (issue.fg !== 'on_accent') expect(own[issue.fg]).toBeDefined()
        }
      }),
      { numRuns: 300 },
    )
  })

  it('reports an unreadable override', () => {
    const set = deriveRoles(
      { primary: '#ffffff', secondary: '#f4f4f5', tertiary: '#2563eb' },
      { light: { text: '#eeeeee' } },
    )
    expect(set.light.text).toBe('#eeeeee')
    expect(validateRoles(set).map(({ mode, fg, bg }) => `${mode} ${fg}/${bg}`)).toEqual([
      'light text/background',
      'light text/surface',
    ])
  })
})

describe('deriveRoles: pure and deterministic', () => {
  it('gives the same roles for the same input and never throws on valid colours', () => {
    fc.assert(
      fc.property(colours, overridesOf(ROLE_NAMES), (input, overrides) => {
        expect(deriveRoles(input, overrides)).toEqual(deriveRoles(input, overrides))
      }),
      { numRuns: 100 },
    )
  })

  it('throws a RangeError for a colour that is not #rrggbb', () => {
    expect(() =>
      deriveRoles({ primary: 'red', secondary: '#ffffff', tertiary: '#000000' }),
    ).toThrow(RangeError)
  })
})

describe('deriveRoles: the light scheme keeps the colours as chosen', () => {
  it('uses the primary as the page, the secondary as the panels, the tertiary as the accent', () => {
    const set = deriveRoles({ primary: '#F4EFE6', secondary: '#e8dfcf', tertiary: '#d9f26b' })
    expect(set.light.background).toBe('#f4efe6')
    expect(set.light.surface).toBe('#e8dfcf')
    expect(set.light.accent).toBe('#d9f26b')
  })

  it('keeps the panels as chosen whenever black or white reads on both page and panels', () => {
    fc.assert(
      fc.property(colours, (input) => {
        const bothDark = [input.primary, input.secondary].every(
          (colour) => contrastRatio('#000000', colour) >= 4.5,
        )
        const bothLight = [input.primary, input.secondary].every(
          (colour) => contrastRatio('#ffffff', colour) >= 4.5,
        )
        fc.pre(bothDark || bothLight)
        expect(deriveRoles(input).light.surface).toBe(input.secondary)
      }),
      { numRuns: 200 },
    )
  })

  it('moves only the panels lightness when page and panels straddle mid-grey', () => {
    const input = { primary: '#7a7a7a', secondary: '#717171', tertiary: '#2563eb' }
    const set = deriveRoles(input)
    expect(set.light.background).toBe('#7a7a7a')
    expect(set.light.surface).not.toBe('#717171')
    // A grey stays a grey; it moved to the page's side (black reads on both now).
    expect(hexToOklch(set.light.surface).c).toBeLessThan(0.001)
    expect(contrastRatio('#000000', set.light.surface)).toBeGreaterThanOrEqual(4.5)
  })

  it('makes a deep ink in the page hue, darker than the page', () => {
    const set = deriveRoles({ primary: '#eef4ff', secondary: '#dfe9fb', tertiary: '#2563eb' })
    const ink = hexToOklch(set.light.text)
    expect(ink.l).toBeLessThanOrEqual(0.3)
    expect(hueDistance(ink.h, hexToOklch('#eef4ff').h)).toBeLessThan(15)
    expect(ink.c).toBeLessThanOrEqual(0.05)
  })

  it('makes muted text softer than the ink, still readable', () => {
    fc.assert(
      fc.property(colours, (input) => {
        const { light } = deriveRoles(input)
        expect(contrastRatio(light.muted, light.background)).toBeLessThanOrEqual(
          contrastRatio(light.text, light.background) + 0.05,
        )
      }),
      { numRuns: 200 },
    )
  })

  it('gives the accent as text the tertiary hue when the tertiary reads as it is', () => {
    const set = deriveRoles({ primary: '#ffffff', secondary: '#f8fafc', tertiary: '#1d4ed8' })
    expect(set.light.accent_text).toBe('#1d4ed8')
    const lime = deriveRoles({ primary: '#f4efe6', secondary: '#e8dfcf', tertiary: '#d9f26b' })
    expect(hueDistance(hexToOklch(lime.light.accent_text).h, hexToOklch('#d9f26b').h)).toBeLessThan(
      10,
    )
  })

  it('puts on the accent the first of page, ink, white and black that reads', () => {
    fc.assert(
      fc.property(colours, (input) => {
        const { light } = deriveRoles(input)
        const first = [light.background, light.text, '#ffffff', '#000000'].find(
          (candidate) => contrastRatio(candidate, light.accent) >= 4.5,
        )
        expect(light.on_accent).toBe(first)
      }),
      { numRuns: 200 },
    )
  })

  it('draws the border as a quiet blend of the ink into the page (about 15%)', () => {
    fc.assert(
      fc.property(colours, (input) => {
        const { light } = deriveRoles(input)
        const page = hexToOklab(light.background).l
        const ink = hexToOklab(light.text).l
        expect(hexToOklab(light.border).l).toBeCloseTo(page + (ink - page) * 0.15, 1)
      }),
      { numRuns: 200 },
    )
  })
})

describe('deriveRoles: the dark scheme keeps the hues (not an inversion)', () => {
  it('puts the page at OKLCH L 0.16–0.20 in the primary hue, the panels a step lighter', () => {
    fc.assert(
      fc.property(colours, (input) => {
        const { dark } = deriveRoles(input)
        const page = hexToOklch(dark.background)
        const panels = hexToOklch(dark.surface)
        expect(page.l).toBeGreaterThanOrEqual(0.16)
        expect(page.l).toBeLessThanOrEqual(0.2)
        expect(panels.l).toBeGreaterThan(page.l)
        expect(page.c).toBeLessThanOrEqual(Math.max(hexToOklch(input.primary).c, 0.005))
      }),
      { numRuns: 200 },
    )
  })

  it('keeps the primary hue in the page and the secondary hue in the panels', () => {
    const input = { primary: '#ff6b35', secondary: '#2563eb', tertiary: '#facc15' }
    const { dark } = deriveRoles(input)
    expect(hueDistance(hexToOklch(dark.background).h, hexToOklch(input.primary).h)).toBeLessThan(15)
    expect(hueDistance(hexToOklch(dark.surface).h, hexToOklch(input.secondary).h)).toBeLessThan(15)
  })

  it('lightens a highlight too dark to stand out (3:1) on the dark page, keeping its hue', () => {
    fc.assert(
      fc.property(colours, (input) => {
        const { dark } = deriveRoles(input)
        expect(contrastRatio(dark.accent, dark.background)).toBeGreaterThanOrEqual(3)
      }),
      { numRuns: 200 },
    )
    const navy = deriveRoles({ primary: '#ffffff', secondary: '#f1f5f9', tertiary: '#1e3a8a' })
    expect(navy.dark.accent).not.toBe('#1e3a8a')
    expect(hexToOklch(navy.dark.accent).l).toBeGreaterThan(hexToOklch('#1e3a8a').l)
    expect(hueDistance(hexToOklch(navy.dark.accent).h, hexToOklch('#1e3a8a').h)).toBeLessThan(10)
    // A highlight that already stands out stays as chosen.
    expect(deriveRoles({ ...HARD_CASES[6], tertiary: '#d9f26b' } as ThemeColours).dark.accent).toBe(
      '#d9f26b',
    )
  })

  it('writes light text on the dark page', () => {
    fc.assert(
      fc.property(colours, (input) => {
        const { dark } = deriveRoles(input)
        expect(hexToOklch(dark.text).l).toBeGreaterThan(hexToOklch(dark.background).l)
      }),
      { numRuns: 100 },
    )
  })
})

describe('the v1 path (moved from the shell, unchanged)', () => {
  it('maps the semantic colours to snake_case roles', () => {
    const palette = generatePalette('#3366cc')
    const set = paletteRoles(palette)
    expect(set.light).toEqual(rolesFromSemantic(semanticColours(palette)))
    expect(set.dark).toEqual(rolesFromSemantic(semanticColoursDark(palette)))
    expect(set.light.on_accent).toBe(semanticColours(palette).onAccent)
    expect(set.light.accent_text).toBe(semanticColours(palette).accentText)
  })

  it('reads in both schemes for any brand colour', () => {
    fc.assert(
      fc.property(hexColour, (brand) => {
        expect(validateRoles(paletteRoles(generatePalette(brand)))).toEqual([])
      }),
      { numRuns: 300 },
    )
  })

  it('keeps the default palette exactly as the snapshot has always published it', () => {
    expect(PALETTE_STEPS.map((step) => DEFAULT_PALETTE[step])).toEqual([
      '#f8f8f9',
      '#efeff1',
      '#dcdce0',
      '#bdbdc4',
      '#9a9aa3',
      '#7c7c86',
      '#63636c',
      '#505058',
      '#3f3f46',
      '#27272a',
      '#18181b',
    ])
  })

  it('lays overrides over a role set verbatim', () => {
    const set = paletteRoles(DEFAULT_PALETTE)
    const laid = withOverrides(set, { dark: { accent: '#ff0000' } })
    expect(laid.dark.accent).toBe('#ff0000')
    expect(laid.light).toBe(set.light)
    expect({ ...laid.dark, accent: set.dark.accent }).toEqual(set.dark)
  })

  it('every required pair is listed once', () => {
    expect(new Set(REQUIRED_PAIRS.map(({ fg, bg }) => `${fg}/${bg}`)).size).toBe(
      REQUIRED_PAIRS.length,
    )
  })
})
