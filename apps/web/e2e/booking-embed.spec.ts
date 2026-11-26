// The booking page framed only where configuration allows (#581, D178), on a production build: the
// web server runs with BOOKING_FRAME_ANCESTORS naming one other site, `http://127.0.0.1:<PORT + 4>`
// (playwright.config.ts), which `next build` never saw, so the header comes from the environment
// the server runs in. This spec serves a tiny page that frames the booking page from that port:
//
//   - on the configured origin, the booking page shows inside the frame;
//   - on another origin (`localhost` on the same port: another site to the browser), the browser
//     refuses the frame;
//   - the booking page and a guest's own link send that policy, keep no referrer, and the link
//     stays out of every cache.
//
// The fixture is scripts/seed-booking-e2e.ts (Booking Club's Demo Bar, online booking on).
import { createServer, type Server } from 'node:http'

import { expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'

test.describe.configure({ mode: 'serial' })

const PORT = Number(process.env.E2E_PORT ?? 3100)
const SIM = `127.0.0.1:${PORT + 3}`
const FRAME_HOST_PORT = PORT + 4
const BOOKING_ORIGIN = `http://127.0.0.1:${PORT}`
/** The site BOOKING_FRAME_ANCESTORS names. */
const ALLOWED = `http://127.0.0.1:${FRAME_HOST_PORT}`
/** The same server under another name: another origin, which nothing allows. */
const OTHER = `http://localhost:${FRAME_HOST_PORT}`

/** Cloudflare's script, stubbed: the page loads it, and nothing here sends a request. */
const TURNSTILE_STUB = `window.turnstile = {
  render() { return 'w1' },
  execute() {},
  remove() {},
}`

function seededPath(): string {
  const output = runScript('./scripts/seed-booking-e2e.ts', 'seed', SIM, 'on')
  const line = output
    .split('\n')
    .reverse()
    .find((candidate) => candidate.includes('seed_booking_e2e_done'))
  if (!line) throw new Error(`the seed printed no seed_booking_e2e_done:\n${output}`)
  return (JSON.parse(line) as { path: string }).path
}

/** The club's own page: one frame, the booking page in it. */
function framingPage(src: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Club site</title></head>
<body><h1>Club site</h1><iframe src="${src}" title="Book a table" width="400" height="800"></iframe></body></html>`
}

async function stubTurnstile(page: Page): Promise<void> {
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
  )
}

test.describe('the booking page in another site’s frame', () => {
  let path = ''
  let server: Server

  test.beforeAll(async () => {
    path = seededPath()
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(framingPage(`${BOOKING_ORIGIN}${path}?lang=en`))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(FRAME_HOST_PORT, resolve)
    })
  })

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test('the booking page and a guest link name their own origin and the configured site, and keep no referrer', async ({
    request,
  }) => {
    const policy = `frame-ancestors 'self' ${ALLOWED}`
    const page = await request.get(path)
    expect(page.status()).toBe(200)
    expect(page.headers()['content-security-policy']).toBe(policy)
    expect(page.headers()['referrer-policy']).toBe('no-referrer')
    // X-Frame-Options cannot name another site, so the booking page sends none.
    expect(page.headers()['x-frame-options']).toBeUndefined()

    // A guest's own link (#579): the same policy, no referrer, and never kept in a cache.
    const link = await request.get(`${path}/${'Ab0_'.repeat(10)}Ab0`)
    expect(link.headers()['content-security-policy']).toBe(policy)
    expect(link.headers()['referrer-policy']).toBe('no-referrer')
    expect(link.headers()['cache-control']).toContain('no-store')

    // The admin is still framed by its own origin only.
    const admin = await request.get('/login')
    expect(admin.headers()['content-security-policy']).toBe("frame-ancestors 'self'")
    expect(admin.headers()['x-frame-options']).toBe('SAMEORIGIN')
  })

  test('a page on the configured site shows the booking page in its frame', async ({ page }) => {
    const refusals: string[] = []
    page.on('console', (message) => {
      if (message.text().includes('frame-ancestors')) refusals.push(message.text())
    })
    await stubTurnstile(page)
    await page.goto(`${ALLOWED}/`)
    const frame = page.frameLocator('iframe')
    await expect(frame.locator('[data-page="booking"]')).toBeVisible({ timeout: 20_000 })
    await expect(frame.getByRole('heading', { level: 1, name: 'Book a table' })).toBeVisible()
    expect(refusals).toEqual([])
  })

  test('a page on any other site is refused by the browser', async ({ page }) => {
    await stubTurnstile(page)
    const refused = page.waitForEvent('console', {
      predicate: (message) => message.text().includes('frame-ancestors'),
      timeout: 20_000,
    })
    const framed = page.waitForResponse((response) => response.url().startsWith(BOOKING_ORIGIN))
    await page.goto(`${OTHER}/`)
    await expect(page.getByRole('heading', { name: 'Club site' })).toBeVisible()
    // The booking page answered, and the browser would not show it there.
    expect((await framed).headers()['content-security-policy']).toBe(
      `frame-ancestors 'self' ${ALLOWED}`,
    )
    await refused
    await expect(page.frameLocator('iframe').locator('[data-page="booking"]')).toHaveCount(0)
  })
})
