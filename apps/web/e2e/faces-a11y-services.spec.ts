import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'
import pg from 'pg'

import { dialogs, exerciseDialog, settled, withAudit } from './faces-audit'
import { addressOfVenue } from './menu-path'
import { ADMIN_EMAIL, ADMIN_PASSWORD, GUEST_SLUG, VENUE_NAME } from './support'
import { CUSTOM_COLOURS, VISUAL_THEMES } from './visual-fixtures'

// The accessibility audit of the Editorial Market's service screens (brief SH-07, T74): the bag, the
// table bill, calling a waiter, paying and the receipt. A guest sees them only once the platform
// supports them (D71), so they are drawn where the owner previews them: the Design tab's phone, with
// "Preview guest services" on and demo data behind them. The venue is the demo venue (its items are
// linked to the till, so they can be ordered), with every service switched on in its settings for the
// length of this file.
//
// The same checks as the menu's (faces-a11y.spec.ts): touch targets, dialogs, sideways overflow,
// reduced motion, and the contrast of what is drawn for every theme in the light and the dark scheme,
// with the edge of every input and choice box held to 3:1.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

/** The template's root inside the preview's phone frame. */
const FACE = '[data-testid="phone-frame"] [data-face="editorial-market"]:not([data-testid])'
const SCREENS = ['bag', 'bill', 'call', 'pay', 'receipt'] as const
type Screen = (typeof SCREENS)[number]

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

test.beforeAll(async ({ browser }) => {
  // Every service on, in the venue's own settings: the draft the preview is built from has them.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 1 })
  try {
    await pool.query(
      `update restro.venues set settings = coalesce(settings, '{}'::jsonb) || $1::jsonb where slug = '${GUEST_SLUG}'`,
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
      ],
    )
  } finally {
    await pool.end()
  }
  owner = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  page = await owner.newPage()
  await signIn(page, ADMIN_EMAIL)
  await page
    .getByTestId('venue-card')
    .filter({ hasText: VENUE_NAME })
    .getByRole('link', { name: 'Отвори' })
    .click()
  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}/)
  venueId = /\/venues\/(vn_[0-9A-Za-z]+)/.exec(page.url())?.[1] ?? ''
  expect((await addressOfVenue({ venueId })).slug).toBe(GUEST_SLUG)
  await owner.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
})

test.afterAll(async () => {
  await owner?.close()
  // The demo venue goes back to the services it has by default (none on, filters on).
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 1 })
  try {
    await pool.query(
      `update restro.venues set settings = settings - 'guest_features' where slug = '${GUEST_SLUG}'`,
    )
  } finally {
    await pool.end()
  }
})

/** Opens the Design tab at a width, with the services preview on and the light scheme. */
async function openPreview(width: number, scheme: 'light' | 'dark' = 'light') {
  await withAudit(page)
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(`/venues/${venueId}?tab=design`)
  await expect(page.locator(FACE)).toBeVisible()
  const preview = page.getByTestId('design-preview')
  await preview.getByRole('button', { name: scheme === 'light' ? 'Light' : 'Dark' }).click()
  const services = page.getByTestId('design-preview-services')
  if ((await services.getAttribute('aria-checked')) !== 'true') await services.click()
  // The bar with the waiter button, and the bill and pay entries in the header.
  await expect(page.locator(`${FACE} .ro-waiter`)).toBeVisible()
  await expect(page.locator(`${FACE} .ro-payentry`)).toBeVisible()
}

/** The control that opens a screen. */
const opener = (screen: Screen): Locator =>
  page.locator(
    {
      bag: `${FACE} .ro-bagbtn`,
      bill: `${FACE} .ro-pill`,
      call: `${FACE} .ro-waiter`,
      pay: `${FACE} .ro-payentry`,
      receipt: `${FACE} .ro-payentry`,
    }[screen],
  )

/** Puts a dish in the bag, so the bag has its button. */
async function fillBag() {
  if ((await page.locator(`${FACE} .ro-bagbtn`).count()) > 0) return
  await page.locator(`${FACE} .ro-plus`).first().click()
  await expect(page.locator(`${FACE} .ro-bagbtn`)).toBeVisible()
}

