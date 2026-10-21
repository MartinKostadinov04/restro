import { expect, type Page, test } from '@playwright/test'

import { dialogs, exerciseDialog, overlapsInHeader, settled, withAudit } from './faces-audit'
import { runScript } from './global-setup'
import {
  LONG_NAME_BG,
  LONG_NAME_EN,
  LONG_TEXT_NAME_BG,
  VISUAL_ITEMS,
  VISUAL_THEMES,
  type VisualTheme,
  visualPath,
} from './visual-fixtures'

// The accessibility audit of the Editorial Market's guest page (brief SH-07, T74), on a production
// build. The menus are the five themes of scripts/seed-visual-e2e.ts (the designer's four presets
// and one made from three colours), all with the same content: photo cards in the strip and in
// every layout, a sold-out and a scheduled item, 60-character Cyrillic names, a dish with all
// fourteen allergens, a sub-section, filters. The service screens (the bag, the bill, the waiter,
// paying, the receipt) are audited in faces-a11y-services.spec.ts, in the Design preview.
//
// What it holds the page to, at 320 and 390 px unless a step says otherwise:
//   touch targets   every button, link and radio is at least 44 x 44 px (the page, and each dialog)
//   dialogs         focus goes in, Tab stays in, Escape closes, focus returns to the opener
//   overflow        no sideways scroll, nothing sticks out of the screen
//   names           never cut: no ellipsis, no line clamp, nothing clipped
//   motion          a guest who asks for less gets no animation
//   contrast        what is drawn, measured as the browser paints it (colour mixes, opacity,
//                   inverse bands), for every theme in the light and the dark scheme
//   markup          headings in order, no heading or block inside a button, an image size that
//                   follows the layout, a table label that stays, a cue for the dish's allergens
test.setTimeout(90_000)

const FACE = '[data-face="editorial-market"]:not([data-testid])'
const [BOTANICAL] = VISUAL_THEMES
const LAYOUTS = ['list', 'one', 'two'] as const

test.beforeAll(() => {
  runScript('./scripts/seed-visual-e2e.ts')
})

