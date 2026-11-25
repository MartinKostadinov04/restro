import { expect, type Frame, type Page, test } from '@playwright/test'

import { runScriptWith } from './global-setup'
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  INTEGRATION_OWNER_EMAIL,
  TONIGHT_OWNER_EMAIL,
  TONIGHT_PIN_PEPPER,
  TONIGHT_VENUE_NAME,
} from './support'

// D123: the manager's phone is a supported admin device, and a tappable control has a hit area of
// at least 44 x 44 px (Restro's own floor, docs/guides/operational-screens.md, Accessibility). This
// walks the Studio's Structure screen, the item sheet and the Publish dialog over it, the Design page
// with the guest template in its preview, Settings -> Integrations, Staff and Ordering, the QR links
// guide, and Venue › Reservations (the night's list, a reservation's sheet, Guests, and the spot
// pickers Change tables and Give a spot on the list a phone opens them on: S17 of the 11-18 screen
// round) on a 390 px phone, and Tonight on a phone and the bar tablet, and checks
// every control on them, so the floor cannot slip back unseen. A control may look smaller than 44 px
// if its hit area is extended around it (the `tap-area` utility in globals.css), so the check is
// not on the element's box: it asks the browser what is under the pointer at the edges of a
// 44 x 44 px square centred on the control. On a laptop (no touch) the item sheet and the Publish
// dialog are held to WCAG 2.5.8's 24 x 24 px the same way.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const FLOOR = 44
/** WCAG 2.5.8 (target size, minimum): a mouse target on a wide screen. */
const DESKTOP_FLOOR = 24
/** How far inside the square's corners the probe sits, so a control's rounded corner still counts. */
const CORNER_INSET = 8

interface Miss {
  readonly control: string
  readonly box: string
  readonly missed: readonly string[]
  /** What the first missed probe landed on instead. */
  readonly hitBy: string
}

/**
 * Every tappable control now on the page whose `floorPx` x `floorPx` square (44 px by default,
 * 24 px for a mouse on a laptop) is not all its own. Controls
 * drawn but out of reach (hidden, disabled-by-attribute inside inert parts) are skipped. A link
 * inside a sentence is skipped too (WCAG 2.5.8 exempts inline links).
 */
