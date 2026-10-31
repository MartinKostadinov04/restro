// A venue's page on a 390 px phone, on a production build (RR-79, RR-80, RR-85): large text never
// runs off the side; on Tonight the night's work comes first, so Publish is not offered to someone
// who can't publish and follows the work for someone who can; and a tablet signed in with an owner's
// account is not offered what would only answer "not allowed". The fixture is
// scripts/seed-tonight-e2e.ts. The admin is read in English.
import { type Browser, expect, type Page, test } from '@playwright/test'

import { runScriptWith } from './global-setup'
import {
  ADMIN_EMAIL,
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
        timeout: 30_000,
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

/** A bar still streaming in has a hidden copy for a moment: only what is on screen counts. */
function onScreen(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true })
}

let waiter: Page
let owner: Page
let venuePath: string

test.beforeAll(async ({ browser }) => {
  // Two scripts and two sign-ins take more than a hook's own 30 seconds on a busy machine.
  test.setTimeout(240_000)
  seed('seed')
  seed('night', 'empty')
  waiter = await signIn(browser, TONIGHT_WAITER_EMAIL)
  owner = await signIn(browser, TONIGHT_OWNER_EMAIL)
  await owner.goto('/venues')
  const href = await owner.getByRole('link', { name: 'Open' }).first().getAttribute('href')
  venuePath = href ?? ''
})

test.afterAll(async () => {
  await waiter?.context().close()
  await owner?.context().close()
})

