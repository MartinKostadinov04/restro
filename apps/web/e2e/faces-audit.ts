// The measuring tools of the accessibility and visual audit of the Editorial Market (brief SH-07),
// shared by faces-a11y.spec.ts and faces-visual.spec.ts. `installAudit` runs inside the page (it is
// handed to `page.addInitScript`, so it must stay self-contained) and puts `window.__rmAudit` there:
//
//   targets()         the controls (button, a, [role="radio"]) smaller than 44 x 44 px
//   textContrast()    every text on the page and its contrast with what is behind it, composited the
//                     way the browser paints it (colour mixes, `opacity`, several layers of colour)
//   borderContrast()  the contrast of the border of a control with what is outside it
//   overflow()        the sideways overflow of the page, and of one element
//
// Not a general accessibility checker: it measures what the brief names, on the rendered page.
import { expect, type Locator, type Page } from '@playwright/test'

/** A control smaller than the touch target. */
export interface SmallTarget {
  readonly label: string
  readonly width: number
  readonly height: number
}

/** A text below its contrast, and what it was measured against. */
export interface LowText {
  readonly text: string
  readonly where: string
  readonly size: number
  readonly ratio: number
  readonly needs: number
  readonly foreground: string
  readonly background: string
}

/** The border of a control and its contrast with the outside. */
export interface BorderContrast {
  readonly where: string
  readonly ratio: number
  readonly border: string
  readonly outside: string
}

export interface RmAudit {
  targets(rootSelector: string): SmallTarget[]
  textContrast(rootSelector: string): { checked: number; low: LowText[] }
  borderContrast(selector: string): BorderContrast[]
  ratioOf(selector: string, against: string): number | null
}

declare global {
  interface Window {
    __rmAudit: RmAudit
  }
}