/** From the open pay sheet to the receipt: pays the demo bill by card and opens the receipt. */
async function payAndOpenReceipt() {
  const sheet = dialogs(page).last()
  await sheet.locator('.ro-pay:not(.is-apple)').first().click()
  await expect(sheet.locator('.ro-state[data-tone="ok"]')).toBeVisible({ timeout: 15_000 })
  await sheet.locator('.ro-primary').click()
  await expect(sheet.locator('.ro-receipt')).toBeVisible()
}

/** Opens a screen and runs `check` on it; the screen is closed again afterwards. */
async function onScreen(screen: Screen, check: (sheet: Locator) => Promise<void>) {
  await fillBag()
  await opener(screen).click()
  if (screen === 'receipt') await payAndOpenReceipt()
  const sheet = dialogs(page).last()
  await expect(sheet).toBeVisible()
  await settled(page)
  await check(sheet)
  await page.keyboard.press('Escape')
  await expect(dialogs(page)).toHaveCount(0)
}

const smallTargets = (root: string) => page.evaluate((root) => window.__rmAudit.targets(root), root)

test.describe('the touch targets', () => {
  for (const width of [390, 320]) {
    test(`every button and radio of the header, the bar and each screen is 44 x 44 px at ${width} px`, async () => {
      await openPreview(width)
      await fillBag()
      const found: Record<string, string[]> = {}
      const note = (state: string, list: { label: string; width: number; height: number }[]) => {
        if (list.length > 0) found[state] = list.map((t) => `${t.label}: ${t.width}x${t.height}`)
      }
      // The page itself, with the bar and the quick-add buttons on the dish cards.
      note('the page', await smallTargets(FACE))
      for (const screen of SCREENS) {
        await onScreen(screen, async () => note(screen, await smallTargets('.rm-overlay')))
      }
      expect(found).toEqual({})
    })
  }
})

test.describe('the dialogs', () => {
  test('each screen keeps the focus, gives it back, and closes on Escape', async () => {
    await openPreview(390)
    await fillBag()
    await exerciseDialog(page, opener('bag'), 'Your bag')
    await exerciseDialog(page, opener('bill'), 'Table order')
    await exerciseDialog(page, opener('call'), 'Call a server')
    await exerciseDialog(page, opener('pay'), 'Pay')
    // The receipt, reached from the pay sheet: the focus goes back to where the guest began.
    await exerciseDialog(page, opener('receipt'), 'Pay', payAndOpenReceipt)
  })
})

test.describe('the screen width', () => {
  test('nothing sticks out of a 320 px screen', async () => {
    await openPreview(320)
    await fillBag()
    const problems: string[] = []
    const outside = (root: string, state: string) =>
      page.evaluate(
        ({ root, state }) => {
          const frame = document.querySelector('[data-testid="phone-screen"]')
          const found: string[] = []
          if (frame === null) return [`${state}: no phone screen`]
          const edge = frame.getBoundingClientRect()
          for (const element of document.querySelectorAll(`${root} *`)) {
            if (element.closest('.rm-sections, .rm-section.is-feature .rm-items') !== null) continue
            if (element.closest('[hidden]') !== null) continue
            const box = element.getBoundingClientRect()
            if (box.width === 0 || getComputedStyle(element).visibility !== 'visible') continue
            if (box.right > edge.right + 0.5 || box.left < edge.left - 0.5) {
              found.push(
                `${state}: ${element.tagName.toLowerCase()}.${[...element.classList].join('.')} ${Math.round(box.left - edge.left)}..${Math.round(box.right - edge.left)} of ${Math.round(edge.width)}`,
              )
            }
          }
          return found.slice(0, 6)
        },
        { root, state },
      )
    problems.push(...(await outside(FACE, 'the page')))
    for (const screen of SCREENS) {
      await onScreen(screen, async () => {
        problems.push(...(await outside('.rm-overlay', screen)))
      })
    }
    expect(problems).toEqual([])
  })
})

