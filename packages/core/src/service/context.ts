// Who calls the service write path, and the provenance every row it writes carries (rule 2 as
// D122 §9 amends it; design §2.2): `source`, `actor` and `job_id`, NOT NULL, plus `via` for where a
// staff answer came from. The caller resolves the actor (the table code, the session, the PIN)
// and passes it in; applyService checks it against the command and the database, never trusts it
// for a permission.
//
// Pure: no I/O.

import { z } from 'zod'

import { idSchema } from '../ids'

/** Where a command comes from: a guest's phone, a staff screen, or the worker (design §2.1). */
export const SERVICE_ORIGINS = ['guest', 'staff', 'worker'] as const

/** One origin. */
export type ServiceOrigin = (typeof SERVICE_ORIGINS)[number]

/** The `source` column's values (design §2.2; migration 0028's check). */
export type ServiceSource = 'guest' | 'staff' | 'worker' | 'provider' | 'restro' | 'pos'

/** The `via` column's values: where a write, a staff answer above all, came from (D122 §7). */
export const VIA_VALUES = ['guest_page', 'tonight', 'telegram', 'worker', 'provider'] as const

/** One `via`. */
export type Via = (typeof VIA_VALUES)[number]

/**
 * A Better Auth id as the actor text may carry it: what the database's actor pattern allows after
 * the `user:` prefix.
 */
const AccountIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/)

/** The id the server made for the web request, or the worker's job run (`job_id`). */
export const JobIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/)

/**
 * The actor as the caller resolved it.
 * - `guest`: a phone that showed a table code. Nothing about the phone is kept (D111).
 * - `user`: a signed-in account, with the session it signed in with (a shared device is a
 *   session an owner marked).
 * - `staff`: a person identified by their PIN on a shared device, with that device's session.
 * - `operator`: a signed-in account of Restro's admin team.
 * - `system`: the worker itself; `integration`: the worker acting for one POS instance.
 */
export const ServiceActorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('guest') }),
  z.strictObject({
    kind: z.literal('user'),
    userId: AccountIdSchema,
    sessionId: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('staff'),
    staffMemberId: idSchema('sm'),
    sessionId: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal('operator'), userId: AccountIdSchema }),
  z.strictObject({ kind: z.literal('system') }),
  z.strictObject({ kind: z.literal('integration'), integrationId: idSchema('in') }),
])

/** The actor of one command. */
export type ServiceActor =
  | { readonly kind: 'guest' }
  | { readonly kind: 'user'; readonly userId: string; readonly sessionId: string }
  | { readonly kind: 'staff'; readonly staffMemberId: string; readonly sessionId: string }
  | { readonly kind: 'operator'; readonly userId: string }
  | { readonly kind: 'system' }
  | { readonly kind: 'integration'; readonly integrationId: string }

/** The actor kinds each origin may carry. */
const ACTOR_KINDS_BY_ORIGIN: Readonly<Record<ServiceOrigin, readonly ServiceActor['kind'][]>> = {
  guest: ['guest'],
  staff: ['user', 'staff', 'operator'],
  worker: ['system', 'integration'],
}

/** Where a staff answer may come from; guests and the worker have one place each. */
const VIA_BY_ORIGIN: Readonly<Record<ServiceOrigin, readonly Via[]>> = {
  guest: ['guest_page'],
  staff: ['tonight', 'telegram'],
  worker: ['worker', 'provider'],
}

