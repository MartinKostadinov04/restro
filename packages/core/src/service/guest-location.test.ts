// Integration tests of the location check, the location pass and the per-phone limits (#76) on a
// real Postgres, as the restro_app role: a phone without a pass sees no order and no bill and can't
// add; a position clearly elsewhere, too coarse, or at a venue with no spot fails closed; a passed
// check hands out a pass that holds until its sitting ends or the code is re-issued (and the engine
// refuses a pass whose sitting ended under it); remove and Undo need none; the phone and code
// limits; Turnstile at Send, failing closed and open only when siteverify is down; a Send's repeat
// is looked up before siteverify. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { LOCATION_CONSENT_VERSION } from '../location-check'
import { DEFAULT_ORDERING_SETTINGS, type OrderingSettings } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import {
  forgetGuestCodes,
  type GuardEvent,
  type GuestActInput,
  type GuestTableState,
  guestAct,
  guestState,
  type HumanCheck,
} from './guest'
import { GUEST_LIMITS, type GuestLimit, GuestLimiter, type GuestLimitName } from './guest-limits'

const PASS_KEY = 'guest-location-test-key-'.padEnd(48, 'x')
const SPOT = { lat: 42.6977, lng: 23.3219 }
const AT_THE_BAR = { ...SPOT, accuracyM: 20 }
const ACROSS_TOWN = { lat: 42.65, lng: 23.38, accuracyM: 20 }
const COARSE = { ...SPOT, accuracyM: 3_000 }

/** Every limit loose but those a test names (the code's 20 a second would trip quick tests). */
function limits(over: Partial<Record<GuestLimitName, GuestLimit>> = {}): GuestLimiter {
  const loose = Object.fromEntries(
    Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
  ) as Record<GuestLimitName, GuestLimit>
  return new GuestLimiter({ ...loose, ...over })
}