async function floorMisses(
  page: Page | Frame,
  scope?: string,
  floorPx: number = FLOOR,
): Promise<{ checked: number; misses: Miss[] }> {
  return (page as Frame).evaluate(
    ({ floor, inset, scopeSelector }) => {
      const root: ParentNode = scopeSelector
        ? (document.querySelector(scopeSelector) ?? document)
        : document
      const selector = [
        'button',
        'a[href]',
        'input:not([type=hidden])',
        'select',
        'textarea',
        'summary',
        '[role=tab]',
        '[role=checkbox]',
        '[role=switch]',
        '[role=combobox]',
        '[role=menuitem]',
        '[role=menuitemcheckbox]',
        '[role=menuitemradio]',
        '[role=option]',
        '[role=radio]',
        '[role=button]',
      ].join(',')

      const describe = (el: Element) => {
        const label =
          el.getAttribute('aria-label') ??
          el.getAttribute('data-testid') ??
          (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
        const role = el.getAttribute('role') ?? el.tagName.toLowerCase()
        return `${role} "${label}"`
      }
      const isInline = (el: Element) => {
        if (el.tagName !== 'A' && el.tagName !== 'BUTTON') return false
        const parent = el.parentElement
        if (!parent) return false
        const own = (el.textContent ?? '').trim()
        const all = (parent.textContent ?? '').trim()
        return all.length > own.length + 3 && getComputedStyle(parent).display !== 'flex'
      }

      const misses: { control: string; box: string; missed: string[]; hitBy: string }[] = []
      let checked = 0
      const seen = new Set<Element>()
      for (const el of Array.from(root.querySelectorAll(selector))) {
        if (seen.has(el)) continue
        seen.add(el)
        if (el.closest('[aria-hidden=true], [inert], [hidden]')) continue
        // A disabled control takes no taps (the pointer goes through it).
        if (el.matches(':disabled, [aria-disabled=true]')) continue
        const style = getComputedStyle(el)
        if (style.visibility === 'hidden' || style.display === 'none') continue
        // A visually hidden field behind a styled control (a checkbox's native twin).
        if (el instanceof HTMLInputElement && el.getAttribute('aria-hidden') === 'true') continue
        // The sr-only skip link and Next's dev overlay are not part of the screens.
        if (el.closest('nextjs-portal, [data-nextjs-toast]')) continue
        if (isInline(el)) continue
        // `instant`: the page may set smooth scrolling, and the probe needs the final position.
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
        let rect = el.getBoundingClientRect()
        // A sideways strip of the guest template snaps each card to its start, so `nearest` can come
        // to rest with the control past the edge, where no guest ever taps it. It is measured where
        // the guest swipes it to. A control that runs off a page with nothing to scroll stays cut,
        // and still fails below.
        if (rect.left < 0 || rect.right > document.documentElement.clientWidth) {
          el.scrollIntoView({ block: 'center', inline: 'start', behavior: 'instant' })
          rect = el.getBoundingClientRect()
        }
        if (rect.width === 0 || rect.height === 0) continue
        // A visually hidden twin (a file input behind its button) takes no taps.
        if (rect.width <= 1 && rect.height <= 1) continue

        // The square: the control's centre, at least FLOOR on each side (a larger control keeps
        // its own box).
        const w = Math.max(rect.width, floor)
        const h = Math.max(rect.height, floor)
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        const probes: [string, number, number][] = [
          ['top', cx, cy - h / 2 + 1],
          ['bottom', cx, cy + h / 2 - 1],
          ['left', cx - w / 2 + 1, cy],
          ['right', cx + w / 2 - 1, cy],
          ['top-left', cx - w / 2 + inset, cy - h / 2 + inset],
          ['top-right', cx + w / 2 - inset, cy - h / 2 + inset],
          ['bottom-left', cx - w / 2 + inset, cy + h / 2 - inset],
          ['bottom-right', cx + w / 2 - inset, cy + h / 2 - inset],
        ]
        checked += 1
        const missed: string[] = []
        let hitBy = ''
        for (const [where, x, y] of probes) {
          const hit = document.elementFromPoint(x, y)
          const label =
            el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el.labels : null
          const ok =
            hit !== null &&
            (el.contains(hit) ||
              // The label of a field is the field (a tap on it focuses or toggles it).
              (label !== null && Array.from(label).some((l) => l.contains(hit))))
          if (!ok) {
            missed.push(where)
            if (hitBy === '') hitBy = hit ? describe(hit) : 'nothing (outside the page)'
          }
        }
        rect = el.getBoundingClientRect()
        if (missed.length > 0) {
          misses.push({
            control: describe(el),
            box: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
            missed,
            hitBy,
          })
        }
      }
      return { checked, misses }
    },
    // The inset scales with the square, capped at CORNER_INSET: 8 px in a 44 px square (unchanged),
    // 4 px in a 24 px one. An 8 px inset there would leave only the middle 8 px of the square to
    // probe, and a 24 px control with rounded corners passes or fails on its centre alone; at 4 px
    // the probes still sit inside a rounded corner but test most of the square's edge.
    { floor: floorPx, inset: Math.min(CORNER_INSET, floorPx / 6), scopeSelector: scope ?? null },
  )
}

/** `atLeast`: how many controls the screen has, so a page that failed to draw cannot pass. */
async function expectFloor(
  page: Page | Frame,
  where: string,
  atLeast: number,
  scope?: string,
  floorPx: number = FLOOR,
) {
  // A menu opens with a zoom, and a box measured half-way is smaller than it will be.
  await (page as Frame).evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  )
  const { checked, misses } = await floorMisses(page, scope, floorPx)
  expect(checked, `${where}: controls found`).toBeGreaterThanOrEqual(atLeast)
  expect(misses, `${where}: controls under ${floorPx} x ${floorPx} px`).toEqual([])
}

