// The one way a spec signs a person in through the login form (#617).
//
// Every spec used to carry its own copy of a retry loop: fill the form, give the page eight
// seconds to leave /login, and on any failure sleep a flat ten seconds and go round again. It
// could not tell a refused sign-in from a slow one, so a slow one that did succeed sent the second
// turn to a page with no form and the `fill` waited out the whole hook budget. This helper asks the
// one question that matters, "what did the sign-in answer?", and bounds every wait, so a sign-in
// that cannot succeed fails in seconds and names what it was waiting for.
//
// Better Auth's limiter (`rateLimit: { enabled: true }` in src/server/auth.ts) lets 3 sign-ins
// through per path, then refuses until 10 seconds have passed since the last one it let through; a
// refused one does not move that clock. It counts every client together here (the test requests
// carry no address), so the sign-ins of one run share one count. Measured on a healthy build:
// three sign-ins take about 3 seconds in all, a fourth inside the window is refused (429) in under
// 10 milliseconds, and the limiter lets a sign-in through again 10 seconds after the third.
import { expect, type Page } from '@playwright/test'

import { ADMIN_PASSWORD } from './support'

const SIGN_IN_LIMIT = 3
const SIGN_IN_WINDOW_MS = 10_000
/** A little over the window, so a sign-in that waited for room is not refused on the edge. */
const ROOM_MARGIN_MS = 500

/** How long one step may take before the sign-in fails naming it. A healthy step takes well under a second. */
const STEP_MS = 20_000
/** The whole sign-in, waits for the limiter included. A healthy one takes 3 seconds or less. */
const DEADLINE_MS = 90_000

// One worker runs every spec in order (playwright.config.ts), so this module's memory is the
// run's account of the limiter. A worker that restarts loses it, and the 429 handling below covers that.
const signIns = { count: 0, last: 0 }

/**
 * Notes a sign-in that is about to be sent, from this helper or from a spec's own (the password
 * dialog of a sensitive change signs in too).
 */
export function noteSignIn() {
  const now = Date.now()
  signIns.count = now - signIns.last >= SIGN_IN_WINDOW_MS ? 1 : signIns.count + 1
  signIns.last = now
}

/** Waits until the limiter has room for one more sign-in. */
export async function leaveRoomForSignIn(page: Page) {
  const waitMs = signIns.last + SIGN_IN_WINDOW_MS + ROOM_MARGIN_MS - Date.now()
  if (signIns.count >= SIGN_IN_LIMIT && waitMs > 0) await page.waitForTimeout(waitMs)
}

/** Where a sign-in may land: the venue list, or a venue (a staff-only account goes straight in). */
export const LANDS_ANYWHERE = /\/venues(\/vn_[^/?]+(\?.*)?)?$/

export type SignInOptions = {
  /** The address the person lands on once signed in; what the spec used to expect. */
  lands?: RegExp
  /** Defaults to the demo password every seeded account shares. */
  password?: string
}

/** Signs `email` in on `page` and returns once the page has left the login form for `lands`. */
export async function signInAs(
  page: Page,
  email: string,
  { lands = LANDS_ANYWHERE, password = ADMIN_PASSWORD }: SignInOptions = {},
) {
  const started = Date.now()
  const seen: string[] = []
  const fail = (what: string): never => {
    throw new Error(
      `could not sign in as ${email}: ${what} (page at ${page.url()}; after ${Math.round(
        (Date.now() - started) / 1000,
      )} s; sign-in answers so far: ${seen.join(', ') || 'none'})`,
    )
  }

  while (Date.now() - started < DEADLINE_MS) {
    await leaveRoomForSignIn(page)
    try {
      await page.goto('/venues', { timeout: STEP_MS })
    } catch {
      fail(`the venues page did not load within ${STEP_MS / 1000} s`)
    }
    // A sign-in that answered late can have succeeded behind a turn that gave up on it: the page
    // is then already inside, with no form to fill.
    if (lands.test(page.url())) return

    const emailField = page.getByLabel('Имейл')
    try {
      await emailField.fill(email, { timeout: STEP_MS })
      await page.getByLabel('Парола').fill(password, { timeout: STEP_MS })
    } catch {
      if (lands.test(page.url())) return
      fail(`the login form did not take the email and password within ${STEP_MS / 1000} s`)
    }

    const answer = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/sign-in/email') &&
        response.request().method() === 'POST',
      { timeout: STEP_MS },
    )
    noteSignIn()
    try {
      await page.getByRole('button', { name: 'Вход' }).click({ timeout: STEP_MS })
    } catch {
      answer.catch(() => undefined)
      fail(`the sign-in button could not be pressed within ${STEP_MS / 1000} s`)
    }

    let status: number
    let retryAfterSeconds: number
    try {
      const response = await answer
      status = response.status()
      retryAfterSeconds = Number(response.headers()['x-retry-after'] ?? SIGN_IN_WINDOW_MS / 1000)
    } catch {
      return fail(`the server did not answer the sign-in within ${STEP_MS / 1000} s`)
    }
    seen.push(String(status))

    if (status === 429) {
      // Refused for being the fourth in a window (a restarted worker lost its count): wait as long
      // as the limiter says, and no longer.
      await page.waitForTimeout(retryAfterSeconds * 1000 + ROOM_MARGIN_MS)
      continue
    }
    if (status !== 200) fail(`the server answered ${status}`)

    try {
      await expect(page).toHaveURL(lands, { timeout: STEP_MS })
    } catch {
      fail(`signed in, but the page did not reach ${lands} within ${STEP_MS / 1000} s`)
    }
    return
  }
  fail(`no success within ${DEADLINE_MS / 1000} s`)
}
