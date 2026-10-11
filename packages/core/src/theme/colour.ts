// Colour conversions: `#rrggbb` ↔ red/green/blue ↔ HSL (the Platform's palette maths, S3-02) and
// sRGB ↔ linear RGB ↔ OKLab ↔ OKLCH (brief SH-01, for the venue's colour roles). Written in-house,
// no colour library (Martin, 10-10).
//
// OKLab is Björn Ottosson's perceptual colour space ("A perceptual color space for image
// processing", 2020, https://bottosson.github.io/posts/oklab/); the two matrices below are his
// published ones. OKLCH is OKLab in polar form: lightness L (0 black … 1 white), chroma C (0 grey,
// about 0.37 at most inside sRGB) and hue h in degrees. Moving L at a fixed C and h keeps a colour's
// hue as people see it, which HSL does not: that is why the role derivation works in OKLCH.

/** `#rrggbb`, either case. */
const HEX = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/

/** True for `#rrggbb` (either case). */
export function isHexColour(value: string): boolean {
  return HEX.test(value)
}

/** `#rrggbb` to red, green and blue (0–255). Throws a `RangeError` for anything else. */
export function hexToRgb(hex: string): [number, number, number] {
  const match = HEX.exec(hex)
  if (match === null) throw new RangeError(`not a #rrggbb colour: ${hex}`)
  return [
    Number.parseInt(match[1] ?? '00', 16),
    Number.parseInt(match[2] ?? '00', 16),
    Number.parseInt(match[3] ?? '00', 16),
  ]
}

/** Red, green and blue (0–255, rounded and clamped) to `#rrggbb`. */
export function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** `#rrggbb` to hue (0–360), saturation (0–1) and lightness (0–1). */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = hexToRgb(hex).map((value) => value / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const delta = max - min
  if (delta === 0) return { h: 0, s: 0, l }
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / delta) % 6
  else if (max === g) h = (b - r) / delta + 2
  else h = (r - g) / delta + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

/** Hue (0–360), saturation (0–1) and lightness (0–1) to `#rrggbb`. */
export function hslToHex(h: number, s: number, l: number): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const sector = (((h % 360) + 360) % 360) / 60
  const x = chroma * (1 - Math.abs((sector % 2) - 1))
  const [r1, g1, b1] =
    sector < 1
      ? [chroma, x, 0]
      : sector < 2
        ? [x, chroma, 0]
        : sector < 3
          ? [0, chroma, x]
          : sector < 4
            ? [0, x, chroma]
            : sector < 5
              ? [x, 0, chroma]
              : [chroma, 0, x]
  const m = l - chroma / 2
  return rgbToHex(((r1 ?? 0) + m) * 255, ((g1 ?? 0) + m) * 255, ((b1 ?? 0) + m) * 255)
}

// --- OKLab and OKLCH ----------------------------------------------------------------------------

/** Linear-light red, green and blue, 0–1 inside the sRGB gamut. */
export type LinearRgb = readonly [number, number, number]

/** A colour in OKLab: lightness `l` (0–1) and the two opponent axes `a` (green–red), `b` (blue–yellow). */
export interface Oklab {
  readonly l: number
  readonly a: number
  readonly b: number
}

/** A colour in OKLCH: lightness `l` (0–1), chroma `c` (0 = grey) and hue `h` in degrees (0–360). */
export interface Oklch {
  readonly l: number
  readonly c: number
  readonly h: number
}

/** One sRGB channel (0–1, gamma-encoded) to linear light (the sRGB transfer function). */
export function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

/** One linear-light channel (0–1) to gamma-encoded sRGB (0–1). */
export function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055
}

/** `#rrggbb` to linear-light red, green and blue. */
export function hexToLinearRgb(hex: string): LinearRgb {
  const [r, g, b] = hexToRgb(hex)
  return [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)]
}

/** Linear-light red, green and blue to `#rrggbb` (each channel clamped to 0–1, then rounded). */
export function linearRgbToHex([r, g, b]: LinearRgb): string {
  const encode = (value: number) => linearToSrgb(Math.min(1, Math.max(0, value))) * 255
  return rgbToHex(encode(r), encode(g), encode(b))
}

/** Linear sRGB to OKLab (Ottosson's M1, cube root, M2). */
export function linearRgbToOklab([r, g, b]: LinearRgb): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** OKLab to linear sRGB (Ottosson's inverse matrices). Out-of-gamut colours fall outside 0–1. */
export function oklabToLinearRgb({ l: lightness, a, b }: Oklab): LinearRgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** OKLab to OKLCH. A grey (chroma under 1e-9) gets hue 0. */
export function oklabToOklch({ l, a, b }: Oklab): Oklch {
  const c = Math.hypot(a, b)
  if (c < 1e-9) return { l, c: 0, h: 0 }
  const h = (Math.atan2(b, a) * 180) / Math.PI
  return { l, c, h: h < 0 ? h + 360 : h }
}

/** OKLCH to OKLab. */
export function oklchToOklab({ l, c, h }: Oklch): Oklab {
  const radians = (h * Math.PI) / 180
  return { l, a: c * Math.cos(radians), b: c * Math.sin(radians) }
}

/** `#rrggbb` to OKLab. */
export function hexToOklab(hex: string): Oklab {
  return linearRgbToOklab(hexToLinearRgb(hex))
}

/** `#rrggbb` to OKLCH. */
export function hexToOklch(hex: string): Oklch {
  return oklabToOklch(hexToOklab(hex))
}

/** OKLab to `#rrggbb`, each channel clamped into sRGB (use `oklchToHex` to keep the hue). */
export function oklabToHex(lab: Oklab): string {
  return linearRgbToHex(oklabToLinearRgb(lab))
}

/** How far outside 0–1 a linear channel may sit and still count as inside sRGB (float noise). */
const GAMUT_EPSILON = 1e-6

/** True when the OKLCH colour is inside the sRGB gamut. */
export function isInSrgbGamut(colour: Oklch): boolean {
  return oklabToLinearRgb(oklchToOklab(colour)).every(
    (channel) => channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON,
  )
}

/**
 * OKLCH to `#rrggbb`, gamut-safe: lightness is clamped to 0–1 and, when the colour does not fit in
 * sRGB, the chroma is reduced (bisection, hue and lightness kept) to the largest that fits. A grey
 * of any lightness always fits, so the search always ends inside the gamut.
 */
export function oklchToHex(colour: Oklch): string {
  const l = Math.min(1, Math.max(0, colour.l))
  const h = Number.isFinite(colour.h) ? colour.h : 0
  const c = Math.max(0, Number.isFinite(colour.c) ? colour.c : 0)
  if (isInSrgbGamut({ l, c, h })) return oklabToHex(oklchToOklab({ l, c, h }))
  let inside = 0
  let outside = c
  for (let step = 0; step < 32; step++) {
    const middle = (inside + outside) / 2
    if (isInSrgbGamut({ l, c: middle, h })) inside = middle
    else outside = middle
  }
  return oklabToHex(oklchToOklab({ l, c: inside, h }))
}

/**
 * The colour `amount` of the way from `from` to `to` (0 = `from`, 1 = `to`), mixed in OKLab so the
 * steps look even. Both are `#rrggbb`; the result is `#rrggbb` in lower case.
 */
export function mixOklab(from: string, to: string, amount: number): string {
  const a = hexToOklab(from)
  const b = hexToOklab(to)
  const t = Math.min(1, Math.max(0, amount))
  return oklabToHex({
    l: a.l + (b.l - a.l) * t,
    a: a.a + (b.a - a.a) * t,
    b: a.b + (b.b - a.b) * t,
  })
}
