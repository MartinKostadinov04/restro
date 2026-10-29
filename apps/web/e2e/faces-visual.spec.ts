import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, type Locator, type Page, test } from '@playwright/test'
import { stringsFor } from '@restro/shell'

import { dialogs, settled } from './faces-audit'
import {
  chooseLanguage,
  chooseTheme,
  FACE_ID,
  type Owner,
  onScreen,
  openPreview,
  SCREENS,
  servicesBack,
  servicesOn,
  signInAsOwner,
  tryFillBag,
  whyNoScreen,
} from './faces-preview'
import { runScript } from './global-setup'
import {
  LOGO_MARKS,
  LONG_NAME_BG,
  LONG_NAME_EN,
  LONG_TEXT_NAME_BG,
  LONG_TEXT_NAME_EN,
  VISUAL_THEMES,
  type VisualTheme,
  visualPath,
} from './visual-fixtures'

// The screenshot matrix of a template (briefs SH-07 and T89): pictures for people to look at, not a
// pixel comparison. Skipped unless FACES_VISUAL=1, so the normal gate stays fast. One template per
// run, chosen by FACES_VISUAL_FACE (default editorial-market; any id in the registry, hidden ones
// too):
//
//   FACES_VISUAL=1 FACES_VISUAL_FACE=<face> pnpm --filter @restro/web run test:e2e e2e/faces-visual.spec.ts
//
// Every picture goes to apps/web/test-results/faces-visual/<face>/<preset>-<scheme>-<lang>-<width>-<screen>.png,
// and the steps this template cannot take, each with its reason, to <face>/skipped.txt.
//
// The spec finds everything through the face contract (guide §5.5 and §7.3): `data-face`, `data-item`,
// `data-slot` (`item.name`, `item.allergens`, `item.open`, `item.add`, `menu.filters`, `menu.bag`,
// `menu.bill`, `menu.pay`, `menu.call_waiter`, `menu.language`, `pay.whole`, `pay.start`, `pay.form`,
// `pay.number`) and the dialog role. What the contract has no marker for is driven another way
// (the menu's layout through the snapshot, D92) or skipped with a named reason.
//
//   presets  the designer's four and a custom one from three colours
//   schemes  light, dark;  languages  bg, en;  widths  320, 360, 390, 430, 820
//   screens  top (the first screen), layout-list, layout-one and layout-two (a section of photo
//            cards), soldout and scheduled (a photo card each), longname-photo and longname-text
//            (at 320 only: 60 characters of Cyrillic or Latin), dish (the dish page), filters (the
//            filter sheet), allergens (the allergen sheet)
// worst cases of D109, one test per theme that walks the schemes and languages it names:
//   nomatch   at 390: every choice of the filter sheet switched on, so nothing on the menu matches
//             and the shell's "no matches" and "clear filters" strings show:
//             <preset>-<scheme>-<lang>-390-nomatch
//   logos     at 390, bg: a white and a black logo with no background, each in light and dark:
//             <preset>-<scheme>-bg-390-logo-white and -logo-black
//   zoom200   at 320: the text of the page scaled to 200 % (every font size and fixed line height
//             doubled, the layout left alone, as a phone's large-text setting does): -320-zoom200-top,
//             -zoom200-layout-two, -zoom200-longname-photo and -zoom200-longname-text
//   landscape 844 x 390: -844-landscape-top, -landscape-dish and -landscape-filters (a sheet open)
//   services bag, bill, call, pay, receipt: the Design tab's phone preview with "Preview guest
//            services" on, at 390 and 320 (the phone frame is 360 px wide at most, so the other
//            widths would look the same); only those the template has (R15)
test.skip(process.env.FACES_VISUAL !== '1', 'screenshots for people to review: set FACES_VISUAL=1')
test.setTimeout(180_000)
// A step that cannot be done fails in seconds, not in minutes: there are 130 of these tests.
test.use({ actionTimeout: 20_000 })

const OUT = fileURLToPath(new URL(`../test-results/faces-visual/${FACE_ID}/`, import.meta.url))
mkdirSync(OUT, { recursive: true })

