// Tonight's push control (RR-86) on a production build at 390 px, through the real actions, core and
// Postgres, with the browser's push APIs stubbed: headless Chromium has no push service, so no real
// subscribe and no real buzz. Those are on Martin's hands-on script, on a real phone over HTTPS.
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import pg from 'pg'

import { runScriptWith } from './global-setup'
import { addressOfVenue } from './menu-path'
import {
  ADMIN_PASSWORD,
  GUEST_SLUG,
  TONIGHT_PIN_PEPPER,
  TONIGHT_TABLET_EMAIL,
  TONIGHT_WAITER_EMAIL,
} from './support'

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

const PHONE = { width: 390, height: 844 }
const TABLET = { width: 1180, height: 820 }
const P256DH = `B${'q'.repeat(86)}`
const AUTH = 'a'.repeat(22)

function seed(...args: string[]): string {
  return runScriptWith(
    { STAFF_PIN_PEPPER: TONIGHT_PIN_PEPPER },
    './scripts/seed-tonight-e2e.ts',
    ...args,
  )
}

/** The browser's push APIs, stubbed before any page runs. */
async function stubPush(
  context: BrowserContext,
  options: { permission: string; endpoint: string },
): Promise<void> {
  await context.addInitScript(
    ({ permission, endpoint, p256dh, auth }) => {
      const store = window.sessionStorage
      const read = (key: string, fallback: string) => store.getItem(key) ?? fallback
      const held = () => {
        if (read('push.held', '0') !== '1') return null
        return {
          endpoint,
          options: { applicationServerKey: null },
          toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }),
          unsubscribe: async () => {
            store.setItem('push.held', '0')
            return true
          },
        }
      }
      const registration = {
        pushManager: {
          getSubscription: async () => held(),
          subscribe: async () => {
            store.setItem('push.held', '1')
            return held()
          },
        },
      }
      Object.defineProperty(window, 'Notification', {
        configurable: true,
        value: {
          get permission() {
            return read('push.permission', permission)
          },
          requestPermission: async () => {
            store.setItem('push.permission', 'granted')
            return 'granted'
          },
        },
      })
      Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} })
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          register: async (url: string, opts: { scope: string }) => {
            store.setItem('push.registered', `${url} ${opts.scope}`)
            return registration
          },
          getRegistration: async () => registration,
          ready: Promise.resolve(registration),
        },
      })
    },
    { ...options, p256dh: P256DH, auth: AUTH },
  )
}

async function signIn(page: Page, email: string) {
  // Better Auth allows a few sign-ins per 10 seconds, and other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/venues')
    await page.getByLabel('Имейл').fill(email)
    await page.getByLabel('Парола').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Вход' }).click()
    try {
      // A staff sign-in lands on Tonight; the tablet's plain account on the venues until it is a device.
      await expect(page).toHaveURL(/\/venues\/vn_[^/?]+\?tab=tonight|\/venues$/, {
        timeout: 8_000,
      })
      return
    } catch {
      await page.waitForTimeout(10_000)
    }
  }
  throw new Error(`could not sign in as ${email}`)
}

async function person(
  browser: Browser,
  email: string,
  viewport: { width: number; height: number },
  push: { permission: string; endpoint: string },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport })
  await stubPush(context, push)
  const page = await context.newPage()
  await signIn(page, email)
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  await page.goto('/venues')
  return { context, page }
}

async function rowOf(endpoint: string) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 1 })
  try {
    const { rows } = await pool.query<{ email: string; revoked_at: Date | null }>(
      `select u.email, s.revoked_at from restro.push_subscriptions s
         join restro.auth_user u on u.id = s.user_id where s.endpoint = $1`,
      [endpoint],
    )
    return rows
  } finally {
    await pool.end()
  }
}

const control = (page: Page) => page.getByTestId('push-control')
const inState = (page: Page, state: string) =>
  expect(control(page)).toHaveAttribute('data-state', state)
const endpointFor = (name: string) =>
  `https://fcm.googleapis.com/fcm/send/${name}-${Date.now()}-${'x'.repeat(30)}`

async function isTappable(page: Page, name: string) {
  const box = await page.getByRole('button', { name }).boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
}

test.beforeAll(() => {
  seed('seed')
})