test('the header at 200% text stays inside a 390 px phone (RR-79)', async () => {
  await owner.goto(`${venuePath}?tab=studio`)
  await expect(onScreen(owner, 'guest-link')).toBeVisible({ timeout: 30_000 })
  await owner.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  // Once the page has settled at the new size there is no sideways scroll.
  await expect
    .poll(() =>
      owner.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBe(0)
  for (const testId of ['guest-link', 'publish-button']) {
    const box = await onScreen(owner, testId).boundingBox()
    expect(box, testId).not.toBeNull()
    expect((box?.x ?? 0) + (box?.width ?? 0), testId).toBeLessThanOrEqual(PHONE.width)
  }
  await owner.screenshot({ path: test.info().outputPath('rr-79-header-200-percent.png') })
})

test('on Tonight a waiter is not offered Publish at all (RR-80)', async () => {
  await waiter.goto(`${venuePath}?tab=tonight`)
  await expect(onScreen(waiter, 'tonight')).toBeVisible({ timeout: 30_000 })
  await expect(waiter.getByTestId('publish-bar')).toHaveCount(0)
  await expect(waiter.getByTestId('publish-button')).toHaveCount(0)
  await expect(waiter.getByTestId('tonight-publish')).toHaveCount(0)
  await waiter.screenshot({ path: test.info().outputPath('rr-80-waiter-tonight.png') })
})

test('on Tonight an owner with nothing to press sees no greyed Publish (RR-80)', async () => {
  // The fixture's venue has no menu: everywhere else the bar says so with its buttons off.
  await owner.goto(`${venuePath}?tab=tonight`)
  await expect(onScreen(owner, 'tonight')).toBeVisible({ timeout: 30_000 })
  await expect(owner.locator('[hidden][id*="S:"]')).toHaveCount(0)
  await expect(owner.getByTestId('publish-button')).toHaveCount(0)
  await expect(owner.getByTestId('guest-link')).toHaveCount(0)
  await expect(owner.getByTestId('tonight-publish')).toBeHidden()
  await owner.screenshot({
    path: test.info().outputPath('rr-80-owner-nothing-to-press.png'),
    fullPage: true,
  })
  // Elsewhere it still heads the page.
  await owner.goto(`${venuePath}?tab=settings`)
  await expect(onScreen(owner, 'publish-button')).toBeVisible({ timeout: 30_000 })
  await expect(owner.getByTestId('tonight-publish')).toHaveCount(0)
})

test('on Tonight what an owner can press follows the night’s work (RR-80)', async ({ browser }) => {
  // The demo venue has a menu: published or not, there is a guest page or a Publish to press.
  const demo = await signIn(browser, ADMIN_EMAIL)
  await demo.goto('/venues')
  const open = demo.getByRole('link', { name: 'Open' }).first()
  await demo.goto(`${(await open.getAttribute('href')) ?? ''}?tab=tonight`)
  const work = onScreen(demo, 'tonight')
  await expect(work).toBeVisible({ timeout: 30_000 })
  const section = onScreen(demo, 'tonight-publish')
  await expect(section).toBeVisible({ timeout: 30_000 })
  await expect(section.getByRole('button').or(section.getByRole('link')).first()).toBeVisible()
  await expect(section.locator(':disabled')).toHaveCount(0)
  await expect(demo.getByRole('combobox').nth(1)).toContainText('Actions and tables')
  const workBox = await work.boundingBox()
  const sectionBox = await section.boundingBox()
  expect(sectionBox?.y ?? 0).toBeGreaterThanOrEqual((workBox?.y ?? 0) + (workBox?.height ?? 0))
  await demo.screenshot({
    path: test.info().outputPath('rr-80-owner-tonight.png'),
    fullPage: true,
  })
  await demo.context().close()
})

test('a tablet with an owner’s account is not offered what it would be refused (RR-85)', async ({
  browser,
}) => {
  const tablet = await signIn(browser, TONIGHT_OWNER_EMAIL)
  // The newest session of the account becomes a shared device, as "mark this device" does.
  seed('device', TONIGHT_OWNER_EMAIL)

  await tablet.goto('/venues')
  await expect(tablet.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })
  await expect(tablet.getByTestId('new-venue')).toHaveCount(0)
  await tablet.getByRole('button', { name: /sidebar/i }).click()
  await expect(tablet.getByTestId('venue-nav-item').first()).toBeVisible()
  await expect(tablet.getByTestId('venue-nav-new')).toHaveCount(0)
  await expect(tablet.getByTestId('nav-settings')).toHaveCount(0)
  await tablet.waitForTimeout(500) // the side sheet slides in
  await tablet.screenshot({ path: test.info().outputPath('rr-85-tablet-menu.png') })

  // The old links: the organisation's Settings say what they need, the venue's land on Tonight.
  await tablet.goto('/settings')
  await expect(tablet.getByTestId('settings-own-signin')).toBeVisible({ timeout: 30_000 })
  await expect(tablet.getByTestId('settings-content')).toHaveCount(0)
  await tablet.screenshot({ path: test.info().outputPath('rr-85-tablet-settings.png') })

  await tablet.goto(`${venuePath}?tab=settings`)
  await expect(tablet).toHaveURL(/\?tab=tonight$/)
  // Tonight is all it has, so there is no choosing a tab.
  await expect(onScreen(tablet, 'tonight')).toBeVisible({ timeout: 30_000 })
  await expect(tablet.getByRole('combobox', { name: 'Switch tab' })).toHaveCount(0)
  await expect(tablet.getByTestId('publish-button')).toHaveCount(0)
  await tablet.screenshot({ path: test.info().outputPath('rr-85-tablet-tonight.png') })

  // The owner's own phone is what it was.
  await owner.goto('/venues')
  await expect(onScreen(owner, 'new-venue')).toBeVisible({ timeout: 30_000 })
  await tablet.context().close()
})

test('Tonight and the Settings screens wrap at 200% text inside a 390 px phone (RR-79)', async () => {
  // A busy night, so the rows, their buttons and the phone's switch are all there to wrap.
  seed('night', 'busy')
  const screens = [
    ['Tonight', '?tab=tonight', 'tonight'],
    ['the end of the night', '?tab=tonight&view=night', 'tonight-night'],
    ['Settings › General', '?tab=settings&section=general', 'settings-general'],
    ['Settings › Hours', '?tab=settings&section=hours', 'hours-panel'],
    ['Settings › Ordering', '?tab=settings&section=ordering', 'ordering-panel'],
    ['Settings › Staff and roles', '?tab=settings&section=staff', 'staff-panel'],
    ['Settings › Alerts', '?tab=settings&section=alerts', 'alerts-panel'],
  ] as const
  for (const [name, query, testId] of screens) {
    await owner.goto(`${venuePath}${query}`)
    await expect(onScreen(owner, testId)).toBeVisible({ timeout: 30_000 })
    await owner.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })
    await expect
      .poll(
        () =>
          owner.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        { message: `${name} at 200% text` },
      )
      .toBeLessThanOrEqual(0)
  }
})
