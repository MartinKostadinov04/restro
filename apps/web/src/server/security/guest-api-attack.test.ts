// The guest API, attacked (the repair-review's A7), through its real handlers on a real Postgres as
// restro_app, with no stub of core: no code, a retired code, another table's code, another
// organisation's ids; oversized and malformed bodies; rule 3 walked over every answer; hostile POS
// text in the bill. The per-phone limits and the Turnstile answers are in their own files.
import { generateKeyPairSync, randomUUID } from 'node:crypto'

import { applyService } from '@restro/core/service'
import type { DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { getPool } from '../db'
import { handleGuestAction, handleGuestPayment, handleGuestState } from '../guest-api'
import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import { refusingFetch } from './attack-session'
import { removeOrgs, type SeededOrg, type SeededVenue, seedOrg } from './tests/attack-world'

vi.mock('@/server/session', async () => (await import('./attack-session')).sessionModule)
vi.mock('next/cache', async () => (await import('./attack-session')).cacheModule)
vi.mock('next/headers', async () => (await import('./attack-session')).headersModule)
vi.mock('next-intl/server', async () => (await import('./attack-session')).intlModule)
vi.mock('@/server/jobs', async () => (await import('./attack-session')).jobsModule)
vi.mock('@/server/log', async () => (await import('./attack-session')).logModule)

const PHONE = 'attack-phone-aaaaaaaaa'
const HOSTILE = '<script>alert(1)</script>'
const KEY = 'attack-test-key-'.padEnd(48, 'x')

/** POS ids the seeded reading uses: none may leave in a guest answer. */
const POS_BILL = 'POSBILL77'
const POS_LINE = 'POSLINE88'
const POS_ITEM = 'POSITEM99'

/** Key names that would be an internal field wherever they turn up. */
const INTERNAL_KEY =
  /^(pos|posId|posName|posBillRef|bid|billId|placeId|articleId|article_id|article_name|cat_name|cost|costPrice|cost_price|integrationId|integration_id|tenantId|tenant_id|venueId|providerPaymentRef|handleHash|handle_hash|qrToken|qrCodeHash|source|actor|jobId|job_id)$/

function keysOf(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const entry of value) keysOf(entry, into)
  else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key)
      keysOf(inner, into)
    }
  }
  return into
}

