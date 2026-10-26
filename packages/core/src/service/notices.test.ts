// The notice route's one write (#108): `@restro/core/service/notices` exports only
// `recordProviderNotice`, which stores a verified notice once by its event id as the restro_app
// role, and the worker's helpers read the stored notices back, mark them handled and find the venue
// of an account. The database part is skipped without a database.
import { randomUUID } from 'node:crypto'
import type { DbPool } from '@restro/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { hasDatabase } from '../apply/test-database'

import { providerRef } from '../connectors/payment/provider-ref'
import { ProviderNoticeSchema } from '../connectors/payment/schemas'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import * as notices from './notices'
import {
  markProviderNoticeHandled,
  paymentAccountVenues,
  unhandledProviderNotices,
} from './provider-notices'

describe('the notice module', () => {
  it('exports recordProviderNotice and nothing else', () => {
    expect(Object.keys(notices)).toEqual(['recordProviderNotice'])
  })

  it("refuses, before the database, every notice the payment seam's schema refuses", async () => {
    const good = {
      id: 'evt_1',
      type: 'charge.refunded',
      kind: 'refund',
      accountRef: providerRef('acct_1'),
      objectRef: providerRef('ch_1'),
    }
    expect(ProviderNoticeSchema.safeParse(good).success).toBe(true)
    const noPool = {} as DbPool
    for (const bad of [
      { ...good, kind: 'charge.refunded' },
      { ...good, amountMinor: 500 },
      { ...good, id: '' },
      { ...good, id: 'evt 1' },
      { ...good, id: 'e'.repeat(256) },
      { ...good, type: 'x'.repeat(129) },
      { ...good, objectRef: 'ch_1' },
      { ...good, accountRef: { provider: 'acct 1' } },
    ]) {
      expect(ProviderNoticeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
      await expect(
        notices.recordProviderNotice(noPool, {
          providerKind: 'sim-pay',
          live: false,
          notice: bad as notices.RecordProviderNoticeInput['notice'],
          jobId: 'rq-1',
        }),
        JSON.stringify(bad),
      ).rejects.toBeInstanceOf(ZodError)
    }
  })
})

describe.skipIf(!hasDatabase)('recording a provider notice (as the restro_app role)', () => {
  let world: ServiceWorld
  const eventIds: string[] = []

  beforeAll(async () => {
    world = await openServiceWorld('notices')
  })
  afterAll(async () => {
    if (world !== undefined && eventIds.length > 0) {
      await world.owner.query('delete from restro.provider_notices where event_id = any($1)', [
        eventIds,
      ])
    }
    await world?.close()
  })

  const notice = (kind: 'refund' | 'dispute' | 'other' = 'refund') => {
    const id = `evt_${randomUUID().replaceAll('-', '')}`
    eventIds.push(id)
    return {
      id,
      type: kind === 'refund' ? 'charge.refunded' : 'charge.dispute.created',
      kind,
      accountRef: providerRef('acct_notices'),
      objectRef: providerRef('ch_1'),
    }
  }
  const record = (input: ReturnType<typeof notice>, providerKind = 'sim-pay') =>
    notices.recordProviderNotice(world.app, {
      providerKind,
      live: false,
      notice: input,
      jobId: `rq-${randomUUID()}`,
    })

  it('stores a notice once, and answers duplicate for the same event id', async () => {
    const first = notice()
    expect(await record(first)).toBe('recorded')
    expect(await record(first)).toBe('duplicate')
    expect(await record(first, 'other-pay')).toBe('recorded')
    const stored = await world.owner.query(
      `select provider_kind, live, account_ref, type, kind, object_ref, source, actor, handled_at
         from restro.provider_notices where event_id = $1 order by provider_kind`,
      [first.id],
    )
    expect(stored.rows).toEqual([
      expect.objectContaining({ provider_kind: 'other-pay' }),
      {
        provider_kind: 'sim-pay',
        live: false,
        account_ref: 'acct_notices',
        type: 'charge.refunded',
        kind: 'refund',
        object_ref: 'ch_1',
        source: 'provider',
        actor: 'system',
        handled_at: null,
      },
    ])
  })

  it('throws on a malformed notice and stores nothing', async () => {
    const bad = { ...notice(), kind: 'charge.refunded' as 'refund' }
    await expect(record(bad)).rejects.toThrow()
    await expect(
      notices.recordProviderNotice(world.app, {
        providerKind: 'Sim Pay',
        live: false,
        notice: notice(),
        jobId: 'rq-1',
      }),
    ).rejects.toThrow()
    const stored = await world.owner.query(
      'select 1 from restro.provider_notices where event_id = $1',
      [bad.id],
    )
    expect(stored.rowCount).toBe(0)
  })

  it('lists the unhandled notices in the order stored and marks each handled once', async () => {
    const a = notice('dispute')
    const b = notice('other')
    await record(a)
    await record(b)
    const mine = (await unhandledProviderNotices(world.app, { limit: 1_000 })).filter((n) =>
      [a.id, b.id].includes(n.eventId),
    )
    expect(mine.map((n) => [n.eventId, n.kind])).toEqual([
      [a.id, 'dispute'],
      [b.id, 'other'],
    ])
    const [first] = mine
    if (first === undefined) throw new Error('no notice')
    expect(first).toMatchObject({ accountRef: 'acct_notices', objectRef: 'ch_1', live: false })
    expect(await markProviderNoticeHandled(world.app, first.seq)).toBe(true)
    expect(await markProviderNoticeHandled(world.app, first.seq)).toBe(false)
    const left = await unhandledProviderNotices(world.app, { limit: 1_000 })
    expect(left.map((n) => n.eventId)).not.toContain(a.id)
    expect(left.map((n) => n.eventId)).toContain(b.id)
  })

  it('pages the unhandled notices by seq, and only of the provider kinds asked for', async () => {
    const ids = [notice(), notice(), notice()]
    for (const input of ids) await record(input, 'page-pay')
    const elsewhere = notice()
    await record(elsewhere, 'unwired-pay')
    const kinds = ['page-pay']
    const first = await unhandledProviderNotices(world.app, { limit: 2, providerKinds: kinds })
    expect(first.map((n) => n.eventId)).toEqual([ids[0]?.id, ids[1]?.id])
    const rest = await unhandledProviderNotices(world.app, {
      limit: 2,
      afterSeq: first.at(-1)?.seq,
      providerKinds: kinds,
    })
    expect(rest.map((n) => n.eventId)).toEqual([ids[2]?.id])
    expect(await unhandledProviderNotices(world.app, { limit: 10, providerKinds: [] })).toEqual([])
    const all = await unhandledProviderNotices(world.app, { limit: 1_000 })
    expect(all.map((n) => n.eventId)).toContain(elsewhere.id)
    expect(all.map((n) => n.seq)).toEqual([...all.map((n) => n.seq)].sort((x, y) => x - y))
  })

  it("finds an account's venue across tenants, by provider kind", async () => {
    const account = `acct_${randomUUID().replaceAll('-', '')}`
    await world.owner.query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, source, actor, job_id)
       values ($1, $2, 'sim-pay', $3, 'connected', 'restro', 'system', 'test-seed')`,
      [world.tenantId, world.venueId, account],
    )
    const venues = await paymentAccountVenues(world.app, 'sim-pay')
    expect(venues.get(account)).toEqual({ tenantId: world.tenantId, venueId: world.venueId })
    expect((await paymentAccountVenues(world.app, 'other-pay')).get(account)).toBeUndefined()
  })
})
