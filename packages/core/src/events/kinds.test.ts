// The guest event kinds (D142; #335): the union is closed, every kind's fields are fixed, and
// nothing in the model can carry personal data — the property test below tries to put a name, a
// phone number, an email address, an IP address, a device id and free text into every kind and
// every field name we could think of, and every one is refused. The last block reads the repository
// itself: a kind nobody records is a kind that measures nothing.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { guestEvents } from '@restro/db'
import { getTableColumns } from 'drizzle-orm'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { newId } from '../ids'
import {
  GUEST_EVENT_BATCH_MAX,
  GUEST_EVENT_KIND_NAMES,
  GUEST_EVENT_KINDS,
  GuestEventBatchSchema,
  type GuestEventInput,
  GuestEventInputSchema,
  guestEventAmount,
  guestEventOutcome,
  guestEventRetentionOf,
  isPhoneReportedKind,
  PHONE_REPORTED_KINDS,
} from './kinds'

/** One valid event of every kind, with the fields that kind needs and nothing more. */
const ONE_OF_EACH: Record<string, GuestEventInput> = {
  'menu.opened': { kind: 'menu.opened' },
  'item.opened': { kind: 'item.opened', itemId: newId('nd') },
  'order.line_added': { kind: 'order.line_added', itemId: newId('nd') },
  'order.line_removed': { kind: 'order.line_removed', itemId: newId('nd') },
  'order.send_attempted': { kind: 'order.send_attempted', outcome: 'ok' },
  'pay.started': { kind: 'pay.started' },
  'pay.finished': { kind: 'pay.finished', outcome: 'ok' },
  'waiter.call_opened': { kind: 'waiter.call_opened' },
  'language.chosen': { kind: 'language.chosen', locale: 'bg_BG' },
}