/** Runs in the page. Keep it self-contained: Playwright sends its source, not its closure. */
export function installAudit(): void {
  type Colour = [number, number, number, number]

  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })

  /** A computed CSS colour as [r, g, b, a], r g b in 0..255. */
  function parse(css: string): Colour {
    const rgb = /^rgba?\(([^)]+)\)$/.exec(css)
    if (rgb?.[1] !== undefined) {
      const parts = rgb[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number)
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1]
    }
    const srgb = /^color\(srgb ([^)]+)\)$/.exec(css)
    if (srgb?.[1] !== undefined) {
      const [channels = '', alpha = '1'] = srgb[1].split('/').map((part) => part.trim())
      const [r = 0, g = 0, b = 0] = channels.split(/\s+/).map(Number)
      return [r * 255, g * 255, b * 255, Number(alpha)]
    }
    if (context === null) return [0, 0, 0, 1]
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = css
    context.fillRect(0, 0, 1, 1)
    const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data
    return [r, g, b, a / 255]
  }

  function over(top: Colour, bottom: Colour): Colour {
    const alpha = top[3] + bottom[3] * (1 - top[3])
    if (alpha === 0) return [0, 0, 0, 0]
    const mix = (i: 0 | 1 | 2) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha
    return [mix(0), mix(1), mix(2), alpha]
  }

  /**
   * The colour a pixel of `element` has on the page: its layers from the root down, each ancestor
   * a group that is drawn at its own `opacity`. `leaf` is a colour drawn on the element itself (its
   * text, or its border); null leaves it out.
   */
  function paint(element: Element, leaf: Colour | null): [number, number, number] {
    const chain: Element[] = []
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      chain.push(node)
    }
    let group: Colour = [0, 0, 0, 0]
    chain.forEach((node, index) => {
      const style = getComputedStyle(node)
      let layers = over(group, parse(style.backgroundColor))
      if (index === 0) {
        // A fill drawn by the control's ::before behind its content (a chosen button's pill).
        const before = getComputedStyle(node, '::before')
        if (before.content !== 'none' && before.position === 'absolute') {
          layers = over(parse(before.backgroundColor), over(group, parse(style.backgroundColor)))
        }
      }
      if (index === 0 && leaf !== null) layers = over(leaf, layers)
      group = [layers[0], layers[1], layers[2], layers[3] * Number(style.opacity)]
    })
    const page = over(group, [255, 255, 255, 1])
    return [page[0], page[1], page[2]]
  }

  function luminance([r, g, b]: [number, number, number]): number {
    const channel = (value: number) => {
      const c = value / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }

  function ratio(a: [number, number, number], b: [number, number, number]): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
  }

  const hex = ([r, g, b]: [number, number, number]) =>
    `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

  function describe(element: Element): string {
    const classes = [...element.classList].slice(0, 2).join('.')
    const slot = element.closest('.rm [data-slot]')?.getAttribute('data-slot')
    return `${element.tagName.toLowerCase()}${classes === '' ? '' : `.${classes}`}${
      slot === undefined || slot === null ? '' : ` [${slot}]`
    }`
  }

  /** Drawn at all: a box, not hidden, not hidden by an ancestor. */
  function visible(element: Element): boolean {
    if (element.getClientRects().length === 0) return false
    if (getComputedStyle(element).visibility !== 'visible') return false
    return element.closest('[hidden]') === null
  }

  // Off-screen items are not laid out (`content-visibility: auto`); measure them as they will be.
  function prepare(): void {
    if (document.getElementById('rm-audit-style') !== null) return
    const style = document.createElement('style')
    style.id = 'rm-audit-style'
    style.textContent = '.rm-item { content-visibility: visible !important; }'
    document.documentElement.appendChild(style)
  }

  window.__rmAudit = {
    targets(rootSelector) {
      prepare()
      const root = document.querySelector(rootSelector)
      if (root === null) return []
      const small: SmallTarget[] = []
      for (const element of root.querySelectorAll('button, a[href], [role="radio"]')) {
        if (!visible(element)) continue
        const box = element.getBoundingClientRect()
        if (box.width >= 43.5 && box.height >= 43.5) continue
        const label =
          element.getAttribute('aria-label') ??
          (element.textContent ?? '').trim().slice(0, 40) ??
          ''
        small.push({
          label: `${describe(element)} "${label}"`,
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10,
        })
      }
      return small
    },

    textContrast(rootSelector) {
      prepare()
      const root = document.querySelector(rootSelector)
      if (root === null) return { checked: 0, low: [] }
      const low: LowText[] = []
      let checked = 0
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = (node.textContent ?? '').trim()
        const element = node.parentElement
        if (text === '' || element === null) continue
        if (!visible(element) || element.closest('[aria-hidden="true"], svg') !== null) continue
        // An inactive control (a disabled button) is exempt from the contrast rule (WCAG 1.4.3).
        if (element.closest(':disabled, [aria-disabled="true"]') !== null) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        const box = range.getBoundingClientRect()
        // Visually hidden text (the clipped 1 px boxes) is not read by eye.
        if (box.width <= 1 || box.height <= 1) continue
        const computed = getComputedStyle(element)
        const colour = parse(computed.color)
        const background = paint(element, null)
        const foreground = paint(element, colour)
        const size = Number.parseFloat(computed.fontSize)
        const bold = Number.parseInt(computed.fontWeight, 10) >= 700
        const needs = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5
        const found = ratio(foreground, background)
        checked += 1
        if (found < needs) {
          low.push({
            text: text.slice(0, 40),
            where: describe(element),
            size,
            ratio: Math.round(found * 100) / 100,
            needs,
            foreground: hex(foreground),
            background: hex(background),
          })
        }
      }
      return { checked, low }
    },

    borderContrast(selector) {
      prepare()
      const found: BorderContrast[] = []
      for (const element of document.querySelectorAll(selector)) {
        if (!visible(element)) continue
        const computed = getComputedStyle(element)
        if (Number.parseFloat(computed.borderTopWidth) === 0) {
          found.push({
            where: `${describe(element)} (no border)`,
            ratio: 0,
            border: '',
            outside: '',
          })
          continue
        }
        const parent = element.parentElement
        if (parent === null) continue
        const outside = paint(parent, null)
        // The border is drawn over the control's own fill, which runs under it.
        const border = paint(element, parse(computed.borderTopColor))
        // paint() puts the leaf over the element's own layers, which is what a border is.
        found.push({
          where: describe(element),
          ratio: Math.round(ratio(border, outside) * 100) / 100,
          border: hex(border),
          outside: hex(outside),
        })
      }
      return found
    },

    ratioOf(selector, against) {
      const element = document.querySelector(selector)
      const other = document.querySelector(against)
      if (element === null || other === null) return null
      return ratio(paint(element, parse(getComputedStyle(element).color)), paint(other, null))
    },
  }
}

/**
 * Waits until every animation that ends has ended (a sheet fades and slides in), so a measurement
 * sees the colours the guest ends up with. Endless ones (a spinner) are left running.
 */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
          )
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
      // Never wait for ever on one that does not end.
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]),
  )
}

/**
 * The things of the venue bar that draw over one another: the logo, the table label and every
 * control in it. Returns a description of each pair that overlaps by more than a pixel.
 */
export async function overlapsInHeader(page: Page, root: string): Promise<string[]> {
  return page.evaluate((root) => {
    const header = document.querySelector(`${root} .rm-header .rm-brandline`)
    if (header === null) return ['no venue bar']
    const parts = [
      ...header.querySelectorAll<HTMLElement>('.rm-logo, .rm-table, .rm-language button, button'),
    ]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({
        name: `${element.className || element.tagName.toLowerCase()} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 12)}"`,
        box: element.getBoundingClientRect(),
        // The 44 px boxes of the language switch reach a little past its pill, and over its other button.
        pad: element.closest('.rm-language') !== null ? 4 : 0,
      }))
    const found: string[] = []
    for (let a = 0; a < parts.length; a += 1) {
      for (let b = a + 1; b < parts.length; b += 1) {
        const [one, two] = [parts[a], parts[b]]
        if (one === undefined || two === undefined) continue
        const slack = 1 + Math.max(one.pad, two.pad)
        const across = Math.min(one.box.right, two.box.right) - Math.max(one.box.left, two.box.left)
        const down = Math.min(one.box.bottom, two.box.bottom) - Math.max(one.box.top, two.box.top)
        if (across > slack && down > slack) found.push(`${one.name} over ${two.name}`)
      }
    }
    return found
  }, root)
}

