import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { devices, expect, type Page, test } from '@playwright/test'

import { DEMO_ITEMS, DEMO_SECTIONS } from '../scripts/lib/demo-menu'
import { addressOfVenue, type VenueAddress } from './menu-path'
import {
  GUEST_SLUG,
  GUEST_TABLE_LABEL,
  GUEST_TABLE_TOKEN,
  LOOK_PUBLIC_ID,
  LOOK_SLUG,
  TAG_PUBLIC_ID,
  TAG_SLUG,
} from './support'

// The guest's phone page on a production build (brief S3-03): the demo venue's menu that
// `scripts/seed-guest-e2e.ts` published into the e2e publish folder, read through `/cdn`, on a
// Pixel 7 (and an iPhone 13 sized screen for one picture). No sign-in: the page is public. The
// screenshots (BG and EN, light and dark) go to `.local/screenshots/s3/`.
//
// The address is `/m/<slug>-<code>` (CF-14, D68). The demo venue's code is random, so the specs read
// it from the database (e2e/menu-path.ts) before they start.
test.use({ ...devices['Pixel 7'] })

/** The demo venue's address, read once before the tests. */
let GUEST: VenueAddress
/** The tagged fixture menu has no venue row: its code is a fixed one. */
const TAG_PATH = `/m/${TAG_SLUG}-${TAG_PUBLIC_ID}`
/** The look fixture (SH-04): the reference template, the dark scheme forced, Playfair Display. */
const LOOK_PATH = `/m/${LOOK_SLUG}-${LOOK_PUBLIC_ID}`

test.beforeAll(async () => {
  GUEST = await addressOfVenue({ slug: GUEST_SLUG })
})

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

// The Editorial Market keeps a filtered-out item in the page (`hidden`), so the names are those of
// the items that are shown.
const names = (page: Page) =>
  page.locator('[data-item]:visible [data-slot="item.name"]').allTextContents()
const sectionTitles = (page: Page) =>
  page.getByRole('main').getByRole('heading', { level: 2 }).allTextContents()
const card = (page: Page, name: string) =>
  page.locator('[data-item]').filter({ has: page.getByRole('heading', { name, exact: true }) })