/** The steps this template could not take, by reason, and how many pictures each cost. */
const SKIPPED = new Map<string, number>()
const skip = (reason: string) => SKIPPED.set(reason, (SKIPPED.get(reason) ?? 0) + 1)

test.afterAll(() => {
  const lines = [...SKIPPED].map(([reason, times]) => `${reason} (${times}x)`)
  writeFileSync(
    `${OUT}skipped.txt`,
    `${lines.length === 0 ? 'nothing skipped' : lines.join('\n')}\n`,
  )
})

const WIDTHS = [320, 360, 390, 430, 820] as const
const LANGS = ['bg', 'en'] as const
const SCHEMES = ['light', 'dark'] as const
const LAYOUTS = ['list', 'one', 'two'] as const

/** The picture file of a screen. */
const file = (
  theme: VisualTheme,
  scheme: string,
  lang: string,
  width: number,
  screen: string,
): string => `${OUT}${theme.id}-${scheme}-${lang}-${width}-${screen}.png`

/** What the fixture menus call things, by language. */
const WORDS = {
  bg: {
    negroni: 'Негрони',
    soldOut: 'Пшенична бира',
    scheduled: 'Нощен шот',
    platter: 'Плато за компания',
    longName: LONG_NAME_BG,
    longText: LONG_TEXT_NAME_BG,
  },
  en: {
    negroni: 'Negroni',
    soldOut: 'Wheat beer',
    scheduled: 'Late-night shot',
    platter: 'Sharing platter',
    longName: LONG_NAME_EN,
    longText: LONG_TEXT_NAME_EN,
  },
} as const

/** A text matched whole, with no surrounding text (a name must not match the longer names that start with it). */
const exactly = (text: string) =>
  new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)

/** The card of the item with exactly this name: a `data-item` that holds an `item.name` slot of that text. */
const card = (page: Page, name: string) =>
  page.locator('[data-item]').filter({
    has: page.locator('[data-slot="item.name"]', { hasText: exactly(name) }),
  })

/** The section a card is in (its nearest `section`; the card itself when the template draws none). */
const sectionOf = (item: Locator) => item.locator('xpath=ancestor::section[1]').or(item).first()

/** Loads the photos that wait for the guest to scroll, and waits for all of them. */
async function loadPhotos(page: Page) {
  // A picture of a section taller than the screen would leave out the items the browser has not
  // painted (it skips what is off screen, `content-visibility: auto`): paint them all.
  await page.addStyleTag({ content: '[data-item] { content-visibility: visible !important; }' })
  await page.evaluate(() => {
    for (const image of document.querySelectorAll('img[loading="lazy"]')) {
      image.setAttribute('loading', 'eager')
    }
  })
  await page.waitForFunction(() => [...document.images].every((image) => image.complete))
  await page.evaluate(() => document.fonts.ready)
}

/** A picture of one element or of the screen. */
async function shoot(page: Page, path: string, target?: Locator) {
  await settled(page)
  if (target === undefined) await page.screenshot({ path })
  else await target.screenshot({ path })
}

/** The snapshot file of a fixture menu, as the guest page asks for it (`snap/sn_….json`). */
const SNAPSHOT_FILE = /\/snap\/sn_[^/]+\.json$/

/**
 * D109: the snapshot's theme and assets with another logo instead of the fixture's blue one. A
 * snapshot may not name an asset nothing uses, so the logo's entry moves to the new id (its file
 * paths with it).
 */
function withLogo(
  snapshot: {
    theme: { logo: string | null } & Record<string, unknown>
    assets: Record<string, unknown>
  },
  logo: string,
) {
  // A menu with no logo (null, or an id the assets lack) is served as it is; the test then skips.
  const current = snapshot.theme.logo
  if (current === null || !(current in snapshot.assets)) return {}
  const { [current]: entry, ...others } = snapshot.assets
  const moved = JSON.parse(JSON.stringify(entry).replaceAll(current, logo))
  return { theme: { ...snapshot.theme, logo }, assets: { ...others, [logo]: moved } }
}