/** Every dialog on the page. */
export const dialogs = (page: Page): Locator => page.locator('[role="dialog"]')

/** The topmost dialog holds the focus. */
export const focusInDialog = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll('[role="dialog"]')]
    const top = all.at(-1)
    return top?.contains(document.activeElement) === true
  })

/**
 * One dialog, the way a keyboard and a screen reader meet it: opening moves the focus inside, Tab
 * and Shift+Tab never leave it, Escape closes it and gives the focus back to the control that
 * opened it. `opener` is that control. `within` does something inside the dialog once it is open
 * (a sheet that leads on to another one), before the keys are tried on whatever is then showing.
 */
export async function exerciseDialog(
  page: Page,
  opener: Locator,
  name: string | RegExp,
  within?: () => Promise<void>,
): Promise<void> {
  await opener.evaluate((element) => element.setAttribute('data-rm-opener', ''))
  const before = await dialogs(page).count()
  await opener.click()
  await expect(page.getByRole('dialog', { name })).toBeVisible()
  await expect(dialogs(page)).toHaveCount(before + 1)
  await expect.poll(() => focusInDialog(page), { message: `focus inside "${name}"` }).toBe(true)
  if (within !== undefined) {
    await within()
    await expect(dialogs(page)).toHaveCount(before + 1)
    await expect
      .poll(() => focusInDialog(page), { message: `focus inside "${name}" later` })
      .toBe(true)
  }

  const focusable = await dialogs(page)
    .last()
    .evaluate(
      (element) =>
        element.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])',
        ).length,
    )
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let press = 0; press < focusable + 2; press += 1) {
      await page.keyboard.press(key)
      expect(await focusInDialog(page), `${key} ${press + 1} stays inside "${name}"`).toBe(true)
    }
  }

  await page.keyboard.press('Escape')
  await expect(dialogs(page)).toHaveCount(before)
  await expect
    .poll(
      () => page.evaluate(() => document.activeElement?.hasAttribute('data-rm-opener') === true),
      { message: `focus returns to the opener of "${name}"` },
    )
    .toBe(true)
  await opener.evaluate((element) => element.removeAttribute('data-rm-opener'))
}

/** Puts the audit in every page of this test; call before the first `goto`. */
export async function withAudit(page: Page): Promise<void> {
  await page.addInitScript(installAudit)
}