/** Opens a fixture menu on a phone-sized screen and waits until the menu and its photos are there. */
async function openMenu(
  page: Page,
  options: {
    theme?: VisualTheme
    width?: number
    lang?: 'bg' | 'en'
    scheme?: 'light' | 'dark'
    table?: boolean
  } = {},
) {
  const { theme = BOTANICAL, width = 390, lang = 'bg', scheme = 'light', table = false } = options
  await withAudit(page)
  await page.setViewportSize({ width, height: 800 })
  await page.emulateMedia({ colorScheme: scheme })
  await page.goto(`${visualPath(theme)}?lang=${lang}${table ? `&t=${theme.table}` : ''}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // The photos of the first screens (the others are lazy and wait for the guest to scroll).
  await page.waitForFunction(() =>
    [...document.images]
      .filter((image) => image.getBoundingClientRect().top < window.innerHeight * 1.5)
      .every((image) => image.complete),
  )
}

const card = (page: Page, name: string) =>
  page.locator('[data-item]').filter({ has: page.getByRole('heading', { name, exact: true }) })

/** The opener of the dish page of an item, by the item's Bulgarian name. */
const dishOpener = (page: Page, name: string) => card(page, name).locator('[data-slot="item.open"]')

/** The sheet-opening buttons of the menu, in either language. */
const filterButton = (page: Page) => page.locator('.rm-header [data-slot="menu.filters"]')
const allergenButton = (page: Page, name: string) =>
  card(page, name).locator('[data-slot="item.allergens"] button')
/** The sharing platter, which lists all fourteen allergens, by its name in each language. */
const PLATTER = { bg: VISUAL_ITEMS.platter, en: 'Sharing platter' } as const

test.describe('the touch targets', () => {
  for (const width of [320, 390]) {
    test(`every button, link and radio is 44 x 44 px at ${width} px, on the page and in each dialog`, async ({
      page,
    }) => {
      await openMenu(page, { width, table: true })
      const small = new Map<string, string[]>()
      const measure = async (state: string, root = FACE) => {
        const found = await page.evaluate((root) => window.__rmAudit.targets(root), root)
        small.set(
          state,
          found.map((target) => `${target.label}: ${target.width}x${target.height}`),
        )
      }
      await measure('the page')
      for (const layout of [0, 1]) {
        await page.locator('.rm-layout [role="radio"]').nth(layout).click()
        await measure(`the page, layout ${LAYOUTS[layout]}`)
      }
      await filterButton(page).click()
      await measure('the filter sheet', '.rm-overlay')
      await page.keyboard.press('Escape')
      await allergenButton(page, VISUAL_ITEMS.platter).click()
      await measure('the allergen sheet', '.rm-overlay')
      await page.keyboard.press('Escape')
      await dishOpener(page, VISUAL_ITEMS.platter).click()
      await measure('the dish page', '.rm-overlay')
      expect(Object.fromEntries([...small].filter(([, found]) => found.length > 0))).toEqual({})
    })
  }
})

test.describe('the dialogs', () => {
  test('the dish page, the filter sheet and the allergen sheet keep the focus and give it back', async ({
    page,
  }) => {
    await openMenu(page, { width: 390 })
    await exerciseDialog(page, dishOpener(page, VISUAL_ITEMS.negroni), VISUAL_ITEMS.negroni)
    await exerciseDialog(page, filterButton(page), 'Филтриране на менюто')
    await exerciseDialog(page, allergenButton(page, VISUAL_ITEMS.platter), 'Алергени')
  })

  test('the allergen sheet over the dish page: Escape closes the sheet first, then the page', async ({
    page,
  }) => {
    await openMenu(page, { width: 390 })
    const opener = dishOpener(page, VISUAL_ITEMS.platter)
    await opener.evaluate((element) => element.setAttribute('data-rm-opener', ''))
    await opener.click()
    const dish = page.getByRole('dialog', { name: VISUAL_ITEMS.platter })
    await expect(dish).toBeVisible()
    const info = dish.getByRole('button', { name: 'Алергени', exact: true })
    await exerciseDialog(page, info, 'Алергени')
    // The dish page is still there, with the focus on the button that opened the sheet.
    await expect(page.getByRole('dialog', { name: VISUAL_ITEMS.platter })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialogs(page)).toHaveCount(0)
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.hasAttribute('data-rm-opener')))
      .toBe(true)
  })
})

test.describe('the screen width', () => {
  for (const lang of ['bg', 'en'] as const) {
    test(`nothing sticks out of a 320 px screen, in ${lang.toUpperCase()}, in every layout and dialog`, async ({
      page,
    }) => {
      await openMenu(page, { width: 320, lang })
      const outside = async (state: string) =>
        (
          await page.evaluate((state) => {
            const width = document.documentElement.clientWidth
            const found: string[] = []
            const page = document.documentElement
            if (page.scrollWidth > width)
              found.push(`${state}: the page scrolls (${page.scrollWidth})`)
            for (const element of document.querySelectorAll(
              '[data-face="editorial-market"]:not([data-testid]) *',
            )) {
              // The photo strip and the section rail scroll sideways inside their own box.
              if (element.closest('.rm-sections, .rm-section.is-feature .rm-items') !== null)
                continue
              const style = getComputedStyle(element)
              const box = element.getBoundingClientRect()
              if (box.width === 0 || style.visibility !== 'visible') continue
              if (element.closest('[hidden]') !== null) continue
              if (box.right > width + 0.5 || box.left < -0.5) {
                found.push(
                  `${state}: ${element.tagName.toLowerCase()}.${[...element.classList].join('.')} ${Math.round(box.left)}..${Math.round(box.right)}`,
                )
              }
            }
            return found
          }, state)
        ).slice(0, 8)
      const problems: string[] = []
      for (const layout of [0, 1, 2]) {
        await page.locator('.rm-layout [role="radio"]').nth(layout).click()
        problems.push(...(await outside(`layout ${LAYOUTS[layout]}`)))
      }
      await filterButton(page).click()
      problems.push(...(await outside('the filter sheet')))
      await page.keyboard.press('Escape')
      await allergenButton(page, PLATTER[lang]).click()
      problems.push(...(await outside('the allergen sheet')))
      await page.keyboard.press('Escape')
      await dishOpener(page, PLATTER[lang]).click()
      problems.push(...(await outside('the dish page')))
      expect(problems).toEqual([])
    })
  }

  test('the section rail stays at the top of the screen while the guest scrolls the menu', async ({
    page,
  }) => {
    // The page's own "no sideways scroll" rule once made <body> a scroll box of its own, and the
    // sticky rail scrolled away with the menu (globals.css explains the rule now in place).
    await openMenu(page)
    const rail = page.locator(`${FACE} .rm-sections`)
    const startTop = await rail.evaluate((element) => element.getBoundingClientRect().top)
    await page.mouse.move(195, 400)
    await page.mouse.wheel(0, startTop + 1200)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(startTop + 600)
    await expect.poll(() => rail.evaluate((element) => element.getBoundingClientRect().top)).toBe(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true)
  })
})

test.describe('the names', () => {
  for (const lang of ['bg', 'en'] as const) {
    test(`are never cut, in ${lang.toUpperCase()}, in every layout at 320 px`, async ({ page }) => {
      await openMenu(page, { width: 320, lang })
      const long = lang === 'bg' ? LONG_NAME_BG : LONG_NAME_EN
      const problems: string[] = []
      for (const layout of [0, 1, 2]) {
        await page.locator('.rm-layout [role="radio"]').nth(layout).click()
        problems.push(
          ...(await page.evaluate(
            ({ state, long }) => {
              const width = document.documentElement.clientWidth
              const found: string[] = []
              const names = document.querySelectorAll('[data-slot="item.name"]')
              if (names.length === 0) found.push(`${state}: no names`)
              for (const slot of names) {
                const text = (slot.textContent ?? '').trim()
                for (const element of [slot, ...slot.querySelectorAll('*')]) {
                  const style = getComputedStyle(element)
                  const clamp = (style as CSSStyleDeclaration & { webkitLineClamp: string })
                    .webkitLineClamp
                  if (style.textOverflow === 'ellipsis')
                    found.push(`${state}: ellipsis on "${text}"`)
                  if (clamp !== 'none' && clamp !== '')
                    found.push(`${state}: line clamp on "${text}"`)
                  if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
                    found.push(`${state}: "${text}" runs past its box (${element.tagName})`)
                  }
                  if (
                    element.scrollHeight > element.clientHeight + 1 &&
                    style.overflowY !== 'visible'
                  ) {
                    found.push(`${state}: "${text}" is clipped in height (${element.tagName})`)
                  }
                }
                const box = slot.getBoundingClientRect()
                if (
                  slot.closest('.rm-section.is-feature') === null &&
                  box.width > 0 &&
                  box.right > width + 0.5
                ) {
                  found.push(`${state}: "${text}" sticks out of the screen`)
                }
              }
              const longest = [...names].find((slot) => (slot.textContent ?? '').includes(long))
              if (longest === undefined) found.push(`${state}: the 60-character name is missing`)
              return found
            },
            { state: `layout ${LAYOUTS[layout]}`, long },
          )),
        )
      }
      expect(problems).toEqual([])
    })
  }
})

test.describe('reduced motion', () => {
  test('a guest who asks for less gets no animation when the dish page and the sheets open', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openMenu(page)
    const moving = (state: string) =>
      page.evaluate((state) => {
        const found: string[] = []
        for (const element of document.querySelectorAll(
          '.rm-overlay, .rm-overlay-panel, .rm-overlay-panel *',
        )) {
          const style = getComputedStyle(element)
          const names = style.animationName.split(',').map((part) => part.trim())
          const durations = style.animationDuration
            .split(',')
            .map((part) => Number.parseFloat(part))
          const running = names.some(
            (name, index) => name !== 'none' && (durations[index] ?? 0) > 0,
          )
          if (running)
            found.push(`${state}: ${element.tagName}.${element.className} ${style.animationName}`)
        }
        const live = document
          .getAnimations()
          .filter((animation) => animation.effect instanceof KeyframeEffect)
          .filter((animation) => {
            const target = (animation.effect as KeyframeEffect).target
            return target !== null && target.closest('.rm-overlay') !== null
          })
        if (live.length > 0) found.push(`${state}: ${live.length} animation(s) in the dialog`)
        return found
      }, state)
    const problems: string[] = []
    await dishOpener(page, VISUAL_ITEMS.negroni).click()
    await expect(dialogs(page)).toHaveCount(1)
    problems.push(...(await moving('the dish page')))
    await page.keyboard.press('Escape')
    await expect(dialogs(page)).toHaveCount(0)
    await filterButton(page).click()
    problems.push(...(await moving('the filter sheet')))
    await page.keyboard.press('Escape')
    await allergenButton(page, VISUAL_ITEMS.platter).click()
    problems.push(...(await moving('the allergen sheet')))
    expect(problems).toEqual([])
    // And the page itself scrolls without gliding.
    expect(await page.locator(FACE).evaluate((root) => getComputedStyle(root).scrollBehavior)).toBe(
      'auto',
    )
  })
})

test.describe('the contrast of what is drawn', () => {
  for (const theme of VISUAL_THEMES) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${theme.id}, ${scheme}: every text reads at 4.5:1 (3:1 when large), on the page and in the sheets`, async ({
        page,
      }) => {
        await openMenu(page, { theme, scheme, table: true })
        const low: Record<string, unknown> = {}
        const scan = async (state: string, root: string) => {
          await settled(page)
          const found = await page.evaluate((root) => window.__rmAudit.textContrast(root), root)
          expect(found.checked, `${state} has text to measure`).toBeGreaterThan(5)
          if (found.low.length > 0) low[state] = found.low
        }
        await scan('the page', FACE)
        await filterButton(page).click()
        await scan('the filter sheet', '.rm-overlay')
        await page.keyboard.press('Escape')
        await allergenButton(page, VISUAL_ITEMS.platter).click()
        await scan('the allergen sheet', '.rm-overlay')
        await page.keyboard.press('Escape')
        await dishOpener(page, VISUAL_ITEMS.platter).click()
        await scan('the dish page', '.rm-overlay')
        expect(low).toEqual({})
      })

      test(`${theme.id}, ${scheme}: the boundary of a choice the guest makes shows at 3:1`, async ({
        page,
      }) => {
        await openMenu(page, { theme, scheme })
        await filterButton(page).click()
        await settled(page)
        const found = await page.evaluate(() =>
          window.__rmAudit.borderContrast('.rm-filter-group button'),
        )
        expect(found.length).toBeGreaterThan(2)
        expect(found.filter((entry) => entry.ratio < 3)).toEqual([])
      })
    }
  }
})