/**
 * Opens a fixture menu with the menu's layout set to `layout`. The layout is a setting of the menu
 * (D92), published in its snapshot, so the snapshot is served here with that one value changed (what
 * the composer would publish) instead of pressing a template's own layout switch.
 */
async function openMenu(
  page: Page,
  theme: VisualTheme,
  lang: string,
  layout: (typeof LAYOUTS)[number],
  logo?: string,
) {
  await page.unroute(SNAPSHOT_FILE)
  await page.route(SNAPSHOT_FILE, async (route) => {
    const response = await route.fetch()
    const snapshot = (await response.json()) as {
      layout?: Record<string, unknown>
      theme: { logo: string | null } & Record<string, unknown>
      assets: Record<string, unknown>
    }
    await route.fulfill({
      response,
      json: {
        ...snapshot,
        layout: { ...snapshot.layout, default: layout },
        ...(logo === undefined ? {} : withLogo(snapshot, logo)),
      },
    })
  })
  await page.goto(`${visualPath(theme)}?lang=${lang}#t=${theme.table}`)
  await expect(page.locator(`[data-face="${FACE_ID}"]:not([data-testid])`)).toBeVisible()
  await expect(page.locator('[data-item]').first()).toBeVisible()
  await loadPhotos(page)
}

// The global setup of the guest page's test clears the venue and table files of the publish folder
// when it starts, so the five fixture menus are written (again) here, for this template: once per
// worker, by whichever describe block runs first.
let seeded = false
function seedOnce() {
  if (seeded) return
  runScript('./scripts/seed-visual-e2e.ts', FACE_ID)
  seeded = true
}

test.describe('the guest menu', () => {
  test.beforeAll(seedOnce)

  for (const theme of VISUAL_THEMES) {
    for (const scheme of SCHEMES) {
      for (const lang of LANGS) {
        for (const width of WIDTHS) {
          test(`${theme.id} ${scheme} ${lang} ${width}`, async ({ page }) => {
            const words = WORDS[lang]
            const path = (screen: string) => file(theme, scheme, lang, width, screen)
            await page.setViewportSize({ width, height: 800 })
            await page.emulateMedia({ colorScheme: scheme })

            // A section of photo cards in each layout. The menu's own layout (two columns) comes
            // first, for the "top" and the long names; one column comes last, for what follows.
            const beer = () => sectionOf(card(page, words.soldOut))
            for (const layout of ['two', 'list', 'one'] as const) {
              await openMenu(page, theme, lang, layout)
              if (layout === 'two') await shoot(page, path('top'))
              await beer().scrollIntoViewIfNeeded()
              await shoot(page, path(`layout-${layout}`), beer())
              // A long name at the narrowest width, in the narrowest layout (two columns).
              if (layout === 'two' && width === 320) {
                await shoot(page, path('longname-photo'), card(page, words.longName))
                await shoot(page, path('longname-text'), card(page, words.longText))
              }
            }

            // Sold-out and scheduled items, as one column of big cards (the layout opened last).
            await shoot(page, path('soldout'), card(page, words.soldOut))
            await shoot(page, path('scheduled'), card(page, words.scheduled))

            // The dish page, the filter sheet and the allergen sheet.
            const dish = card(page, words.negroni).locator('[data-slot="item.open"]')
            if ((await dish.count()) === 0) {
              skip('dish: the template draws no item.open, so there is no dish page to open')
            } else {
              await dish.click()
              await expect(dialogs(page)).toHaveCount(1)
              await shoot(page, path('dish'))
              await page.keyboard.press('Escape')
              await expect(dialogs(page)).toHaveCount(0)
            }

            const filters = page.locator('[data-slot="menu.filters"]').first()
            if ((await filters.count()) === 0) {
              skip('filters: the template draws no menu.filters')
            } else if ((await filters.evaluate((element) => element.tagName)) !== 'BUTTON') {
              skip(
                'filters: menu.filters is not a button (drawn inline), so there is no filter sheet',
              )
            } else {
              await filters.click()
              await expect(dialogs(page)).toHaveCount(1)
              await shoot(page, path('filters'))
              await page.keyboard.press('Escape')
              await expect(dialogs(page)).toHaveCount(0)
            }

            const allergens = card(page, words.platter).locator(
              '[data-slot="item.allergens"] button',
            )
            if ((await allergens.count()) === 0) {
              skip(
                'allergens: item.allergens holds no button, so there is no allergen sheet to open',
              )
            } else {
              await allergens.first().click()
              await expect(dialogs(page)).toHaveCount(1)
              await shoot(page, path('allergens'))
            }
          })
        }
      }
    }
  }
})

