import { expect, type Frame, type Page, test } from '@playwright/test'

import { dialogs, exerciseDialog, overlapsInHeader, settled } from './faces-audit'
import {
  chooseTheme,
  FACE_ID,
  fillBag,
  type Owner,
  onScreen,
  opener,
  openPreview,
  PREVIEW_FACE,
  payTheBill,
  SCREENS,
  servicesBack,
  servicesOn,
  signInAsOwner,
} from './faces-preview'
import { VISUAL_THEMES } from './visual-fixtures'

// The accessibility audit of the Editorial Market's service screens (brief SH-07, T74): the bag, the
// table bill, calling a waiter, and paying. A guest sees them only once the platform
// supports them (D71), so they are drawn where the owner previews them: the Design page's frame, with
// "Preview guest services" on and demo data behind them (e2e/faces-preview.ts). The venue is the demo
// venue, with every service switched on in its settings for the length of this file. What is measured
// is the frame's document; the Light and Dark buttons and the colours are on the page around it.
//
// The same checks as the menu's (faces-a11y.spec.ts): touch targets, dialogs, sideways overflow,
// reduced motion, and the contrast of what is drawn for every theme in the light and the dark scheme,
// with the edge of every input and choice box held to 3:1.
//
// The way into each screen, and into the dish page, is the face contract's (e2e/faces-preview.ts:
// `data-slot`: `item.add`, `item.open`, `menu.*`, `pay.*`), but what is measured inside the screens
// is still Editorial Market's own markup, which the contract has no markers for. So the audit is
// for that template, and a run with another FACES_VISUAL_FACE skips it. The selectors that still
// name that markup are the `.rm-*` and `.ro-*` ones below, and `.rm-header .rm-brandline`, `.rm-logo`,
// `.rm-table` and `.rm-language` in `overlapsInHeader` (faces-audit.ts).
test.skip(
  FACE_ID !== 'editorial-market',
  'these checks read the service sheets of Editorial Market',
)
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

let owner: Owner
let page: Page
/** The frame the renderer is drawn in, on the preview opened last. */
let view: Frame
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

const smallTargets = (root: string) => view.evaluate((root) => window.__rmAudit.targets(root), root)

test.describe('the touch targets', () => {
  for (const width of [390, 320]) {
    test(`every button and radio of the header, the bar and each screen is 44 x 44 px at ${width} px`, async () => {
      view = await openPreview(here(), width)
      await fillBag(view)
      const found: Record<string, string[]> = {}
      const note = (state: string, list: { label: string; width: number; height: number }[]) => {
        if (list.length > 0) found[state] = list.map((t) => `${t.label}: ${t.width}x${t.height}`)
      }
      // The page itself, with the bar and the quick-add buttons on the dish cards.
      note('the page', await smallTargets(PREVIEW_FACE))
      for (const screen of SCREENS) {
        await onScreen(view, screen, async () => note(screen, await smallTargets('.rm-overlay')))
      }
      expect(found).toEqual({})
    })
  }
})

test.describe('the dialogs', () => {
  test('each screen keeps the focus, gives it back, and closes on Escape', async () => {
    view = await openPreview(here(), 390)
    await fillBag(view)
    await exerciseDialog(view, opener(view, 'bag'), 'Your bag')
    await exerciseDialog(view, opener(view, 'bill'), 'Table order')
    await exerciseDialog(view, opener(view, 'call'), 'Call a server')
    await exerciseDialog(view, opener(view, 'pay'), 'Pay')
    // The paid screen, reached from the pay sheet: the focus goes back to where the guest began.
    await exerciseDialog(view, opener(view, 'pay'), 'Pay', () => payTheBill(view))
  })
})

test.describe('the screen width', () => {
  test('nothing sticks out of a 320 px screen', async () => {
    view = await openPreview(here(), 320)
    await fillBag(view)
    const problems: string[] = []
    const outside = (root: string, state: string) =>
      view.evaluate(
        ({ root, state }) => {
          const found: string[] = []
          const edge = { left: 0, right: document.documentElement.clientWidth }
          for (const element of document.querySelectorAll(`${root} *`)) {
            if (element.closest('.rm-sections, .rm-section.is-feature .rm-items') !== null) continue
            if (element.closest('[hidden]') !== null) continue
            const box = element.getBoundingClientRect()
            if (box.width === 0 || getComputedStyle(element).visibility !== 'visible') continue
            if (box.right > edge.right + 0.5 || box.left < edge.left - 0.5) {
              found.push(
                `${state}: ${element.tagName.toLowerCase()}.${[...element.classList].join('.')} ${Math.round(box.left - edge.left)}..${Math.round(box.right - edge.left)} of ${edge.right}`,
              )
            }
          }
          return found.slice(0, 6)
        },
        { root, state },
      )
    problems.push(...(await outside(PREVIEW_FACE, 'the page')))
    // The venue bar, with the bill and pay entries beside the logo and the language switch.
    problems.push(...(await overlapsInHeader(view, PREVIEW_FACE)))
    for (const screen of SCREENS) {
      await onScreen(view, screen, async () => {
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
      view = await openPreview(here(), 390)
      await fillBag(view)
      const moving = (state: string) =>
        view.evaluate((state) => {
          const found: string[] = []
          for (const element of document.querySelectorAll('[data-face] *')) {
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
        await onScreen(view, screen, async () => {
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
        view = await openPreview(here(), 390, scheme)
        await chooseTheme(page, theme)
        await fillBag(view)
        const low: Record<string, unknown> = {}
        const edges: Record<string, unknown> = {}
        const scan = async (state: string, root: string) => {
          await settled(view)
          const found = await view.evaluate((root) => window.__rmAudit.textContrast(root), root)
          expect(found.checked, `${state} has text to measure`).toBeGreaterThan(3)
          if (found.low.length > 0) low[state] = once(found.low)
          const borders = await view.evaluate(() =>
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
          await onScreen(view, screen, async (sheet) => {
            // The pay sheet's ticks and tip box, and the dish page's note, are inputs too.
            if (screen === 'pay') {
              await sheet.locator('[data-slot="pay.whole"]').click()
            }
            await scan(screen, '.rm-overlay')
          })
        }
        // A dish's page, where the choices and the note are.
        await view.locator(`${PREVIEW_FACE} [data-slot="item.open"]`).first().click()
        await expect(dialogs(view)).toHaveCount(1)
        await scan('the dish page', '.rm-overlay')
        await page.keyboard.press('Escape')
        expect({ low, edges }).toEqual({ low: {}, edges: {} })
      })
    }
  }
})