async function signIn(page: Page, email: string, lands = /\/venues(\/vn_[^/?]+\?tab=\w+)?$/) {
  // Better Auth allows a few sign-ins per 10 seconds, and other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/venues')
    await page.getByLabel('Имейл').fill(email)
    await page.getByLabel('Парола').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Вход' }).click()
    try {
      // A person with one venue may land on it straight away.
      await expect(page).toHaveURL(lands, { timeout: 5_000 })
      return
    } catch {
      await page.waitForTimeout(10_000)
    }
  }
  throw new Error(`could not sign in as ${email}`)
}

const phone = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
} as const

/** Signs in as the demo owner and opens the venue's composer. */
async function openComposer(page: Page) {
  await signIn(page, ADMIN_EMAIL)
  await page.getByTestId('venue-card').first().getByRole('link', { name: 'Отвори' }).click()
  await expect(page.getByTestId('composer')).toBeVisible()
  await expect(page.getByTestId('section-picker')).toContainText('Коктейли')
}

/** Opens the first item's sheet, measures its controls (Details tab) and closes it. */
async function checkItemSheet(page: Page, floorPx: number = FLOOR) {
  await page.getByTestId('item-open').first().click()
  await expect(page.getByTestId('item-sheet-details')).toBeVisible()
  await expectFloor(page, 'item sheet', 5, '[data-testid="item-sheet"]', floorPx)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('item-sheet')).toHaveCount(0)
}

/**
 * Opens the Publish dialog and measures it, without publishing. With nothing to publish the button is
 * off, so one item is hidden first and shown again after, even when the measure fails: the draft
 * ends as it began, and the later tests of this serial file see the menu they expect.
 */
async function checkPublishDialog(page: Page, floorPx: number = FLOOR) {
  const button = page.getByTestId('publish-button')
  await expect(button).toBeVisible()
  let toggled: string | null = null
  if (await button.isDisabled()) {
    const row = page
      .getByTestId('item-row')
      .filter({ has: page.locator('[data-testid="item-visible"]:not([disabled])') })
      .first()
    toggled = await row.getAttribute('data-item-id')
    await row.getByTestId('item-visible').click()
    await expect(button).toBeEnabled()
  }
  const dialog = page.getByTestId('publish-confirm-dialog')
  try {
    const several = (await button.getAttribute('aria-haspopup')) === 'menu'
    await button.click()
    // Several menus: the button opens a list of them first (a disabled row carries data-disabled).
    if (several) {
      await page.locator('[data-testid="publish-menu-row"]:not([data-disabled])').first().click()
    }
    await expect(dialog).toBeVisible()
    await expectFloor(page, 'Publish dialog', 2, '[data-testid="publish-confirm-dialog"]', floorPx)
  } finally {
    // Close whatever is open (the dialog, or the menu list) before the row can be reached.
    if ((await dialog.count()) > 0 || (await page.getByRole('menu').count()) > 0) {
      await page.keyboard.press('Escape')
    }
    await expect(dialog).toHaveCount(0)
    if (toggled !== null) {
      // Show the item again, and wait until the switch says it is shown before the next test runs.
      const visible = page
        .locator(`[data-testid="item-row"][data-item-id="${toggled}"]`)
        .getByTestId('item-visible')
      await visible.click()
      await expect(visible).toBeChecked()
    }
  }
}

