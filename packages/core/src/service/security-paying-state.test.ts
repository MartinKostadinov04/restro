// RR-2: `readTableState` answers `unchanged` while the phone's version equals the table's, so a change
// to the venue's paying state or legal details raises the version of its open tables
// (`paying-phones.ts`), and only when what a phone is told really moved. The control: the engine
// refuses a Pay on a lost account whatever the phone shows, so no money moves under a lost account;
// what a stale phone gets wrong is what it shows, and whose name it pays under.
import { randomUUID } from 'node:crypto'

import { withTenantWrite } from '@restro/db/write'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { DEFAULT_ORDERING_SETTINGS } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import { forgetGuestCodes, guestAct, guestState } from './guest'
import { GuestLimiter } from './guest-limits'

const KEY = 'pay-test-key-'.padEnd(48, 'x')

const OLD_LEGAL = {
  name: 'Club EOOD',
  eik: '123456789',
  address: 'Sofia, 1 Vitosha Blvd',
  privacyUrl: 'https://club.example/privacy',
}

describe.skipIf(!hasDatabase)('an open phone and a change of paying state (RR-2)', () => {
  let world: ServiceWorld
  let tableId: string
  let code: string
  let owner: string
  const integrationId = newId('in')
  let limiter: GuestLimiter

  async function record() {
    const { result } = await applyService(
      world.app,
      {
        type: 'reading.record',
        tableId,
        reading: {
          complete: true,
          currency: 'EUR',
          bills: [
            {
              pos: 'B1',
              totalMinor: 1_000,
              paidMinor: 0,
              openedAt: '2026-10-26T20:00:00.000Z',
              openedByRestro: false,
              paymentInFlight: false,
              lines: [
                {
                  pos: 'L1',
                  itemPos: null,
                  posName: 'till name',
                  quantity: '1',
                  amountMinor: 1_000,
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
        tenantId: world.tenantId,
        venueId: world.venueId,
        origin: 'worker',
        actor: { kind: 'integration', integrationId },
        jobId: `table-read-${randomUUID()}`,
      },
      { billIdKey: KEY },
    )
    if (result.status !== 'accepted') throw new Error(`refused: ${JSON.stringify(result)}`)
  }

  const read = async (since?: number) => {
    const answer = await guestState(world.app, {
      code,
      view: 'bill',
      limiter: new GuestLimiter(),
      ...(since === undefined ? {} : { since }),
    })
    if (!answer.ok) throw new Error(answer.code)
    return answer.answer
  }

  const full = async () => {
    const state = await read()
    if (state.unchanged) throw new Error('unchanged')
    return state
  }

  beforeAll(async () => {
    world = await openServiceWorld('paying-state')
    tableId = world.tables[0] as string
    owner = await world.addUser('owner')
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: false })],
    )
    await withTenantWrite(world.app, world.tenantId, (tx) =>
      tx.execute(sql`
        insert into restro.integrations (id, tenant_id, kind, host)
        values (${integrationId}, ${world.tenantId}, 'sim', '127.0.0.1:9')`),
    )
    await world.owner.query('update restro.tables set is_payment_table = true where id = $1', [
      world.tables[3],
    ])
    await world.declareCapabilities({ recordTipOnClose: true, firstItemsOpenBill: true })
  }, 120_000)

  afterAll(async () => {
    await world?.close()
  }, 60_000)

  beforeEach(async () => {
    forgetGuestCodes()
    limiter = new GuestLimiter()
    await world.owner.query(
      `update restro.venues set settings = settings || jsonb_build_object('legalDetails', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify(OLD_LEGAL)],
    )
    await world.owner.query('delete from restro.payment_accounts where venue_id = $1', [
      world.venueId,
    ])
    await world.owner.query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, checks, connected_at, source, actor, job_id)
       values ($1, $2, 'sim-pay', 'acct_paytest1', 'connected', '{"cardPayments":true,"ticks":{"cardTypeInTill":{"at":"2026-10-27T00:00:00Z","by":"system"},"receiptEmailsOff":{"at":"2026-10-27T00:00:00Z","by":"system"}}}'::jsonb, now(), 'restro', 'system', 'test-seed')`,
      [world.tenantId, world.venueId],
    )
    await world.owner.query(
      `update restro.payments set state = 'released', reason = 'test', form_values = null,
         settled_at = now() where table_id = $1 and settled_at is null`,
      [tableId],
    )
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
      [tableId, 'staff_closed'],
    )
    await world.openSitting(tableId)
    code = `code${randomUUID().replaceAll('-', '')}`
    await world.owner.query(
      'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
      [tableId, code, await hashTableCode(code)],
    )
    await record()
  }, 30_000)

  const lose = async () => {
    const { result } = await applyService(
      world.app,
      { type: 'payment_account.lost', accountRef: 'acct_paytest1' } as never,
      {
        tenantId: world.tenantId,
        venueId: world.venueId,
        origin: 'worker',
        actor: { kind: 'system' },
        jobId: `lost-${randomUUID()}`,
      },
    )
    expect(result.status, JSON.stringify(result)).toBe('accepted')
  }

  const setLegal = async () => {
    const { result } = await applyService(
      world.app,
      {
        type: 'settings.paying_set',
        changes: { legalDetails: { ...OLD_LEGAL, name: 'Another Company OOD' } },
        providerMinMinor: 50,
      } as never,
      {
        tenantId: world.tenantId,
        venueId: world.venueId,
        origin: 'staff',
        actor: { kind: 'user', userId: owner, sessionId: `s-${owner}` },
        jobId: `settings-${randomUUID()}`,
        signedInAt: new Date(),
      } as never,
    )
    expect(result.status, JSON.stringify(result)).toBe('accepted')
  }

  const pay = async (phone: string) => {
    const state = await full()
    const lines = state.bill?.parts.flatMap((part) => part.lines) ?? []
    return guestAct(world.app, {
      code,
      command: {
        actionId: randomUUID(),
        type: 'pay.start',
        pick: {
          kind: 'lines',
          lines: lines.map((line) => ({ lineId: line.id, quantity: line.quantity })),
        },
        seen: lines.map((line) => ({
          lineId: line.id,
          quantity: line.quantity,
          amountMinor: line.amountMinor,
        })),
        tipMinor: null,
        tipPercent: null,
      } as never,
      ageMs: 50,
      view: 'bill',
      phone,
      limiter,
      check: { humanToken: 'XXXX.DUMMY.TOKEN.XXXX' },
      humanCheck: async () => 'passed',
      queuePayment: async () => {},
    })
  }

  it('the setup: an open phone is offered paying, under the old legal name', async () => {
    const state = await full()
    expect(state.ordering.paying).toBe('on')
    expect(state.ordering.payingLegal?.name).toBe(OLD_LEGAL.name)
  }, 30_000)

  it('after the account is lost, a poll must tell the open phone', async () => {
    const { version } = await full()
    await lose()
    // A fresh phone is told: the state itself has changed.
    expect((await full()).ordering.paying).not.toBe('on')
    const poll = await read(version)
    expect(poll.unchanged, 'the phone keeps showing Pay until the table version moves').toBe(false)
  }, 30_000)

  it('after the legal details change, a poll must tell the open phone', async () => {
    const { version } = await full()
    await setLegal()
    expect((await full()).ordering.payingLegal?.name).toBe('Another Company OOD')
    const poll = await read(version)
    expect(poll.unchanged, 'the phone keeps the old legal name').toBe(false)
  }, 30_000)

  it('after telling it once, the next poll is unchanged again', async () => {
    const { version } = await full()
    await setLegal()
    const told = await read(version)
    if (told.unchanged) throw new Error('unchanged')
    expect(told.version).toBeGreaterThan(version)
    expect(told.ordering.payingLegal?.name).toBe('Another Company OOD')
    expect((await read(told.version)).unchanged).toBe(true)
  }, 30_000)

  const setPayFirst = async (change: Record<string, unknown>) => {
    const { result } = await applyService(
      world.app,
      { type: 'pay_first.set', change } as never,
      {
        tenantId: world.tenantId,
        venueId: world.venueId,
        origin: 'staff',
        actor: { kind: 'user', userId: owner, sessionId: `s-${owner}` },
        jobId: `pay-first-${randomUUID()}`,
        signedInAt: new Date(),
      } as never,
    )
    expect(result.status, JSON.stringify(result)).toBe('accepted')
  }

  it('after pay first is turned on, a poll must tell the open phone', async () => {
    await setPayFirst({ applies: false })
    const { version, ordering } = await full()
    expect(ordering.payFirst).toBe('off')
    await setPayFirst({ applies: true })
    expect((await full()).ordering.payFirst).toBe('on')
    const poll = await read(version)
    expect(poll.unchanged, 'the phone keeps the old pay-first answer').toBe(false)
    await setPayFirst({ applies: false })
  }, 30_000)

  it("after a table's own pay-first choice, a poll must tell the open phone", async () => {
    await setPayFirst({ applies: false })
    const { version } = await full()
    await setPayFirst({ table: tableId, value: true })
    expect((await full()).ordering.payFirst).toBe('on')
    expect((await read(version)).unchanged, 'the phone keeps the old answer').toBe(false)
    await setPayFirst({ table: tableId, value: null })
  }, 30_000)

  it('saving the pay-first choice it already has leaves every phone unchanged', async () => {
    await setPayFirst({ applies: false })
    const { version } = await full()
    await setPayFirst({ applies: false })
    expect((await read(version)).unchanged).toBe(true)
  }, 30_000)

  it('a change a phone is not told about leaves every phone unchanged', async () => {
    const { version } = await full()
    const worker = () => ({
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin: 'worker' as const,
      actor: { kind: 'system' as const },
      jobId: `breaker-${randomUUID()}`,
    })
    const { result } = await applyService(
      world.app,
      { type: 'paying.breaker', action: 'progress', breaker: { good: 1 } } as never,
      worker(),
    )
    expect(result.status, JSON.stringify(result)).toBe('accepted')
    // The same legal details again: a save that moves nothing.
    await setLegal()
    const { version: afterSave } = await full()
    await setLegal()
    expect((await full()).version).toBe(afterSave)
    expect(afterSave).toBe(version + 1)
  }, 30_000)

  it("the breaker's pause and its lift both reach the phone", async () => {
    const { version } = await full()
    const breaker = async (action: 'pause' | 'lift') => {
      const { result } = await applyService(
        world.app,
        { type: 'paying.breaker', action, breaker: {} } as never,
        {
          tenantId: world.tenantId,
          venueId: world.venueId,
          origin: 'worker',
          actor: { kind: 'system' },
          jobId: `breaker-${randomUUID()}`,
        },
      )
      expect(result.status, JSON.stringify(result)).toBe('accepted')
    }
    await breaker('pause')
    const paused = await read(version)
    if (paused.unchanged) throw new Error('unchanged')
    expect(paused.ordering.paying).toBe('paused')
    await breaker('lift')
    const lifted = await read(paused.version)
    if (lifted.unchanged) throw new Error('unchanged')
    expect(lifted.ordering.paying).toBe('on')
  }, 30_000)

  it("a table with no open sitting: the guest's first item brings the new details", async () => {
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
      [tableId, 'staff_closed'],
    )
    const { version } = await full()
    await setLegal()
    // Nothing to raise: no bill and nothing to pay on this table until a sitting opens.
    expect((await read(version)).unchanged).toBe(true)
    await world.openSitting(tableId)
    await record()
    const opened = await read(version)
    if (opened.unchanged) throw new Error('unchanged')
    expect(opened.ordering.payingLegal?.name).toBe('Another Company OOD')
  }, 30_000)

  it('control: the engine refuses a Pay on a lost account, whatever the phone shows', async () => {
    await lose()
    const answer = await pay(randomUUID())
    if (!answer.ok) throw new Error(answer.code)
    expect(answer.result).toMatchObject({ status: 'rejected', code: 'paying_paused' })
  }, 30_000)
})
