// What applyService answers (D72): a command is accepted or refused with a code, never a local
// success. The face shows *pending* until this answer, then words the code through the shell's
// strings. A repeat of an action id gets the stored answer (idempotency), so the answer is plain
// data that can be kept on the order row.
//
// Pure: no I/O.

import { z } from 'zod'

/**
 * Why a command was refused. The machinery's codes are here; the tickets that build a command add
 * its own (the guest API's `order_changed`, `line_held`, `undo_expired`, …).
 */
export const REFUSAL_CODES = [
  /** The command failed its schema. */
  'invalid_command',
  /** The command may not come from this origin (a guest sending a staff command). */
  'origin_not_allowed',
  /** The actor lacks the command's permission at this venue. */
  'permission_denied',
  /** A staff write on a shared device needs the person's own PIN (D122 §7). */
  'pin_required',
  /** A settings change needs a person's own sign-in, never a PIN (D122 §7). */
  'own_sign_in_required',
  /** The PIN's person, the shared device or the operator is unknown, archived or revoked. */
  'actor_unknown',
  /** This tenant has no such venue. */
  'venue_missing',
  /** The venue was deleted (archived). */
  'venue_archived',
  /** This venue has no such table. */
  'table_missing',
  /** The table has no open sitting: it is not open for phones (D122 §4). */
  'table_not_open',
  /** A row it needs is locked by another write longer than `lock_timeout`; try again. */
  'busy',
  /** The command exists but its ticket has not built it yet. */
  'not_built',
] as const

/** One refusal code. */
export type RefusalCode = (typeof REFUSAL_CODES)[number]

/** Facts an answer may carry for the face: short, flat, never a note or guest data. */
export const ResultDetailsSchema = z.record(
  z.string().regex(/^[a-z][A-Za-z0-9]{0,39}$/),
  z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
)

/** An answer's details. */
export type ResultDetails = z.infer<typeof ResultDetailsSchema>

/** The answer to one command. `actionId` echoes the command's, when it has one. */
export const ServiceResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('accepted'),
    actionId: z.uuid().nullable(),
    /** A short reference to show (a sent order's code a waiter reads), or null. */
    ref: z.string().max(16).nullable(),
    details: ResultDetailsSchema,
  }),
  z.strictObject({
    status: z.literal('refused'),
    actionId: z.uuid().nullable(),
    code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    details: ResultDetailsSchema,
  }),
])

/** The answer to one command. */
export type ServiceResult = z.infer<typeof ServiceResultSchema>

/** An accepted answer. */
export type Accepted = Extract<ServiceResult, { status: 'accepted' }>

/** A refused answer. */
export type Refused = Extract<ServiceResult, { status: 'refused' }>

/** Builds an accepted answer. */
export function accepted(
  actionId: string | null,
  options: { readonly ref?: string | null; readonly details?: ResultDetails } = {},
): Accepted {
  return { status: 'accepted', actionId, ref: options.ref ?? null, details: options.details ?? {} }
}

/**
 * Builds a refused answer. `code` is one of the machinery's codes or a command's own (snake case);
 * `details` carries what the face needs to word it.
 */
export function refused(
  actionId: string | null,
  code: RefusalCode | (string & {}),
  details: ResultDetails = {},
): Refused {
  return { status: 'refused', actionId, code, details }
}
