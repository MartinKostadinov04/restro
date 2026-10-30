// RR-26 on Postgres, as restro_app, with a published menu and D122's real Send limits: a refused
// Send never spends the phone's Send (out of stock, a duplicate, first-time consent, a failed human
// check, a Send the POS sent back), two Sends that go out within 15 s still get the 429, and repeated
// failed human checks stop at their own limit, each one reaching nothing.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { apply } from '../apply/apply'
import { provisionMenu } from '../apply/provision'
import { publishMenu } from '../apply/publish'
import { setSoldOutTonight } from '../apply/sold-out'
import { hasDatabase } from '../apply/test-database'
import type { ChangeSet } from '../change-set'
import { sha256Hex } from '../hash'
import { type NodeId, newId } from '../ids'
import { LOCATION_CONSENT_VERSION } from '../location-check'
import { DEFAULT_ORDERING_SETTINGS } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import { forgetGuestCodes, type GuestActInput, guestAct, guestState } from './guest'
import { GUEST_LIMITS, GuestLimiter } from './guest-limits'

const PASS_KEY = 'guest-send-limits-key-'.padEnd(48, 'x')
const PHONE = 'phone-one-aaaaaaaaaaaaa'
const FRIEND = 'phone-two-bbbbbbbbbbbbb'
const SPOT = { lat: 42.6977, lng: 23.3219 }
const MANAGER = 'user:us_manager'