describe('the kinds', () => {
  it('takes one of every kind, and the list and the table agree', () => {
    for (const kind of GUEST_EVENT_KIND_NAMES) {
      const event = ONE_OF_EACH[kind]
      expect(event, `no fixture for ${kind}`).toBeDefined()
      expect(GuestEventInputSchema.safeParse(event).success, kind).toBe(true)
      expect(guestEventRetentionOf(kind)).toBe(GUEST_EVENT_KINDS[kind])
    }
    expect(Object.keys(ONE_OF_EACH).sort()).toEqual([...GUEST_EVENT_KIND_NAMES].sort())
  })

  it('keeps every kind the full 18 months (D142)', () => {
    // These rows hold no personal data, so a longer retention costs nothing a guest could mind,
    // and the nights a later question wants to compare against are the earliest ones. A kind that
    // should not be kept that long is a decision to write down, not a value to change here.
    for (const kind of GUEST_EVENT_KIND_NAMES) {
      expect(guestEventRetentionOf(kind), kind).toBe('record')
    }
  })

  it('refuses a kind that is not in the union', () => {
    for (const kind of ['', 'menu', 'menu.closed', 'order.line_moved', 'pay', 'PAY.STARTED']) {
      expect(GuestEventInputSchema.safeParse({ kind }).success, kind).toBe(false)
    }
  })

  it('refuses a kind missing its own field, or borrowing another one', () => {
    expect(GuestEventInputSchema.safeParse({ kind: 'item.opened' }).success).toBe(false)
    expect(GuestEventInputSchema.safeParse({ kind: 'order.send_attempted' }).success).toBe(false)
    expect(GuestEventInputSchema.safeParse({ kind: 'pay.finished' }).success).toBe(false)
    expect(GuestEventInputSchema.safeParse({ kind: 'language.chosen' }).success).toBe(false)
    // The two order kinds need the dish they moved, or they measure nothing.
    expect(GuestEventInputSchema.safeParse({ kind: 'order.line_added' }).success).toBe(false)
    expect(GuestEventInputSchema.safeParse({ kind: 'order.line_removed' }).success).toBe(false)
    expect(
      GuestEventInputSchema.safeParse({ kind: 'order.line_added', itemId: 'ol_1234567890' })
        .success,
    ).toBe(false)
    // A POS id or a name where our own node id belongs (rule 3).
    expect(GuestEventInputSchema.safeParse({ kind: 'item.opened', itemId: '30001' }).success).toBe(
      false,
    )
    expect(
      GuestEventInputSchema.safeParse({ kind: 'item.opened', itemId: 'Negroni' }).success,
    ).toBe(false)
    // A locale that is not one of the eleven we serve, and an outcome that is free text.
    expect(GuestEventInputSchema.safeParse({ kind: 'language.chosen', locale: 'en' }).success).toBe(
      false,
    )
    expect(
      GuestEventInputSchema.safeParse({ kind: 'language.chosen', locale: 'zz_ZZ' }).success,
    ).toBe(false)
    expect(
      GuestEventInputSchema.safeParse({ kind: 'pay.finished', outcome: 'Card declined!' }).success,
    ).toBe(false)
    // The menu opening carries no item.
    expect(
      GuestEventInputSchema.safeParse({ kind: 'menu.opened', itemId: newId('nd') }).success,
    ).toBe(false)
  })

  it('takes money as integer minor units only (rule 8)', () => {
    const amount = { amount_minor: 1250, currency: 'EUR' }
    expect(GuestEventInputSchema.safeParse({ kind: 'pay.started', amount }).success).toBe(true)
    for (const bad of [
      { amount_minor: 12.5, currency: 'EUR' },
      { amount_minor: -1, currency: 'EUR' },
      { amount_minor: 1250, currency: 'eur' },
      { amount_minor: 1250, currency: 'BGN' },
      { amount_minor: 1250 },
      { amount_minor: '1250', currency: 'EUR' },
    ]) {
      expect(
        GuestEventInputSchema.safeParse({ kind: 'pay.started', amount: bad }).success,
        JSON.stringify(bad),
      ).toBe(false)
    }
  })

  it('refuses a batch that is empty or over the cap, and takes one at the cap', () => {
    const one = ONE_OF_EACH['menu.opened'] as GuestEventInput
    expect(GuestEventBatchSchema.safeParse([]).success).toBe(false)
    expect(GuestEventBatchSchema.safeParse(Array(GUEST_EVENT_BATCH_MAX).fill(one)).success).toBe(
      true,
    )
    expect(
      GuestEventBatchSchema.safeParse(Array(GUEST_EVENT_BATCH_MAX + 1).fill(one)).success,
    ).toBe(false)
    // One bad event refuses the batch whole.
    expect(GuestEventBatchSchema.safeParse([one, { kind: 'menu.closed' }]).success).toBe(false)
  })

  it('names the three kinds a phone may report, and no more', () => {
    expect([...PHONE_REPORTED_KINDS]).toEqual(['menu.opened', 'item.opened', 'language.chosen'])
    for (const kind of GUEST_EVENT_KIND_NAMES) {
      expect(isPhoneReportedKind(kind), kind).toBe(PHONE_REPORTED_KINDS.includes(kind as never))
    }
    expect(isPhoneReportedKind('pay.finished')).toBe(false)
    expect(isPhoneReportedKind('nonsense')).toBe(false)
  })
})

describe('the outcome and the amount of an event', () => {
  it('keeps a code of ours and turns anything else into `other`', () => {
    expect(guestEventOutcome('ok')).toBe('ok')
    expect(guestEventOutcome('pos_unreachable')).toBe('pos_unreachable')
    expect(guestEventOutcome(null)).toBe('other')
    expect(guestEventOutcome(undefined)).toBe('other')
    expect(guestEventOutcome('')).toBe('other')
    expect(guestEventOutcome('Card declined: 4242')).toBe('other')
    expect(guestEventOutcome('x'.repeat(200))).toBe('other')
  })

  it('never makes an outcome the model would refuse', () => {
    fc.assert(
      fc.property(fc.string(), (code) => {
        const outcome = guestEventOutcome(code)
        expect(GuestEventInputSchema.safeParse({ kind: 'pay.finished', outcome }).success).toBe(
          true,
        )
      }),
    )
  })

  it('leaves the amount out rather than fail the write it measures', () => {
    expect(guestEventAmount(1250, 'EUR')).toEqual({
      amount: { amount_minor: 1250, currency: 'EUR' },
    })
    expect(guestEventAmount(null, 'EUR')).toEqual({})
    expect(guestEventAmount(undefined, 'EUR')).toEqual({})
    expect(guestEventAmount(1250, null)).toEqual({})
    expect(guestEventAmount(-5, 'EUR')).toEqual({})
    expect(guestEventAmount(1250, 'nonsense')).toEqual({})
  })

  it('never makes an amount the model would refuse', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.double(), fc.constant(null)),
        fc.oneof(fc.string(), fc.constant(null)),
        (minor, currency) => {
          const amount = guestEventAmount(minor, currency)
          expect(GuestEventInputSchema.safeParse({ kind: 'pay.started', ...amount }).success).toBe(
            true,
          )
        },
      ),
    )
  })
})

