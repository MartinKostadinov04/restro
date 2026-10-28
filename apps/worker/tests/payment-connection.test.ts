// Connecting a venue's payment account through the worker (#109; D125 §The venue's side) on Postgres,
// as the restro_app role, against the simulated provider (`@restro/sim-pay`): the owner connects and
// gets the provider's hosted address, refreshes it, returns and the account is read back; a check
// the provider reports missing keeps paying off until the provider's notice shows it done; the
// provider restricting the account or taking Restro's access away pauses paying and alerts the
// venue's owners and managers; reconnecting brings paying back; and a disconnect is refused while a
// payment is not final. The permission and the sign-in of the last 15 minutes are checked before
// the provider is asked anything, and no provider id or key is in what the web app gets back.
import { randomUUID } from 'node:crypto'

import {
  newId,
  type PaymentProvider,
  type ProviderNotice,
  payingReadiness,
  providerRef,
  readAccountChecks,
} from '@restro/core'
import { createArea, createTable, provisionTenant, provisionVenue } from '@restro/core/apply'
import { applyService, loadPayingConnection } from '@restro/core/service'
import { recordProviderNotice } from '@restro/core/service/notices'
import { createPool, type DbPool, withTenant } from '@restro/db'
import {
  createSimPayProvider,
  ManualClock,
  SIM_PAY_KIND,
  SimPayEngine,
  simPayNotice,
} from '@restro/sim-pay'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  ACCOUNT_NOTICE_GRACE_MS,
  handleProviderNotices,
  newNoticeRunState,
} from '../src/jobs/provider-notices'
import { retryWalletDomains } from '../src/jobs/wallet-domain'
import { createLogger } from '../src/logger'
import {
  type ConnectionApiAnswer,
  type ConnectionRequest,
  createConnectionApi,
} from '../src/payments/connection-api'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'

allowSlowSetup()

const GUEST_HOST = 'guest.restro.test'

