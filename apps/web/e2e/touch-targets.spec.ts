import { expect, type Frame, type Page, test } from '@playwright/test'

import { ADMIN_EMAIL, ADMIN_PASSWORD, INTEGRATION_OWNER_EMAIL } from './support'

// D123: the manager's phone is a supported admin device, and a tappable control has a hit area of
// at least 44 x 44 px (Restro's own floor, docs/guides/operational-screens.md, Accessibility). This
// walks the Studio's Structure screen, the Design page with the guest template in its preview, and
// Settings -> Integrations on a 390 px phone and checks
// every control on them, so the floor cannot slip back unseen. A control may look smaller than 44 px
// if its hit area is extended around it (the `tap-area` utility in globals.css), so the check is
// not on the element's box: it asks the browser what is under the pointer at the edges of a
// 44 x 44 px square centred on the control.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const FLOOR = 44
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
 * Every tappable control now on the page whose 44 x 44 px square is not all its own. Controls
 * drawn but out of reach (hidden, disabled-by-attribute inside inert parts) are skipped. A link
 * inside a sentence is skipped too (WCAG 2.5.8 exempts inline links).
 */
async function floorMisses(
  page: Page | Frame,
  scope?: string,
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
    { floor: FLOOR, inset: CORNER_INSET, scopeSelector: scope ?? null },
  )
}

/** `atLeast`: how many controls the screen has, so a page that failed to draw cannot pass. */
async function expectFloor(page: Page | Frame, where: string, atLeast: number, scope?: string) {
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
  const { checked, misses } = await floorMisses(page, scope)
  expect(checked, `${where}: controls found`).toBeGreaterThanOrEqual(atLeast)
  expect(misses, `${where}: controls under ${FLOOR} x ${FLOOR} px`).toEqual([])
}

async function signIn(page: Page, email: string) {
  // Better Auth allows a few sign-ins per 10 seconds, and other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/venues')
    await page.getByLabel('Имейл').fill(email)
    await page.getByLabel('Парола').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Вход' }).click()
    try {
      await expect(page).toHaveURL(/\/venues$/, { timeout: 5_000 })
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