// -----------------------------------------------------------------------------------------------
// No personal data, anywhere in the model (D142, rule 3)

/** Field names a night could be measured by if we were careless. None of them may be accepted. */
const PERSONAL_FIELDS = [
  'phone',
  'phoneNumber',
  'phone_number',
  'msisdn',
  'name',
  'guestName',
  'firstName',
  'surname',
  'email',
  'ip',
  'ipAddress',
  'remoteAddr',
  'device',
  'deviceId',
  'fingerprint',
  'userAgent',
  'note',
  'notes',
  'text',
  'comment',
  'message',
  'search',
  'query',
  'card',
  'cardLast4',
  'pan',
  'latitude',
  'longitude',
  'location',
  'coords',
] as const

describe('no event can carry personal data', () => {
  it('refuses every personal field name, on every kind, with any value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...GUEST_EVENT_KIND_NAMES),
        fc.constantFrom(...PERSONAL_FIELDS),
        fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
        (kind, field, value) => {
          const event = { ...(ONE_OF_EACH[kind] as GuestEventInput), [field]: value }
          expect(GuestEventInputSchema.safeParse(event).success).toBe(false)
        },
      ),
    )
  })

  it('refuses any field the kind did not ask for', () => {
    const known = ['kind', 'at', 'sittingId', 'itemId', 'outcome', 'locale', 'amount']
    fc.assert(
      fc.property(
        fc.constantFrom(...GUEST_EVENT_KIND_NAMES),
        fc.string({ minLength: 1 }).filter((key) => !known.includes(key)),
        (kind, key) => {
          const event = { ...(ONE_OF_EACH[kind] as GuestEventInput), [key]: 'x' }
          expect(GuestEventInputSchema.safeParse(event).success).toBe(false)
        },
      ),
    )
  })

  it('has no column for personal data in the table either', () => {
    const columns = Object.values(getTableColumns(guestEvents)).map((column) => column.name)
    expect([...columns].sort()).toEqual(
      [
        'seq',
        'tenant_id',
        'venue_id',
        'at',
        'service_date',
        'kind',
        'table_id',
        'sitting_id',
        'node_id',
        'amount_minor',
        'currency',
        'locale',
        'outcome',
        'retention',
        'source',
        'actor',
        'job_id',
      ].sort(),
    )
  })
})

// -----------------------------------------------------------------------------------------------
// Every kind is actually recorded somewhere (the seam is wired, not only declared)

/**
 * Where a kind is recorded from: the service write path and the guest page. This folder is left
 * out on purpose — a kind the model only declares and nobody records measures nothing.
 */
const WRITERS = ['packages/core/src/service', 'apps/web/src/guest'] as const

function filesUnder(root: string): readonly string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path)
    }
  }
  walk(root)
  return out
}

describe('every kind has a writer', () => {
  const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..')
  const sources = WRITERS.flatMap((dir) => filesUnder(join(repoRoot, dir))).map((path) =>
    readFileSync(path, 'utf8'),
  )

  it('finds the sources it means to read', () => {
    expect(sources.length).toBeGreaterThan(20)
  })

  it.each(GUEST_EVENT_KIND_NAMES)('%s is recorded somewhere', (kind) => {
    expect(sources.some((text) => text.includes(`'${kind}'`))).toBe(true)
  })
})