describe.skipIf(!hasDatabase)('the Send limits count Sends that go out (RR-26)', () => {
  let world: ServiceWorld
  let tableId: string
  let code: string
  let limiter: GuestLimiter
  let checks: string[]
  const beer = newId('nd')
  const gin = newId('nd')
  const cola = newId('nd')

  const line = (itemId: string, qty = 1) => ({ itemId, optionIds: [], qty, note: '' })

  /** The real limits of a Send, the others loose: a quick test would trip the code's 20 a second. */
  function realSendLimits(): GuestLimiter {
    const loose = Object.fromEntries(
      Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
    ) as unknown as typeof GUEST_LIMITS
    return new GuestLimiter({
      ...loose,
      sendGap: GUEST_LIMITS.sendGap,
      sends: GUEST_LIMITS.sends,
      payGap: GUEST_LIMITS.payGap,
      pays: GUEST_LIMITS.pays,
      humanFails: GUEST_LIMITS.humanFails,
    })
  }

  async function raw(
    command: Record<string, unknown>,
    more: Partial<Omit<GuestActInput, 'command'>> = {},
  ) {
    return guestAct(world.app, {
      code,
      command: { actionId: randomUUID(), ...command } as never,
      ageMs: 50,
      view: 'order',
      phone: PHONE,
      passKey: PASS_KEY,
      limiter,
      check: { humanToken: 'token' },
      humanCheck: async (_token, actionId) => {
        checks.push(actionId)
        return 'passed'
      },
      ...more,
    })
  }

  async function act(
    command: Record<string, unknown>,
    more: Partial<Omit<GuestActInput, 'command'>> = {},
  ) {
    const answer = await raw(command, more)
    if (!answer.ok) throw new Error(`refused before the table: ${answer.code}`)
    return answer
  }

  const add = (itemId: string, qty = 1) => act({ type: 'order.add', ...line(itemId, qty) })
  const sendOf = (...lines: ReturnType<typeof line>[]) => ({ type: 'order.send', lines })

  async function sentOrderCount(): Promise<number> {
    const { rows } = await world.owner.query<{ n: number }>(
      'select count(*)::int as n from restro.sent_orders where table_id = $1',
      [tableId],
    )
    return rows[0]?.n ?? 0
  }

  async function setOrdering(locationCheck: boolean): Promise<void> {
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck, spot: SPOT })],
    )
  }

  /** The worker's steps for the table's oldest waiting sent order, up to the POS's "ran out". */
  async function posSaysItRanOut(itemId: string): Promise<void> {
    const worker = {
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin: 'worker',
      actor: { kind: 'system' },
      jobId: `jb-${randomUUID()}`,
    } as const
    const step = async (command: Record<string, unknown>) =>
      (await applyService(world.app, command, worker)).result
    const started = await step({ type: 'sent_order.start', tableId })
    expect(started).toMatchObject({ status: 'accepted', details: { state: 'taken' } })
    const { sentOrderId, fence } = started.details as { sentOrderId: string; fence: number }
    const move = { type: 'sent_order.transition', sentOrderId, fence }
    expect(await step({ ...move, to: 'sending' })).toMatchObject({ status: 'accepted' })
    expect(
      await step({ ...move, to: 'not_sent', reason: 'item_unavailable', outOfStock: [itemId] }),
    ).toMatchObject({ status: 'accepted', details: { state: 'not_sent' } })
  }

  beforeAll(async () => {
    world = await openServiceWorld('guest-send-limits')
    tableId = world.tables[0] as string
    const menu = await provisionMenu(world.app, world.tenantId, world.venueId)
    const section = newId('nd')
    const integration = newId('in')
    await world.owner.query(
      `insert into restro.integrations (id, tenant_id, kind, host) values ($1, $2, 'sim', $3)`,
      [integration, world.tenantId, `${integration.slice(3, 15).toLowerCase()}.limits.test`],
    )
    const changeSet = (source: string, actor: string, ops: unknown[]) =>
      ({
        id: newId('cs'),
        source,
        jobId: newId('jb'),
        actor,
        observedAt: new Date().toISOString(),
        ops,
      }) as unknown as ChangeSet
    const run = async (changes: ChangeSet) => {
      expect((await apply(world.app, world.tenantId, changes)).rejected).toEqual([])
    }
    await run(
      changeSet('manual', MANAGER, [
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: menu.id },
          status: 'active',
          sortKey: 'end',
        },
        {
          op: 'setField',
          node: { id: section },
          fieldKey: 'title',
          layer: 'manual',
          scope: 'master',
          value: { bg_BG: 'Бар', en_US: 'Bar' },
        },
      ]),
    )
    // Only an item the POS prices and sells is orderable (the guest's Send takes nothing else).
    for (const [index, id] of [beer, gin, cola].entries()) {
      const record = newId('sr')
      const external = `ext-${index}`
      await world.owner.query(
        `insert into restro.source_records
           (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw, payload)
         values ($1, $2, $3, 'article', $4, 'master', $5, '{}', '{}'::jsonb)`,
        [record, world.tenantId, integration, external, sha256Hex(record)],
      )
      const link = { integration, externalType: 'article', externalId: external }
      const till = (fieldKey: string, value: unknown, scope = 'master') => ({
        op: 'setField',
        node: { link },
        fieldKey,
        layer: 'till',
        scope,
        value,
        sourceRecordId: record,
        mappingVersion: 1,
      })
      const here = `venue:${world.venueId}`
      await run(
        changeSet(`till:${integration}`, `integration:${integration}`, [
          { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
          { op: 'linkSource', node: { id }, link },
          till('name', { bg_BG: `Напитка ${index}`, en_US: `Drink ${index}` }),
          till('price', { amount_minor: 500 + index * 100, currency: 'EUR' }, here),
          till('for_sale', true, here),
          till('visible', true),
          till('allergens', []),
        ]),
      )
      await run(
        changeSet('manual', MANAGER, [
          { op: 'setPlacement', item: { id }, section: { id: section }, sortKey: 'end' },
        ]),
      )
    }
    await publishMenu(world.app, world.tenantId, {
      menuId: menu.id,
      venueId: world.venueId,
      reason: 'manual',
      actor: MANAGER,
    })
    await world.owner.query('update restro.venues set live_menu_id = $2 where id = $1', [
      world.venueId,
      menu.id,
    ])
    await world.declareCapabilities({ notesReachTicket: true, firstItemsOpenBill: true })
    await setSoldOutTonight(world.app, world.tenantId, {
      venueId: world.venueId,
      itemIds: [cola as NodeId],
      soldOut: true,
      actor: MANAGER,
    })
  })

  afterAll(async () => {
    await world?.close()
  })

  beforeEach(async () => {
    forgetGuestCodes()
    limiter = realSendLimits()
    checks = []
    await setOrdering(false)
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
      [tableId, 'staff_closed'],
    )
    await world.owner.query('delete from restro.sent_orders where table_id = $1', [tableId])
    await world.openSitting(tableId)
    code = `code${randomUUID().replaceAll('-', '')}`
    await world.owner.query(
      'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
      [tableId, code, await hashTableCode(code)],
    )
  })

  it('still gets the 429 on two Sends that go out within 15 s, and the friend at the table doesn’t', async () => {
    await add(beer)
    await add(gin)
    await add(cola, 2)
    expect((await act(sendOf(line(beer)))).result.status).toBe('accepted')
    const second = await raw(sendOf(line(gin)))
    expect(second).toMatchObject({ ok: false, code: 'rate_limited' })
    if (second.ok || second.code !== 'rate_limited') throw new Error('expected the 429')
    expect(second.retryAfter).toBeGreaterThan(0)
    expect(second.retryAfter).toBeLessThanOrEqual(15)
    expect(await sentOrderCount()).toBe(1)
    const friend = await act(sendOf(line(gin)), { phone: FRIEND })
    expect(friend.result.status).toBe('accepted')
  })

  it('lets exactly one of two Sends at the same moment through: the limit is taken before any wait', async () => {
    await add(beer)
    await add(gin)
    const answers = await Promise.all([raw(sendOf(line(beer))), raw(sendOf(line(gin)))])
    const went = answers.filter((one) => one.ok && one.result.status === 'accepted')
    const limited = answers.filter((one) => !one.ok && one.code === 'rate_limited')
    expect(went).toHaveLength(1)
    expect(limited).toHaveLength(1)
    expect(await sentOrderCount()).toBe(1)
  })

  it('sends "the other one" straight after a refusal for a sold-out item', async () => {
    await add(beer)
    await add(cola)
    const refused = await act(sendOf(line(beer), line(cola)))
    expect(refused.result).toMatchObject({ status: 'rejected', code: 'item_unavailable' })
    expect((await act(sendOf(line(beer)))).result.status).toBe('accepted')
  })

  it('sends "Send another" straight after the duplicate question', async () => {
    await add(beer)
    const first = await act(sendOf(line(beer)), { phone: FRIEND })
    expect(first.result.status).toBe('accepted')
    await add(beer)
    const asked = await act(sendOf(line(beer)))
    expect(asked.result).toMatchObject({ status: 'rejected', code: 'duplicate_order' })
    const again = await act({
      ...sendOf(line(beer)),
      confirmDuplicateOf: asked.result.subjectId,
    })
    expect(again.result.status).toBe('accepted')
  })

  it('sends right after the first-time consent, and a failed location still counts as a try', async () => {
    await setOrdering(true)
    const send = sendOf(line(beer))
    expect((await act(send)).result.code).toBe('location_needed')
    expect(checks).toEqual([])
    const elsewhere = { lat: 42.65, lng: 23.38, accuracyM: 20 }
    const consent = { consentVersion: LOCATION_CONSENT_VERSION }
    const away = await act(send, { check: { location: elsewhere, ...consent, humanToken: 't' } })
    expect(away.result.code).toBe('location_failed')
    const here = { location: { ...SPOT, accuracyM: 20 }, ...consent, humanToken: 't' }
    const located = await act({ type: 'order.add', ...line(beer) }, { check: here })
    expect(located.result.status).toBe('accepted')
    expect(located.pass).not.toBeNull()
    const sent = await act(send, { pass: located.pass as string })
    expect(sent.result.status).toBe('accepted')
  })

  it('sends right after a failed human check, and that Send then holds the 15 s', async () => {
    await add(beer)
    await add(gin)
    const failed = await act(sendOf(line(beer)), { humanCheck: async () => 'failed' })
    expect(failed.result).toMatchObject({ status: 'rejected', code: 'human_check' })
    expect((await act(sendOf(line(beer)))).result.status).toBe('accepted')
    expect(await raw(sendOf(line(gin)))).toMatchObject({ ok: false, code: 'rate_limited' })
  })

  it('gives a refused Send’s Pay back too: a pay-first part counts only when it goes out', async () => {
    await add(beer)
    const payFirst = { lines: [line(beer)], tipMinor: 0 }
    const failed = await act({ ...sendOf(), payFirst }, { humanCheck: async () => 'failed' })
    expect(failed.result.code).toBe('human_check')
    const subject = `${await hashTableCode(code)}:${PHONE}`
    expect(limiter.take(subject, ['sendGap', 'sends', 'payGap', 'pays'], Date.now()).ok).toBe(true)
  })

  it('never lets refused Sends use up the 10 in 10 minutes', async () => {
    await add(beer)
    await add(cola)
    for (let n = 0; n < 12; n += 1) {
      const refused = await act(sendOf(line(beer), line(cola)))
      expect(refused.result.code).toBe('item_unavailable')
    }
    expect((await act(sendOf(line(beer)))).result.status).toBe('accepted')
  })

  it('frees the phone at once when the POS sends its Send back Not sent, but not while it may land', async () => {
    await add(beer)
    await add(gin)
    expect((await act(sendOf(line(beer), line(gin)))).result.status).toBe('accepted')
    // Still waiting to go: it may yet land, so the 15 s holds.
    expect(await raw(sendOf(line(gin)))).toMatchObject({ ok: false, code: 'rate_limited' })
    await posSaysItRanOut(beer)
    // The lines came back: "Send the other one" goes with one more tap.
    const rest = await act(sendOf(line(gin)))
    expect(rest.result.status).toBe('accepted')
    // That one went out, so the next one waits.
    await add(beer)
    expect(await raw(sendOf(line(beer)))).toMatchObject({ ok: false, code: 'rate_limited' })
  })

  it('stops repeated failed human checks at 10 in 10 minutes, the last ones without a siteverify, and none reaches the table', async () => {
    await add(beer)
    let failedChecks = 0
    const humanCheck = async () => {
      failedChecks += 1
      return 'failed' as const
    }
    for (let n = 0; n < GUEST_LIMITS.humanFails.max; n += 1) {
      const failed = await act(sendOf(line(beer)), { humanCheck })
      expect(failed.result.code).toBe('human_check')
    }
    expect(failedChecks).toBe(10)
    expect(await raw(sendOf(line(beer)), { humanCheck })).toMatchObject({
      ok: false,
      code: 'rate_limited',
    })
    // The eleventh cost no siteverify, and nothing reached the engine or the POS's queue.
    expect(failedChecks).toBe(10)
    expect(await sentOrderCount()).toBe(0)
    // The next phone value starts again, as it did before this fix: the value is the page's own, so
    // what bounds a script that changes it is the code's 20 requests a second, and that a failed
    // check reaches nothing.
    const other = await act(sendOf(line(beer)), { humanCheck, phone: FRIEND })
    expect(other.result.code).toBe('human_check')
    expect(await sentOrderCount()).toBe(0)
  })

  it('does not count a passed human check as a failure', async () => {
    await add(beer)
    await add(cola)
    for (let n = 0; n < 12; n += 1) {
      const refused = await act(sendOf(line(beer), line(cola)))
      expect(refused.result.code).toBe('item_unavailable')
    }
    expect(checks).toHaveLength(12)
    expect(
      limiter.take(`${await hashTableCode(code)}:${PHONE}`, ['humanFails'], Date.now()).ok,
    ).toBe(true)
  })

  it('gives "Show this to your waiter" the time on the venue’s clock, never UTC or the phone’s', async () => {
    await add(beer)
    expect((await act(sendOf(line(beer)))).result.status).toBe('accepted')
    const read = await guestState(world.app, { code, view: 'order', limiter })
    if (!read.ok || read.answer.unchanged) throw new Error('expected a full state')
    const { rows } = await world.owner.query<{ created_at: Date; timezone: string }>(
      `select s.created_at, v.timezone from restro.sent_orders s
         join restro.venues v on v.id = s.venue_id where s.table_id = $1`,
      [tableId],
    )
    const [row] = rows
    if (row === undefined) throw new Error('expected the sent order')
    expect(row.timezone).toBe('Europe/Sofia')
    const inZone = (timeZone: string) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(row.created_at)
    expect(read.answer.sentOrders[0]?.sentClock).toBe(inZone('Europe/Sofia'))
    expect(inZone('Europe/Sofia')).not.toBe(inZone('UTC'))
  })
})
