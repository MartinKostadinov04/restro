// The ring of the last 64 action ids (design §2.4): a repeat finds its first answer, the ring never
// grows past 64, and an entry that fails its schema is ignored rather than trusted.
import { randomUUID } from 'node:crypto'

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { ACTION_RING_SIZE, findInRing, pushToRing, type RingEntry, readRing } from './action-ring'
import { accepted, refused } from './results'

function entry(actionId: string, version: number): RingEntry {
  return { actionId, result: accepted(actionId), version }
}

describe('the action ring', () => {
  it('returns the first answer to a remembered action id', () => {
    const first = randomUUID()
    const ring = pushToRing([], {
      actionId: first,
      result: refused(first, 'line_held'),
      version: 3,
    })
    expect(findInRing(ring, first)).toEqual(refused(first, 'line_held'))
    expect(findInRing(ring, randomUUID())).toBeNull()
  })

  it('keeps the last 64 actions, oldest dropped first', () => {
    const ids = Array.from({ length: ACTION_RING_SIZE + 5 }, () => randomUUID())
    let ring: unknown[] = []
    ids.forEach((id, index) => {
      ring = pushToRing(ring, entry(id, index))
    })
    expect(ring).toHaveLength(ACTION_RING_SIZE)
    expect(findInRing(ring, ids[0] as string)).toBeNull()
    expect(findInRing(ring, ids[ids.length - 1] as string)).not.toBeNull()
  })

  it('skips stored entries that fail the schema', () => {
    const id = randomUUID()
    expect(readRing([{ actionId: 'not-a-uuid' }, entry(id, 1), 7])).toEqual([entry(id, 1)])
    expect(readRing('not an array')).toEqual([])
  })

  it('never holds more than 64 entries or the same action twice', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 80 }), { maxLength: 200 }), (picks) => {
        const ids = Array.from({ length: 81 }, () => randomUUID())
        let ring: unknown[] = []
        for (const pick of picks) ring = pushToRing(ring, entry(ids[pick] as string, pick))
        const kept = readRing(ring)
        expect(kept.length).toBeLessThanOrEqual(ACTION_RING_SIZE)
        expect(new Set(kept.map((e) => e.actionId)).size).toBe(kept.length)
      }),
    )
  })
})
