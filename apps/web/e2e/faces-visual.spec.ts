import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { dialogs, settled } from './faces-audit'
import {
  chooseTheme,
  fillBag,
  type Owner,
  onScreen,
  openPreview,
  PREVIEW_FACE,
  SCREENS,
  servicesBack,
  servicesOn,
  signInAsOwner,
} from './faces-preview'
import {
  LONG_NAME_BG,
  LONG_NAME_EN,
  LONG_TEXT_NAME_BG,
  LONG_TEXT_NAME_EN,
  VISUAL_THEMES,
  type VisualTheme,
  visualPath,
} from './visual-fixtures'

// The screenshot matrix of the Editorial Market (brief SH-07): pictures for people to look at, not a
// pixel comparison. Skipped unless FACES_VISUAL=1, so the normal gate stays fast:
//
//   FACES_VISUAL=1 pnpm --filter @restro/web run test:e2e e2e/faces-visual.spec.ts
//
// Every picture goes to apps/web/test-results/faces-visual/<preset>-<scheme>-<lang>-<width>-<screen>.png
//
//   presets  the designer's four and a custom one from three colours
//   schemes  light, dark;  languages  bg, en;  widths  320, 360, 390, 430, 820
//   screens  top (the venue bar, the title, the rail, the photo strip), layout-list, layout-one and
//            layout-two (a section of photo cards), soldout and scheduled (a photo card each),
//            longname-photo and longname-text (at 320 only: 60 characters of Cyrillic or Latin),
//            dish (the dish page), filters (the filter sheet), allergens (the allergen sheet)
//   services bag, bill, call, pay, receipt: the Design tab's phone preview with "Preview guest
//            services" on, at 390 and 320 (the phone frame is 360 px wide at most, so the other
//            widths would look the same)
test.skip(process.env.FACES_VISUAL !== '1', 'screenshots for people to review: set FACES_VISUAL=1')
test.setTimeout(180_000)

const OUT = fileURLToPath(new URL('../test-results/faces-visual/', import.meta.url))
mkdirSync(OUT, { recursive: true })

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

const card = (page: Page, name: string) =>
  page.locator('[data-item]').filter({ has: page.getByRole('heading', { name, exact: true }) })

/** Loads the photos that wait for the guest to scroll, and waits for all of them. */
async function loadPhotos(page: Page) {
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

test.describe('the guest menu', () => {
  for (const theme of VISUAL_THEMES) {
    for (const scheme of SCHEMES) {
      for (const lang of LANGS) {
        for (const width of WIDTHS) {
          test(`${theme.id} ${scheme} ${lang} ${width}`, async ({ page }) => {
            const words = WORDS[lang]
            const path = (screen: string) => file(theme, scheme, lang, width, screen)
            await page.setViewportSize({ width, height: 800 })
            await page.emulateMedia({ colorScheme: scheme })
            await page.goto(`${visualPath(theme)}?lang=${lang}&t=${theme.table}`)
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
            await loadPhotos(page)

            await shoot(page, path('top'))

            // A section of photo cards in each layout.
            const beer = page.locator('main > section').nth(1)
            for (const [index, layout] of LAYOUTS.entries()) {
              await page.locator('.rm-layout [role="radio"]').nth(index).click()
              await expect(page.locator('[data-face="editorial-market"]')).toHaveAttribute(
                'data-layout',
                layout,
              )
              await beer.scrollIntoViewIfNeeded()
              await shoot(page, path(`layout-${layout}`), beer)
            }

            // A long name at the narrowest width, in the narrowest layout (two columns).
            if (width === 320) {
              await page.locator('.rm-layout [role="radio"]').nth(2).click()
              await shoot(page, path('longname-photo'), card(page, words.longName))
              await shoot(page, path('longname-text'), card(page, words.longText))
            }

            // Sold-out and scheduled items, as one column of big cards.
            await page.locator('.rm-layout [role="radio"]').nth(1).click()
            await shoot(page, path('soldout'), card(page, words.soldOut))
            await shoot(page, path('scheduled'), card(page, words.scheduled))

            // The dish page, the filter sheet and the allergen sheet.
            await card(page, words.negroni).locator('.rm-item-open').click()
            await expect(dialogs(page)).toHaveCount(1)
            await shoot(page, path('dish'))
            await page.keyboard.press('Escape')
            await expect(dialogs(page)).toHaveCount(0)

            await page.locator('.rm-header [data-slot="menu.filters"]').click()
            await expect(dialogs(page)).toHaveCount(1)
            await shoot(page, path('filters'))
            await page.keyboard.press('Escape')
            await expect(dialogs(page)).toHaveCount(0)

            await card(page, words.platter).locator('[data-slot="item.allergens"] button').click()
            await expect(dialogs(page)).toHaveCount(1)
            await shoot(page, path('allergens'))
          })
        }
      }
    }
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
            await openPreview(owner, width, scheme)
            await chooseTheme(page, theme)
            await page
              .locator(`${PREVIEW_FACE} .rm-language button`, { hasText: lang.toUpperCase() })
              .click()
            await fillBag(page)
            for (const screen of SCREENS) {
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