/** The Studio's Structure, what opens over it, and the Design page, on the screen's own controls. */
async function walkComposer(page: Page) {
  // Guest features is on Structure, under the menu (stacked switches and checkboxes).
  await expect(page.getByTestId('guest-features-panel')).toBeVisible()
  await expectFloor(page, 'Structure, top to bottom', 20)
  // The pickers and menus that open over the screen.
  await page.getByTestId('section-picker').click()
  await expectFloor(page, 'section picker open', 3)
  await page.keyboard.press('Escape')
  await page.getByTestId('item-menu').first().click()
  await expectFloor(page, 'item menu open', 3)
  await page.keyboard.press('Escape')
  // The row checkboxes and the selection bar they bring up.
  await page.getByTestId('item-row').first().getByRole('checkbox').click()
  // The bar covers the foot of the list while it is up (it is fixed), so only its own controls
  // are measured here; the rows were measured above.
  await expectFloor(page, 'one item selected', 2, '[data-testid="selection-bar"]')
  await page.getByTestId('clear-selection').click()
  // The item sheet and the Publish dialog, over Structure.
  await checkItemSheet(page)
  await checkPublishDialog(page)
  // The Design page, and the guest template in its preview. The template is measured once it is
  // mounted, in its own document at the frame's width (RR-87): the real screen, not the moment before.
  const venueId = /\/venues\/(vn_[0-9A-Za-z]+)/.exec(page.url())?.[1]
  await page.goto(`/venues/${venueId}/design`)
  await expect(page.getByTestId('design-panel')).toBeVisible()
  const element = page.getByTestId('design-preview-frame')
  const frame = await (await element.elementHandle())?.contentFrame()
  if (!frame) throw new Error('the preview has no frame')
  await expect(frame.locator('[data-face]').first()).toBeVisible()
  await expectFloor(page, 'the Design page', 10)
  await expectFloor(frame, 'the template in the preview', 3)
}

test('the Studio’s Structure and Design screens: every control has a 44 px hit area on a phone', async ({
  browser,
}) => {
  const context = await browser.newContext(phone)
  const page = await context.newPage()
  try {
    await openComposer(page)
    await walkComposer(page)
  } finally {
    await context.close().catch(() => undefined)
  }
})

// A bar tablet (768 to 1024 px wide, a touch screen) gets the same floor: it is keyed to a coarse
// pointer as well as to width (the `phone` variant in globals.css). 820 px keeps the section picker
// instead of the tree, which is drawn from 1024 px.
test('the same screens on a tablet-wide touch screen', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
  })
  const page = await context.newPage()
  try {
    expect(
      await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches),
      'the context reports a coarse pointer',
    ).toBe(true)
    await openComposer(page)
    await walkComposer(page)
  } finally {
    await context.close().catch(() => undefined)
  }
})

test('Settings › Staff, Settings › Ordering and the QR links guide: a 44 px hit area on a phone (S18)', async ({
  browser,
}) => {
  const context = await browser.newContext(phone)
  const page = await context.newPage()
  try {
    await signIn(page, ADMIN_EMAIL)
    await page.getByTestId('venue-card').first().getByRole('link', { name: 'Отвори' }).click()
    await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]+/)
    const venueId = /\/venues\/(vn_[0-9A-Za-z]+)/.exec(page.url())?.[1]
    // The screens' own controls; the header and its trail are measured with the navigation.
    await page.goto(`/venues/${venueId}?tab=settings&section=staff`)
    await expect(page.getByTestId('staff-panel')).toBeVisible()
    await expectFloor(page, 'Settings › Staff', 3, '[data-testid="staff-panel"]')
    await page.goto(`/venues/${venueId}?tab=settings&section=ordering`)
    await expect(page.getByTestId('ordering-panel')).toBeVisible()
    await expectFloor(page, 'Settings › Ordering', 3, '[data-testid="ordering-panel"]')
    await page.goto(`/guides/qr-links?venue=${venueId}`)
    await expect(page.getByTestId('guide-back')).toBeVisible()
    await expectFloor(page, 'the QR links guide', 1, '[data-testid="guide-page"]')
  } finally {
    await context.close().catch(() => undefined)
  }
})

