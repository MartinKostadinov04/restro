// Ending the session of this browser. False when it could not be ended (no connection): the caller
// then stays where it is and says so, instead of sending the browser to a page it cannot load (RR-88).
import { authClient } from '@/lib/auth-client'

export async function endSession(): Promise<boolean> {
  try {
    const result = await authClient.signOut()
    return !result?.error
  } catch {
    return false
  }
}
