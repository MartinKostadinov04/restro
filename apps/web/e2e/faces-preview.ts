// How the audit of the Editorial Market's service screens (brief SH-07) reaches them: the Design
// tab's phone preview of the demo venue, with "Preview guest services" on and demo data behind them.
// A guest sees the bag, the table bill, the waiter, paying and the receipt only once the platform
// supports them (D71), so this is the one place they are drawn. Shared by
// faces-a11y-services.spec.ts and faces-visual.spec.ts.
//
// The demo venue's items are linked to the till, so they can be ordered (a "+" on each card); every
// service is switched on in its settings for the length of one spec file (`servicesOn`), and put back
// afterwards (`servicesBack`).
import {
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
} from '@playwright/test'
import { THEME_PRESETS } from '@restro/core'
import pg from 'pg'

import { dialogs, settled, withAudit } from './faces-audit'
import { addressOfVenue } from './menu-path'
import { ADMIN_EMAIL, ADMIN_PASSWORD, GUEST_SLUG, VENUE_NAME } from './support'
import { CUSTOM_COLOURS, type VisualTheme } from './visual-fixtures'

/** The template's root inside the preview's phone frame. */
export const PREVIEW_FACE =
  '[data-testid="phone-frame"] [data-face="editorial-market"]:not([data-testid])'

/** The five service screens, in the order a guest meets them. */
export const SCREENS = ['bag', 'bill', 'call', 'pay', 'receipt'] as const
export type Screen = (typeof SCREENS)[number]

async function withOwnerPool(run: (pool: pg.Pool) => Promise<void>): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 1 })
  try {
    await run(pool)
  } finally {
    await pool.end()
  }
}

/** Every service on, in the demo venue's own settings: the draft the preview is built from has them. */
export async function servicesOn(): Promise<void> {
  await withOwnerPool(async (pool) => {
    await pool.query(
      `update restro.venues set settings = coalesce(settings, '{}'::jsonb) || $1::jsonb where slug = $2`,
      [
        JSON.stringify({
          guest_features: {
            filters: true,
            call_waiter: {
              enabled: true,
              kinds: ['waiter', 'bill', 'water', 'cutlery', 'terminal', 'other'],
            },
            bill: true,
            ordering: true,
            pay: true,
          },
        }),
        GUEST_SLUG,
      ],
    )
  })
}

/** The demo venue goes back to the services it has by default (none on, filters on). */
export async function servicesBack(): Promise<void> {
  await withOwnerPool(async (pool) => {
    await pool.query(
      `update restro.venues set settings = settings - 'guest_features' where slug = $1`,
      [GUEST_SLUG],
    )
  })
}

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

/** The owner of the demo venue, signed in, in English, on a page of its own. */
export interface Owner {
  readonly context: BrowserContext
  readonly page: Page
  readonly venueId: string
}

export async function signInAsOwner(browser: Browser): Promise<Owner> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const page = await context.newPage()
  await signIn(page, ADMIN_EMAIL)
  await page
    .getByTestId('venue-card')
    .filter({ hasText: VENUE_NAME })
    .getByRole('link', { name: 'Отвори' })
    .click()
  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}/)
  const venueId = /\/venues\/(vn_[0-9A-Za-z]+)/.exec(page.url())?.[1] ?? ''
  expect((await addressOfVenue({ venueId })).slug).toBe(GUEST_SLUG)
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  return { context, page, venueId }
}

/** Opens the Design tab at a width, with the services preview on, in a colour scheme. */
export async function openPreview(
  { page, venueId }: Pick<Owner, 'page' | 'venueId'>,
  width: number,
  scheme: 'light' | 'dark' = 'light',
): Promise<void> {
  await withAudit(page)
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(`/venues/${venueId}?tab=design`)
  await expect(page.locator(PREVIEW_FACE)).toBeVisible()
  const preview = page.getByTestId('design-preview')
  await preview.getByRole('button', { name: scheme === 'light' ? 'Light' : 'Dark' }).click()
  const services = page.getByTestId('design-preview-services')
  if ((await services.getAttribute('aria-checked')) !== 'true') await services.click()
  // The bar with the waiter button, and the bill and pay entries in the header.
  await expect(page.locator(`${PREVIEW_FACE} .ro-waiter`)).toBeVisible()
  await expect(page.locator(`${PREVIEW_FACE} .ro-payentry`)).toBeVisible()
}

/**
 * Sets the look of the preview through the three colour boxes (the Design subtab is brand-first
 * since S7, D93: no preset buttons): a designer preset's three colours from core, or the custom
 * theme's. The brand colour goes first, since it pre-fills the page and the panels.
 */
export async function chooseTheme(page: Page, theme: VisualTheme): Promise<void> {
  const preset = THEME_PRESETS.find((candidate) => candidate.id === theme.id)
  if (theme.id !== 'custom' && preset === undefined) {
    throw new Error(`there is no preset ${theme.id} in core`)
  }
  const colours = preset?.colours ?? CUSTOM_COLOURS
  for (const [label, value] of [
    ['Your brand colour', colours.tertiary],
    ['Page', colours.primary],
    ['Panels', colours.secondary],
  ] as const) {
    await page.getByLabel(label, { exact: true }).fill(value)
  }
}

/** The control that opens a screen. */
export const opener = (page: Page, screen: Screen): Locator =>
  page.locator(
    {
      bag: `${PREVIEW_FACE} .ro-bagbtn`,
      bill: `${PREVIEW_FACE} .ro-pill`,
      call: `${PREVIEW_FACE} .ro-waiter`,
      pay: `${PREVIEW_FACE} .ro-payentry`,
      receipt: `${PREVIEW_FACE} .ro-payentry`,
    }[screen],
  )

/** Puts a dish in the bag, so the bag has its button. */
export async function fillBag(page: Page): Promise<void> {
  if ((await page.locator(`${PREVIEW_FACE} .ro-bagbtn`).count()) > 0) return
  await page.locator(`${PREVIEW_FACE} .ro-plus`).first().click()
  await expect(page.locator(`${PREVIEW_FACE} .ro-bagbtn`)).toBeVisible()
}

/** From the open pay sheet to the receipt: pays the demo bill by card and opens the receipt. */
export async function payAndOpenReceipt(page: Page): Promise<void> {
  const sheet = dialogs(page).last()
  await sheet.locator('.ro-pay:not(.is-apple)').first().click()
  await expect(sheet.locator('.ro-state[data-tone="ok"]')).toBeVisible({ timeout: 15_000 })
  await sheet.locator('.ro-primary').click()
  await expect(sheet.locator('.ro-receipt')).toBeVisible()
}

/** Opens a screen and runs `check` on it; the screen is closed again afterwards. */
export async function onScreen(
  page: Page,
  screen: Screen,
  check: (sheet: Locator) => Promise<void>,
): Promise<void> {
  await fillBag(page)
  await opener(page, screen).click()
  if (screen === 'receipt') await payAndOpenReceipt(page)
  const sheet = dialogs(page).last()
  await expect(sheet).toBeVisible()
  await settled(page)
  await check(sheet)
  await page.keyboard.press('Escape')
  await expect(dialogs(page)).toHaveCount(0)
}