// A laptop with a mouse: no `tap-area`, so the drawn size is the target. WCAG 2.5.8 asks 24 px
// (the dialog's close button was 15 px, S21).
test('the item sheet and the Publish dialog: every control is at least 24 px on a laptop', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  try {
    expect(
      await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches),
      'the context reports a fine pointer',
    ).toBe(false)
    await openComposer(page)
    await checkItemSheet(page, DESKTOP_FLOOR)
    await checkPublishDialog(page, DESKTOP_FLOOR)
  } finally {
    await context.close().catch(() => undefined)
  }
})

test('Settings -> Integrations: every control has a 44 px hit area on a phone', async ({
  browser,
}) => {
  const context = await browser.newContext(phone)
  const page = await context.newPage()
  try {
    await signIn(page, INTEGRATION_OWNER_EMAIL)
    await page.goto('/settings/integrations')
    await expect(page.getByTestId('integration-panel')).toBeVisible()

    // The shipped list: choose the system, give it a connection (the form), then the connection.
    const picker = page.getByTestId('systems-picker')
    const box = picker.getByRole('checkbox', { name: /barsy/ })
    if ((await box.getAttribute('aria-checked')) !== 'true') {
      await box.click()
      await page.getByRole('button', { name: 'Запази системите' }).click()
      await expect(page.getByText('Системите са запазени.')).toBeVisible()
    }
    await expectFloor(page, 'integrations, system chosen', 5)
    if ((await page.getByTestId('instance').count()) === 0) {
      const form = page.getByTestId('add-instance-form')
      await form.getByLabel('Име').fill('barsy – 44 px')
      await form.getByLabel('Адрес на barsy').fill('https://touch-targets.barsy.test')
      await form.getByLabel('API потребител').fill('touch-api-user')
      await form.getByLabel('Парола').fill('touch-password-not-a-secret')
      await form.getByRole('button', { name: 'Запази и провери' }).click()
      await expect(page.getByTestId('instance').first()).toBeVisible()
    }
    await expectFloor(page, 'integrations, a connection', 10)
  } finally {
    await context.close()
  }
})

/** Tonight's fixture (scripts/seed-tonight-e2e.ts): the club, then a night. */
function seedTonight(...args: string[]): string {
  return runScriptWith(
    { STAFF_PIN_PEPPER: TONIGHT_PIN_PEPPER },
    './scripts/seed-tonight-e2e.ts',
    ...args,
  )
}

/**
 * Tonight's four screens and what opens over them, each measured inside its own box: the venue's
 * header around them is another screen's. A busy night, so every kind of row and tile is drawn.
 */
