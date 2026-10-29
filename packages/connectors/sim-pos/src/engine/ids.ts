// Ids in varied shapes (#51 design §7 risk 1, ticket #68): each new id takes the next of three
// shapes in turn, a number, text with spaces, or a uuid, so no platform code can assume one.

import type { Random } from './random'

export type IdKind = 'bill' | 'row'

const WORDS: { readonly [K in IdKind]: string } = { bill: 'acc', row: 'pos line' }
const BASES: { readonly [K in IdKind]: number } = { bill: 70_000, row: 9_100_000 }

export function makeId(kind: IdKind, seq: number, random: Random): string {
  switch (seq % 3) {
    case 0:
      return String(BASES[kind] + seq)
    case 1:
      return `${WORDS[kind]} ${seq} #${(seq % 7) + 1}`
    default: {
      const hex = random.hex32()
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`
    }
  }
}

export type IdShape = 'number' | 'spaced' | 'uuid'

export function idShape(id: string): IdShape | null {
  if (/^[1-9]\d*$/.test(id)) return 'number'
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) return 'uuid'
  if (/ /.test(id)) return 'spaced'
  return null
}
