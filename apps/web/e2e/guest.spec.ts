import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { devices, expect, type Page, test } from '@playwright/test'

import { DEMO_ITEMS, DEMO_SECTIONS } from '../scripts/lib/demo-menu'
import { GUEST_SLUG, GUEST_TABLE_LABEL, GUEST_TABLE_TOKEN, TAG_SLUG } from './support'

// The guest's phone page on a production build (brief S3-03): the demo venue's menu that
// `scripts/seed-guest-e2e.ts` published into the e2e publish folder, read through `/cdn`, on a
// Pixel 7 (and an iPhone 13 sized screen for one picture). No sign-in: the page is public. The
// screenshots (BG and EN, light and dark) go to `.local/screenshots/s3/`.
test.use({ ...devices['Pixel 7'] })

const SHOTS = fileURLToPath(new URL('../../../.local/screenshots/s3/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const shot = (name: string) => `${SHOTS}s3-03-${name}.png`

const SECTIONS_BG = ['Коктейли', 'Бира', 'Безалкохолни', 'Храна']
const SECTIONS_EN = ['Cocktails', 'Beer', 'Soft drinks', 'Food']

/** Opens a guest page and waits until the menu (not the skeleton) and its photos are there. */
async function open(page: Page, url: string) {
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForFunction(() => [...document.images].every((image) => image.complete))
}

const names = (page: Page) => page.locator('[data-slot="item.name"]').allTextContents()
const sectionTitles = (page: Page) => page.locator('h2.rq-section-title').allTextContents()
const card = (page: Page, name: string) =>
  page.locator('[data-item]').filter({ has: page.getByRole('heading', { name, exact: true }) })

test.describe('the menu of /m/demo-club', () => {
  test('shows the sections in order, a price, and the language switch BG <-> EN', async ({
    page,
  }) => {
    await open(page, `/m/${GUEST_SLUG}?lang=bg`)
    expect((await sectionTitles(page)).slice(0, 4)).toEqual(SECTIONS_BG)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Демо клуб')
    // A price in the venue's money, formatted for Bulgarian.
    await expect(card(page, 'Негрони')).toContainText(/10,50\s?€/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'bg-BG')

    await page.getByRole('button', { name: 'EN', exact: true }).click()
    await expect
      .poll(() => sectionTitles(page).then((titles) => titles.slice(0, 4)))
      .toEqual(SECTIONS_EN)
    await expect(card(page, 'Negroni')).toContainText(/€10\.50/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
    expect(new URL(page.url()).searchParams.get('lang')).toBe('en')

    await page.getByRole('button', { name: 'БГ', exact: true }).click()
    await expect.poll(() => sectionTitles(page).then((titles) => titles[0])).toBe('Коктейли')
  })

  test('opens the allergen legend from a code, with the full names', async ({ page }) => {
    await open(page, `/m/${GUEST_SLUG}?lang=bg`)
    // Gluten is number 1 of the EU list; the beer has it.
    const beer = card(page, 'Загорка 500 мл')
    await beer.getByRole('button', { name: 'Глутен' }).click()
    const dialog = page.getByRole('dialog', { name: 'Алергени' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('li[data-on="true"]')).toContainText('Глутен')
    await expect(dialog.locator('li').first()).toContainText('Глутен')
    await page.screenshot({ path: shot('guest-bg-light-allergen-sheet') })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    // The footer lists every allergen of the menu for a guest who never taps.
    await expect(page.locator('[data-slot="menu.allergen_legend"]')).toContainText('Глутен')
  })

  test('filters by a dietary label, and back', async ({ page }) => {
    await open(page, `/m/${GUEST_SLUG}?lang=bg`)
    const before = await names(page)
    await page.getByRole('group', { name: 'Диета' }).getByRole('button', { name: 'Веган' }).click()
    await expect.poll(() => names(page)).toEqual(['Негрони', 'Пържени картофки'])
    await page.getByRole('group', { name: 'Диета' }).getByRole('button', { name: 'Всички' }).click()
    await expect.poll(() => names(page)).toEqual(before)
  })

  test('jumps to a section from the sticky bar and highlights it', async ({ page }) => {
    await open(page, `/m/${GUEST_SLUG}?lang=bg`)
    const bar = page.getByRole('navigation', { name: 'Раздели на менюто' })
    await bar.getByRole('link', { name: 'Храна', exact: true }).click()
    await expect(bar.getByRole('link', { name: 'Храна', exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    )
    // The section sits just under the bar, and the bar stays at the top.
    await expect
      .poll(
        async () =>
          (await page.locator('h2.rq-section-title', { hasText: 'Храна' }).boundingBox())?.y,
      )
      .toBeLessThan(200)
    expect((await bar.boundingBox())?.y).toBeLessThanOrEqual(1)
  })

  test('keeps cards stable and controls tappable on a phone', async ({ page }) => {
    await open(page, `/m/${GUEST_SLUG}?lang=bg`)
    // No sideways scroll.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    // Photos reserve their box and load lazily.
    const photos = await page.locator('.rq-item-media img').evaluateAll((images) =>
      images.map((image) => {
        const img = image as HTMLImageElement
        return {
          lazy: img.loading,
          width: img.getAttribute('width'),
          height: img.getAttribute('height'),
          srcset: img.srcset,
          alt: img.alt,
        }
      }),
    )
    expect(photos.length).toBe(3)
    for (const photo of photos) {
      expect(photo.lazy).toBe('lazy')
      expect(Number(photo.width)).toBeGreaterThan(0)
      expect(Number(photo.height)).toBeGreaterThan(0)
      expect(photo.srcset).toMatch(/\/cdn\/a\/as_\w+\/w\d+\.webp \d+w/)
      expect(photo.alt).not.toBe('')
    }
    // Every control is at least 44 px high (the language buttons and allergen codes 44 wide too).
    const small = await page.locator('button, nav a').evaluateAll((elements) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect()
          return { text: element.textContent?.trim(), w: box.width, h: box.height }
        })
        .filter((box) => box.w > 0 && (box.h < 43.5 || (box.w < 43.5 && box.text?.length === 0)))
        .map((box) => `${box.text}: ${box.w}x${box.h}`),
    )
    expect(small).toEqual([])
    // A long description is cut to three lines and offers "Още".
    const more = page.getByRole('button', { name: 'Още' }).first()
    if (await more.count()) {
      await more.click()
      await expect(page.getByRole('button', { name: 'По-малко' }).first()).toBeVisible()
    }
  })

  test('gives less motion to a guest who asks for it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page, `/m/${GUEST_SLUG}`)
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
    ).toBe('auto')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
    ).toBe('smooth')
  })
})

test.describe('the tag filter', () => {
  test('filters a menu by tag, and "All" brings everything back', async ({ page }) => {
    await open(page, `/m/${TAG_SLUG}?lang=bg`)
    await expect.poll(() => names(page)).toEqual(['Негрони', 'Хумус'])
    await page
      .getByRole('group', { name: 'Етикети' })
      .getByRole('button', { name: 'Фирмено' })
      .click()
    await expect.poll(() => names(page)).toEqual(['Негрони'])
    await page
      .getByRole('group', { name: 'Етикети' })
      .getByRole('button', { name: 'Всички' })
      .click()
    await expect.poll(() => names(page)).toEqual(['Негрони', 'Хумус'])
  })
})

test.describe('the table code', () => {
  test.use({ locale: 'bg-BG' })

  test('/t/<token> leads to the menu with the table banner, in the browser language', async ({
    page,
    request,
  }) => {
    const redirect = await request.get(`/t/${GUEST_TABLE_TOKEN}`, { maxRedirects: 0 })
    expect(redirect.status()).toBe(302)
    expect(redirect.headers().location).toBe(`/m/${GUEST_SLUG}?t=${GUEST_TABLE_TOKEN}`)

    await page.goto(`/t/${GUEST_TABLE_TOKEN}`)
    await page.waitForURL(`**/m/${GUEST_SLUG}?t=${GUEST_TABLE_TOKEN}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(
      page.getByRole('status').filter({ hasText: `Маса ${GUEST_TABLE_LABEL}` }),
    ).toBeVisible()
    await page.screenshot({ path: shot('guest-bg-light-table') })
  })

  test('an English browser gets the English menu without asking', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'en-GB' })
    const page = await context.newPage()
    await page.goto(`/t/${GUEST_TABLE_TOKEN}`)
    await expect(
      page.getByRole('status').filter({ hasText: `Table ${GUEST_TABLE_LABEL}` }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo Club')
    await context.close()
  })

  test('an unknown code gets a small page in both languages and no venue data', async ({
    page,
    request,
  }) => {
    const response = await request.get('/t/tb_notARealCode0000001', { maxRedirects: 0 })
    expect(response.status()).toBe(404)
    await page.goto('/t/tb_notARealCode0000001')
    await expect(page.getByText('This table code is not active.')).toBeVisible()
    await expect(page.getByText('Ask the staff.')).toBeVisible()
    await expect(page.getByText('Този код за маса не е активен.')).toBeVisible()
    await expect(page.getByText('Попитайте персонала.')).toBeVisible()
    expect(await page.content()).not.toContain(GUEST_SLUG)
    await page.screenshot({ path: shot('table-code-not-active') })
  })

  test('a venue that does not exist gets a friendly notice, not an error page', async ({
    page,
  }) => {
    await page.goto('/m/no-such-club?lang=en')
    await expect(page.getByText('Menu not found')).toBeVisible()
    await expect(page.getByRole('button')).toHaveCount(0)
  })
})

test.describe('what the page asks for (rule 4)', () => {
  test('only /cdn files and Next assets, and no barsy id in any of them', async ({ page }) => {
    const urls: string[] = []
    const bodies: { url: string; text: string }[] = []
    page.on('response', async (response) => {
      const url = new URL(response.url())
      urls.push(`${url.pathname}`)
      if (url.pathname.startsWith('/cdn/') && url.pathname.endsWith('.json')) {
        bodies.push({ url: url.pathname, text: await response.text() })
      }
    })
    await open(page, `/m/${GUEST_SLUG}?t=${GUEST_TABLE_TOKEN}`)
    await page.waitForLoadState('networkidle')

    const allowed = (pathname: string) =>
      pathname.startsWith('/cdn/') ||
      pathname.startsWith('/_next/') ||
      pathname === `/m/${GUEST_SLUG}` ||
      pathname === '/favicon.ico'
    expect(urls.filter((pathname) => !allowed(pathname))).toEqual([])
    // The chain: slug index, pointer, snapshot, overlay, and the table's file.
    for (const part of ['/cdn/v/', '/cdn/m/', '/cdn/snap/', '/cdn/t/']) {
      expect(
        urls.some((pathname) => pathname.startsWith(part)),
        part,
      ).toBe(true)
    }
    expect(urls.some((pathname) => pathname.startsWith('/api/'))).toBe(false)

    // None of what came back holds a barsy id (article or category id of the demo installation).
    const externalIds = [
      ...DEMO_ITEMS.map((item) => item.externalId),
      ...DEMO_SECTIONS.map((section) => section.externalId),
    ]
    expect(bodies.length).toBeGreaterThanOrEqual(4)
    for (const { url, text } of bodies) {
      for (const id of externalIds) {
        expect(
          new RegExp(`(?<![0-9A-Za-z])${id}(?![0-9A-Za-z])`).test(text),
          `${id} in ${url}`,
        ).toBe(false)
      }
      expect(text, url).not.toMatch(/internal_note|cost_price|storage_key|original\./i)
    }
  })

  test('/cdn ignores the cache-busting query of live.json when it looks the file up (S3-10)', async ({
    request,
  }) => {
    const index = (await (await request.get(`/cdn/v/${GUEST_SLUG}.json`)).json()) as {
      venue_id: string
      menu_id: string
    }
    const live = `/cdn/m/${index.menu_id}/${index.venue_id}/live.json`
    const plain = await request.get(live)
    expect(plain.status()).toBe(200)
    // What the guest page asks for after an overlay of another version: ?v=<version>, and later
    // tries add &r=<n>. The file is the same; only the cache key (a CDN's) differs.
    for (const query of ['?v=1', '?v=1&r=2', '?v=1&r=3']) {
      const busted = await request.get(`${live}${query}`)
      expect(busted.status(), query).toBe(200)
      expect(await busted.json(), query).toEqual(await plain.json())
      expect(busted.headers()['cache-control'], query).toBe('public, max-age=15')
    }
  })
})

test.describe('screenshots (BG and EN, light and dark)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const lang of ['bg', 'en'] as const) {
      test(`${lang} ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme })
        await open(page, `/m/${GUEST_SLUG}?lang=${lang}&t=${GUEST_TABLE_TOKEN}`)
        // The page follows the guest's screen: a dark page on a dark screen, a light one otherwise.
        const luminance = await page.evaluate(() => {
          const root = document.querySelector('.rq-root') as HTMLElement
          const [r = 0, g = 0, b = 0] = (getComputedStyle(root).backgroundColor.match(/\d+/g) ?? [])
            .slice(0, 3)
            .map(Number)
          return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        })
        if (scheme === 'dark') expect(luminance).toBeLessThan(0.15)
        else expect(luminance).toBeGreaterThan(0.85)
        await page.screenshot({ path: shot(`guest-${lang}-${scheme}`) })
        await page.screenshot({ path: shot(`guest-${lang}-${scheme}-full`), fullPage: true })
      })
    }
  }

  test('iPhone 13 sized screen, bg light', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'light' })
    const page = await context.newPage()
    await open(page, `/m/${GUEST_SLUG}?lang=bg&t=${GUEST_TABLE_TOKEN}`)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({ path: shot('guest-iphone13-bg-light') })
    await context.close()
  })
})