async function walkTonight(page: Page, where: string) {
  seedTonight('seed')
  seedTonight('night', 'busy')
  await signIn(page, TONIGHT_OWNER_EMAIL, /\/venues(\/vn_[^/?]+\?tab=\w+)?$/)
  const venue = /\/venues\/vn_[0-9A-Za-z]+/.exec(page.url())?.[0]
  if (venue === undefined) {
    await page.getByTestId('venue-card').first().getByRole('link').first().click()
    await expect(page).toHaveURL(/\/venues\/vn_[^/?]+/)
  }
  const base = /\/venues\/vn_[0-9A-Za-z]+/.exec(page.url())?.[0] ?? ''
  await page.goto(`${base}?tab=tonight`)
  const tonight = page.getByTestId('tonight')
  await expect(tonight).toBeVisible()
  await expectFloor(page, `${where}: Tonight`, 5, '[data-testid="tonight"]')
  // The sections: the tab bar from 1024 px (it sits outside each section's box), the switch below.
  const tabBar = page.getByTestId('tonight-section-tabs')
  if (await tabBar.isVisible()) {
    await expectFloor(page, `${where}: the section tabs`, 4, '[data-testid="tonight-section-tabs"]')
  } else {
    const box = await page.locator('[data-testid="tonight-section-switch"]:visible').boundingBox()
    expect(box, `${where}: the section switch is drawn`).not.toBeNull()
    expect(box?.height ?? 0, `${where}: the section switch's height`).toBeGreaterThanOrEqual(44)
    expect(box?.width ?? 0, `${where}: the section switch's width`).toBeGreaterThanOrEqual(44)
  }
  // On a phone one part shows at a time; Tables is the other one.
  const tables = tonight.getByRole('button', { name: 'Маси', exact: true })
  if (await tables.isVisible()) {
    await tables.click()
    await expectFloor(page, `${where}: Tonight, the tables`, 6, '[data-testid="tonight"]')
  }
  // The tables menu, and a table's sheet (a drawer on a phone).
  await page.getByRole('button', { name: 'Още действия' }).click()
  await expectFloor(page, `${where}: the tables menu`, 1, '[role="menu"]')
  await page.keyboard.press('Escape')
  await page.getByTestId('table-tile').first().click()
  await expect(page.getByTestId('table-sheet')).toBeVisible()
  await expectFloor(page, `${where}: a table's sheet`, 2, '[data-testid="table-sheet"]')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('table-sheet')).toHaveCount(0)
  for (const view of ['sent', 'log', 'night']) {
    await page.goto(`${base}?tab=tonight&view=${view}`)
    await expect(page.getByTestId(`tonight-${view}`)).toBeVisible()
    await expectFloor(page, `${where}: Tonight, ${view}`, 2, `[data-testid="tonight-${view}"]`)
  }
}

test('Tonight: every control has a 44 px hit area on a phone', async ({ browser }) => {
  const context = await browser.newContext(phone)
  const page = await context.newPage()
  try {
    await walkTonight(page, '390 px')
  } finally {
    await context.close().catch(() => undefined)
  }
})

test('Tonight: every control has a 44 px hit area on the bar tablet', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
  })
  const page = await context.newPage()
  try {
    await walkTonight(page, '1180 px')
  } finally {
    await context.close().catch(() => undefined)
  }
})

