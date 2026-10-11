import { expect, type Page, test } from '@playwright/test'

import { dialogs, exerciseDialog, settled } from './faces-audit'
import {
  chooseTheme,
  fillBag,
  type Owner,
  onScreen,
  opener,
  openPreview,
  PREVIEW_FACE,
  payAndOpenReceipt,
  SCREENS,
  servicesBack,
  servicesOn,
  signInAsOwner,
} from './faces-preview'
import { VISUAL_THEMES } from './visual-fixtures'

// The accessibility audit of the Editorial Market's service screens (brief SH-07, T74): the bag, the
// table bill, calling a waiter, paying and the receipt. A guest sees them only once the platform
// supports them (D71), so they are drawn where the owner previews them: the Design tab's phone, with
// "Preview guest services" on and demo data behind them (e2e/faces-preview.ts). The venue is the demo
// venue, with every service switched on in its settings for the length of this file.
//
// The same checks as the menu's (faces-a11y.spec.ts): touch targets, dialogs, sideways overflow,
// reduced motion, and the contrast of what is drawn for every theme in the light and the dark scheme,
// with the edge of every input and choice box held to 3:1.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

let owner: Owner
let page: Page
const here = () => ({ page, venueId: owner.venueId })

test.beforeAll(async ({ browser }) => {
  await servicesOn()
  owner = await signInAsOwner(browser)
  page = owner.page
})

test.afterAll(async () => {
  await owner?.context.close()
  await servicesBack()
})

const smallTargets = (root: string) => page.evaluate((root) => window.__rmAudit.targets(root), root)

test.describe('the touch targets', () => {
  for (const width of [390, 320]) {
    test(`every button and radio of the header, the bar and each screen is 44 x 44 px at ${width} px`, async () => {
      await openPreview(here(), width)
      await fillBag(page)
      const found: Record<string, string[]> = {}
      const note = (state: string, list: { label: string; width: number; height: number }[]) => {
        if (list.length > 0) found[state] = list.map((t) => `${t.label}: ${t.width}x${t.height}`)
      }
      // The page itself, with the bar and the quick-add buttons on the dish cards.
      note('the page', await smallTargets(PREVIEW_FACE))
      for (const screen of SCREENS) {
        await onScreen(page, screen, async () => note(screen, await smallTargets('.rm-overlay')))
      }
      expect(found).toEqual({})
    })
  }
})

test.describe('the dialogs', () => {
  test('each screen keeps the focus, gives it back, and closes on Escape', async () => {
    await openPreview(here(), 390)
    await fillBag(page)
    await exerciseDialog(page, opener(page, 'bag'), 'Your bag')
    await exerciseDialog(page, opener(page, 'bill'), 'Table order')
    await exerciseDialog(page, opener(page, 'call'), 'Call a server')
    await exerciseDialog(page, opener(page, 'pay'), 'Pay')
    // The receipt, reached from the pay sheet: the focus goes back to where the guest began.
    await exerciseDialog(page, opener(page, 'receipt'), 'Pay', () => payAndOpenReceipt(page))
  })
})

test.describe('the screen width', () => {
  test('nothing sticks out of a 320 px screen', async () => {
    await openPreview(here(), 320)
    await fillBag(page)
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
    problems.push(...(await outside(PREVIEW_FACE, 'the page')))
    for (const screen of SCREENS) {
      await onScreen(page, screen, async () => {
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
      await openPreview(here(), 390)
      await fillBag(page)
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
        await onScreen(page, screen, async () => {
          problems.push(...(await moving(screen)))
        })
      }
      expect(problems).toEqual([])
    } finally {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
    }
  })
})

/** A list without its repeats (twelve identical buttons are one finding). */
const once = <T>(list: readonly T[]): T[] => [
  ...new Map(list.map((entry) => [JSON.stringify(entry), entry])).values(),
]

test.describe('the contrast of what is drawn', () => {
  for (const theme of VISUAL_THEMES) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${theme.id}, ${scheme}: every text reads, and the edge of every input and choice shows at 3:1`, async () => {
        await openPreview(here(), 390, scheme)
        await chooseTheme(page, theme)
        await fillBag(page)
        const low: Record<string, unknown> = {}
        const edges: Record<string, unknown> = {}
        const scan = async (state: string, root: string) => {
          await settled(page)
          const found = await page.evaluate((root) => window.__rmAudit.textContrast(root), root)
          expect(found.checked, `${state} has text to measure`).toBeGreaterThan(3)
          if (found.low.length > 0) low[state] = once(found.low)
          const borders = await page.evaluate(() =>
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
        await scan('the page', PREVIEW_FACE)
        for (const screen of SCREENS) {
          await onScreen(page, screen, async (sheet) => {
            // The pay sheet's custom tip and promo box, and the dish page's note, are inputs too.
            if (screen === 'pay') {
              await sheet.getByRole('radio', { name: 'Custom' }).click()
              await sheet.locator('.ro-acc summary').click()
            }
            await scan(screen, '.rm-overlay')
          })
        }
        // A dish's page, where the choices and the note are.
        await page.locator(`${PREVIEW_FACE} .rm-item-open`).first().click()
        await expect(dialogs(page)).toHaveCount(1)
        await scan('the dish page', '.rm-overlay')
        await page.keyboard.press('Escape')
        expect({ low, edges }).toEqual({ low: {}, edges: {} })
      })
    }
  }
})