test.describe('reduced motion', () => {
  test('a guest who asks for less gets no animation on the bar and the screens', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    try {
      await openPreview(390)
      await fillBag()
      const moving = (state: string) =>
        page.evaluate((state) => {
          const found: string[] = []
          for (const element of document.querySelectorAll(
            '[data-testid="phone-frame"] [data-face] *',
          )) {
            const style = getComputedStyle(element)
            const names = style.animationName.split(',').map((part) => part.trim())
            const times = style.animationDuration.split(',').map((part) => Number.parseFloat(part))
            if (names.some((name, index) => name !== 'none' && (times[index] ?? 0) > 0)) {
              found.push(`${state}: ${element.tagName}.${element.className} ${style.animationName}`)
            }
          }
          return found.slice(0, 6)
        }, state)
      const problems: string[] = [...(await moving('the page'))]
      for (const screen of SCREENS) {
        if (screen === 'receipt') continue
        await onScreen(screen, async () => problems.push(...(await moving(screen))))
      }
      expect(problems).toEqual([])
    } finally {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
    }
  })
})

/** Sets the look of the preview: a preset by its name, or the three colours of the custom theme. */
async function chooseTheme(theme: (typeof VISUAL_THEMES)[number]) {
  await page.locator(`[data-preset="${theme.id}"]`).click()
  if (theme.id !== 'custom') return
  for (const [label, value] of [
    ['Primary', CUSTOM_COLOURS.primary],
    ['Secondary', CUSTOM_COLOURS.secondary],
    ['Tertiary', CUSTOM_COLOURS.tertiary],
  ] as const) {
    await page.getByLabel(label, { exact: true }).fill(value)
  }
}

/** A list without its repeats (twelve identical buttons are one finding). */
const once = <T>(list: readonly T[]): T[] => [
  ...new Map(list.map((entry) => [JSON.stringify(entry), entry])).values(),
]

test.describe('the contrast of what is drawn', () => {
  for (const theme of VISUAL_THEMES) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${theme.id}, ${scheme}: every text reads, and the edge of every input and choice shows at 3:1`, async () => {
        await openPreview(390, scheme)
        await chooseTheme(theme)
        await fillBag()
        const low: Record<string, unknown> = {}
        const edges: Record<string, unknown> = {}
        const scan = async (state: string, root: string) => {
          await settled(page)
          const found = await page.evaluate((root) => window.__rmAudit.textContrast(root), root)
          expect(found.checked, `${state} has text to measure`).toBeGreaterThan(3)
          if (found.low.length > 0) low[state] = once(found.low)
          const borders = await page.evaluate(
            () =>
              window.__rmAudit.borderContrast(
                [
                  '.rm-overlay .ro-options button',
                  '.rm-overlay .ro-choicegrid button',
                  '.rm-overlay .ro-tips button',
                  '.rm-overlay .ro-scope button',
                  '.rm-overlay textarea',
                  '.rm-overlay input:not([type="hidden"])',
                ].join(', '),
              ),
          )
          const weak = borders.filter((entry) => entry.ratio < 3)
          if (weak.length > 0) edges[state] = once(weak)
        }
        await scan('the page', FACE)
        for (const screen of SCREENS) {
          await onScreen(screen, async (sheet) => {
            // The pay sheet's custom tip and promo box, and the dish page's note, are inputs too.
            if (screen === 'pay') {
              await sheet.getByRole('radio', { name: 'Custom' }).click()
              await sheet.locator('.ro-acc summary').click()
            }
            await scan(screen, '.rm-overlay')
          })
        }
        // A dish's page, where the choices and the note are.
        await page.locator(`${FACE} .rm-item-open`).first().click()
        await expect(dialogs(page)).toHaveCount(1)
        await scan('the dish page', '.rm-overlay')
        await page.keyboard.press('Escape')
        expect({ low, edges }).toEqual({ low: {}, edges: {} })
      })
    }
  }
})