test.describe('the menu of /m/demo-club-<code>', () => {
  test('shows the sections in order, a price, and the language switch BG <-> EN', async ({
    page,
  }) => {
    await open(page, `${GUEST.path}?lang=bg`)
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

    await page.getByRole('button', { name: 'BG', exact: true }).click()
    await expect.poll(() => sectionTitles(page).then((titles) => titles[0])).toBe('Коктейли')
  })

  test('is the Editorial Market, the registry’s default, as the venue chose no template (SH-04)', async ({
    page,
  }) => {
    await open(page, `${GUEST.path}?lang=bg`)
    const face = page.locator('[data-face]:not([data-testid])')
    await expect(face).toHaveAttribute('data-face', 'editorial-market')
    // Its layout (one of three) and the colour scheme it follows are on its root.
    await expect(face).toHaveAttribute('data-layout', /^(list|one|two)$/)
    await expect(face).toHaveAttribute('data-scheme', 'auto')
    // One template only: the other face's code and styles never reach the page.
    await expect(page.locator('[data-face="qr-phone"]')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.outerHTML.includes('rq-root'))).toBe(
      false,
    )
  })

  test('opens the allergen legend from a code, with the full names', async ({ page }) => {
    await open(page, `${GUEST.path}?lang=bg`)
    // Gluten is number 1 of the EU list; the beer has it.
    const beer = card(page, 'Загорка 500 мл')
    await beer.getByRole('button', { name: /Алергени: Глутен/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Алергени' })
    await expect(dialog).toBeVisible()
    // The sheet names every allergen of the menu and sets this item's apart.
    await expect(dialog.locator('.is-present')).toContainText('Глутен')
    await expect(dialog.getByText('Глутен')).toHaveCount(1)
    await page.screenshot({ path: shot('guest-bg-light-allergen-sheet') })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    // The footer lists every allergen of the menu for a guest who never taps.
    await expect(page.locator('[data-slot="menu.allergen_legend"]')).toContainText('Глутен')
  })

  test('filters by a dietary label, and back', async ({ page }) => {
    await open(page, `${GUEST.path}?lang=bg`)
    const before = await names(page)
    await page.getByRole('button', { name: 'Филтриране на менюто' }).click()
    const sheet = page.getByRole('dialog', { name: 'Филтриране на менюто' })
    await sheet.getByRole('group', { name: 'Диета' }).getByRole('button', { name: 'Веган' }).click()
    await expect(
      sheet.getByRole('group', { name: 'Диета' }).getByRole('button', { name: 'Веган' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect.poll(() => names(page)).toEqual(['Негрони', 'Пържени картофки'])
    await page.getByRole('button', { name: 'Филтриране на менюто' }).click()
    await sheet.getByRole('button', { name: 'Изчисти филтрите' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => names(page)).toEqual(before)
  })

  test('jumps to a section from the sticky bar and highlights it', async ({ page }) => {
    await open(page, `${GUEST.path}?lang=bg`)
    const bar = page.getByRole('navigation', { name: 'Раздели на менюто' })
    await bar.getByRole('link', { name: 'Храна', exact: true }).click()
    await expect(bar.getByRole('link', { name: 'Храна', exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    )
    // The section sits just under the bar, and the bar stays at the top.
    await expect
      .poll(
        async () => (await page.getByRole('heading', { name: 'Храна', level: 2 }).boundingBox())?.y,
      )
      .toBeLessThan(200)
    expect((await bar.boundingBox())?.y).toBeLessThanOrEqual(1)
  })

  test('keeps cards stable on a phone: no sideways scroll, photos with a reserved box', async ({
    page,
  }, testInfo) => {
    await open(page, `${GUEST.path}?lang=bg`)
    // No sideways scroll.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    // Photos reserve their box and come in the sizes the shell chose (srcset). The photos of the
    // first screen load at once; the others lazily.
    const photos = await page.locator('[data-slot="item.image"] img').evaluateAll((images) =>
      images.map((image) => {
        const img = image as HTMLImageElement
        return {
          loading: img.loading,
          width: img.getAttribute('width'),
          height: img.getAttribute('height'),
          srcset: img.srcset,
          alt: img.alt,
          item: img.closest('[data-item]')?.querySelector('h3')?.textContent,
        }
      }),
    )
    expect(photos.length).toBe(3)
    for (const photo of photos) {
      expect(Number(photo.width)).toBeGreaterThan(0)
      expect(Number(photo.height)).toBeGreaterThan(0)
      expect(photo.srcset).toMatch(/\/cdn\/a\/as_\w+\/w\d+\.webp \d+w/)
      expect(photo.alt).not.toBe('')
    }
    expect(photos.find((photo) => photo.item === 'Негрони')?.loading).toBe('eager')
    expect(photos.find((photo) => photo.item === 'Загорка 500 мл')?.loading).toBe('lazy')

    // Controls and tap size. The reference template (qr-phone) holds every control to 44 px, and
    // its test below keeps doing so. The Editorial Market was delivered with some smaller ones
    // (the language and layout switches, the allergen codes); they are listed on the report of this
    // run, and the accessibility audit (SH-07) decides what changes.
    const small = await page.locator('button, nav a').evaluateAll((elements) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect()
          return {
            label: element.getAttribute('aria-label') ?? element.textContent?.trim(),
            w: Math.round(box.width),
            h: Math.round(box.height),
          }
        })
        .filter((box) => box.w > 0 && (box.h < 44 || box.w < 30))
        .map((box) => `${box.label}: ${box.w}x${box.h}`),
    )
    testInfo.annotations.push({
      type: 'controls below 44 px high (SH-07)',
      description: [...new Set(small)].join('; ') || 'none',
    })
  })

  test('shows a long description cut on the card and whole on the dish page', async ({ page }) => {
    await open(page, `${GUEST.path}?lang=bg`)
    const daiquiri = card(page, 'Дайкири')
    // The description is in the markup in full; the card only clips it, and says whether it did.
    const description = daiquiri.locator('[data-slot="item.description"] p')
    await expect(description).toHaveText('Класически ром, лайм и захар: леко и свежо.')
    await expect(description).toHaveAttribute('data-clamped', /^(true|false)$/)
    await daiquiri
      .getByRole('button', { name: /Дайкири/ })
      .first()
      .click()
    const dish = page.getByRole('dialog', { name: 'Дайкири' })
    await expect(dish).toContainText('Класически ром, лайм и захар: леко и свежо.')
  })

  test('gives less motion to a guest who asks for it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page, GUEST.path)
    const scrollBehavior = () =>
      page.evaluate(() => {
        const root = document.querySelector('[data-face]:not([data-testid])')
        return root === null ? null : getComputedStyle(root).scrollBehavior
      })
    expect(await scrollBehavior()).toBe('auto')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    expect(await scrollBehavior()).toBe('smooth')
  })
})

// The dish page lives in the address as `#item-<id>` (SH-02): the face pushes a history entry when it
// opens and goes back one step when it closes. Next.js patches `history.pushState`/`replaceState` for
// its router, so this is checked on the real page, on a production build (brief SH-04, section 8).
test.describe('the dish page in the address bar', () => {
  /** The dish page of the demo's Mojito, whose id the page carries. */
  const dishOf = (page: Page) => page.getByRole('dialog', { name: 'Мохито' })
  const openMojito = (page: Page) =>
    card(page, 'Мохито')
      .getByRole('button', { name: /Мохито/ })
      .first()
      .click()

  test('opening a dish adds #item-<id>; Back closes it and stays on the menu; Forward reopens it', async ({
    page,
  }) => {
    await open(page, `${GUEST.path}?lang=bg&t=${GUEST_TABLE_TOKEN}`)
    const menuUrl = page.url()
    const mojito = await card(page, 'Мохито').getAttribute('data-item')
    expect(mojito).toMatch(/^nd_/)

    await openMojito(page)
    await expect(dishOf(page)).toBeVisible()
    expect(page.url()).toBe(`${menuUrl}#item-${mojito}`)

    await page.goBack()
    await expect(dishOf(page)).toBeHidden()
    // Still the menu, at its own address (nothing left of the dish in it), not another page.
    expect(page.url()).toBe(menuUrl)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Демо клуб')
    await expect(card(page, 'Мохито')).toBeVisible()

    await page.goForward()
    await expect(dishOf(page)).toBeVisible()
    expect(page.url()).toBe(`${menuUrl}#item-${mojito}`)
  })

  test('closing a dish with its own button goes back one step, and one more Back leaves the page', async ({
    page,
  }) => {
    await open(page, `${GUEST.path}?lang=bg`)
    const menuUrl = page.url()
    await openMojito(page)
    await expect(dishOf(page)).toBeVisible()
    await dishOf(page).getByRole('button', { name: 'Обратно към менюто' }).click()
    await expect(dishOf(page)).toBeHidden()
    expect(page.url()).toBe(menuUrl)
    // The dish left no entry behind to come back to: the next Back is the page before the menu.
    await page.goBack()
    expect(page.url()).toBe('about:blank')
  })

  test('keeps the place in the menu: Back returns to where the guest was reading', async ({
    page,
  }) => {
    await open(page, `${GUEST.path}?lang=bg`)
    const fries = card(page, 'Пържени картофки')
      .getByRole('button', { name: /Пържени картофки/ })
      .first()
    // The guest reads down to the dish, which sits in the middle of the screen (away from the
    // sticky bar, so the tap does not scroll anything); the place is taken just before the tap.
    await fries.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    )
    const before = await page.evaluate(() => window.scrollY)
    expect(before).toBeGreaterThan(300)
    await fries.click()
    await expect(page.getByRole('dialog', { name: 'Пържени картофки' })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 4)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before + 4)
  })

  test('a shared #item-<id> link opens that dish on load, and closing it cleans the address', async ({
    page,
  }) => {
    await open(page, `${GUEST.path}?lang=bg`)
    const mojito = await card(page, 'Мохито').getAttribute('data-item')
    const shared = `${GUEST.path}?lang=bg#item-${mojito}`

    const fresh = await page.context().newPage()
    await fresh.goto(shared)
    await expect(dishOf(fresh)).toBeVisible()
    // The link entered the page with the dish open: closing it replaces the address (there is no
    // entry of ours to go back to) and the guest is on the menu.
    await dishOf(fresh).getByRole('button', { name: 'Обратно към менюто' }).click()
    await expect(dishOf(fresh)).toBeHidden()
    await expect(fresh.getByRole('heading', { level: 1 })).toBeVisible()
    expect(new URL(fresh.url()).hash).toBe('')
    expect(new URL(fresh.url()).pathname).toBe(GUEST.path)
    await fresh.close()
  })

  test('a shared link with an older slug opens the dish and the address is still corrected', async ({
    page,
  }) => {
    await open(page, `${GUEST.path}?lang=bg`)
    const mojito = await card(page, 'Мохито').getAttribute('data-item')
    const fresh = await page.context().newPage()
    await fresh.goto(`/m/an-older-name-${GUEST.publicId}?lang=bg#item-${mojito}`)
    await expect(dishOf(fresh)).toBeVisible()
    await expect.poll(() => new URL(fresh.url()).pathname).toBe(GUEST.path)
    // The hash survived the correction, and the dish page is still the open one.
    expect(new URL(fresh.url()).hash).toBe(`#item-${mojito}`)
    await expect(dishOf(fresh)).toBeVisible()
    await fresh.close()
  })

  test('a link to a dish the menu does not have shows the menu, not an error', async ({ page }) => {
    await open(page, `${GUEST.path}?lang=bg#item-nd_doesNotExist0000000000`)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(card(page, 'Негрони').first()).toBeVisible()
  })
})

// The look fixture: a venue that chose the reference template (qr-phone) and forces the dark scheme
// with Playfair Display. It proves the registry on a production build: the template named in the
// snapshot is the one drawn, its own code loads and the other's does not, the forced scheme wins over
// the guest's screen, and the font comes from this app.
test.describe('the template and the look the snapshot names (SH-04)', () => {
  test('draws the reference template, forced dark on a light screen, and not the Editorial Market', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await open(page, `${LOOK_PATH}?lang=en`)
    const face = page.locator('[data-face]:not([data-testid])')
    await expect(face).toHaveAttribute('data-face', 'qr-phone')
    await expect(face).toHaveAttribute('data-scheme', 'dark')
    // Forced: dark although the guest's screen is light.
    const luminance = await face.evaluate((root) => {
      const [r = 0, g = 0, b = 0] = (getComputedStyle(root).backgroundColor.match(/\d+/g) ?? [])
        .slice(0, 3)
        .map(Number)
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    })
    expect(luminance).toBeLessThan(0.15)
    await expect(page.locator('[data-face="editorial-market"]')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.outerHTML.includes('rm-item'))).toBe(
      false,
    )
  })

  test('holds every control of the reference template to 44 px', async ({ page }) => {
    await open(page, `${LOOK_PATH}?lang=bg`)
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
  })

  test('uses the font the venue chose from this app, and only that one', async ({ page }) => {
    const fonts: { url: string; status: number }[] = []
    page.on('response', (response) => {
      if (response.request().resourceType() === 'font') {
        fonts.push({ url: response.url(), status: response.status() })
      }
    })
    await open(page, `${LOOK_PATH}?lang=bg`)
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.fonts.ready)

    // The venue's font is in use ...
    const loaded = await page.evaluate(() =>
      [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family),
    )
    expect(
      loaded.some((family) => /Playfair/i.test(family)),
      loaded.join(', '),
    ).toBe(true)
    // ... and the five others were not fetched for this guest.
    for (const other of ['Inter', 'Manrope', 'Montserrat', 'Lora', 'Unbounded']) {
      expect(
        loaded.some((family) => new RegExp(`^_{0,2}${other}(_|$)`, 'i').test(family)),
        `${other} loaded`,
      ).toBe(false)
    }
    // Every font file came from this app.
    expect(fonts.length).toBeGreaterThan(0)
    for (const font of fonts) {
      const url = new URL(font.url)
      expect(url.origin).toBe(new URL(page.url()).origin)
      expect(url.pathname).toMatch(/^\/_next\/static\/media\/.+\.woff2$/)
      expect(font.status).toBe(200)
    }
  })

  test('names no outside host, in the page or in any of its stylesheets', async ({
    page,
    request,
  }) => {
    const hosts = new Set<string>()
    page.on('request', (req) => {
      const url = new URL(req.url())
      if (url.protocol === 'http:' || url.protocol === 'https:') hosts.add(url.host)
    })
    await open(page, `${LOOK_PATH}?lang=bg`)
    await page.waitForLoadState('networkidle')
    // Every request of the page went to this app.
    expect([...hosts]).toEqual([new URL(page.url()).host])

    // The page and the stylesheets it links hold no address of a font host.
    const html = await (await request.get(LOOK_PATH)).text()
    const hrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    )
    expect(hrefs.length).toBeGreaterThan(0)
    const outside = /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit|cdnjs|unpkg|jsdelivr/i
    expect(html).not.toMatch(outside)
    for (const href of hrefs) {
      const css = await (await request.get(href)).text()
      expect(css, href).not.toMatch(outside)
      // Every font file is one of this app's own (`../media/<name>.woff2`, relative to the sheet).
      const sources = [...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map((match) =>
        (match[1] ?? '').replace(/["']/g, ''),
      )
      for (const source of sources) {
        const file = new URL(source, new URL(href, page.url()))
        expect(file.origin, `${source} in ${href}`).toBe(new URL(page.url()).origin)
        expect(file.pathname, `${source} in ${href}`).toMatch(/^\/_next\/static\/media\//)
      }
    }
  })
})

test.describe('the address in the browser (D68)', () => {
  test('a stale slug finds the menu, and the address bar is corrected, keeping ?t= and ?lang=', async ({
    page,
  }) => {
    const search = `?lang=bg&t=${GUEST_TABLE_TOKEN}`
    await page.goto(`/m/an-older-name-${GUEST.publicId}${search}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Демо клуб')
    await expect.poll(() => new URL(page.url()).pathname).toBe(GUEST.path)
    expect(new URL(page.url()).search).toBe(search)
    // The corrected address is the one that reloads.
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Демо клуб')
    expect(new URL(page.url()).pathname).toBe(GUEST.path)
    // Replaced, not pushed: going back leaves the site, it does not return to the stale address.
    await page.goBack()
    expect(page.url()).toBe('about:blank')
  })

  test('a bare code finds the menu and gets its slug back', async ({ page }) => {
    await page.goto(`/m/${GUEST.publicId}?lang=en`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo Club')
    await expect.poll(() => new URL(page.url()).pathname).toBe(GUEST.path)
    expect(new URL(page.url()).search).toBe('?lang=en')
  })

  test('the canonical address is left as it is', async ({ page }) => {
    await open(page, `${GUEST.path}?lang=bg`)
    await page.waitForLoadState('networkidle')
    expect(new URL(page.url()).pathname).toBe(GUEST.path)
    expect(new URL(page.url()).search).toBe('?lang=bg')
  })
})

test.describe('the tag filter', () => {
  test('filters a menu by tag, and "All" brings everything back', async ({ page }) => {
    await open(page, `${TAG_PATH}?lang=bg`)
    await expect.poll(() => names(page)).toEqual(['Негрони', 'Хумус'])
    const sheet = page.getByRole('dialog', { name: 'Филтриране на менюто' })
    await page.getByRole('button', { name: 'Филтриране на менюто' }).click()
    await sheet
      .getByRole('group', { name: 'Етикети' })
      .getByRole('button', { name: 'Фирмено' })
      .click()
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect.poll(() => names(page)).toEqual(['Негрони'])
    await page.getByRole('button', { name: 'Филтриране на менюто' }).click()
    await sheet.getByRole('button', { name: 'Изчисти филтрите' }).click()
    await page.keyboard.press('Escape')
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
    expect(redirect.headers().location).toBe(`${GUEST.path}?t=${GUEST_TABLE_TOKEN}`)

    await page.goto(`/t/${GUEST_TABLE_TOKEN}`)
    await page.waitForURL(`**${GUEST.path}?t=${GUEST_TABLE_TOKEN}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // The Editorial Market shows the table in the bar at the top, next to the language switch.
    await expect(page.getByText(`Маса ${GUEST_TABLE_LABEL}`, { exact: true })).toBeVisible()
    await page.screenshot({ path: shot('guest-bg-light-table') })
  })

  test('an English browser gets the English menu without asking', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'en-GB' })
    const page = await context.newPage()
    await page.goto(`/t/${GUEST_TABLE_TOKEN}`)
    await expect(page.getByText(`Table ${GUEST_TABLE_LABEL}`, { exact: true })).toBeVisible()
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

  test('the menu and the table address send no referrer, so the code in the address stays here (A5-F5)', async ({
    request,
  }) => {
    const menu = await request.get(GUEST.path)
    expect(menu.status()).toBe(200)
    expect(menu.headers()['referrer-policy']).toBe('no-referrer')

    const redirect = await request.get(`/t/${GUEST_TABLE_TOKEN}`, { maxRedirects: 0 })
    expect(redirect.status()).toBe(302)
    expect(redirect.headers()['referrer-policy']).toBe('no-referrer')

    const unknown = await request.get('/t/tb_notARealCode0000001', { maxRedirects: 0 })
    expect(unknown.status()).toBe(404)
    expect(unknown.headers()['referrer-policy']).toBe('no-referrer')

    // Only the guest's own pages are changed.
    const health = await request.get('/api/health')
    expect(health.headers()['referrer-policy']).toBeUndefined()
  })

  test('a venue that does not exist gets a friendly notice, not an error page', async ({
    page,
  }) => {
    await page.goto('/m/no-such-club?lang=en')
    await expect(page.getByText('Menu not found')).toBeVisible()
    await expect(page.getByRole('button')).toHaveCount(0)
  })

  test('the older address, a slug alone, and a code nobody has are both just "not found"', async ({
    page,
  }) => {
    await page.goto(`/m/${GUEST_SLUG}?lang=en`)
    await expect(page.getByText('Menu not found')).toBeVisible()
    await page.goto(`/m/${GUEST_SLUG}-000000000000?lang=en`)
    await expect(page.getByText('Menu not found')).toBeVisible()
    // Upper case is not part of a code.
    await page.goto(`/m/${GUEST_SLUG}-${GUEST.publicId.toUpperCase()}?lang=en`)
    await expect(page.getByText('Menu not found')).toBeVisible()
  })
})

test.describe('what the page asks for (rule 4)', () => {
  test('only /cdn files and Next assets, and no barsy id in any of them', async ({ page }) => {
    const urls: string[] = []
    const bodies: { url: string; text: string }[] = []
    const hosts = new Set<string>()
    page.on('response', async (response) => {
      const url = new URL(response.url())
      urls.push(`${url.pathname}`)
      hosts.add(url.host)
      if (url.pathname.startsWith('/cdn/') && url.pathname.endsWith('.json')) {
        bodies.push({ url: url.pathname, text: await response.text() })
      }
    })
    await open(page, `${GUEST.path}?t=${GUEST_TABLE_TOKEN}`)
    await page.waitForLoadState('networkidle')

    const allowed = (pathname: string) =>
      pathname.startsWith('/cdn/') ||
      pathname.startsWith('/_next/') ||
      pathname === GUEST.path ||
      pathname === '/favicon.ico'
    expect(urls.filter((pathname) => !allowed(pathname))).toEqual([])
    // Nothing from another host: not the files, not the fonts, not the template's code.
    expect([...hosts]).toEqual([new URL(page.url()).host])
    // The chain: venue index (by public code), pointer, snapshot, overlay, and the table's file.
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
    const indexResponse = await request.get(`/cdn/v/${GUEST.publicId}.json`)
    expect(indexResponse.status()).toBe(200)
    const index = (await indexResponse.json()) as {
      venue_id: string
      menu_id: string
      slug: string
    }
    // The index carries the venue's current slug (the page corrects its address from it) ...
    expect(index.slug).toBe(GUEST.slug)
    // ... and the older v/<slug>.json path leads nowhere.
    expect((await request.get(`/cdn/v/${GUEST_SLUG}.json`)).status()).toBe(404)
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
        await open(page, `${GUEST.path}?lang=${lang}&t=${GUEST_TABLE_TOKEN}`)
        // The page follows the guest's screen: a dark page on a dark screen, a light one otherwise.
        const luminance = await page.evaluate(() => {
          const root = document.querySelector('[data-face]:not([data-testid])') as HTMLElement
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
    await open(page, `${GUEST.path}?lang=bg&t=${GUEST_TABLE_TOKEN}`)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({ path: shot('guest-iphone13-bg-light') })
    await context.close()
  })
})
