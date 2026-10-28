// Connecting a venue's payment account on the service write path (#109; D125 2.2–2.4) on a real
// Postgres, as the restro_app role: the permission "connect payments" (a role without it is refused,
// the organisation's owner and Restro's admin team hold it) and the sign-in of the last 15 minutes;
// the account's way from `connecting` to `connected` as the worker records the provider's readings;
// the four checks of D125 2.3, two of them the owner's own tick; lost access pausing paying at once
// with one alert for owners and managers that closes when paying is back; and a disconnect that is
// refused while a payment is not final. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { withTenant } from '@restro/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasDatabase } from '../apply/test-database'
import { readAccountChecks } from '../payment-connection'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { PAYMENT_ACCOUNT_LOST_KIND, ruleOf } from './alert-rules'
import type { ServiceActor, ServiceContext } from './context'
import { applyService, loadPayingConnection, type ServiceCommand } from './index'
import { DEFAULT_ROLE_PERMISSIONS, OPERATOR_PERMISSIONS, PERMISSIONS } from './permissions'

const ACCOUNT = 'acct_pay_connect_1'
const NEW_ACCOUNT = 'acct_pay_connect_2'

describe('the permission to connect payments', () => {
  it('is in the list, in the default Owner role and with Restro’s admin team; not for staff or a manager', () => {
    expect(PERMISSIONS).toContain('settings.connect_payments')
    expect(DEFAULT_ROLE_PERMISSIONS.owner).toContain('settings.connect_payments')
    expect(DEFAULT_ROLE_PERMISSIONS.manager).not.toContain('settings.connect_payments')
    expect(DEFAULT_ROLE_PERMISSIONS.staff).not.toContain('settings.connect_payments')
    expect(OPERATOR_PERMISSIONS).toContain('settings.connect_payments')
  })
})