// The screen round's 44 px rows for Reservations: the night's list (its row actions and "…"), a
// reservation's sheet, and Guests with a row's "…" open. Scoped to the tab itself: the venue's
// header and navigation are checked with their own screens. The night is written before the test,
// in its own hook: seeding it inside the test spent most of the test's two minutes.
test.describe('Venue › Reservations', () => {
  test.beforeAll(() => {
    test.setTimeout(240_000)
    const fixture = (...args: string[]) =>
      runScriptWith(
        { STAFF_PIN_PEPPER: TONIGHT_PIN_PEPPER },
        './scripts/seed-tonight-e2e.ts',
        ...args,
      )
    fixture('seed')
    fixture('night', 'empty')
    fixture('book', 'book')
  })

  test('every control has a 44 px hit area on a phone', async ({ browser }) => {
    const context = await browser.newContext(phone)
    const page = await context.newPage()
    try {
      await signIn(page, TONIGHT_OWNER_EMAIL)
      if (!/\/venues\/vn_/.test(page.url())) {
        // On a phone the sidebar that names the venue is folded away: the list's card is the way
        // in, and its one link is «Отвори».
        await page
          .getByTestId('venue-card')
          .filter({ hasText: TONIGHT_VENUE_NAME })
          .getByRole('link', { name: 'Отвори' })
          .click()
        await expect(page).toHaveURL(/\/venues\/vn_[^/?]+/)
      }
      const venueId = new URL(page.url()).pathname.split('/')[2] ?? ''

      await page.goto(`/venues/${venueId}?tab=reservations`)
      const night = page.getByTestId('reservations-night')
      await expect(night.getByTestId('rv-row').first()).toBeVisible()
      await expectFloor(page, 'reservations, the night', 6, '[data-testid="reservations-night"]')

      // The fixture's night has rows with a "…" (Иванова's, still coming): it is there to check.
      const more = night.getByTestId('rv-row-more').first()
      await expect(more).toBeVisible()
      await more.click()
      await expectFloor(page, 'reservations, a row’s "…" open', 1, '[role="menu"]')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)

      // The row's own button opens the sheet; its centre may be one of the row's actions on a phone.
      await night.getByTestId('rv-row-open').first().click()
      const sheet = page.getByTestId('rv-sheet')
      await expect(sheet).toBeVisible()
      await expect(sheet).toHaveAttribute('aria-busy', 'false')
      await expectFloor(page, 'reservations, a reservation', 2, '[data-testid="rv-sheet"]')
      await page.keyboard.press('Escape')

      await page.goto(`/venues/${venueId}?tab=reservations&view=guests`)
      const guests = page.getByTestId('reservations-guests')
      await expect(guests).toBeVisible()
      await expectFloor(page, 'reservations, guests', 2, '[data-testid="reservations-guests"]')
      // The fixture's bookings carry guest records, so Guests has rows with a "…".
      const guestMore = guests.getByTestId('rv-g-row-more').first()
      await expect(guestMore).toBeVisible()
      await guestMore.click()
      await expectFloor(page, 'reservations, a guest’s "…" open', 1, '[role="menu"]')
    } finally {
      await context.close()
    }
  })

  // The spot pickers a phone opens on their list (S17 of the 11-18 screen round): Change tables and
  // Give a spot, each row a 44 px target. On the night the hook wrote: Иванова booked on Маса 7.
  test('Change tables and Give a spot on the list have 44 px hit areas on a phone', async ({
    browser,
  }) => {
    const context = await browser.newContext(phone)
    const page = await context.newPage()
    try {
      await signIn(page, TONIGHT_OWNER_EMAIL)
      if (!/\/venues\/vn_/.test(page.url())) {
        await page
          .getByTestId('venue-card')
          .filter({ hasText: TONIGHT_VENUE_NAME })
          .getByRole('link', { name: 'Отвори' })
          .click()
        await expect(page).toHaveURL(/\/venues\/vn_[^/?]+/)
      }
      const venueId = new URL(page.url()).pathname.split('/')[2] ?? ''
      await page.goto(`/venues/${venueId}?tab=reservations`)
      await expect(page.getByTestId('reservations-night')).toBeVisible()

      // Change tables opens on the named list on a phone; every row's checkbox is a 44 px target.
      await page
        .getByTestId('rv-row')
        .filter({ hasText: 'Иванова' })
        .first()
        .getByTestId('rv-row-open')
        .click()
      await page.getByTestId('rv-sheet').getByTestId('rv-sheet-change-tables').click()
      const changing = page.getByTestId('rv-ct-sheet')
      await expect(changing.getByTestId('rv-pick-list')).toBeVisible()
      await expectFloor(page, 'Change tables, the list', 8, '[data-testid="rv-ct-sheet"]')
      await changing.getByTestId('rv-ct-close').click()
      await expect(changing).toHaveCount(0)

      // Give a spot, from a party written onto the waiting list: each row is a 44 px button.
      await page.goto(`/venues/${venueId}?tab=reservations`)
      await page.getByTestId('rv-wl-add').click()
      await page.getByTestId('rv-wl-name').fill('Чакаща 44')
      await page.getByTestId('rv-wl-phone').fill('+359 888 777 244')
      await page.getByTestId('rv-wl-guests').fill('2')
      await page.getByTestId('rv-wl-save').click()
      await expect(page.getByTestId('rv-waiting-note')).toBeVisible()
      await page
        .getByTestId('rv-row')
        .filter({ hasText: 'Чакаща 44' })
        .first()
        .getByTestId('rv-row-give')
        .click()
      await expect(page.getByTestId('rv-give').getByTestId('rv-pick-list')).toBeVisible()
      await expectFloor(page, 'Give a spot, the list', 8, '[data-testid="rv-give"]')
    } finally {
      await context.close()
    }
  })
})
