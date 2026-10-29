// The people settings' server side (#72; the screens are #87): who is asking, and the shared
// device's PIN check. The writes are the service write path's (`role.*`, `staff.*`, `pin.*`,
// `device.*` in @restro/core/service), which checks every right again inside its transaction.
// - Restro's admin team: an account with an unrevoked `operators` row acts at any venue as an
//   `operator` actor (adds roles, changes rights, sees and resets PINs). The row is read as the
//   app role, which may only SELECT that system table; nothing here bypasses row-level security.
// - On a shared device every staff write asks for a PIN first (`identifyAtSharedDevice`); the
//   wrong-PIN counters live in this process's memory (design §8).
// Nothing here logs a PIN, its HMAC or the pepper.
import { newId } from '@restro/core'
import {
  identifyStaffByPin,
  PinGuard,
  type PinIdentity,
  type ServiceActor,
  type ServiceOptions,
} from '@restro/core/service'
import { operators } from '@restro/db'
import { and, eq, isNull } from 'drizzle-orm'

import { getAuthDb, getPool } from '../db'
import { serverEnv } from '../env'

/** True when the account belongs to Restro's admin team (an unrevoked `operators` row). */
export async function isOperator(userId: string): Promise<boolean> {
  const [row] = await getAuthDb()
    .select({ userId: operators.userId })
    .from(operators)
    .where(and(eq(operators.userId, userId), isNull(operators.revokedAt)))
    .limit(1)
  return row !== undefined
}

/**
 * The actor a signed-in person's own write names: Restro's admin team as `operator` when asked
 * to act as such, else the account with its session (D122 §7).
 */
export async function ownActor(
  user: { readonly id: string },
  sessionId: string,
  options: { readonly asOperator?: boolean } = {},
): Promise<ServiceActor> {
  if (options.asOperator === true && (await isOperator(user.id))) {
    return { kind: 'operator', userId: user.id }
  }
  return { kind: 'user', userId: user.id, sessionId }
}

const processGuard = globalThis as typeof globalThis & { __restroPinGuard?: PinGuard }

/** This process's wrong-PIN counters (kept across hot reloads in development). */
export function pinGuard(): PinGuard {
  processGuard.__restroPinGuard ??= new PinGuard()
  return processGuard.__restroPinGuard
}

/** The PIN pepper, or undefined when it is not set (then no PIN is made or checked). */
export function pinPepper(): string | undefined {
  return serverEnv().STAFF_PIN_PEPPER
}

/** What the staff commands need from the environment: the seal key and the pepper a new PIN uses. */
export function staffServiceOptions(): ServiceOptions {
  const env = serverEnv()
  return {
    ...(env.SEAL_PUBLIC_KEY === undefined ? {} : { sealPublicKey: env.SEAL_PUBLIC_KEY }),
    ...(env.STAFF_PIN_PEPPER === undefined ? {} : { pinPepper: env.STAFF_PIN_PEPPER }),
  }
}

/**
 * The person a PIN names on the shared device signed in with this session. Without the pepper no
 * PIN can match: the device is told the PIN is wrong, and nothing is counted.
 */
export async function identifyAtSharedDevice(input: {
  readonly tenantId: string
  readonly venueId: string
  readonly userId: string
  readonly sessionId: string
  readonly pin: string
}): Promise<PinIdentity> {
  const pepper = pinPepper()
  if (pepper === undefined) return { ok: false, code: 'pin_wrong' }
  return identifyStaffByPin(getPool(), {
    ...input,
    pepper,
    guard: pinGuard(),
    jobId: newId('jb'),
  })
}
