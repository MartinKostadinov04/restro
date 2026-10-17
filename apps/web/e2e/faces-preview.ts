// How the audit of a template's service screens (brief SH-07, T89) reaches them: the Design tab's
// phone preview of the demo venue, with "Preview guest services" on and demo data behind them.
// A guest sees the bag, the table bill, the waiter, paying and the receipt only once the platform
// supports them (D71), so this is the one place they are drawn. Shared by
// faces-a11y-services.spec.ts and faces-visual.spec.ts.
//
// The template under test is one id, `FACES_VISUAL_FACE` (default `editorial-market`), and every
// control is found through the face contract's markers (guide §5.5 and §7.3: `data-slot`,
// `data-item`), never through a template's class names. Two things the contract has no marker for
// are still driven through Editorial Market's own markup, and only for it (see `ADD_TO_BAG` and
// `payAndOpenReceipt`); any other template skips those steps with a named reason.
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

/** The template this run draws: `FACES_VISUAL_FACE`, or Editorial Market. */
export const FACE_ID = process.env.FACES_VISUAL_FACE || 'editorial-market'
if (!/^[a-z][a-z0-9-]*$/.test(FACE_ID)) {
  throw new Error(`FACES_VISUAL_FACE must be a template id such as "qr-phone", not "${FACE_ID}"`)
}

/** The template's root inside the preview's phone frame. */
export const PREVIEW_FACE = `[data-testid="phone-frame"] [data-face="${FACE_ID}"]:not([data-testid])`

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

/**
 * Every service on, and the template `face` chosen, in the demo venue's own settings: the draft the
 * preview is built from has them. (A hidden template cannot be picked in the Design tab, so the
 * settings are written here, the way the seeds do.)
 */
export async function servicesOn(face: string = FACE_ID): Promise<void> {
  await withOwnerPool(async (pool) => {
    await pool.query(
      `update restro.venues set settings = coalesce(settings, '{}'::jsonb) || $1::jsonb where slug = $2`,
      [
        JSON.stringify({
          presentation: { face, options: {} },
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

/** The demo venue goes back to the services and the template it has by default (none on, filters on). */
export async function servicesBack(): Promise<void> {
  await withOwnerPool(async (pool) => {
    await pool.query(
      `update restro.venues set settings = settings - 'guest_features' - 'presentation' where slug = $1`,
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

/**
 * Opens the Design tab at a width, with the services preview on, in a colour scheme. Unless
 * `servicesOptional`, the template must draw the waiter button and the pay entry (a template that
 * lists no services draws neither: the visual spec passes the option and skips what is missing).
 */
export async function openPreview(
  { page, venueId }: Pick<Owner, 'page' | 'venueId'>,
  width: number,
  scheme: 'light' | 'dark' = 'light',
  { servicesOptional = false }: { servicesOptional?: boolean } = {},
): Promise<void> {
  await withAudit(page)
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(`/venues/${venueId}?tab=design`)
  await expect(page.locator(PREVIEW_FACE)).toBeVisible()
  const preview = page.getByTestId('design-preview')
  await preview.getByRole('button', { name: scheme === 'light' ? 'Light' : 'Dark' }).click()
  const services = page.getByTestId('design-preview-services')
  if ((await services.getAttribute('aria-checked')) !== 'true') await services.click()
  await expect(services).toHaveAttribute('aria-checked', 'true')
  if (servicesOptional) {
    await settled(page)
    return
  }
  // The bar with the waiter button, and the bill and pay entries in the header.
  await expect(opener(page, 'call')).toBeVisible()
  await expect(opener(page, 'pay')).toBeVisible()
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

/** The control of a menu-level slot (guide §5.5) inside the preview's template. */
const slot = (name: string): string => `${PREVIEW_FACE} [data-slot="${name}"]`

/** The control that opens a screen: the slot the contract names for its feature. */
export const opener = (page: Page, screen: Screen): Locator =>
  page.locator(
    {
      // `menu.bag` is the bag's place; the button is the slot itself or inside it, and only while the bag has a dish.
      bag: `${slot('menu.bag')}:is(button), ${slot('menu.bag')} button`,
      bill: slot('menu.bill'),
      call: slot('menu.call_waiter'),
      pay: slot('menu.pay'),
      receipt: slot('menu.pay'),
    }[screen],
  )

/**
 * The control on a dish card that puts the dish in the bag. The contract has no marker for it
 * (stop-and-ask in the T89 report; proposed: `data-slot="item.add"` on the control). Until it has,
 * Editorial Market's own quick-add button is used, for it alone.
 */
const ADD_TO_BAG =
  FACE_ID === 'editorial-market'
    ? `${PREVIEW_FACE} [data-slot="item.add"], ${PREVIEW_FACE} .ro-plus`
    : `${PREVIEW_FACE} [data-slot="item.add"]`

/** Puts a dish in the bag when the template has a way to, so the bag has its button. */
export async function tryFillBag(page: Page): Promise<boolean> {
  if ((await opener(page, 'bag').count()) > 0) return true
  const add = page.locator(ADD_TO_BAG).first()
  if ((await add.count()) === 0) return false
  await add.click()
  await expect(opener(page, 'bag')).toBeVisible()
  return true
}

/** The same, and it fails when the template cannot fill the bag. */
export async function fillBag(page: Page): Promise<void> {
  expect(await tryFillBag(page), 'a dish can be put in the bag').toBe(true)
}

/**
 * Why a screen cannot be shot for this template, or null when it can. Call after `tryFillBag`. A
 * template draws a service control only when it lists the feature (guide §5.5), so a missing slot
 * is a template that has no such service, not a failure.
 */
export async function whyNoScreen(page: Page, screen: Screen): Promise<string | null> {
  const feature = {
    bag: 'menu.bag',
    bill: 'menu.bill',
    call: 'menu.call_waiter',
    pay: 'menu.pay',
    receipt: 'menu.pay',
  }[screen]
  if ((await page.locator(slot(feature)).count()) === 0) {
    return `${FACE_ID} draws no ${feature} (its manifest lists no such feature), so there is no ${screen} screen`
  }
  if ((await opener(page, screen).count()) === 0) {
    return `${FACE_ID} has no way to put a dish in the bag (no "item.add" marker in the contract), so there is no ${screen} screen`
  }
  if (screen === 'receipt' && FACE_ID !== 'editorial-market') {
    return `the pay sheet's controls have no contract marker, so ${FACE_ID}'s receipt cannot be reached`
  }
  return null
}

/**
 * Switches the template's language control to `lang` (a button or radio whose text is the code).
 * The control is the template's own markup (the contract has no marker for it); false when the
 * template draws none in the preview.
 */
export async function chooseLanguage(page: Page, lang: string): Promise<boolean> {
  const control = page
    .locator(PREVIEW_FACE)
    .locator('button, [role="radio"]')
    .filter({ hasText: new RegExp(`^${lang}$`, 'i') })
    .first()
  if ((await control.count()) === 0) return false
  await control.click()
  return true
}

/**
 * From the open pay sheet to the receipt: pays the demo bill by card and opens the receipt. The
 * pay sheet's controls are not in the contract; these are Editorial Market's (`whyNoScreen` keeps
 * other templates out).
 */
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
  await tryFillBag(page)
  await opener(page, screen).click()
  if (screen === 'receipt') await payAndOpenReceipt(page)
  const sheet = dialogs(page).last()
  await expect(sheet).toBeVisible()
  await settled(page)
  await check(sheet)
  await page.keyboard.press('Escape')
  await expect(dialogs(page)).toHaveCount(0)
}