/** What every call of `applyService` carries beside the command (design §2.1). */
export const ServiceContextSchema = z
  .strictObject({
    tenantId: idSchema('tn'),
    venueId: idSchema('vn'),
    origin: z.enum(SERVICE_ORIGINS),
    actor: ServiceActorSchema,
    jobId: JobIdSchema,
    /** Where the write came from; the origin's usual place when left out. */
    via: z.enum(VIA_VALUES).optional(),
    /** The clock for decisions made in memory (the service day); deadlines use the database's. */
    now: z.date().optional(),
    /**
     * When a signed-in actor last entered their password: their session's start. A settings
     * change needs it within `FRESH_SIGN_IN_MINUTES` (D122 §7).
     */
    signedInAt: z.date().optional(),
    /**
     * A guest's table code, as its SHA-256 hex (D121): the guest API puts it here, and the command
     * is refused `code_retired` unless the table still has this code and a guest page.
     */
    tableCodeHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    /**
     * For a located guest command (#76, D122 §4): the sitting the phone's location pass names. The
     * command is refused `location_needed` unless it is still the table's open sitting.
     */
    sittingId: idSchema('st').optional(),
    /** The location consent version the pass or the check carried (D119), for a sent order. */
    consentVersion: z.string().min(1).max(16).optional(),
  })
  .superRefine((context, issues) => {
    if (context.tableCodeHash !== undefined && context.origin !== 'guest') {
      issues.addIssue({
        code: 'custom',
        path: ['tableCodeHash'],
        message: 'only a guest command carries a table code',
      })
    }
    for (const key of ['sittingId', 'consentVersion'] as const) {
      if (context[key] !== undefined && context.tableCodeHash === undefined) {
        issues.addIssue({
          code: 'custom',
          path: [key],
          message: 'only a guest command with its table code carries a location claim',
        })
      }
    }
    if (!ACTOR_KINDS_BY_ORIGIN[context.origin].includes(context.actor.kind)) {
      issues.addIssue({
        code: 'custom',
        path: ['actor'],
        message: `a ${context.origin} command cannot carry a ${context.actor.kind} actor`,
      })
    }
    if (context.via !== undefined && !VIA_BY_ORIGIN[context.origin].includes(context.via)) {
      issues.addIssue({
        code: 'custom',
        path: ['via'],
        message: `a ${context.origin} command cannot come via ${context.via}`,
      })
    }
  })

/** The context of one call; `ServiceContextSchema` checks it. */
export interface ServiceContext {
  readonly tenantId: string
  readonly venueId: string
  readonly origin: ServiceOrigin
  readonly actor: ServiceActor
  readonly jobId: string
  readonly via?: Via
  readonly now?: Date
  readonly signedInAt?: Date
  readonly tableCodeHash?: string
  readonly sittingId?: string
  readonly consentVersion?: string
}

/**
 * How long after entering their password a person may change settings (D122 §7: the password
 * again before a settings change after 15 minutes). Better Auth's `freshAge` uses the same.
 */
export const FRESH_SIGN_IN_MINUTES = 15

/**
 * True when a signed-in actor entered their password recently enough to change settings at `now`.
 * A time in the future (a clock that ran ahead) counts as not fresh.
 */
export function isFreshSignIn(signedInAt: Date | undefined, now: Date): boolean {
  if (signedInAt === undefined) return false
  const age = now.getTime() - signedInAt.getTime()
  return age >= -60_000 && age < FRESH_SIGN_IN_MINUTES * 60_000
}

/** The provenance columns of a service row (rule 2). */
export interface Provenance {
  readonly source: ServiceSource
  readonly actor: string
  readonly jobId: string
}

/** The `actor` column's text for an actor: never personal data (design §2.2). */
export function actorText(actor: ServiceActor): string {
  switch (actor.kind) {
    case 'guest':
      return 'guest'
    case 'system':
      return 'system'
    case 'user':
      return `user:${actor.userId}`
    case 'staff':
      return `staff:${actor.staffMemberId}`
    case 'operator':
      return `operator:${actor.userId}`
    case 'integration':
      return `integration:${actor.integrationId}`
  }
}

/** The `source` of a write: the origin's, except that Restro's admin team writes as `restro`. */
export function sourceOf(origin: ServiceOrigin, actor: ServiceActor): ServiceSource {
  if (actor.kind === 'operator') return 'restro'
  return origin
}

/** The provenance of a call. */
export function provenanceOf(context: {
  readonly origin: ServiceOrigin
  readonly actor: ServiceActor
  readonly jobId: string
}): Provenance {
  return {
    source: sourceOf(context.origin, context.actor),
    actor: actorText(context.actor),
    jobId: context.jobId,
  }
}

/** Where a write came from: what the caller said, or the origin's usual place. */
export function viaOf(context: { readonly origin: ServiceOrigin; readonly via?: Via }): Via {
  return context.via ?? VIA_BY_ORIGIN[context.origin][0] ?? 'worker'
}