test('at 390 px: off, on, off, through the real action and core', async ({ browser }) => {
  const endpoint = endpointFor('phone')
  const { context, page } = await person(browser, TONIGHT_WAITER_EMAIL, PHONE, {
    permission: 'default',
    endpoint,
  })
  await inState(page, 'off')
  await expect(control(page)).toContainText('Alerts on this device: off')
  await isTappable(page, 'Turn on')
  expect(await rowOf(endpoint)).toEqual([])

  await page.getByRole('button', { name: 'Turn on' }).click()
  await inState(page, 'on')
  await expect(control(page)).toContainText('Alerts on this device: on')
  await isTappable(page, 'Turn off')
  expect(await page.evaluate(() => sessionStorage.getItem('push.registered'))).toBe(
    '/sw.js /venues/',
  )
  await expect
    .poll(() => rowOf(endpoint))
    .toEqual([{ email: TONIGHT_WAITER_EMAIL, revoked_at: null }])

  await page.getByRole('button', { name: 'Turn off' }).click()
  await inState(page, 'off')
  const [row] = await rowOf(endpoint)
  expect(row?.revoked_at).not.toBeNull()

  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  expect(fits, 'no sideways scroll').toBe(true)
  await context.close()
})

test('at 390 px: blocked by the browser says how to allow it, and offers nothing to tap', async ({
  browser,
}) => {
  const { context, page } = await person(browser, TONIGHT_WAITER_EMAIL, PHONE, {
    permission: 'denied',
    endpoint: endpointFor('blocked'),
  })
  await inState(page, 'blocked')
  await expect(control(page)).toContainText('Allow notifications for this site')
  await expect(control(page).getByRole('button')).toHaveCount(0)
  await context.close()
})

test('on the shared tablet: subscribes the tablet’s account with no PIN, and has no Off', async ({
  browser,
}) => {
  const endpoint = endpointFor('tablet')
  const { context, page } = await person(browser, TONIGHT_TABLET_EMAIL, TABLET, {
    permission: 'default',
    endpoint,
  })
  seed('device', TONIGHT_TABLET_EMAIL)
  await page.goto('/venues')
  await expect(page).toHaveURL(/\/venues\/vn_[^/?]+\?tab=tonight/)
  await inState(page, 'off')
  await expect(control(page)).toContainText('Alerts on this tablet: off')
  await page.getByRole('button', { name: 'Turn on' }).click()
  await inState(page, 'on')
  await expect(control(page)).toContainText('Alerts on this tablet: on')
  await expect(page.getByTestId('pin-sheet')).toHaveCount(0)
  await expect(control(page).getByRole('button')).toHaveCount(0)
  await expect
    .poll(() => rowOf(endpoint))
    .toEqual([{ email: TONIGHT_TABLET_EMAIL, revoked_at: null }])
  await context.close()
})

test('with no sign-in: the worker, the manifest and its icons are served', async ({ browser }) => {
  const context = await browser.newContext()
  const worker = await context.request.get('/sw.js', { maxRedirects: 0 })
  expect(worker.status()).toBe(200)
  expect(worker.headers()['content-type']).toMatch(/javascript/)
  expect(worker.headers()['cache-control']).toBe('public, max-age=0')
  expect(worker.headers()['content-security-policy']).toBeUndefined()

  const manifest = await context.request.get('/manifest.webmanifest', { maxRedirects: 0 })
  expect(manifest.status()).toBe(200)
  expect(manifest.headers()['content-type']).toMatch(/manifest\+json/)
  const read = await manifest.json()
  expect(read).toMatchObject({ start_url: '/venues', scope: '/', display: 'standalone' })
  for (const icon of read.icons as { src: string }[]) {
    const answer = await context.request.get(icon.src, { maxRedirects: 0 })
    expect(answer.status(), icon.src).toBe(200)
    expect(answer.headers()['content-type']).toBe('image/png')
  }
  await context.close()
})

test('a staff page links the manifest; a guest page links none and registers no worker', async ({
  browser,
}) => {
  const staff = await person(browser, TONIGHT_WAITER_EMAIL, PHONE, {
    permission: 'default',
    endpoint: endpointFor('links'),
  })
  await expect(staff.page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  )
  await staff.context.close()

  const guest = await browser.newContext({ viewport: PHONE })
  const page = await guest.newPage()
  const { path } = await addressOfVenue({ slug: GUEST_SLUG })
  await page.goto(path)
  await expect(page.locator('main, [data-testid="menu"], body').first()).toBeVisible()
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  expect(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
  ).toBe(0)
  await guest.close()
})
