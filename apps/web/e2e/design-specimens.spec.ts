import { type BrowserContext, expect, type Page, test } from '@playwright/test'

import { e2eSealEnvironment } from '../../worker/src/e2e-seal-keys'
import { runScriptWith } from './global-setup'
import { ADMIN_PASSWORD, TONIGHT_PIN_PEPPER } from './support'

// The speed of the Advanced panel's option pictures (D159) on the walk's demo club
// (`db:seed:demo`: a Bulgarian club menu with photos, a design, a night in progress), on a production
// build. Each tile's frame draws one part alone (the face's specimen view). The spec's targets are
// the first picture of a page within 1 s of opening it and every picture in view within 3 s, on the
// pilot PC; they are checked on the walk. GitHub's runners are slower and vary, so this spec fails
// only well past them (3 s and 8 s): it catches a return to whole-menu tiles (10-40 s), not jitter.
//
// Measured from the tap on the part's row to the specimen's root standing in the tile's frame. The
// numbers are attached to the test's report (`speed`), so every run says how fast it was.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const OWNER_EMAIL = 'owner@club-biad.test'
const FIRST_MS = 3_000
const IN_VIEW_MS = 8_000

let owner: BrowserContext
let page: Page
let venueId = ''

async function signIn(target: Page, email: string) {
  // Better Auth allows a few sign-ins per 10 seconds, and the other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await target.goto('/venues')
    await target.getByLabel('Имейл').fill(email)
    await target.getByLabel('Парола').fill(ADMIN_PASSWORD)
    await target.getByRole('button', { name: 'Вход' }).click()
    try {
      await expect(target).toHaveURL(/\/venues$/, { timeout: 5_000 })
      return
    } catch {
      await target.waitForTimeout(10_000)
    }
  }
  throw new Error(`could not sign in as ${email}`)
}

/**
 * The demo club's venue, from the seed's summary line (its ids are drawn at random). The seed seals
 * its table codes and gives its staff PINs, so it needs a public key and the PIN pepper: the test
 * process has neither (only the servers get them, playwright.config.ts). This spec never opens a
 * table code, so a throwaway pair does; the pepper is the servers' own.
 */
function seedDemo(): string {
  const out = runScriptWith(
    {
      ...e2eSealEnvironment().web,
      STAFF_PIN_PEPPER: process.env.STAFF_PIN_PEPPER ?? TONIGHT_PIN_PEPPER,
    },
    './scripts/seed-demo.ts',
  )
  for (const line of out.split('\n')) {
    if (!line.startsWith('{')) continue
    const parsed = JSON.parse(line) as { event?: string; venueId?: string }
    if (parsed.event === 'seed_demo_done' && parsed.venueId !== undefined) return parsed.venueId
  }
  throw new Error(`db:seed:demo printed no venue:\n${out}`)
}

test.beforeAll(async ({ browser }) => {
  venueId = seedDemo()
  owner = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  page = await owner.newPage()
  await signIn(page, OWNER_EMAIL)
  await owner.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
})

test.afterAll(async () => {
  await owner?.close()
})

/**
 * Waits in the page, frame by frame, until the tiles in view have drawn their specimen, and says when
 * the first and the last were drawn, in ms after `start` (the page's clock). Timed in the page, so
 * Playwright's own polling adds nothing to the numbers.
 */
function timeTiles(
  target: Page,
  pageId: string,
  start: number,
): Promise<{ inView: number; first: number; all: number }> {
  return target.evaluate(
    ({ pageId: id, since }) =>
      new Promise<{ inView: number; first: number; all: number }>((resolve, reject) => {
        const drawnAt = new Map<HTMLElement, number>()
        let shown: HTMLElement[] | null = null
        const give = setTimeout(
          () => reject(new Error('the tiles in view did not draw in 30 s')),
          30_000,
        )
        const drawn = (tile: HTMLElement) => {
          const frame = tile.querySelector<HTMLIFrameElement>(
            '[data-testid="design-tile-specimen"]',
          )
          return Boolean(frame?.contentDocument?.querySelector('[data-specimen]'))
        }
        const tick = () => {
          // This page's tiles with a picture (a row that does not apply draws none).
          const tiles = [
            ...document.querySelectorAll<HTMLElement>(
              `[data-testid="design-option"][data-page="${id}"] [data-testid="design-tile"]`,
            ),
          ].filter((tile) => tile.querySelector('[data-testid="design-tile-picture"]') !== null)
          // The tiles in view, once the page's tiles stand.
          if (shown === null && tiles.length > 0) {
            shown = tiles.filter((tile) => {
              const box = tile.getBoundingClientRect()
              return box.bottom > 0 && box.top < window.innerHeight && box.height > 0
            })
          }
          const now = performance.now() - since
          for (const tile of tiles) if (!drawnAt.has(tile) && drawn(tile)) drawnAt.set(tile, now)
          if (shown !== null && shown.length > 0 && shown.every((tile) => drawnAt.has(tile))) {
            clearTimeout(give)
            const times = shown.map((tile) => drawnAt.get(tile) ?? now)
            resolve({
              inView: shown.length,
              first: Math.round(Math.min(...drawnAt.values())),
              all: Math.round(Math.max(...times)),
            })
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    { pageId, since: start },
  )
}

for (const pageId of ['items', 'header', 'order'] as const) {
  test(`Advanced › ${pageId}: the pictures are drawn in seconds, not tens of seconds`, async () => {
    await page.goto(`/venues/${venueId}/design`)
    await expect(page.getByTestId('design-panel')).toBeVisible()
    await page
      .getByRole('group', { name: 'Level of detail' })
      .getByRole('button', { name: 'Advanced' })
      .click()
    await expect(page.getByTestId('design-part-list')).toBeVisible()

    const start = await page.evaluate(() => performance.now())
    await page.getByTestId(`design-part-${pageId}`).click()
    const { inView, first, all } = await timeTiles(page, pageId, start)
    expect(inView).toBeGreaterThan(0)
    test.info().annotations.push({
      type: 'speed',
      description: `${pageId}: first ${first} ms, ${inView} in view ${all} ms`,
    })
    expect(first, `${pageId}: the first picture`).toBeLessThanOrEqual(FIRST_MS)
    expect(all, `${pageId}: the pictures in view`).toBeLessThanOrEqual(IN_VIEW_MS)
  })
}
