// A venue's page on a 390 px phone, on a production build (RR-79, RR-80, RR-85): large text never
// runs off the side; on Tonight the night's work comes first, so Publish is not offered to someone
// who can't publish and follows the work for someone who can; and a tablet signed in with an owner's
// account is not offered what would only answer "not allowed". The fixture is
// scripts/seed-tonight-e2e.ts. The admin is read in English.
import { type Browser, expect, type Page, test } from '@playwright/test'

import { runScriptWith } from './global-setup'
import {
  ADMIN_PASSWORD,
  TONIGHT_OWNER_EMAIL,
  TONIGHT_PIN_PEPPER,
  TONIGHT_WAITER_EMAIL,
} from './support'

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const PHONE = { width: 390, height: 844 }

function seed(...args: string[]): string {
  return runScriptWith(
    { STAFF_PIN_PEPPER: TONIGHT_PIN_PEPPER },
    './scripts/seed-tonight-e2e.ts',
    ...args,
  )
}

async function signIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: PHONE })
  const page = await context.newPage()
  // Better Auth allows a few sign-ins per 10 seconds, and other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/venues')
    await page.getByLabel('Имейл').fill(email)
    await page.getByLabel('Парола').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Вход' }).click()
    try {
      await expect(page).toHaveURL(/\/venues\/vn_[^/?]+\?tab=tonight|\/venues$/, {
        timeout: 8_000,
      })
      await context.addCookies([
        { name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin },
      ])
      return page
    } catch {
      await page.waitForTimeout(10_000)
    }
  }
  throw new Error(`could not sign in as ${email}`)
}

let waiter: Page
let owner: Page
let venuePath: string

test.beforeAll(async ({ browser }) => {
  seed('seed')
  seed('night', 'empty')
  waiter = await signIn(browser, TONIGHT_WAITER_EMAIL)
  venuePath = new URL(waiter.url()).pathname
  owner = await signIn(browser, TONIGHT_OWNER_EMAIL)
})

test.afterAll(async () => {
  await waiter?.context().close()
  await owner?.context().close()
})

test('the header at 200% text stays inside a 390 px phone (RR-79)', async ({}, testInfo) => {
  await owner.goto(`${venuePath}?tab=composer`)
  await expect(owner.getByTestId('guest-link')).toBeVisible()
  await owner.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  const sideways = await owner.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(sideways.scroll).toBeLessThanOrEqual(sideways.client)
  for (const testId of ['guest-link', 'publish-button']) {
    const box = await owner.getByTestId(testId).boundingBox()
    expect(box, testId).not.toBeNull()
    expect((box?.x ?? 0) + (box?.width ?? 0), testId).toBeLessThanOrEqual(PHONE.width)
  }
  await owner.screenshot({ path: testInfo.outputPath('rr-79-header-200-percent.png') })
})

test('on Tonight a waiter is not offered Publish at all (RR-80)', async ({}, testInfo) => {
  await waiter.goto(`${venuePath}?tab=tonight`)
  await expect(waiter.getByTestId('tonight')).toBeVisible()
  await expect(waiter.getByTestId('publish-bar')).toHaveCount(0)
  await expect(waiter.getByTestId('publish-button')).toHaveCount(0)
  await expect(waiter.getByTestId('tonight-publish')).toHaveCount(0)
  await waiter.screenshot({ path: testInfo.outputPath('rr-80-waiter-tonight.png') })
})

test('on Tonight the owner’s Publish follows the night’s work (RR-80)', async ({}, testInfo) => {
  await owner.goto(`${venuePath}?tab=tonight`)
  const work = owner.getByTestId('tonight')
  await expect(work).toBeVisible()
  const publish = owner.getByTestId('publish-button')
  await expect(publish).toBeVisible()
  const workBox = await work.boundingBox()
  const publishBox = await publish.boundingBox()
  expect(publishBox?.y ?? 0).toBeGreaterThanOrEqual((workBox?.y ?? 0) + (workBox?.height ?? 0))
  await owner.screenshot({ path: testInfo.outputPath('rr-80-owner-tonight.png'), fullPage: true })
  // Elsewhere it still heads the page.
  await owner.goto(`${venuePath}?tab=settings`)
  await expect(owner.getByTestId('publish-button')).toBeVisible()
  await expect(owner.getByTestId('tonight-publish')).toHaveCount(0)
})

test('a tablet with an owner’s account is not offered what it would be refused (RR-85)', async ({
  browser,
}, testInfo) => {
  const tablet = await signIn(browser, TONIGHT_OWNER_EMAIL)
  // The newest session of the account becomes a shared device, as "mark this device" does.
  seed('device', TONIGHT_OWNER_EMAIL)

  await tablet.goto('/venues')
  await expect(tablet.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(tablet.getByTestId('new-venue')).toHaveCount(0)
  await tablet.getByRole('button', { name: /sidebar/i }).click()
  await expect(tablet.getByTestId('venue-nav-item').first()).toBeVisible()
  await expect(tablet.getByTestId('venue-nav-new')).toHaveCount(0)
  await expect(tablet.getByTestId('nav-settings')).toHaveCount(0)
  await tablet.screenshot({ path: testInfo.outputPath('rr-85-tablet-menu.png') })

  // The old links: the organisation's Settings say what they need, the venue's land on Tonight.
  await tablet.goto('/settings')
  await expect(tablet.getByTestId('settings-own-signin')).toBeVisible()
  await expect(tablet.getByTestId('settings-content')).toHaveCount(0)
  await tablet.screenshot({ path: testInfo.outputPath('rr-85-tablet-settings.png') })

  await tablet.goto(`${venuePath}?tab=settings`)
  await expect(tablet).toHaveURL(/\?tab=tonight$/)
  await expect(tablet.getByRole('tab')).toHaveText(['Tonight'])
  await expect(tablet.getByTestId('publish-button')).toHaveCount(0)

  // The owner's own phone is what it was.
  await owner.goto('/venues')
  await expect(owner.getByTestId('new-venue')).toBeVisible()
  await tablet.context().close()
})