/** The shell's own interface words for a language of the matrix (the fixture menus' words are WORDS). */
const shellWords = (lang: (typeof LANGS)[number]) =>
  stringsFor(lang === 'bg' ? 'bg_BG' : 'en_US').guest

/**
 * Opens the filter sheet and returns true, or says why the template has none (a skipped step, under
 * `step`) and returns false.
 */
async function openFilterSheet(page: Page, step: string): Promise<boolean> {
  const filters = page.locator('[data-slot="menu.filters"]').first()
  if ((await filters.count()) === 0) {
    skip(`${step}: the template draws no menu.filters`)
    return false
  }
  if ((await filters.evaluate((element) => element.tagName)) !== 'BUTTON') {
    skip(`${step}: menu.filters is not a button (drawn inline), so there is no filter sheet`)
    return false
  }
  await filters.click()
  await expect(dialogs(page)).toHaveCount(1)
  return true
}

/**
 * Scales the text of the page by `factor` as a phone's large-text setting does: every font size and
 * every fixed line height, the layout (widths, gaps) left as it was. Reads all sizes before it writes
 * any, so an element sized in `em` is not scaled twice. Elements drawn afterwards are not scaled.
 */
async function zoomText(page: Page, factor: number) {
  await page.evaluate((factor) => {
    const elements = [...document.querySelectorAll('body *')].filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    )
    const read = elements.map((element) => {
      const style = getComputedStyle(element)
      return { size: Number.parseFloat(style.fontSize), line: style.lineHeight }
    })
    elements.forEach((element, index) => {
      const { size, line } = read[index] ?? { size: 0, line: 'normal' }
      if (size > 0) element.style.setProperty('font-size', `${size * factor}px`, 'important')
      if (line.endsWith('px')) {
        element.style.setProperty(
          'line-height',
          `${Number.parseFloat(line) * factor}px`,
          'important',
        )
      }
    })
  }, factor)
}

