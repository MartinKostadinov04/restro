// DA-B2 (designer audit, money), fixed by #293: a refused pay-first part no longer refuses the
// Send's on-the-bill lines (DA-1, Martin 11-01). A Send splits into its on-the-bill round and a
// `pay_first` payment with its own waiting sent order; where the pay-first part cannot be taken —
// below the venue's smallest card payment, or with the table's open payments already spent — the
// bill lines still go, the pay-first lines stay free on the order, and the answer carries the pay
// part's own refusal (`details.payFirstRefused`) for the face to word. A Send of pay-first lines
// alone has nothing to accept and is refused as before. Built on pay-first-route.test.ts's harness,
// on a real Postgres as the restro_app role; skipped without a database.
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { DEFAULT_ORDERING_SETTINGS } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import type { ServiceContext } from './context'
import type { SendMenu } from './send-menu'

describe.skipIf(!hasDatabase)('DA-B2: a Send with pay-first lines (as the restro_app role)', () => {
  let world: ServiceWorld
  let tableId: string
  let paymentTableId: string
  let sittingId: string
  let codeHash: string
  const beer = newId('nd')
  const gin = newId('nd')
  const vodka = newId('nd')

  const menu: SendMenu = {
    currency: 'EUR',
    items: new Map([
      [
        beer,
        { priceMinor: 450, orderable: true, soldOut: false, name: 'Beer', options: new Map() },
      ],
      [
        gin,
        {
          priceMinor: 700,
          orderable: true,
          soldOut: false,
          name: 'Gin tonic',
          options: new Map(),
          paymentMode: 'pay_first',
        },
      ],
      [
        vodka,
        {
          priceMinor: 600,
          orderable: true,
          soldOut: false,
          name: 'Vodka',
          options: new Map(),
          paymentMode: 'pay_first',
        },
      ],
    ]),
  }

  const guest = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'guest',
    actor: { kind: 'guest' },
    jobId: `guest-${randomUUID()}`,
    tableCodeHash: codeHash,
    sittingId,
    consentVersion: 'v1',
  })

  async function add(itemId: string, qty: number) {
    const { result } = await applyService(
      world.app,
      {
        type: 'order.add',
        tableId,
        actionId: randomUUID(),
        ageMs: 50,
        itemId,
        optionIds: [],
        qty,
        note: '',
      },
      guest(),
    )
    expect(result.status).toBe('accepted')
  }

  const line = (itemId: string, qty: number) => ({ itemId, optionIds: [], qty, note: '' })
  /** A fresh handle's hash, as the guest API makes one for each Send that pays. */
  const handleHash = () => createHash('sha256').update(randomUUID()).digest('hex')

  /** A Send of `lines` on the bill and `payFirst` paid first. */
  const send = (
    lines: ReturnType<typeof line>[],
    payFirst: ReturnType<typeof line>[] | null,
    tip: Record<string, unknown> = { kind: 'none' },
  ) =>
    applyService(
      world.app,
      {
        type: 'order.send',
        tableId,
        actionId: randomUUID(),
        ageMs: 50,
        lines,
        ...(payFirst === null
          ? {}
          : { payFirst: { lines: payFirst, tip, handleHash: handleHash() } }),
      },
      guest(),
      { sendMenu: menu },
    )

  /** The order's live lines: item, quantity and the payment holding it. */
  async function orderLines() {
    const { rows } = await world.owner.query(
      'select lines from restro.table_orders where table_id = $1 and sitting_id = $2',
      [tableId, sittingId],
    )
    const lines = (rows[0]?.lines ?? []) as {
      itemId: string
      qty: number
      heldBy: string | null
      removedAt: number | null
    }[]
    return lines
      .filter((one) => one.removedAt === null)
      .map((one) => [
        one.itemId === gin ? 'gin' : one.itemId === vodka ? 'vodka' : 'beer',
        one.qty,
        one.heldBy,
      ])
  }

  beforeAll(async () => {
    world = await openServiceWorld('da-b2-money')
    tableId = world.tables[0] as string
    paymentTableId = world.tables[3] as string
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [
        world.venueId,
        JSON.stringify({
          ...DEFAULT_ORDERING_SETTINGS,
          locationCheck: false,
          pacePer15Minutes: null,
        }),
      ],
    )
    await world.declareCapabilities({ notesReachTicket: true, firstItemsOpenBill: true })
    // The venue's legal details are part of what turns paying on (#198).
    await world.owner.query(
      `update restro.venues set settings = settings || '{"legalDetails":{"name":"Club EOOD","eik":"123456789","address":"Sofia, 1 Vitosha Blvd","privacyUrl":"https://club.example/privacy"}}'::jsonb where id = $1`,
      [world.venueId],
    )
    await world.owner.query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, checks, connected_at, source, actor, job_id)
       values ($1, $2, 'sim-pay', 'acct_payfirst1', 'connected', '{"cardPayments":true,"ticks":{"cardTypeInTill":{"at":"2026-10-27T00:00:00Z","by":"system"},"receiptEmailsOff":{"at":"2026-10-27T00:00:00Z","by":"system"}}}'::jsonb, now(), 'restro', 'system', 'test-seed')`,
      [world.tenantId, world.venueId],
    )
    await world.owner.query('update restro.tables set is_payment_table = true where id = $1', [
      paymentTableId,
    ])
    const code = `code${randomUUID().replaceAll('-', '')}`
    codeHash = await hashTableCode(code)
    await world.owner.query(
      'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
      [tableId, code, codeHash],
    )
  })

  afterAll(async () => {
    await world?.close()
  })

  beforeEach(async () => {
    await world.declareCapabilities({ notesReachTicket: true, firstItemsOpenBill: true })
    await world.owner.query(
      `update restro.payment_accounts set state = 'connected' where venue_id = $1`,
      [world.venueId],
    )
    await world.owner.query(
      `update restro.payments set state = 'released', reason = 'test', settled_at = now(),
          payment_table_id = null
        where venue_id = $1 and settled_at is null`,
      [world.venueId],
    )
    await world.owner.query(
      `update restro.sent_orders set state = 'not_sent', reason = 'test_reset', settled_at = now()
        where table_id = $1 and state in ('waiting', 'sending', 'checking', 'unconfirmed')`,
      [tableId],
    )
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
      [tableId, 'staff_closed'],
    )
    sittingId = await world.openSitting(tableId)
  })

  const setMinCard = (minor: number | null) =>
    world.owner.query(
      minor === null
        ? `update restro.venues set settings = settings - 'paying' where id = $1`
        : `update restro.venues set settings = jsonb_set(settings, '{paying}', $2::jsonb) where id = $1`,
      minor === null ? [world.venueId] : [world.venueId, JSON.stringify({ minCardMinor: minor })],
    )
  const sentOrdersOfSitting = async () =>
    (
      await world.owner.query<{ kind: string }>(
        'select kind from restro.sent_orders where sitting_id = $1 order by kind',
        [sittingId],
      )
    ).rows.map((row) => row.kind)

  it('below the smallest card payment, the beer for the bill still goes and the gin stays (D117, D127)', async () => {
    await setMinCard(1000) // 10.00: the gin (7.00) is below it
    try {
      await add(beer, 1)
      await add(gin, 1)
      // What Editorial sends on "Send and pay": the bill lines and every pay-first line. The face
      // greys the pay part below the minimum, and the server must not hold the beer back either.
      const { result } = await send([line(beer, 1)], [line(gin, 1)])
      expect(result).toMatchObject({
        status: 'accepted',
        details: { payFirstRefused: 'below_minimum' },
      })
      // The beer went on the bill; no pay-first round was made and no payment started.
      expect(await sentOrdersOfSitting()).toEqual(['on_bill'])
      expect(result.status === 'accepted' ? result.details.paymentId : 'none').toBeUndefined()
      // The gin stays on the order, free for a later Send: nothing holds it.
      expect(await orderLines()).toEqual([['gin', 1, null]])
    } finally {
      await setMinCard(null)
    }
  })

  it('below the minimum with nothing for the bill, the Send is refused as before', async () => {
    await setMinCard(1000)
    try {
      await add(gin, 1)
      const { result } = await send([], [line(gin, 1)])
      expect(result).toMatchObject({ status: 'refused', code: 'below_minimum' })
      expect(await sentOrdersOfSitting()).toEqual([])
      expect(await orderLines()).toEqual([['gin', 1, null]])
    } finally {
      await setMinCard(null)
    }
  })

  it("with three payments open at the table, a friend's beer still goes as rate_limited (D127)", async () => {
    await add(gin, 1)
    expect((await send([], [line(gin, 1)])).result).toMatchObject({ status: 'accepted' })
    await add(vodka, 1)
    expect((await send([], [line(vodka, 1)])).result).toMatchObject({ status: 'accepted' })
    await add(gin, 1)
    expect((await send([], [line(gin, 1)])).result).toMatchObject({ status: 'accepted' })
    // Three open pay-first payments: the table's limit. A friend now orders a beer and a vodka.
    await add(beer, 1)
    await add(vodka, 1)
    const { result } = await send([line(beer, 1)], [line(vodka, 1)])
    expect(result).toMatchObject({
      status: 'accepted',
      details: { payFirstRefused: 'rate_limited' },
    })
    // The beer went; the fourth payment was not made and the vodka waits in the bag.
    expect(await sentOrdersOfSitting()).toEqual(['on_bill', 'pay_first', 'pay_first', 'pay_first'])
    const live = await orderLines()
    expect(live.filter((one) => one[0] === 'beer')).toEqual([])
    expect(live.filter((one) => one[0] === 'vodka' && one[2] === null)).toEqual([
      ['vodka', 1, null],
    ])
  })
})