describe.skipIf(!hasDatabase)('the guest API, attacked (as restro_app)', () => {
  let owner: pg.Pool
  let app: DbPool
  let victim: SeededOrg
  let other: SeededOrg
  let venue: SeededVenue
  const queued: unknown[] = []

  const deps = () => ({
    pool: app,
    queueReading: async (target: unknown) => {
      queued.push(target)
    },
    passKey: null,
    humanCheck: async () => 'passed' as const,
    queueSend: async (target: unknown) => {
      queued.push(target)
    },
    queuePayment: async (target: unknown) => {
      queued.push(target)
    },
  })

  const state = (auth: string | null, query = '?view=bill') =>
    handleGuestState(
      new Request(`http://localhost/api/guest/state${query}`, {
        headers: auth === null ? {} : { authorization: auth },
      }),
      deps(),
    )

  const act = (auth: string | null, body: unknown, extra: Record<string, string> = {}) =>
    handleGuestAction(
      new Request('http://localhost/api/guest/actions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-restro-phone': PHONE,
          ...(auth === null ? {} : { authorization: auth }),
          ...extra,
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      deps(),
    )

  const orderAdd = (itemId: string) => ({
    command: { kind: 'order.add', actionId: randomUUID(), itemId, optionIds: [], qty: 1, note: '' },
    ageMs: 1_000,
    view: 'order',
  })

  beforeAll(async () => {
    useTestServerEnvironment()
    vi.stubGlobal('fetch', refusingFetch)
    owner = openOwnerPool()
    app = getPool()
    victim = await seedOrg(app, owner, 'GUESTVICTIM')
    other = await seedOrg(app, owner, 'GUESTOTHER')
    venue = victim.venues[0]
    await owner.query(
      `update restro.venues
          set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{ordering}',
                coalesce(settings->'ordering', '{}'::jsonb) || '{"locationCheck": false}'::jsonb)
        where id = $1`,
      [venue.id],
    )
    const { result } = await applyService(
      app,
      {
        type: 'reading.record',
        tableId: venue.table,
        reading: {
          complete: true,
          currency: 'EUR',
          bills: [
            {
              pos: POS_BILL,
              totalMinor: 1234,
              paidMinor: 0,
              openedAt: '2026-10-26T20:00:00.000Z',
              openedByRestro: false,
              paymentInFlight: false,
              lines: [
                {
                  pos: POS_LINE,
                  itemPos: POS_ITEM,
                  posName: HOSTILE,
                  quantity: '1',
                  amountMinor: 1234,
                  enteredBy: 'staff',
                  enteredAt: null,
                  restroRef: null,
                },
              ],
            },
          ],
        },
      } as never,
      {
        tenantId: victim.tenantId,
        venueId: venue.id,
        origin: 'worker',
        actor: { kind: 'integration', integrationId: victim.integration },
        jobId: `table-read-${randomUUID()}`,
      },
      { billIdKey: KEY },
    )
    if (result.status !== 'accepted') throw new Error(`refused: ${JSON.stringify(result)}`)
  }, 120_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await removeOrgs(owner, [victim, other])
    await owner?.end()
  }, 120_000)

  describe('the code', () => {
    const noCode: readonly [string, string | null][] = [
      ['no header', null],
      ['an empty scheme', 'Table '],
      ['another scheme', 'Bearer abcdefgh1234'],
      ['two codes', 'Table abcdefgh1234 abcdefgh5678'],
      ['too short', 'Table abc'],
      ['a path', 'Table ../../etc/passwd'],
      ['a quote', "Table abc'; drop table x;--"],
      ['a code nobody has', 'Table neverIssuedCodeAAAAAAAA'],
    ]
    for (const [name, auth] of noCode) {
      it(`${name}: the state and an action answer 401, with no id or name`, async () => {
        const read = await state(auth)
        expect(read.status).toBe(401)
        expect(await read.json()).toEqual({ code: 'code_retired' })
        const answer = await act(auth, orderAdd(venue.item))
        expect(answer.status).toBe(401)
        expect(await answer.json()).toEqual({ code: 'code_retired' })
      }, 30_000)
    }

    it('a code that was reissued is retired at once', async () => {
      const table = victim.venues[1]
      const before = await state(`Table ${table.tableCode}`, '?view=menu')
      expect(before.status).toBe(200)
      const { result } = await applyService(
        app,
        { type: 'table_code.reissue', tableId: table.table } as never,
        {
          tenantId: victim.tenantId,
          venueId: table.id,
          origin: 'staff',
          actor: { kind: 'user', userId: victim.ownerId, sessionId: `s-${victim.ownerId}` },
          jobId: `web-${randomUUID()}`,
          signedInAt: new Date(),
        },
        { sealPublicKey: generateKeyPairSync('x25519').publicKey },
      )
      expect(result, JSON.stringify(result)).toMatchObject({ status: 'accepted' })
      const after = await state(`Table ${table.tableCode}`, '?view=menu')
      expect(after.status).toBe(401)
    }, 30_000)
  })

  describe("another table's code", () => {
    it("the table's bill isn't read through the other table's code", async () => {
      const answer = await state(`Table ${other.venues[0].tableCode}`)
      expect(answer.status).toBe(200)
      expect(await answer.text()).not.toContain('1234')
    }, 30_000)

    it("a code at this venue doesn't take another organisation's item", async () => {
      const before = await owner.query(
        `select count(*)::int as n from restro.table_orders where tenant_id = $1`,
        [victim.tenantId],
      )
      const answer = await act(`Table ${venue.tableCode}`, orderAdd(other.venues[0].item))
      const text = await answer.text()
      expect(text).not.toContain('GUESTOTHER')
      const lines = await owner.query<{ row: unknown }>(
        `select to_jsonb(t) as row from restro.table_orders t where tenant_id = $1`,
        [victim.tenantId],
      )
      expect(JSON.stringify(lines.rows)).not.toContain(other.venues[0].item)
      expect(before.rows).toBeDefined()
    }, 30_000)

    it('a payment handle of another table answers nothing', async () => {
      const answer = await handleGuestPayment(
        new Request('http://localhost/api/guest/payment', {
          headers: {
            authorization: `Table ${other.venues[0].tableCode}`,
            'x-restro-payment': 'aaaaaaaaaaaaaaaaaaaaaA',
          },
        }),
        deps(),
      )
      expect([400, 404]).toContain(answer.status)
    }, 30_000)
  })

  describe('the body', () => {
    const auth = () => `Table ${venue.tableCode}`
    it('past 8 KB is a 413, declared or not', async () => {
      const big = JSON.stringify({ ...orderAdd(venue.item), pad: 'x'.repeat(9_000) })
      expect((await act(auth(), big)).status).toBe(413)
    }, 30_000)

    const bad: readonly [string, string][] = [
      ['not JSON', '{'],
      ['a number', '1'],
      ['null', 'null'],
      ['an array', '[]'],
      ['__proto__', '{"__proto__":{"admin":true},"command":{"kind":"order.tidy"}}'],
      ['an unknown command', '{"command":{"kind":"payment.settle"},"ageMs":1,"view":"order"}'],
      [
        'a worker command by name',
        '{"command":{"kind":"reading.record","actionId":"x"},"ageMs":1,"view":"order"}',
      ],
      ['a nesting bomb', `${'['.repeat(3_000)}${']'.repeat(3_000)}`],
    ]
    for (const [name, body] of bad) {
      it(`${name} is a 400 and moves nothing`, async () => {
        const answer = await act(auth(), body)
        expect(answer.status).toBe(400)
        expect(await answer.json()).toEqual({ code: 'invalid_request' })
      }, 30_000)
    }

    it("extra fields (another table's id, a price) are refused, not used", async () => {
      const body = orderAdd(venue.item)
      const answer = await act(auth(), {
        ...body,
        command: { ...body.command, tableId: other.venues[0].table, priceMinor: 1 },
      })
      expect(answer.status).toBe(400)
    }, 30_000)

    it('a phone header of the wrong shape is a 400', async () => {
      const answer = await act(auth(), orderAdd(venue.item), { 'x-restro-phone': 'short' })
      expect(answer.status).toBe(400)
    }, 30_000)
  })

  describe('rule 3, on every answer', () => {
    for (const view of ['menu', 'order', 'bill'] as const) {
      it(`the ${view} view holds no POS id, no internal field`, async () => {
        const answer = await state(`Table ${venue.tableCode}`, `?view=${view}`)
        expect(answer.status).toBe(200)
        const text = await answer.text()
        for (const value of [POS_BILL, POS_LINE, POS_ITEM, victim.integration, victim.tenantId]) {
          expect(text, value).not.toContain(value)
        }
        expect(text).not.toContain(venue.tableCode)
        const keys = [...keysOf(JSON.parse(text))].filter((key) => INTERNAL_KEY.test(key))
        expect(keys).toEqual([])
        expect(answer.headers.get('cache-control')).toBe('no-store')
        expect(answer.headers.get('referrer-policy')).toBe('no-referrer')
      }, 30_000)
    }

    it('an answer to an action holds none either', async () => {
      const answer = await act(`Table ${venue.tableCode}`, orderAdd(venue.item))
      const text = await answer.text()
      for (const value of [POS_BILL, POS_LINE, POS_ITEM, victim.integration, victim.tenantId]) {
        expect(text, value).not.toContain(value)
      }
      expect([...keysOf(JSON.parse(text))].filter((key) => INTERNAL_KEY.test(key))).toEqual([])
    }, 30_000)
  })
})
