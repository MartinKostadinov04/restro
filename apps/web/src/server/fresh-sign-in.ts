// D122 §7: a settings change asks for the password again once the sign-in is older than 15
// minutes. Core's `freshSignIn` commands check it on the service path; the owner-only and
// destructive actions outside it (the organisation, POS instances, a venue's name, address,
// deletion and purge, table codes) ask here and answer `sign_in_again`, which the screen turns
// into the password dialog (`useSignInAgain`).
import { isFreshSignIn } from '@restro/core/service'

/** True when the person must type the password again before this change. */
export function signInTooOld(signedInAt: Date): boolean {
  return !isFreshSignIn(signedInAt, new Date())
}