describe.skipIf(!hasDatabase)('the location check and the guest limits (as restro_app)', () => {
  let world: ServiceWorld
  let tableId: string
  let code: string
  let limiter: GuestLimiter
  let guards: GuardEvent[]
  const item = newId('nd')

  async function setOrdering(over: Partial<OrderingSettings>): Promise<void> {
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [
        world.venueId,
        JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: true, spot: SPOT, ...over }),
      ],
    )
  }

  /** Re-issues the table's code as `table.reissue` does: a new code, the generation raised. */
  async function reissue(): Promise<string> {
    const fresh = `code${randomUUID().replaceAll('-', '')}`
    await world.owner.query(
      `update restro.tables set qr_token = $2, qr_code_hash = $3, code_generation = code_generation + 1
        where id = $1`,
      [tableId, fresh, await hashTableCode(fresh)],
    )
    return fresh
  }

  async function endSitting(): Promise<void> {
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
      [tableId, 'staff_closed'],
    )
  }

  async function state(pass?: string, view: 'order' | 'bill' = 'order'): Promise<GuestTableState> {
    const read = await guestState(world.app, {
      code,
      view,
      passKey: PASS_KEY,
      limiter,
      ...(pass === undefined ? {} : { pass }),
    })
    if (!read.ok || read.answer.unchanged) throw new Error('expected a full state')
    return read.answer
  }

  async function act(
    command: Record<string, unknown>,
    more: Partial<Omit<GuestActInput, 'command'>> = {},
  ) {
    const answer = await guestAct(world.app, {
      code,
      command: { actionId: randomUUID(), ...command } as never,
      ageMs: 50,
      view: 'order',
      phone: 'phone-one-aaaaaaaaaaaaa',
      passKey: PASS_KEY,
      limiter,
      onGuard: (event) => guards.push(event),
      ...more,
    })
    if (!answer.ok) throw new Error(`refused before the table: ${answer.code}`)
    return answer
  }

  const add = { type: 'order.add', itemId: item, optionIds: [], qty: 1, note: '' }
  const located = { location: AT_THE_BAR, consentVersion: LOCATION_CONSENT_VERSION }

  /** Adds a line from the bar and returns the pass and the line. */
  async function locatedAdd(): Promise<{ pass: string; lineId: string }> {
    const answer = await act(add, { check: located })
    expect(answer.result.status).toBe('accepted')
    expect(answer.pass).not.toBeNull()
    return { pass: answer.pass as string, lineId: answer.result.subjectId as string }
  }

  beforeAll(async () => {
    world = await openServiceWorld('guest-location')
    tableId = world.tables[0] as string
  })

  afterAll(async () => {
    await world?.close()
  })

  beforeEach(async () => {
    forgetGuestCodes()
    limiter = limits()
    guards = []
    await setOrdering({})
    await endSitting()
    await world.openSitting(tableId)
    code = await reissue()
  })

  it('shows a phone without a pass the table but not its order, sent orders or bill', async () => {
    const read = await state()
    expect(read.location).toMatchObject({ state: 'needed', passSeconds: null, venueName: 'Club' })
    expect(read.location.dayEndsInSeconds).toBeGreaterThan(0)
    expect(read).toMatchObject({ order: null, sentOrders: [], bill: null })
    // A pass sealed under another key holds nothing.
    const { pass } = await locatedAdd()
    const other = await guestState(world.app, {
      code,
      view: 'order',
      pass,
      passKey: `${PASS_KEY}-other`,
      limiter,
    })
    expect(other).toMatchObject({
      ok: true,
      answer: { location: { state: 'needed' }, order: null },
    })
  })

  it('asks for the location before an addition, and adds nothing until it has one', async () => {
    expect((await act(add)).result).toMatchObject({ status: 'rejected', code: 'location_needed' })
    // A position under consent to another text is no consent.
    const old = { location: AT_THE_BAR, consentVersion: 'v0' }
    expect((await act(add, { check: old })).result.code).toBe('location_needed')
    const { pass } = await locatedAdd()
    expect((await state(pass)).order?.lines).toHaveLength(1)
  })

  it('fails a phone clearly elsewhere, too coarse, or at a venue with no spot, and counts it', async () => {
    for (const location of [ACROSS_TOWN, COARSE]) {
      const answer = await act(add, { check: { ...located, location } })
      expect(answer).toMatchObject({
        result: { status: 'rejected', code: 'location_failed' },
        pass: null,
      })
    }
    await setOrdering({ spot: null })
    expect((await act(add, { check: located })).result.code).toBe('location_failed')
    expect(guards).toEqual(
      Array.from({ length: 3 }, () => ({
        kind: 'location_failed',
        venueId: world.venueId,
        tableId,
      })),
    )
  })

  it('hands out a pass that lets the phone see and change the order, within the pass time', async () => {
    const { pass, lineId } = await locatedAdd()
    const read = await state(pass)
    expect(read.location.state).toBe('held')
    expect(read.location.passSeconds).toBeGreaterThan(0)
    expect(read.location.passSeconds).toBeLessThanOrEqual(120 * 60)
    expect(read.order?.lines).toMatchObject([{ id: lineId, qty: 1 }])
    const changed = await act({ type: 'order.change', lineId, delta: 1 }, { pass })
    expect(changed).toMatchObject({ result: { status: 'accepted' }, pass: null })
    expect(changed.state?.order?.lines).toMatchObject([{ id: lineId, qty: 2 }])
  })

  it('lets a phone remove a line and undo it without a pass', async () => {
    const { lineId } = await locatedAdd()
    expect((await act({ type: 'order.remove', lineId })).result.status).toBe('accepted')
    const undone = await act({ type: 'order.undo', lineId })
    expect(undone.result.status).toBe('accepted')
    // Its answer still hides the order from a phone without a pass.
    expect(undone.state).toMatchObject({ location: { state: 'needed' }, order: null })
  })

  it('kills the pass when the sitting ends: it never outlives its sitting', async () => {
    const { pass } = await locatedAdd()
    await endSitting()
    await world.openSitting(tableId)
    const read = await state(pass)
    expect(read).toMatchObject({ location: { state: 'needed' }, order: null })
    expect((await act(add, { pass })).result.code).toBe('location_needed')
  })

  it('kills the pass when the code is re-issued', async () => {
    const { pass } = await locatedAdd()
    code = await reissue()
    expect((await state(pass)).location.state).toBe('needed')
    expect((await act(add, { pass })).result.code).toBe('location_needed')
  })

  it('has the engine refuse a located command whose sitting ended under it', async () => {
    const old = await world.owner.query<{ id: string }>(
      'select id from restro.sittings where table_id = $1 and ended_at is null',
      [tableId],
    )
    const sittingId = old.rows[0]?.id as string
    await endSitting()
    await world.openSitting(tableId)
    const { result } = await applyService(
      world.app,
      { ...add, actionId: randomUUID(), tableId, ageMs: 10 },
      {
        tenantId: world.tenantId,
        venueId: world.venueId,
        origin: 'guest',
        actor: { kind: 'guest' },
        jobId: 'guest-location-test',
        tableCodeHash: await hashTableCode(code),
        sittingId,
        consentVersion: LOCATION_CONSENT_VERSION,
      },
    )
    expect(result).toMatchObject({ status: 'refused', code: 'location_needed' })
  })

  it('answers "Allow location" with a pass and the whole state, or nothing where nobody checks', async () => {
    const checked = await act({ type: 'location.check' }, { check: located })
    expect(checked.result.status).toBe('accepted')
    expect(checked.pass).not.toBeNull()
    expect(checked.state).toMatchObject({ location: { state: 'held' }, order: { lines: [] } })
    await setOrdering({ locationCheck: false })
    const off = await act({ type: 'location.check' })
    expect(off).toMatchObject({ result: { status: 'accepted' }, pass: null })
  })

  it('needs no pass at a venue that does not check', async () => {
    await setOrdering({ locationCheck: false })
    expect((await act(add)).result.status).toBe('accepted')
    const read = await state()
    expect(read.location.state).toBe('off')
    expect(read.order?.lines).toHaveLength(1)
  })

  it('limits one phone to 30 additions a minute without blocking the friends at its table', async () => {
    limiter = limits({ additions: GUEST_LIMITS.additions })
    const { pass } = await locatedAdd()
    for (let n = 1; n < 30; n += 1) {
      expect((await act(add, { pass })).result.status).toBe('accepted')
    }
    const tripped = await guestAct(world.app, {
      code,
      command: { ...add, actionId: randomUUID() },
      ageMs: 50,
      view: 'order',
      phone: 'phone-one-aaaaaaaaaaaaa',
      pass,
      passKey: PASS_KEY,
      limiter,
      onGuard: (event) => guards.push(event),
    })
    expect(tripped).toMatchObject({ ok: false, code: 'rate_limited' })
    expect(guards).toEqual([{ kind: 'phone_limited', venueId: world.venueId, tableId }])
    const friend = await act(add, { pass, phone: 'phone-two-bbbbbbbbbbbbb' })
    expect(friend.result.status).toBe('accepted')
  })

  it('limits a phone to 5 location tries in 10 minutes', async () => {
    limiter = limits({ locationTries: GUEST_LIMITS.locationTries })
    const across = { ...located, location: ACROSS_TOWN }
    for (let n = 0; n < 5; n += 1) {
      expect((await act(add, { check: across })).result.code).toBe('location_failed')
    }
    await expect(act(add, { check: located })).rejects.toThrow(/rate_limited/)
  })

  it('limits each table code to 20 requests a second, reads and commands together', async () => {
    limiter = limits({ codeRequests: { max: 3, windowMs: 60_000 } })
    await state()
    await state()
    await act(add)
    await expect(state()).rejects.toThrow(/full state/)
    expect(guards).toEqual([])
    await expect(act(add)).rejects.toThrow(/rate_limited/)
    expect(guards).toEqual([{ kind: 'code_limited', venueId: world.venueId, tableId }])
  })

  describe('Turnstile at Send', () => {
    const send = { type: 'order.send', lines: [{ itemId: item, optionIds: [], qty: 1, note: '' }] }
    const checks: string[] = []
    const verdictOf =
      (verdict: Awaited<ReturnType<HumanCheck>>): HumanCheck =>
      async (_token, actionId) => {
        checks.push(actionId)
        return verdict
      }

    beforeEach(() => {
      checks.length = 0
    })

    it('fails closed without a token or a siteverify, and on a failed token', async () => {
      const { pass } = await locatedAdd()
      expect((await act(send, { pass })).result.code).toBe('human_check')
      const token = { check: { humanToken: 'XXXX.DUMMY.TOKEN.XXXX' } }
      expect((await act(send, { pass, ...token })).result.code).toBe('human_check')
      const failed = await act(send, { pass, ...token, humanCheck: verdictOf('failed') })
      expect(failed.result.code).toBe('human_check')
      expect(guards.map((event) => event.kind)).toEqual([
        'human_check_failed',
        'human_check_failed',
        'human_check_failed',
      ])
    })

    it('fails open only when siteverify is down, and counts it', async () => {
      const { pass } = await locatedAdd()
      const actionId = randomUUID()
      const open = await act(
        { ...send, actionId },
        { pass, check: { humanToken: 'token' }, humanCheck: verdictOf('unavailable') },
      )
      // Past every guard: the Send itself refuses it (this venue publishes no menu).
      expect(open.result).toMatchObject({ actionId, code: 'menu_unavailable' })
      expect(checks).toEqual([actionId])
      expect(guards.map((event) => event.kind)).toEqual(['human_check_open'])
    })

    it('needs the location before Turnstile, and looks a repeat up before siteverify', async () => {
      const humanCheck = verdictOf('passed')
      const token = { check: { humanToken: 'token' }, humanCheck }
      expect((await act(send, token)).result.code).toBe('location_needed')
      expect(checks).toEqual([])
      const { pass } = await locatedAdd()
      const sitting = await world.owner.query<{ id: string }>(
        'select id from restro.sittings where table_id = $1 and ended_at is null',
        [tableId],
      )
      const actionId = randomUUID()
      await world.addSentOrder({
        tableId,
        sittingId: sitting.rows[0]?.id as string,
        actionId,
        reference: 'K7Q2',
      })
      await act({ ...send, actionId }, { pass, ...token })
      expect(checks).toEqual([])
    })

    it('takes one Send per 15 s from a phone', async () => {
      limiter = limits({ sendGap: GUEST_LIMITS.sendGap, sends: GUEST_LIMITS.sends })
      const { pass } = await locatedAdd()
      const token = { check: { humanToken: 'token' }, humanCheck: verdictOf('passed') }
      expect((await act(send, { pass, ...token })).result.code).toBe('menu_unavailable')
      await expect(act(send, { pass, ...token })).rejects.toThrow(/rate_limited/)
      const friend = await act(send, { pass, ...token, phone: 'phone-two-bbbbbbbbbbbbb' })
      expect(friend.result.code).toBe('menu_unavailable')
    })
  })
})
