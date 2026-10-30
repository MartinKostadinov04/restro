// The worker's side of "Connect payments" in the owner's Paying settings (#109):
// `POST /internal/payments/connection` on the same private HTTP server as the reveal and Telegram
// endpoints, for the web app's server only (same Host rule and bearer token). The web app names the
// signed-in account and its session; the service path checks the person holds
// `settings.connect_payments` (and, to start, signed in within the last 15 minutes) before the
// worker asks the provider anything. Only the provider's hosted onboarding address comes back:
// the provider's keys and account stay here (rule 3). Nothing here stores or logs a link.
//
// Disconnecting and the owner's ticks need no provider and are service commands the web app runs
// itself; the provider calls are these two:
//   - `start`:  connect, refresh and "Reconnect": the hosted onboarding link;
//   - `return`: the owner came back; the account is read back and recorded.

import { randomUUID } from 'node:crypto'

import { idSchema } from '@restro/core'
import { applyService, type ServiceContext } from '@restro/core/service'
import { type DbPool, paymentAccounts, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { Logger } from '../logger'
import { sessionIsLive } from '../session-check'
import {
  type ConnectionFailure,
  type ConnectionProvider,
  readAccount,
  startAccountConnection,
} from './connection'

/** Where the endpoint listens. */
export const CONNECTION_PATH = '/internal/payments/connection'

/** The largest request body read, in bytes. */
export const MAX_CONNECTION_BODY_BYTES = 4 * 1024

const Actor = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('user'),
    userId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(256),
  }),
  z.strictObject({ kind: z.literal('operator'), userId: z.string().min(1).max(128) }),
])

/** What the web app sends. */
export const ConnectionRequestSchema = z
  .strictObject({
    tenantId: idSchema('tn'),
    venueId: idSchema('vn'),
    actor: Actor,
    signedInAt: z.iso.datetime({ offset: true }).optional(),
    action: z.enum(['start', 'return']),
    /** Where the provider's form sends the owner back to, or when its link ran out. */
    returnUrl: z.url({ protocol: /^https?$/ }).optional(),
    refreshUrl: z.url({ protocol: /^https?$/ }).optional(),
    /** The guest page's host, for wallets (D125 3.6). */
    guestHost: z.hostname(),
  })
  .refine((request) => request.action !== 'start' || (request.returnUrl && request.refreshUrl), {
    message: 'start needs a return and a refresh address',
  })
export type ConnectionRequest = z.output<typeof ConnectionRequestSchema>

/** What the endpoint answers. */
export type ConnectionApiAnswer =
  | {
      readonly status: 'accepted'
      /** The provider's hosted form, for `start`. */
      readonly url?: string
      /** Where the account stands after a `return`. */
      readonly state?: string
    }
  | { readonly status: 'refused'; readonly code: string }

export interface ConnectionApiDeps {
  readonly pool: DbPool
  readonly log: Logger
  readonly providers: ReadonlyMap<string, ConnectionProvider>
}

function failureCode(failure: ConnectionFailure): string {
  return typeof failure === 'string' ? failure : failure.refused
}

/** Makes the handler. */
export function createConnectionApi(
  deps: ConnectionApiDeps,
): (request: ConnectionRequest) => Promise<ConnectionApiAnswer> {
  /** The provider a venue connects through: the one it has, else the only one this worker has. */
  async function providerFor(
    tenantId: string,
    venueId: string,
  ): Promise<ConnectionProvider | null> {
    const [row] = await withTenant(deps.pool, tenantId, (tx) =>
      tx
        .select({ providerKind: paymentAccounts.providerKind, state: paymentAccounts.state })
        .from(paymentAccounts)
        .where(eq(paymentAccounts.venueId, venueId)),
    )
    // A disconnected venue may choose again; a connecting one carries on with its own.
    if (row !== undefined && row.state !== 'disconnected') {
      return deps.providers.get(row.providerKind) ?? null
    }
    const only = [...deps.providers.values()]
    return only.length === 1 ? (only[0] ?? null) : null
  }

  return async (request) => {
    if (!(await sessionIsLive(deps.pool, request.actor))) {
      return { status: 'refused', code: 'session_unknown' }
    }
    const jobId = `connection-api-${randomUUID()}`
    const context: ServiceContext = {
      tenantId: request.tenantId,
      venueId: request.venueId,
      origin: 'staff',
      actor: request.actor,
      jobId,
      ...(request.signedInAt === undefined ? {} : { signedInAt: new Date(request.signedInAt) }),
    }
    const env = { pool: deps.pool, log: deps.log, jobId }

    if (request.action === 'return') {
      // The right to connect, without a new sign-in: the hosted form can take a while.
      const { result } = await applyService(deps.pool, { type: 'payment_account.return' }, context)
      if (result.status === 'refused') return { status: 'refused', code: result.code }
      const outcome = await readAccount(
        env,
        { tenantId: request.tenantId, venueId: request.venueId },
        deps.providers,
        { afterReturn: true, guestHost: request.guestHost },
      )
      if (outcome.kind === 'read') return { status: 'accepted', state: outcome.state }
      if (outcome.kind === 'refused') return { status: 'refused', code: outcome.code }
      return {
        status: 'refused',
        code: outcome.kind === 'unreadable' ? 'provider_unavailable' : 'not_connecting',
      }
    }

    const provider = await providerFor(request.tenantId, request.venueId)
    if (provider === null) return { status: 'refused', code: 'no_provider' }
    const started = await startAccountConnection(env, context, provider, {
      returnUrl: request.returnUrl as string,
      refreshUrl: request.refreshUrl as string,
      guestHost: request.guestHost,
    })
    return started.kind === 'link'
      ? { status: 'accepted', url: started.url }
      : { status: 'refused', code: failureCode(started.failure) }
  }
}
