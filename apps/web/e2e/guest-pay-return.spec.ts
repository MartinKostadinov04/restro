// The guest page's address after a redirect from a card form (#114; D127 "A redirect's address is
// cleaned before any request"; design §11), on a production build. Nothing here needs a key or a
// provider: the redirect is faked by opening the page with the query a provider adds to its return
// address (a payment's id, its client secret and a result), and the page has to take those out of the
// address with `history.replaceState` before it asks for anything else or loads anything else.
//
// The fixture is scripts/seed-send-e2e.ts (a venue on the simulated POS with a table and a code),
// the same page the Send specs use. It runs on the renderer in both Styles (guest-faces.ts).
import { devices, expect, test } from '@playwright/test'

import { runScript } from './global-setup'
import { faceRoot, ORDER_STYLES, type OrderStyle } from './guest-faces'

test.use({ ...devices['Pixel 7'] })

const PORT = Number(process.env.E2E_PORT ?? 3100)
const SIM = `127.0.0.1:${PORT + 3}`

/** What a provider adds to a return address (made up: they stand for no payment). */
const RETURN_QUERY =
  'payment_intent=pi_return_test&payment_intent_client_secret=pi_return_test_secret_x&redirect_status=succeeded'
const SECRET = 'pi_return_test_secret_x'

function seed(style: OrderStyle): { path: string; code: string } {
  const output = runScript('./scripts/seed-send-e2e.ts', 'seed', SIM, style)
  const line = output
    .split('\n')
    .reverse()
    .find((candidate) => candidate.includes('seed_send_e2e_done'))
  if (!line) throw new Error(`the seed printed no result:\n${output}`)
  return JSON.parse(line) as { path: string; code: string }
}

for (const style of ORDER_STYLES) {
  test.describe(`in ${style}`, () => {
    test('the provider values leave the address before anything else is asked for', async ({
      page,
    }) => {
      const { path, code } = seed(style)
      const asked: string[] = []
      page.on('request', (request) => {
        // The first document is the address as the browser had it; everything after it is the page's.
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) return
        asked.push(request.url())
      })

      await page.goto(`${path}?lang=en&${RETURN_QUERY}#t=${code}`)
      await expect(faceRoot(page)).toBeVisible()

      // The address bar holds nothing of the provider's, and still holds the guest's language and table.
      const url = new URL(page.url())
      expect(url.search).toBe('?lang=en')
      expect(url.hash).toContain(code)
      expect(page.url()).not.toContain('payment_intent')
      expect(page.url()).not.toContain(SECRET)

      // No request the page made carried them: not the menu's files, not the guest API, not a font.
      expect(asked.length).toBeGreaterThan(0)
      expect(
        asked.filter(
          (requested) => requested.includes(SECRET) || requested.includes('payment_intent'),
        ),
      ).toEqual([])

      // The tab noted that the guest came back, so a payment of this phone's would be read at once.
      const marker = await page.evaluate(() => window.sessionStorage.getItem('restro.payReturned'))
      expect(marker).toBe('1')
      // And the secret was kept nowhere.
      const kept = await page.evaluate(() =>
        JSON.stringify({ ...window.sessionStorage, ...window.localStorage }),
      )
      expect(kept).not.toContain(SECRET)
    })

    test('an ordinary address is left alone', async ({ page }) => {
      const { path, code } = seed(style)
      await page.goto(`${path}?lang=en#t=${code}`)
      await expect(faceRoot(page)).toBeVisible()
      expect(new URL(page.url()).search).toBe('?lang=en')
      expect(
        await page.evaluate(() => window.sessionStorage.getItem('restro.payReturned')),
      ).toBeNull()
    })

    test('the guest pages carry the card form’s Content-Security-Policy and nothing wider', async ({
      page,
    }) => {
      const { path, code } = seed(style)
      const response = await page.goto(`${path}?lang=en#t=${code}`)
      const policy = response?.headers()['content-security-policy'] ?? ''
      expect(policy).toContain('script-src')
      expect(policy).toContain('https://js.stripe.com')
      expect(policy).toContain('https://api.stripe.com')
      expect(policy).toContain('https://hooks.stripe.com')
      // Only these three directives: images, fonts and styles are not restricted by it.
      expect(policy.split('; ').map((part) => part.split(' ')[0])).toEqual([
        'script-src',
        'frame-src',
        'connect-src',
      ])
      // The page still works under it: the menu shows and no script was blocked.
      await expect(faceRoot(page)).toBeVisible()
    })
  })
}