test.describe('the worst cases of D109', () => {
  test.beforeAll(seedOnce)

  for (const theme of VISUAL_THEMES) {
    test(`${theme.id} a filter that matches nothing`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 800 })
      for (const scheme of SCHEMES) {
        for (const lang of LANGS) {
          const strings = shellWords(lang)
          await page.emulateMedia({ colorScheme: scheme })
          await openMenu(page, theme, lang, 'two')
          if (!(await openFilterSheet(page, 'nomatch'))) continue
          // The contract has no marker for the choices: every button of the sheet is one, except
          // the close button and the clear button, whose names are the shell's strings.
          const buttons = dialogs(page).first().getByRole('button')
          // Re-read the list each turn: a click may re-render the chips, and a template may move
          // the chips that are on to the front; a chip that is already on is left alone.
          for (let index = 0; index < (await buttons.count()); index++) {
            // A template whose sheet closes itself on a choice leaves nothing more to press.
            if ((await dialogs(page).count()) === 0) break
            const button = buttons.nth(index)
            if ((await button.getAttribute('aria-pressed')) === 'true') continue
            const name = (await button.getAttribute('aria-label')) ?? (await button.innerText())
            if (name.trim() === strings.close || name.trim() === strings.clearFilters) continue
            await button.click()
          }
          if ((await dialogs(page).count()) > 0) await page.keyboard.press('Escape')
          await expect(dialogs(page)).toHaveCount(0)
          const message = page.getByText(strings.noMatches, { exact: true })
          const reset = page.getByRole('button', { name: strings.clearFilters, exact: true })
          if ((await message.count()) === 0) {
            skip(
              'nomatch: with every filter choice on, items still match (or the template shows no "no matches" text)',
            )
            continue
          }
          await expect(message).toBeVisible()
          await expect(reset).toBeVisible()
          await shoot(page, file(theme, scheme, lang, 390, 'nomatch'))
        }
      }
    })

    test(`${theme.id} logos with no background`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 800 })
      for (const scheme of SCHEMES) {
        await page.emulateMedia({ colorScheme: scheme })
        for (const [name, id] of Object.entries(LOGO_MARKS)) {
          await openMenu(page, theme, 'bg', 'two', id)
          if ((await page.locator(`img[src*="${id}"]`).count()) === 0) {
            skip('logo: the menu has no logo to swap, or the template draws none')
            continue
          }
          await shoot(page, file(theme, scheme, 'bg', 390, `logo-${name}`))
        }
      }
    })

    test(`${theme.id} 320 at 200 % text`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 })
      for (const scheme of SCHEMES) {
        for (const lang of LANGS) {
          const words = WORDS[lang]
          const path = (screen: string) => file(theme, scheme, lang, 320, `zoom200-${screen}`)
          await page.emulateMedia({ colorScheme: scheme })
          await openMenu(page, theme, lang, 'two')
          await zoomText(page, 2)
          await shoot(page, path('top'))
          const beer = sectionOf(card(page, words.soldOut))
          await beer.scrollIntoViewIfNeeded()
          await shoot(page, path('layout-two'), beer)
          await shoot(page, path('longname-photo'), card(page, words.longName))
          await shoot(page, path('longname-text'), card(page, words.longText))
        }
      }
    })

    test(`${theme.id} landscape 844 x 390`, async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 })
      for (const scheme of SCHEMES) {
        for (const lang of LANGS) {
          const words = WORDS[lang]
          const path = (screen: string) => file(theme, scheme, lang, 844, `landscape-${screen}`)
          await page.emulateMedia({ colorScheme: scheme })
          await openMenu(page, theme, lang, 'two')
          await shoot(page, path('top'))

          const dish = card(page, words.negroni).locator('[data-slot="item.name"] button')
          if ((await dish.count()) === 0) {
            skip('landscape/dish: item.name holds no button, so there is no dish page to open')
          } else {
            await dish.click()
            await expect(dialogs(page)).toHaveCount(1)
            await shoot(page, path('dish'))
            await page.keyboard.press('Escape')
            await expect(dialogs(page)).toHaveCount(0)
          }

          if (await openFilterSheet(page, 'landscape/filters')) {
            await shoot(page, path('filters'))
            await page.keyboard.press('Escape')
            await expect(dialogs(page)).toHaveCount(0)
          }
        }
      }
    })
  }
})

test.describe('the service screens, in the Design preview', () => {
  test.describe.configure({ mode: 'serial' })
  let owner: Owner

  test.beforeAll(async ({ browser }) => {
    await servicesOn()
    owner = await signInAsOwner(browser)
  })

  test.afterAll(async () => {
    await owner?.context.close()
    await servicesBack()
  })

  for (const theme of VISUAL_THEMES) {
    for (const width of [390, 320]) {
      test(`${theme.id} ${width}`, async () => {
        const { page } = owner
        for (const scheme of SCHEMES) {
          for (const lang of LANGS) {
            // A fresh preview each time: the demo table starts again (a paid bill would change them all).
            await openPreview(owner, width, scheme, { servicesOptional: true })
            await chooseTheme(page, theme)
            if (!(await chooseLanguage(page, lang))) {
              skip(
                `services: the preview of ${FACE_ID} draws no menu.language; the pictures keep the menu's default language`,
              )
            }
            await tryFillBag(page)
            for (const screen of SCREENS) {
              const why = await whyNoScreen(page, screen)
              if (why !== null) {
                skip(`services/${screen}: ${why}`)
                continue
              }
              await onScreen(page, screen, async () => {
                await shoot(
                  page,
                  file(theme, scheme, lang, width, screen),
                  page.getByTestId('phone-frame'),
                )
              })
            }
          }
        }
      })
    }
  }
})