test.describe('the markup', () => {
  test('headings run h1, h2 for sections, h3 for items and h4 under a sub-section; nothing but text sits in a button', async ({
    page,
  }) => {
    await openMenu(page)
    const outline = await page.evaluate((root) => {
      const face = document.querySelector(root)
      if (face === null) return null
      const level = (element: Element) => Number(element.tagName.slice(1))
      const items = (selector: string) =>
        [...face.querySelectorAll(selector)].map((element) => level(element))
      return {
        h1: face.querySelectorAll('h1').length,
        sections: items('main > section > .rm-section-head > :is(h1,h2,h3,h4)'),
        subSections: items('main > section > section > .rm-section-head > :is(h1,h2,h3,h4)'),
        topItems: items(
          'main > section > .rm-items [data-slot="item.name"] :is(h1,h2,h3,h4,h5,h6)',
        ),
        subItems: items(
          'main > section > section > .rm-items [data-slot="item.name"] :is(h1,h2,h3,h4,h5,h6)',
        ),
        blocksInButtons: [
          ...face.querySelectorAll(
            'button :is(div, p, h1, h2, h3, h4, h5, h6, ul, ol, li, section, article)',
          ),
        ].map((element) => element.tagName.toLowerCase()),
      }
    }, FACE)
    expect(outline).not.toBeNull()
    expect(outline?.h1).toBe(1)
    expect(new Set(outline?.sections)).toEqual(new Set([2]))
    expect(new Set(outline?.subSections)).toEqual(new Set([3]))
    expect(new Set(outline?.topItems)).toEqual(new Set([3]))
    expect(outline?.subItems.length).toBeGreaterThan(0)
    expect(new Set(outline?.subItems)).toEqual(new Set([4]))
    expect(outline?.blocksInButtons).toEqual([])
  })

  test('the item opens by a button named after the dish, inside its heading, and says it opens a dialog', async ({
    page,
  }) => {
    await openMenu(page)
    const heading = page.getByRole('heading', { name: VISUAL_ITEMS.negroni, exact: true })
    await expect(heading).toHaveCount(1)
    const open = heading.getByRole('button', { name: VISUAL_ITEMS.negroni })
    await expect(open).toHaveCount(1)
    await expect(open).toHaveAttribute('aria-haspopup', 'dialog')
    await open.click()
    await expect(page.getByRole('dialog', { name: VISUAL_ITEMS.negroni })).toBeVisible()
  })

  test('the table label stays on a narrow screen, and nothing in the venue bar draws over the logo or another control', async ({
    page,
  }) => {
    for (const width of [320, 340, 360, 390]) {
      await openMenu(page, { width, table: true })
      const label = page.locator('.rm-table')
      await expect(label, `Table 12 at ${width} px`).toBeVisible()
      await expect(label).toContainText('12')
      const box = await label.boundingBox()
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
      const head = await page.locator('.rm-headtools').boundingBox()
      expect((head?.x ?? 0) + (head?.width ?? 0)).toBeLessThanOrEqual(width)
      // The fixture menus have a logo: it keeps its place, and the controls wrap beside it.
      await expect(page.locator('.rm-logo')).toBeVisible()
      expect(await overlapsInHeader(page, FACE), `the venue bar at ${width} px`).toEqual([])
    }
  })

  test('the photos say which size they will have in each layout, so a phone takes a smaller file', async ({
    page,
  }) => {
    await openMenu(page, { width: 390 })
    const sizes: Record<string, string> = {}
    for (const [index, layout] of LAYOUTS.entries()) {
      await page.locator('.rm-layout [role="radio"]').nth(index).click()
      await expect(page.locator(FACE)).toHaveAttribute('data-layout', layout)
      // A photo card of the second section (the strip of the first one has its own size).
      sizes[layout] = await card(page, 'Загорка 500 мл')
        .locator('[data-slot="item.image"] img')
        .getAttribute('sizes')
        .then((value) => value ?? '')
    }
    expect(new Set(Object.values(sizes)).size, JSON.stringify(sizes)).toBe(3)
    // Two columns: half of the screen, not all of it. One column: the screen less the margins.
    expect(sizes.two).toMatch(/\b50vw\b/)
    expect(sizes.two).not.toMatch(/\b100vw\b/)
    expect(sizes.list).toMatch(/^\s*(\(.*\)\s*)?96px/)
    // The file the browser picks follows: at 390 px and 2x, two columns need no 640 px file.
    await page.locator('.rm-layout [role="radio"]').nth(2).click()
    const picked = await card(page, 'Загорка 500 мл')
      .locator('[data-slot="item.image"] img')
      .evaluate((image) => new URL((image as HTMLImageElement).currentSrc).pathname)
    expect(picked).toMatch(/\/w(320|640)\.webp$/)
  })

  test('the allergen sheet marks the dish’s allergens for a screen reader, not only by weight and shade', async ({
    page,
  }) => {
    await openMenu(page)
    await allergenButton(page, 'Загорка 500 мл').click()
    const sheet = page.getByRole('dialog', { name: 'Алергени' })
    await expect(sheet).toBeVisible()
    const marked = sheet.locator('[aria-current="true"]')
    await expect(marked).toHaveCount(1)
    await expect(marked).toContainText('Глутен')
    // Every other allergen of the menu is listed and not marked.
    expect(await sheet.locator('.rm-allergen-sheet > *').count()).toBeGreaterThan(5)
    await page.keyboard.press('Escape')
    await allergenButton(page, VISUAL_ITEMS.platter).click()
    await expect(
      page.getByRole('dialog', { name: 'Алергени' }).locator('[aria-current="true"]'),
    ).toHaveCount(14)
  })

  test('the long names wrap: the 60-character name shows whole in a card', async ({ page }) => {
    await openMenu(page, { width: 320 })
    await expect(page.getByRole('heading', { name: LONG_NAME_BG, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: LONG_TEXT_NAME_BG, exact: true })).toBeVisible()
  })
})
