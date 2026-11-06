// A read of Tonight that never reached the server (no connection, RR-O32, RR-O47) is a failed read,
// not an unhandled rejection: the screen shows its calm retry line, as for a write that did not get
// through (`run.tsx`). A redirect (the sign-in ran out) is the router's, so it is passed on.
import { unstable_rethrow } from 'next/navigation'

/** What a read action answers when it never got an answer. */
export const READ_FAILED = { ok: false, error: 'failed' } as const

/** The answer of `read`, or `READ_FAILED` when its promise rejected. */
export async function readAttempt<R>(read: () => Promise<R>): Promise<R | typeof READ_FAILED> {
  try {
    return await read()
  } catch (error) {
    unstable_rethrow(error)
    return READ_FAILED
  }
}
