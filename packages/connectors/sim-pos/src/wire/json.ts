// The wire's JSON (rule 8). Out: an id that looks like a number goes out as a JSON number, so the
// platform meets ids of every shape (#51 design §7 risk 1), and a money field goes out as a JSON
// number with a fraction (2.4, not "2.40") where `pricesAsJsonFloats` is on, as POSes send them,
// else as decimal text. In: every JSON number is read back as its exact source text, never a
// float, and the money module turns that text into minor units.

import { minorToDecimal } from '@restro/core'

/** The money fields of the wire, in either direction. */
const MONEY_KEYS: ReadonlySet<string> = new Set(['price', 'amount', 'total', 'paid'])
/** The id fields of the wire: a value, or a list of them. */
const ID_KEYS: ReadonlySet<string> = new Set([
  'id',
  'bill',
  'table',
  'article',
  'row',
  'rows',
  'bar',
])
const NUMBER_SHAPED = /^[1-9]\d{0,14}$/

// `JSON.rawJSON` is in Node 24 (V8 13.6) but not yet in TypeScript's ES2023 library.
const rawJSON = (JSON as unknown as { rawJSON(text: string): unknown }).rawJSON

/** Money in minor units as JSON number text: 1250 → "12.5", 1200 → "12", 5 → "0.05". */
export function moneyNumberText(minor: number): string {
  return minorToDecimal(minor).replace(/\.?0+$/, '')
}

export interface RenderOptions {
  readonly pricesAsJsonFloats: boolean
}

/** Renders an engine answer, or a request body, as wire JSON text. */
export function renderWireJson(value: unknown, options: RenderOptions): string {
  return JSON.stringify(shape(value, null, options))
}

function shape(value: unknown, key: string | null, options: RenderOptions): unknown {
  if (key !== null && MONEY_KEYS.has(key) && typeof value === 'number') {
    return options.pricesAsJsonFloats ? rawJSON(moneyNumberText(value)) : minorToDecimal(value)
  }
  if (key !== null && ID_KEYS.has(key)) {
    if (typeof value === 'string') return idOut(value)
    if (Array.isArray(value)) {
      return value.map((item) =>
        typeof item === 'string' ? idOut(item) : shape(item, null, options),
      )
    }
  }
  if (Array.isArray(value)) return value.map((item) => shape(item, null, options))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([name, child]) => [name, shape(child, name, options)]),
    )
  }
  return value
}

function idOut(id: string): unknown {
  return NUMBER_SHAPED.test(id) ? rawJSON(id) : id
}

type NumberContext = { readonly source?: string }

/**
 * `JSON.parse` with every number kept as its exact source text: `12.50` → `"12.50"`, `7` → `"7"`.
 * Throws `SyntaxError` on invalid JSON, and loudly where the runtime gives no source text.
 */
export function parseWireJson(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: NumberContext) => {
    if (typeof value !== 'number') return value
    if (context?.source === undefined) {
      throw new Error('JSON.parse source-text access is unavailable; Node 24 or newer is required')
    }
    return context.source
  })
}