describe.skipIf(!hasDatabase)('connecting a venue’s payment account (simulated provider)', () => {
  let db: TestDatabase
  let pool: DbPool
  let log: Awaited<ReturnType<typeof createLogger>>
  const tenantId = newId('tn')
  let venueId: string
  let tableId: string
  let sittingId: string
  let ownerId: string
  let plainId: string
  const engine = new SimPayEngine({
    clock: new ManualClock(),
    switches: { wallets: ['apple_pay'] },
  })
  const provider: PaymentProvider = createSimPayProvider({ env: 'test', engine })
  const providers = new Map([[SIM_PAY_KIND, provider]])
  const logLines: string[] = []

  const query = <Row extends object = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows as Row[])

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-connection-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Connect club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Connect club', $2)`,
      [tenantId, `connect-${newId('tn').slice(3, 11)}`],
    )
    const venue = await provisionVenue(pool, tenantId, { name: 'Club', slug: testSlug('connect') })
    venueId = venue.id
    const area = await createArea(pool, tenantId, venueId, 'Hall')
    if (!area.ok) throw new Error('no area')
    const table = await createTable(pool, tenantId, {
      areaId: area.area.id,
      name: null,
      number: '1',
    })
    if (!table.ok) throw new Error('no table')
    tableId = table.table.id
    const [day] = await query<{ id: string }>(
      `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
       values ($1, $2, $3, $4, current_date, 'one', 'restro', 'system', 'test-seed') returning id`,
      [newId('st'), tenantId, venueId, tableId],
    )
    sittingId = day?.id ?? ''
    ownerId = await addUser('owner')
    plainId = await addUser('member')
    log = await createLogger({
      level: 'debug',
      pretty: false,
      destination: { write: (line: string) => void logLines.push(line) },
    })
  })

  afterAll(async () => {
    await pool?.end()
    await db?.drop()
  })

  async function addUser(role: string): Promise<string> {
    const id = `connect-${newId('us').slice(3)}`
    await query('insert into restro.auth_user (id, name, email) values ($1, $2, $3)', [
      id,
      'A person',
      `${id}@example.test`,
    ])
    await query(
      'insert into restro.auth_member (id, organization_id, user_id, role) values ($1, $2, $3, $4)',
      [`mb-${id}`, tenantId, id, role],
    )
    return id
  }

  const api = (using: ReadonlyMap<string, PaymentProvider> = providers) =>
    createConnectionApi({ pool, log, providers: using })
  const request = (
    action: 'start' | 'return',
    options: { userId?: string; signedInMinutesAgo?: number } = {},
  ): ConnectionRequest => ({
    tenantId: tenantId as `tn_${string}`,
    venueId: venueId as `vn_${string}`,
    actor: { kind: 'user', userId: options.userId ?? ownerId, sessionId: `sess-${randomUUID()}` },
    signedInAt: new Date(Date.now() - (options.signedInMinutesAgo ?? 0) * 60_000).toISOString(),
    action,
    returnUrl: `https://restro.test/venues/${venueId}?tab=settings&section=paying&connection=return`,
    refreshUrl: `https://restro.test/venues/${venueId}?tab=settings&section=paying&connection=refresh`,
    guestHost: GUEST_HOST,
  })
  const ask = (
    action: 'start' | 'return',
    options?: { userId?: string; signedInMinutesAgo?: number },
    using?: ReadonlyMap<string, PaymentProvider>,
  ): Promise<ConnectionApiAnswer> => api(using)(request(action, options))

  const account = async () =>
    (
      await query<{
        state: string
        account_ref: string | null
        checks: Record<string, unknown>
      }>('select state, account_ref, checks from restro.payment_accounts where venue_id = $1', [
        venueId,
      ])
    )[0] ?? null
  const paying = () =>
    withTenant(pool, tenantId, (tx) => loadPayingConnection(tx, venueId)).then((c) => ({
      ...c,
      readiness: payingReadiness({
        state: c.state,
        checks: c.checks,
        tables: { paymentTables: 1, queuesWithoutOne: 0 },
      }),
    }))
  const alertRows = () =>
    query<{ permission: string; done_at: Date | null; details: Record<string, unknown> }>(
      `select permission, done_at, details from restro.alerts
        where venue_id = $1 and kind = 'payment_account_lost' order by raised_at`,
      [venueId],
    )

  /** Stores the provider's notice as the notice route would. */
  async function store(event: ReturnType<SimPayEngine['announceAccountUpdated']>) {
    const verified: ProviderNotice = simPayNotice(event)
    await recordProviderNotice(pool, {
      providerKind: SIM_PAY_KIND,
      live: false,
      notice: verified,
      jobId: `rq-${randomUUID()}`,
    })
  }
  /** One run of the notices job, at `now`. */
  const runNotices = (now: () => Date = () => new Date()) =>
    handleProviderNotices(
      { pool, log, now, jobId: `notices-${randomUUID()}` },
      { providers },
      newNoticeRunState(),
    )
  /** The provider's notice, stored as the notice route would, then the job reads it back. */
  async function notice(event: ReturnType<SimPayEngine['announceAccountUpdated']>) {
    await store(event)
    return runNotices()
  }
  /** The provider's account of the venue now, as the test last saw it (backend only). */
  let accountRefNow: string | null = null
  const remember = async () => {
    accountRefNow = (await account())?.account_ref ?? null
  }
  const lastAccount = () => {
    if (accountRefNow === null) throw new Error('no account yet')
    return providerRef(accountRefNow)
  }
  /** A command from the signed-in owner, straight to the service path (no provider asked). */
  const asOwner = async (command: Parameters<typeof applyService>[1]) =>
    (
      await applyService(pool, command, {
        tenantId,
        venueId,
        origin: 'staff',
        actor: { kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` },
        jobId: `req-${randomUUID()}`,
        signedInAt: new Date(),
      })
    ).result
  const disconnect = () => asOwner({ type: 'payment_account.disconnect' })

  // Every test starts from a venue that never connected, and sets up what it needs itself.
  beforeEach(async () => {
    await query('delete from restro.payments where venue_id = $1', [venueId])
    await query(`delete from restro.alerts where venue_id = $1 and kind = 'payment_account_lost'`, [
      venueId,
    ])
    await query('delete from restro.payment_accounts where venue_id = $1', [venueId])
    await query('delete from restro.provider_notices')
    accountRefNow = null
  })
  afterEach(() => engine.clearFaults())

  /** Connect pressed and the provider's account recorded: `connecting`. */
  async function connecting() {
    expect(await ask('start')).toMatchObject({ status: 'accepted' })
    await remember()
  }
  /** Back from the form with the business details and bank account still missing: `connected`. */
  async function connectedUnfinished() {
    await connecting()
    expect(await ask('return')).toMatchObject({ status: 'accepted', state: 'connected' })
  }
  /** Back from the form with everything done: `connected`, taking cards, wallets registered. */
  async function connectedTakingCards(displayName?: string) {
    await connecting()
    engine.finishConnecting(lastAccount(), displayName)
    expect(await ask('return')).toMatchObject({ status: 'accepted', state: 'connected' })
  }

  it('connects: the owner gets the provider’s hosted address and nothing else of the account', async () => {
    const answer = await ask('start')
    expect(answer).toMatchObject({ status: 'accepted' })
    expect(Object.keys(answer).sort()).toEqual(['status', 'url'])
    expect((answer as { url: string }).url).toMatch(/^https:\/\//)
    await remember()
    expect(await account()).toMatchObject({ state: 'connecting' })
    expect(accountRefNow).toMatch(/^simacct_/)
    // The guest host the web app named is remembered for the wallets.
    expect(readAccountChecks((await account())?.checks).guestHost).toBe(GUEST_HOST)
  })

  it('refreshes: a fresh link for the same account', async () => {
    await connecting()
    const before = accountRefNow
    const answer = await ask('start')
    expect(answer).toMatchObject({ status: 'accepted' })
    expect((await account())?.account_ref).toBe(before)
    expect((await account())?.state).toBe('connecting')
  })

  it('makes one provider account for a double press, a timeout or a tick in between, and a fresh key once there is one', async () => {
    const keys: string[] = []
    let landed: string | null = null
    const recording: PaymentProvider = {
      ...provider,
      async startConnection(req) {
        keys.push(req.idempotencyKey)
        const outcome = await provider.startConnection(req)
        if (keys.length === 1) {
          // The provider made the account, but its answer never came back.
          if (outcome.kind === 'done') landed = outcome.result.accountRef.provider
          return { kind: 'unknown', reason: 'the call timed out' }
        }
        return outcome
      },
    }
    const using = new Map([[SIM_PAY_KIND, recording]])

    expect(await ask('start', {}, using)).toEqual({
      status: 'refused',
      code: 'provider_unavailable',
    })
    expect(await account()).toMatchObject({ state: 'connecting', account_ref: null })
    // The owner ticks a check meanwhile (that touches the row), then presses again: the same
    // attempt, so the same key and the same provider account.
    expect(
      await asOwner({ type: 'payment_account.tick', check: 'cardTypeInTill', done: true }),
    ).toMatchObject({ status: 'accepted', details: { changed: true } })
    expect(await ask('start', {}, using)).toMatchObject({ status: 'accepted' })
    expect(keys[1]).toBe(keys[0])
    expect(landed).toMatch(/^simacct_/)
    expect((await account())?.account_ref).toBe(landed)
    // With the account recorded, every press is a new link under a new key.
    expect(await ask('start', {}, using)).toMatchObject({ status: 'accepted' })
    expect(keys[2]).not.toBe(keys[1])
    expect((await account())?.account_ref).toBe(landed)
  })

  it('returns before the owner finished: connected, with card payments still missing', async () => {
    await connectedUnfinished()
    const checks = readAccountChecks((await account())?.checks)
    expect(checks.cardPayments).toBe(false)
    expect(checks.missing).toEqual(['business details', 'bank account'])
    const reading = await paying()
    expect(reading.readiness.on).toBe(false)
    expect(reading.readiness.missing).toContain('cardPayments')
    expect(reading.readiness.providerMissing).toEqual(['business details', 'bank account'])
    // Wallets wait for the account to take cards.
    expect(engine.domainsOf(lastAccount())).toEqual([])
  })

  it('turns card payments on from the provider’s notice, and registers the guest domain for wallets', async () => {
    await connectedUnfinished()
    engine.finishConnecting(lastAccount())
    const counts = await notice(engine.announceAccountUpdated(lastAccount()))
    expect(counts.connection).toBe(1)
    expect(readAccountChecks((await account())?.checks)).toMatchObject({
      cardPayments: true,
      missing: [],
      domainHost: GUEST_HOST,
    })
    expect(engine.domainsOf(lastAccount())).toEqual([GUEST_HOST])
    // The till's card type and the receipt emails are the owner's ticks: paying is still off.
    expect((await paying()).readiness.missing).toEqual(['cardTypeInTill', 'receiptEmailsOff'])
  })

  it('tries a wallet domain the provider did not take again on its own schedule, under a new key', async () => {
    // Like Stripe's v1 API, the provider keeps the answer of a key, failures included, and
    // replays it for that key: a retry under the first attempt's key would only fail again.
    const keys: string[] = []
    type DomainAnswer = Awaited<ReturnType<PaymentProvider['prepareDomain']>>
    const stored = new Map<string, DomainAnswer>()
    const flaky: PaymentProvider = {
      ...provider,
      async prepareDomain(req) {
        keys.push(req.idempotencyKey)
        const replay = stored.get(req.idempotencyKey)
        if (replay !== undefined) return replay
        const answer: DomainAnswer =
          keys.length === 1
            ? { kind: 'unknown', reason: 'the provider answered a server error' }
            : await provider.prepareDomain(req)
        stored.set(req.idempotencyKey, answer)
        return answer
      },
    }
    const using = new Map([[SIM_PAY_KIND, flaky]])
    const env = { pool, log, jobId: `wallet-${randomUUID()}` }

    // Nothing to register while the account does not take cards yet.
    await connecting()
    expect(await retryWalletDomains(env, { providers: using })).toEqual({
      attempted: 0,
      registered: 0,
    })
    expect(keys).toHaveLength(0)

    engine.finishConnecting(lastAccount())
    expect(await ask('return', {}, using)).toMatchObject({ status: 'accepted', state: 'connected' })
    // The first attempt, in that reading, did not go through.
    expect(keys).toHaveLength(1)
    expect(readAccountChecks((await account())?.checks).domainHost).toBeNull()
    expect(engine.domainsOf(lastAccount())).toEqual([])

    expect(await retryWalletDomains(env, { providers: using })).toEqual({
      attempted: 1,
      registered: 1,
    })
    expect(keys).toHaveLength(2)
    expect(keys[1]).not.toBe(keys[0])
    expect(readAccountChecks((await account())?.checks).domainHost).toBe(GUEST_HOST)
    expect(engine.domainsOf(lastAccount())).toEqual([GUEST_HOST])
    // Registered: the next pass asks the provider nothing.
    expect(await retryWalletDomains(env, { providers: using })).toEqual({
      attempted: 0,
      registered: 0,
    })
    expect(keys).toHaveLength(2)
  })

  it('leaves an archived venue alone when retrying wallet domains, and counts a failed attempt', async () => {
    let asked = 0
    const down: PaymentProvider = {
      ...provider,
      async prepareDomain() {
        asked += 1
        return { kind: 'unknown', reason: 'the call timed out' }
      },
    }
    const using = new Map([[SIM_PAY_KIND, down]])
    const env = { pool, log, jobId: `wallet-${randomUUID()}` }
    await connecting()
    engine.finishConnecting(lastAccount())
    // Card payments on, but the registration did not happen (the provider is down meanwhile).
    expect(await ask('return', {}, using)).toMatchObject({ state: 'connected' })
    expect(asked).toBe(1)

    await query('update restro.venues set archived_at = now() where id = $1', [venueId])
    try {
      expect(await retryWalletDomains(env, { providers: using })).toEqual({
        attempted: 0,
        registered: 0,
      })
      expect(asked).toBe(1)
    } finally {
      await query('update restro.venues set archived_at = null where id = $1', [venueId])
    }
    // A live venue is tried; the provider failing is an attempt that did not register.
    expect(await retryWalletDomains(env, { providers: using })).toEqual({
      attempted: 1,
      registered: 0,
    })
    expect(asked).toBe(2)
  })

  it('keeps the guest host and the registered domain when the same account is connected again', async () => {
    await connectedTakingCards()
    expect(readAccountChecks((await account())?.checks)).toMatchObject({
      guestHost: GUEST_HOST,
      domainHost: GUEST_HOST,
    })
    expect(await disconnect()).toMatchObject({ status: 'accepted' })
    const accountBefore = accountRefNow
    // The connect command alone, before the provider is asked or anything is recorded again.
    expect(
      await asOwner({ type: 'payment_account.connect', providerKind: SIM_PAY_KIND }),
    ).toMatchObject({ status: 'accepted', details: { state: 'connecting' } })
    expect((await account())?.account_ref).toBe(accountBefore)
    expect(readAccountChecks((await account())?.checks)).toMatchObject({
      guestHost: GUEST_HOST,
      domainHost: GUEST_HOST,
    })
  })

  it('pauses paying when the provider restricts the account, and lifts when it can again', async () => {
    await connectedTakingCards()
    engine.restrictAccount(lastAccount(), ['identity document'])
    await notice(engine.announceAccountUpdated(lastAccount()))
    expect((await account())?.state).toBe('lost_access')
    const [alert] = await alertRows()
    expect(alert).toMatchObject({
      permission: 'money.follow_up',
      details: { reason: 'account_restricted' },
      done_at: null,
    })

    engine.finishConnecting(lastAccount())
    await notice(engine.announceAccountUpdated(lastAccount()))
    expect((await account())?.state).toBe('connected')
    expect((await alertRows())[0]?.done_at).not.toBeNull()
  })

  it('pauses paying at once when the venue takes access away, and one alert says so', async () => {
    await connectedTakingCards()
    const lostAccount = accountRefNow
    await notice(engine.revokeAccess(lastAccount()))
    expect(await account()).toMatchObject({ state: 'lost_access' })
    expect(readAccountChecks((await account())?.checks).lostReason).toBe('access_removed')
    const alerts = await alertRows()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ details: { reason: 'access_removed' }, done_at: null })
    expect((await paying()).readiness.on).toBe(false)
    expect(JSON.stringify(alerts[0])).not.toContain(lostAccount ?? 'x')
    // The notice alone did this: a reading of the account still answers (what a provider answers
    // after a venue disconnects is not documented), and a later account notice changes nothing.
    expect(engine.readConnection(lastAccount())).toMatchObject({ complete: true })
    await notice(engine.announceAccountUpdated(lastAccount()))
    expect(await account()).toMatchObject({ state: 'lost_access' })
    expect(readAccountChecks((await account())?.checks).lostReason).toBe('access_removed')
  })

  it('does not say card payments are paused when access is lost before the account ever connected', async () => {
    await connecting()
    await notice(engine.revokeAccess(lastAccount()))
    expect(await account()).toMatchObject({ state: 'lost_access' })
    expect(await alertRows()).toHaveLength(0)
  })

  it('reconnects: a new account, and paying’s pause and the alert end once it is read connected', async () => {
    await connectedTakingCards()
    const lostAccount = accountRefNow
    await notice(engine.revokeAccess(lastAccount()))
    expect(await ask('start')).toMatchObject({ status: 'accepted' })
    await remember()
    expect(accountRefNow).not.toBe(lostAccount)
    expect((await account())?.state).toBe('connecting')
    engine.finishConnecting(lastAccount(), 'Club Nova Ltd')
    expect(await ask('return')).toMatchObject({ status: 'accepted', state: 'connected' })
    // The settings show "Connected" with the account's name (D125 2.1).
    expect(
      (
        await query<{ account_name: string | null }>(
          'select account_name from restro.payment_accounts where venue_id = $1',
          [venueId],
        )
      )[0]?.account_name,
    ).toBe('Club Nova Ltd')
    expect((await alertRows())[0]?.done_at).not.toBeNull()
    // The new account has its own registration, made from the guest host kept through the reconnect.
    expect(engine.domainsOf(lastAccount())).toEqual([GUEST_HOST])
  })

  it('records nothing when the provider can not be read, and says to try again', async () => {
    await connecting()
    const before = await account()
    engine.failReads()
    expect(await ask('return')).toEqual({ status: 'refused', code: 'provider_unavailable' })
    engine.clearFaults()
    expect(await account()).toEqual(before)
  })

  it('asks the provider nothing before the permission and the sign-in are checked', async () => {
    await connecting()
    const before = await account()
    let asked = 0
    const counting: PaymentProvider = {
      ...provider,
      async startConnection(req) {
        asked += 1
        return provider.startConnection(req)
      },
      async readConnection(ref) {
        asked += 1
        return provider.readConnection(ref)
      },
    }
    const using = new Map([[SIM_PAY_KIND, counting]])
    expect(await ask('start', { userId: plainId }, using)).toEqual({
      status: 'refused',
      code: 'permission_denied',
    })
    expect(await ask('return', { userId: plainId }, using)).toEqual({
      status: 'refused',
      code: 'permission_denied',
    })
    expect(await ask('start', { signedInMinutesAgo: 16 }, using)).toEqual({
      status: 'refused',
      code: 'sign_in_again',
    })
    // Nothing was asked of the provider and nothing was written.
    expect(asked).toBe(0)
    expect(await account()).toEqual(before)
    // The owner's return reads the account back even after a long time on the provider's form.
    expect(await ask('return', { signedInMinutesAgo: 90 }, using)).toMatchObject({
      status: 'accepted',
    })
    expect(asked).toBe(1)
    expect(await account()).toMatchObject({ state: 'connected', account_ref: before?.account_ref })
  })

  it('refuses to connect a venue whose account already takes card payments', async () => {
    await connectedTakingCards()
    expect(await ask('start')).toEqual({ status: 'refused', code: 'already_connected' })
  })

  it('refuses a disconnect while a payment is not final, and allows it after', async () => {
    await connectedTakingCards()
    const paymentId = newId('py')
    await query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          currency, provider_kind, source, actor, job_id)
       values ($1, $2, $3, $4, $5, current_date, 'on_bill', 'held',
               encode(sha256(convert_to($1, 'UTF8')), 'hex'), 'EUR', $6, 'restro', 'system', 'test-seed')`,
      [paymentId, tenantId, venueId, tableId, sittingId, SIM_PAY_KIND],
    )
    expect(await disconnect()).toMatchObject({ status: 'refused', code: 'payment_in_flight' })
    expect((await account())?.state).toBe('connected')
    await query(`update restro.payments set state = 'released', settled_at = now() where id = $1`, [
      paymentId,
    ])
    expect(await disconnect()).toMatchObject({
      status: 'accepted',
      details: { state: 'disconnected' },
    })
    expect((await account())?.state).toBe('disconnected')
  })

  it('drops a notice for an account of another venue, after waiting for it to be recorded', async () => {
    await connecting()
    const stranger = engine.addAccount()
    const before = await account()
    await store(engine.announceAccountUpdated(stranger))
    // It may be an account that is still about to be recorded as ours: it waits.
    const early = await runNotices()
    expect(early).toMatchObject({ unknown_account: 0, waiting: 1 })
    // Past the wait it is marked handled, doing nothing.
    const later = await runNotices(() => new Date(Date.now() + ACCOUNT_NOTICE_GRACE_MS + 60_000))
    expect(later).toMatchObject({ unknown_account: 1, waiting: 0 })
    expect(await account()).toEqual(before)
  })

  it('gives a lost-access notice for an unknown account the same wait', async () => {
    await connecting()
    const stranger = engine.addAccount()
    await store(engine.revokeAccess(stranger))
    expect(await runNotices()).toMatchObject({ unknown_account: 0, waiting: 1 })
    const later = await runNotices(() => new Date(Date.now() + ACCOUNT_NOTICE_GRACE_MS + 60_000))
    expect(later).toMatchObject({ unknown_account: 1, waiting: 0 })
    expect((await account())?.state).toBe('connecting')
  })

  it('reads an account notice that arrives before the account is recorded as the venue’s', async () => {
    const early: string[] = []
    const racing: PaymentProvider = {
      ...provider,
      async startConnection(req) {
        const outcome = await provider.startConnection(req)
        if (outcome.kind === 'done') {
          // The provider's notice reaches the job before the worker has recorded the account.
          const counts = await notice(engine.announceAccountUpdated(outcome.result.accountRef))
          early.push(`waiting:${counts.waiting},handled:${counts.unknown_account}`)
        }
        return outcome
      },
    }
    expect(await ask('start', {}, new Map([[SIM_PAY_KIND, racing]]))).toMatchObject({
      status: 'accepted',
    })
    expect(early).toEqual(['waiting:1,handled:0'])
    await remember()
    engine.finishConnecting(lastAccount())
    const counts = await runNotices()
    expect(counts).toMatchObject({ connection: 1, unknown_account: 0 })
    expect(await account()).toMatchObject({ state: 'connected' })
  })

  it('after access was taken away and the venue disconnected, Connect makes a new account', async () => {
    await connectedTakingCards()
    const first = accountRefNow
    await notice(engine.revokeAccess(lastAccount()))
    expect((await account())?.state).toBe('lost_access')
    expect(await disconnect()).toMatchObject({
      status: 'accepted',
      details: { state: 'disconnected' },
    })
    expect(await ask('start')).toMatchObject({ status: 'accepted' })
    await remember()
    expect(accountRefNow).not.toBe(first)
    expect((await account())?.state).toBe('connecting')
  })
})