describe.skipIf(!hasDatabase)('connecting a payment account (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let operatorId: string
  let holderId: string
  let withoutId: string

  beforeAll(async () => {
    world = await openServiceWorld('pay-connect')
    ownerId = await world.addUser('owner')
    operatorId = await world.addUser('member')
    await world.addOperator(operatorId)
    // A role that was given the permission, and a manager's role that was not.
    holderId = await world.addUser('member')
    await world.addStaff(['tables.open_close', 'settings.connect_payments'], holderId)
    withoutId = await world.addUser('member')
    await world.addStaff(['tables.open_close', 'money.follow_up', 'settings.alerts'], withoutId)
  })

  afterAll(async () => {
    await world?.close()
  })

  const user = (userId: string): ServiceActor => ({
    kind: 'user',
    userId,
    sessionId: `sess-${randomUUID()}`,
  })
  const context = (
    origin: ServiceContext['origin'],
    actor: ServiceActor,
    signedInAt: Date | null,
  ): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin,
    actor,
    jobId: `req-${randomUUID()}`,
    ...(signedInAt === null ? {} : { signedInAt }),
  })
  const run = async (
    command: ServiceCommand,
    actor: ServiceActor = user(ownerId),
    signedInAt: Date | null = new Date(),
  ) => (await applyService(world.app, command, context('staff', actor, signedInAt))).result
  const worker = async (command: ServiceCommand) =>
    (await applyService(world.app, command, context('worker', { kind: 'system' }, null))).result
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

  const account = async () => {
    const { rows } = await world.owner.query<{
      state: string
      account_ref: string | null
      account_name: string | null
      checks: Record<string, unknown>
      connected_at: Date | null
    }>(
      'select state, account_ref, account_name, checks, connected_at from restro.payment_accounts where venue_id = $1',
      [world.venueId],
    )
    return rows[0] ?? null
  }
  const reset = () =>
    world.owner.query('delete from restro.payment_accounts where venue_id = $1', [world.venueId])
  const openAlerts = async () => {
    const { rows } = await world.owner.query<{
      id: string
      permission: string | null
      audience: string
      details: Record<string, unknown>
      done_at: Date | null
    }>(
      `select id, permission, audience, details, done_at from restro.alerts
        where venue_id = $1 and kind = 'payment_account_lost' order by raised_at`,
      [world.venueId],
    )
    return rows
  }
  const connection = () =>
    withTenant(world.app, world.tenantId, (tx) => loadPayingConnection(tx, world.venueId))
  const markPaymentTable = (on: boolean) =>
    world.owner.query('update restro.tables set is_payment_table = $2 where id = $1', [
      world.tables[3],
      on,
    ])
  const tick = (check: 'cardTypeInTill' | 'receiptEmailsOff', done = true) =>
    run({ type: 'payment_account.tick', check, done })

  /** Connects, records the provider's account and the owner's return: `connected`. */
  async function connected(canTakePayments = true) {
    await reset()
    expect(await run({ type: 'payment_account.connect', providerKind: 'sim-pay' })).toMatchObject({
      status: 'accepted',
    })
    expect(
      await worker({ type: 'payment_account.started', accountRef: ACCOUNT, guestHost: null }),
    ).toMatchObject({ status: 'accepted' })
    expect(
      await worker({
        type: 'payment_account.observed',
        accountRef: ACCOUNT,
        canTakePayments,
        missing: canTakePayments ? [] : ['bank account'],
        afterReturn: true,
        guestHost: null,
        displayName: null,
      }),
    ).toMatchObject({ status: 'accepted', details: { state: 'connected' } })
  }

  describe('who may, and when', () => {
    it('refuses a role without the permission, even a manager’s with settings.alerts', async () => {
      await reset()
      for (const command of [
        { type: 'payment_account.connect', providerKind: 'sim-pay' },
        { type: 'payment_account.disconnect' },
        { type: 'payment_account.tick', check: 'cardTypeInTill', done: true },
        { type: 'payment_account.return' },
      ] as const) {
        expect(await run(command, user(withoutId))).toMatchObject({
          status: 'refused',
          code: 'permission_denied',
        })
      }
      expect(await account()).toBeNull()
    })

    it('lets the organisation’s owner, Restro’s admin team and a role given it connect', async () => {
      for (const actor of [
        user(ownerId),
        { kind: 'operator', userId: operatorId } as const,
        user(holderId),
      ]) {
        await reset()
        expect(
          await run({ type: 'payment_account.connect', providerKind: 'sim-pay' }, actor),
        ).toMatchObject({ status: 'accepted', details: { state: 'connecting' } })
        expect((await account())?.state).toBe('connecting')
      }
    })

    it('needs a sign-in of the last 15 minutes to connect, disconnect and tick', async () => {
      await reset()
      for (const command of [
        { type: 'payment_account.connect', providerKind: 'sim-pay' },
        { type: 'payment_account.disconnect' },
        { type: 'payment_account.tick', check: 'receiptEmailsOff', done: true },
      ] as const) {
        expect(await run(command, user(ownerId), minutesAgo(16))).toMatchObject({
          status: 'refused',
          code: 'sign_in_again',
        })
      }
      expect(await account()).toBeNull()
      expect(
        await run(
          { type: 'payment_account.connect', providerKind: 'sim-pay' },
          user(ownerId),
          minutesAgo(14),
        ),
      ).toMatchObject({ status: 'accepted' })
    })

    it('reads the account back on the owner’s return without a new sign-in, once there is an account to read', async () => {
      await reset()
      await run({ type: 'payment_account.connect', providerKind: 'sim-pay' })
      expect(await run({ type: 'payment_account.return' }, user(ownerId), minutesAgo(90))).toEqual(
        expect.objectContaining({ status: 'refused', code: 'not_connecting' }),
      )
      await worker({ type: 'payment_account.started', accountRef: ACCOUNT, guestHost: null })
      expect(
        await run({ type: 'payment_account.return' }, user(ownerId), minutesAgo(90)),
      ).toMatchObject({ status: 'accepted' })
    })

    it('refuses the worker’s account commands from a person', async () => {
      expect(
        await run({
          type: 'payment_account.lost',
          accountRef: ACCOUNT,
        }),
      ).toMatchObject({ status: 'refused', code: 'origin_not_allowed' })
    })
  })

  /** A connected account the venue then took Restro's access from: paused, one alert open. */
  async function lostAccess() {
    await connected(true)
    expect(await worker({ type: 'payment_account.lost', accountRef: ACCOUNT })).toMatchObject({
      status: 'accepted',
      details: { state: 'lost_access', changed: true },
    })
  }

  describe('connect, return and refresh', () => {
    it('makes the account connecting, then connected on the return, with the provider’s account backend only', async () => {
      await connected(false)
      const row = await account()
      expect(row).toMatchObject({ state: 'connected', account_ref: ACCOUNT })
      expect(row?.connected_at).not.toBeNull()
      expect(readAccountChecks(row?.checks)).toMatchObject({
        cardPayments: false,
        missing: ['bank account'],
      })
    })

    it('keeps the same account on a refresh and a repeat changes nothing', async () => {
      await reset()
      await run({ type: 'payment_account.connect', providerKind: 'sim-pay' })
      await worker({ type: 'payment_account.started', accountRef: ACCOUNT, guestHost: null })
      expect(await run({ type: 'payment_account.connect', providerKind: 'sim-pay' })).toMatchObject(
        { status: 'accepted', details: { changed: false } },
      )
      expect((await account())?.account_ref).toBe(ACCOUNT)
      // A different account for a venue that is already connecting is refused.
      expect(
        await worker({ type: 'payment_account.started', accountRef: NEW_ACCOUNT, guestHost: null }),
      ).toMatchObject({ status: 'refused', code: 'account_mismatch' })
    })

    it('refuses to connect a venue that already takes card payments', async () => {
      await connected(true)
      expect(await run({ type: 'payment_account.connect', providerKind: 'sim-pay' })).toMatchObject(
        { status: 'refused', code: 'already_connected' },
      )
    })

    it('does not connect on a notice’s reading until card payments are allowed', async () => {
      await reset()
      await run({ type: 'payment_account.connect', providerKind: 'sim-pay' })
      await worker({ type: 'payment_account.started', accountRef: ACCOUNT, guestHost: null })
      const midForm = {
        type: 'payment_account.observed',
        accountRef: ACCOUNT,
        canTakePayments: false,
        missing: ['business details'] as string[],
        afterReturn: false,
        guestHost: null,
        displayName: null,
      } as const
      expect(await worker(midForm)).toMatchObject({ details: { state: 'connecting' } })
      expect(await worker({ ...midForm, canTakePayments: true, missing: [] })).toMatchObject({
        details: { state: 'connected' },
      })
    })

    it('refuses a reading of an account that is not this venue’s', async () => {
      await connected(true)
      expect(
        await worker({
          type: 'payment_account.observed',
          accountRef: NEW_ACCOUNT,
          canTakePayments: true,
          missing: [],
          afterReturn: false,
          guestHost: null,
          displayName: null,
        }),
      ).toMatchObject({ status: 'refused', code: 'account_unknown' })
    })
  })

  describe('paying turns on only when every check passes (D125 2.3)', () => {
    it('lists what is missing, and is on only once the card, the till, the tables and the emails are done', async () => {
      await connected(true)
      await markPaymentTable(false)
      let paying = await connection()
      expect(paying.readiness.on).toBe(false)
      // The card is read from the provider; the rest is missing: two ticks and the tables.
      expect(paying.readiness.missing).toEqual([
        'cardTypeInTill',
        'paymentTables',
        'receiptEmailsOff',
      ])

      await tick('cardTypeInTill')
      await tick('receiptEmailsOff')
      paying = await connection()
      expect(paying.readiness.missing).toEqual(['paymentTables'])
      expect(paying.readiness.on).toBe(false)

      await markPaymentTable(true)
      paying = await connection()
      expect(paying.readiness.missing).toEqual([])
      expect(paying.readiness.on).toBe(true)
    })

    it('takes a tick back, and a card the provider does not allow keeps it off', async () => {
      await connected(false)
      await markPaymentTable(true)
      await tick('cardTypeInTill')
      await tick('receiptEmailsOff')
      let paying = await connection()
      expect(paying.readiness.missing).toEqual(['cardPayments'])
      expect(paying.readiness.providerMissing).toEqual(['bank account'])
      expect(paying.readiness.on).toBe(false)

      await tick('receiptEmailsOff', false)
      paying = await connection()
      expect(paying.readiness.missing).toEqual(['cardPayments', 'receiptEmailsOff'])
    })

    it('stores a tick with who and when, and logs it as a record', async () => {
      await connected(true)
      expect(await tick('cardTypeInTill')).toMatchObject({
        status: 'accepted',
        details: { changed: true },
      })
      expect(await tick('cardTypeInTill')).toMatchObject({ details: { changed: false } })
      const checks = readAccountChecks((await account())?.checks)
      expect(checks.ticks.cardTypeInTill).toMatchObject({ by: `user:${ownerId}` })
      expect(new Date(checks.ticks.cardTypeInTill?.at ?? '').getTime()).toBeGreaterThan(
        Date.now() - 60_000,
      )
      expect(checks.ticks.receiptEmailsOff).toBeNull()
      const { rows } = await world.owner.query<{
        retention: string
        details: Record<string, unknown>
      }>(
        `select retention, details from restro.log_entries
          where venue_id = $1 and kind = 'settings.changed' and reason = 'payments_check'
          order by seq desc limit 1`,
        [world.venueId],
      )
      expect(rows[0]).toMatchObject({
        retention: 'record',
        details: { check: 'cardTypeInTill', done: true },
      })
    })
  })

  describe('lost access (D125 2.4)', () => {
    it('pauses paying at once and alerts owners and managers once, offering a way back', async () => {
      await connected(true)
      expect(await worker({ type: 'payment_account.lost', accountRef: ACCOUNT })).toMatchObject({
        status: 'accepted',
        details: { state: 'lost_access', changed: true },
      })
      expect((await account())?.state).toBe('lost_access')
      expect((await connection()).readiness.on).toBe(false)
      const alerts = await openAlerts()
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toMatchObject({
        // Owners hold everything; a manager holds this one (it is what `money.follow_up` is).
        permission: 'money.follow_up',
        audience: 'venue',
        details: { reason: 'access_removed' },
        done_at: null,
      })
      // A repeat of the notice changes nothing and raises nothing more.
      expect(await worker({ type: 'payment_account.lost', accountRef: ACCOUNT })).toMatchObject({
        details: { changed: false },
      })
      expect(await openAlerts()).toHaveLength(1)
    })

    it('is a pause that ends by itself: no Done, and the end of the night leaves it open', async () => {
      await lostAccess()
      const { rows } = await world.owner.query<{ id: string; service_date: string }>(
        `select id, service_date::text as service_date from restro.alerts
          where venue_id = $1 and kind = 'payment_account_lost' and done_at is null`,
        [world.venueId],
      )
      const alert = rows[0]
      if (alert === undefined) throw new Error('no open alert')
      expect(ruleOf(PAYMENT_ACCOUNT_LOST_KIND, 'venue').closesItself).toBe(true)
      expect(await run({ type: 'alert.done', alertId: alert.id as `al_${string}` })).toMatchObject({
        status: 'refused',
        code: 'alert_closes_itself',
      })
      await worker({ type: 'service_day.close', serviceDate: alert.service_date })
      expect((await openAlerts()).at(-1)).toMatchObject({ id: alert.id, done_at: null })
    })

    it('carries no amount and no provider id in the alert', async () => {
      await lostAccess()
      const alert = (await openAlerts()).at(-1)
      const text = JSON.stringify(alert?.details)
      expect(text).not.toContain(ACCOUNT)
      expect(text).not.toMatch(/amount|minor|\d{3,}/i)
    })

    it('does not come back by itself after the venue took access away; Reconnect makes a new account', async () => {
      await lostAccess()
      await worker({
        type: 'payment_account.observed',
        accountRef: ACCOUNT,
        canTakePayments: true,
        missing: [],
        afterReturn: false,
        guestHost: null,
        displayName: null,
      })
      expect((await account())?.state).toBe('lost_access')

      expect(await run({ type: 'payment_account.connect', providerKind: 'sim-pay' })).toMatchObject(
        { status: 'accepted', details: { state: 'connecting' } },
      )
      expect(await account()).toMatchObject({ state: 'connecting', account_ref: null })
      await worker({ type: 'payment_account.started', accountRef: NEW_ACCOUNT, guestHost: null })
      await worker({
        type: 'payment_account.observed',
        accountRef: NEW_ACCOUNT,
        canTakePayments: true,
        missing: [],
        afterReturn: true,
        guestHost: null,
        displayName: null,
      })
      expect((await account())?.state).toBe('connected')
      const alerts = await openAlerts()
      expect(alerts.at(-1)?.done_at).not.toBeNull()
      // A reading for the old account is no longer this venue's.
      expect(await worker({ type: 'payment_account.lost', accountRef: ACCOUNT })).toMatchObject({
        status: 'refused',
        code: 'account_unknown',
      })
    })

    it('pauses when an account that took cards can not any more, and lifts when it can again', async () => {
      await connected(true)
      const gone = {
        type: 'payment_account.observed',
        accountRef: ACCOUNT,
        canTakePayments: false,
        missing: ['identity document'] as string[],
        afterReturn: false,
        guestHost: null,
        displayName: null,
      } as const
      expect(await worker(gone)).toMatchObject({ details: { state: 'lost_access' } })
      expect(readAccountChecks((await account())?.checks).lostReason).toBe('account_restricted')
      expect((await openAlerts()).at(-1)).toMatchObject({
        details: { reason: 'account_restricted' },
        done_at: null,
      })
      expect(await worker({ ...gone, canTakePayments: true, missing: [] })).toMatchObject({
        details: { state: 'connected' },
      })
      expect((await openAlerts()).at(-1)?.done_at).not.toBeNull()
    })

    it('does not alert for an account that never took cards', async () => {
      await connected(false)
      const before = (await openAlerts()).length
      await worker({
        type: 'payment_account.observed',
        accountRef: ACCOUNT,
        canTakePayments: false,
        missing: ['bank account'],
        afterReturn: false,
        guestHost: null,
        displayName: null,
      })
      expect((await account())?.state).toBe('connected')
      expect(await openAlerts()).toHaveLength(before)
    })

    it('does not say card payments are paused while the account was still being connected', async () => {
      await reset()
      await run({ type: 'payment_account.connect', providerKind: 'sim-pay' })
      await worker({ type: 'payment_account.started', accountRef: ACCOUNT, guestHost: null })
      const before = (await openAlerts()).length
      // The venue took access away from an account that never took a payment: it is left behind
      // (so the next link makes a new one), but there was no paying to pause.
      expect(await worker({ type: 'payment_account.lost', accountRef: ACCOUNT })).toMatchObject({
        status: 'accepted',
        details: { state: 'lost_access', changed: true },
      })
      expect(readAccountChecks((await account())?.checks).lostReason).toBe('access_removed')
      expect(await openAlerts()).toHaveLength(before)
    })
  })

  describe('an account the venue took access from is never used again (D125 2.5)', () => {
    const lose = () => worker({ type: 'payment_account.lost', accountRef: ACCOUNT })
    const reading = () =>
      worker({
        type: 'payment_account.observed',
        accountRef: ACCOUNT,
        canTakePayments: true,
        missing: [],
        afterReturn: false,
        guestHost: null,
        displayName: null,
      })
    const disconnect = () => run({ type: 'payment_account.disconnect' })
    const connectsANewAccount = async () => {
      expect(await run({ type: 'payment_account.connect', providerKind: 'sim-pay' })).toMatchObject(
        { status: 'accepted', details: { state: 'connecting' } },
      )
      expect(await account()).toMatchObject({ state: 'connecting', account_ref: null })
    }

    it('revoke, then disconnect, then connect: a new account', async () => {
      await connected(true)
      await lose()
      expect(await disconnect()).toMatchObject({ status: 'accepted' })
      expect(await account()).toMatchObject({ state: 'disconnected', account_ref: ACCOUNT })
      await connectsANewAccount()
    })

    it('disconnect, then revoke, then connect: a new account, with no alert for a venue that left', async () => {
      await connected(true)
      expect(await disconnect()).toMatchObject({ status: 'accepted' })
      const before = (await openAlerts()).length
      expect(await lose()).toMatchObject({
        status: 'accepted',
        details: { state: 'disconnected', changed: true },
      })
      expect((await account())?.state).toBe('disconnected')
      expect(readAccountChecks((await account())?.checks).lostReason).toBe('access_removed')
      expect(await openAlerts()).toHaveLength(before)
      // A repeat of the notice changes nothing.
      expect(await lose()).toMatchObject({ details: { changed: false } })
      await connectsANewAccount()
    })

    it('a reading in between does not clear the mark: revoke, disconnect, reading, connect', async () => {
      await connected(true)
      await lose()
      await disconnect()
      expect(await reading()).toMatchObject({
        status: 'accepted',
        details: { state: 'disconnected' },
      })
      expect(readAccountChecks((await account())?.checks).lostReason).toBe('access_removed')
      await connectsANewAccount()
    })

    it('a reading that says cards work does not bring back an account the venue took away', async () => {
      await connected(true)
      await lose()
      expect(await reading()).toMatchObject({ details: { state: 'lost_access' } })
      expect(readAccountChecks((await account())?.checks).lostReason).toBe('access_removed')
      await connectsANewAccount()
    })
  })

  describe('the account’s name (D125 2.1)', () => {
    const named = (displayName: string | null) =>
      worker({
        type: 'payment_account.observed',
        accountRef: ACCOUNT,
        canTakePayments: true,
        missing: [],
        afterReturn: true,
        guestHost: null,
        displayName,
      })

    it('is written from the reading and kept when a later reading has none', async () => {
      await connected(true)
      expect((await account())?.account_name).toBeNull()
      expect(await named('Club Nova Ltd')).toMatchObject({ status: 'accepted' })
      expect((await account())?.account_name).toBe('Club Nova Ltd')
      await named(null)
      expect((await account())?.account_name).toBe('Club Nova Ltd')
      await named('Club Nova')
      expect((await account())?.account_name).toBe('Club Nova')
    })
  })

  describe('the guest host and the wallet domain through a reconnect (D125 3.6)', () => {
    const HOST = 'guest.example.test'
    const connectedWithDomain = async () => {
      await reset()
      await run({ type: 'payment_account.connect', providerKind: 'sim-pay' })
      await worker({ type: 'payment_account.started', accountRef: ACCOUNT, guestHost: HOST })
      await worker({
        type: 'payment_account.observed',
        accountRef: ACCOUNT,
        canTakePayments: true,
        missing: [],
        afterReturn: true,
        guestHost: null,
        displayName: null,
      })
      await worker({ type: 'payment_account.domain', accountRef: ACCOUNT, host: HOST })
      expect(readAccountChecks((await account())?.checks)).toMatchObject({
        guestHost: HOST,
        domainHost: HOST,
      })
    }

    it('keeps both on Reconnect to the same account', async () => {
      await connectedWithDomain()
      await run({ type: 'payment_account.disconnect' })
      expect(await run({ type: 'payment_account.connect', providerKind: 'sim-pay' })).toMatchObject(
        { status: 'accepted', details: { state: 'connecting' } },
      )
      expect(await account()).toMatchObject({ state: 'connecting', account_ref: ACCOUNT })
      expect(readAccountChecks((await account())?.checks)).toMatchObject({
        guestHost: HOST,
        domainHost: HOST,
      })
    })

    it('keeps the guest host for a new account but not the registration made for the old one', async () => {
      await connectedWithDomain()
      await worker({ type: 'payment_account.lost', accountRef: ACCOUNT })
      await run({ type: 'payment_account.connect', providerKind: 'sim-pay' })
      expect(await account()).toMatchObject({ state: 'connecting', account_ref: null })
      expect(readAccountChecks((await account())?.checks)).toMatchObject({
        guestHost: HOST,
        domainHost: null,
      })
    })
  })

  describe('disconnect', () => {
    it('stops using the account, keeps its reference, and closes the lost-access alert', async () => {
      await connected(true)
      await worker({ type: 'payment_account.lost', accountRef: ACCOUNT })
      expect(await run({ type: 'payment_account.disconnect' })).toMatchObject({
        status: 'accepted',
        details: { state: 'disconnected', changed: true },
      })
      expect(await account()).toMatchObject({ state: 'disconnected', account_ref: ACCOUNT })
      expect((await openAlerts()).at(-1)?.done_at).not.toBeNull()
      expect(await run({ type: 'payment_account.disconnect' })).toMatchObject({
        details: { changed: false },
      })
    })

    it('connects the same account again after a disconnect', async () => {
      // A plain disconnect, with no access taken away: the account is still the venue's.
      await connected(true)
      await run({ type: 'payment_account.disconnect' })
      expect(await run({ type: 'payment_account.connect', providerKind: 'sim-pay' })).toMatchObject(
        { status: 'accepted', details: { state: 'connecting' } },
      )
      expect(await account()).toMatchObject({ state: 'connecting', account_ref: ACCOUNT })
    })

    it('is refused while any payment of the venue is not final, and goes through once it is', async () => {
      await connected(true)
      const tableId = world.tables[0] as string
      const sittingId = await world.openSitting(tableId)
      const paymentId = `py_${randomUUID().replaceAll('-', '').slice(0, 20)}`
      await world.owner.query(
        `insert into restro.payments
           (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
            currency, provider_kind, source, actor, job_id)
         values ($1, $2, $3, $4, $5, current_date, 'on_bill', 'awaiting_guest',
                 encode(sha256(convert_to($1, 'UTF8')), 'hex'), 'EUR', 'sim-pay',
                 'restro', 'system', 'test-seed')`,
        [paymentId, world.tenantId, world.venueId, tableId, sittingId],
      )
      expect(await run({ type: 'payment_account.disconnect' })).toMatchObject({
        status: 'refused',
        code: 'payment_in_flight',
      })
      expect((await account())?.state).toBe('connected')

      await world.owner.query(
        `update restro.payments set state = 'released', settled_at = now() where id = $1`,
        [paymentId],
      )
      expect(await run({ type: 'payment_account.disconnect' })).toMatchObject({
        status: 'accepted',
        details: { state: 'disconnected' },
      })
    })
  })
})
