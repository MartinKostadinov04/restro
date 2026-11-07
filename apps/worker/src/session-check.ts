// Whether the signed-in account an internal request names is really signed in (RR-10). The service
// token proves that the web app's server asks; it says nothing about the session named in the body,
// so the worker looks for it. Only the internal endpoints ask: other work of the worker names no
// sign-in (the poller's Done from Telegram is its own kind of session). A member of Restro's admin
// team, the `operator`, has no session here: the web app's check of them is the one there is.
import { authSession, type DbPool, withSystem } from '@restro/db'
import { and, eq, gt } from 'drizzle-orm'

/** Who an internal request says is asking. */
export type InternalActor =
  | { readonly kind: 'user'; readonly userId: string; readonly sessionId: string }
  | { readonly kind: 'operator'; readonly userId: string }

/** True for an operator, or for a user whose session exists, is theirs and hasn't ended. */
export async function sessionIsLive(pool: DbPool, actor: InternalActor): Promise<boolean> {
  if (actor.kind !== 'user') return true
  const rows = await withSystem(pool, (tx) =>
    tx
      .select({ id: authSession.id })
      .from(authSession)
      .where(
        and(
          eq(authSession.id, actor.sessionId),
          eq(authSession.userId, actor.userId),
          gt(authSession.expiresAt, new Date()),
        ),
      )
      .limit(1),
  )
  return rows.length > 0
}
