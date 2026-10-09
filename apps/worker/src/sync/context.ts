// What every sync job runs with, and `withIntegration`: the one place that opens an integration's
// sealed credentials and builds a barsy client for it.
//
//   1. The integration row is read inside the tenant's scope (row-level security): a payload
//      whose tenant does not own the integration finds nothing.
//   2. The host is checked against this worker's rules (host-policy.ts, rule 9).
//   3. The credentials are opened with the worker's private key. The authenticated data binds
//      them to tenant, integration and host, so a value copied to another integration, or kept
//      after the host was changed, does not open.
//   4. The client talks to that host only. Its calls go through the installation's limiter (two
//      requests at a time, shared by every job of this process).
//
// The password lives only inside `withIntegration`'s closure: the session hands out a client and
// an `authorization()` function (for the photo download, which sends it to the integration's own
// host and nowhere else), never the password itself.

import {
  type BarsyClient,
  type BarsyReader,
  createBarsyClient,
  createBarsyReader,
} from '@restro/barsy'
import { SealError } from '@restro/core/seal'
import { openBarsyCredentials } from '@restro/core/seal-open'
import { type DbPool, type Integration, integrations, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import type { BarsyPolicy, SealKeys } from '../config'
import type { Logger } from '../logger'
import { SyncError } from './errors'
import { assertSyncHost } from './host-policy'
import type { LimiterRegistry } from './limiter'

/** Sends a job to the queue: pg-boss `send`, or a fake in tests. */
export type Enqueue = (
  name: string,
  data: object,
  options: { singletonKey: string },
) => Promise<string | null>

/** The photo store as the worker uses it: put only. */
export interface PhotoStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
}

/** Everything a sync job needs besides the integration it works on. */
export interface SyncEnvironment {
  readonly pool: DbPool
  readonly log: Logger
  readonly now: () => Date
  readonly keys: SealKeys
  readonly policy: BarsyPolicy
  readonly limiters: LimiterRegistry
  readonly enqueue: Enqueue
  readonly store: PhotoStore
  /** `fetch` for photo downloads; tests replace it. */
  readonly fetch: typeof fetch
  readonly signal?: AbortSignal | undefined
}

/** An integration opened for work. */
export interface IntegrationSession {
  readonly tenantId: string
  readonly integration: Integration
  /** The normalised host (no scheme). */
  readonly host: string
  readonly client: BarsyClient
  readonly reader: BarsyReader
  /** `Basic …` for this integration's own host. Never log it; never send it anywhere else. */
  authorization(): string
}

/** Wraps a client so that every call waits for a free slot of the installation's limiter. */
function limited(client: BarsyClient, run: <T>(task: () => Promise<T>) => Promise<T>): BarsyClient {
  return {
    host: client.host,
    env: client.env,
    call: (...args) => run(() => client.call(...args)),
    callMany: (...args) => run(() => client.callMany(...args)),
    callRaw: (...args) => run(() => client.callRaw(...args)),
    ping: (...args) => run(() => client.ping(...args)),
    pingUser: (...args) => run(() => client.pingUser(...args)),
  }
}

/** Reads and opens an integration; see the header. Throws `SyncError` for what retrying cannot fix. */
export async function openIntegration(
  env: SyncEnvironment,
  target: { readonly tenantId: string; readonly integrationId: string },
): Promise<IntegrationSession> {
  const [integration] = await withTenant(env.pool, target.tenantId, (tx) =>
    tx.select().from(integrations).where(eq(integrations.id, target.integrationId)),
  )
  if (integration?.kind !== 'barsy') {
    throw new SyncError('integration_not_found', 'This tenant has no such barsy integration.')
  }
  if (integration.credentialsSealed === null) {
    throw new SyncError('no_credentials', 'The integration has no credentials yet.')
  }
  const host = assertSyncHost(integration.host, env.policy)

  let credentials: { user: string; password: string }
  try {
    credentials = openBarsyCredentials(integration.credentialsSealed, {
      tenantId: target.tenantId,
      integrationId: integration.id,
      host: integration.host,
      privateKey: env.keys.privateKey,
    })
  } catch (error) {
    if (error instanceof SealError) {
      // Its messages say what to do ("connect the integration again") and hold no value.
      throw new SyncError('credentials_unreadable', error.message, { cause: error })
    }
    throw error
  }

  const authorization = `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`, 'utf8').toString('base64')}`
  const limiter = env.limiters.forHost(host)
  // The host passed the worker's rules above; the client's own guard (an allowlist of its own)
  // is told exactly that host, so the two agree and neither can be bypassed by the other.
  const raw = createBarsyClient(
    {
      host,
      user: credentials.user,
      password: credentials.password,
      env: env.policy.env,
      allowedHosts: [host],
    },
    { logger: env.log.child({ integrationId: integration.id }) },
  )
  const client = limited(raw, (task) => limiter.run(task))
  return {
    tenantId: target.tenantId,
    integration,
    host,
    client,
    reader: createBarsyReader(client),
    authorization: () => authorization,
  }
}

/** Opens the integration, runs `fn` with it. */
export async function withIntegration<T>(
  env: SyncEnvironment,
  target: { readonly tenantId: string; readonly integrationId: string },
  fn: (session: IntegrationSession) => Promise<T>,
): Promise<T> {
  return fn(await openIntegration(env, target))
}
