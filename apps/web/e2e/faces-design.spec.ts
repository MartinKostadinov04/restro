import { expect, type Page, test } from '@playwright/test'

import { settled, withAudit } from './faces-audit'
import { runScript } from './global-setup'
import { DESIGN_VARIANTS, visualPath } from './visual-fixtures'

// The renderer in every design (#171, D130), on a production build: each Style, and each value of
// each General option over Basic, on the hard menu of scripts/seed-visual-e2e.ts. What the never-list
// harness (`runDesignContract`) cannot see without a browser is measured here, at phone, tablet and
// PC widths:
//
//   touch targets   every button, link and radio is at least 44 x 44 px, on the page and the dish page
//   overflow        no sideways scroll, nothing sticks out of the screen
//   names           never cut: no ellipsis, no line clamp, nothing clipped
//   text            12 px at the least, 16 px in an input
//   contrast        every text reads at 4.5:1 (3:1 when large), as the browser paints it
//
// The Styles run on a light and a dark screen; a General value on a light one (`general.screen`
// sweeps the forced schemes).
test.setTimeout(120_000)

const FACE = '[data-face="editorial-market"]:not([data-testid])'
const WIDTHS = [320, 390, 820, 1280] as const

test.beforeAll(() => {
  runScript('./scripts/seed-visual-e2e.ts')
})

/** Runs in the page: what sticks out, what is cut and what is too small. Sends its source, no closure. */
function floorsOf(root: string): string[] {
  const width = document.documentElement.clientWidth
  const found: string[] = []
  if (document.documentElement.scrollWidth > width) {
    found.push(`the page scrolls (${document.documentElement.scrollWidth})`)
  }
  for (const element of document.querySelectorAll(`${root} *`)) {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    if (box.width === 0 || style.visibility !== 'visible') continue
    if (element.closest('[hidden]') !== null) continue
    const where = `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`
    // The photo strip and the section rail scroll sideways inside their own box.
    const scrolls = element.closest('.rm-sections, .rm-section.is-feature .rm-items') !== null
    if (!scrolls && (box.right > width + 0.5 || box.left < -0.5)) {
      found.push(`${where} sticks out: ${Math.round(box.left)}..${Math.round(box.right)}`)
    }
    const size = Number.parseFloat(style.fontSize)
    if (element.matches('input, textarea, select')) {
      if (size < 16) found.push(`${where} is an input at ${size} px`)
      continue
    }
    const hasText = [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
    )
    if (hasText && size < 12 && !element.matches('.rm-sr, [class*="visually-hidden"]')) {
      found.push(`${where} is text at ${size} px`)
    }
  }
  for (const slot of document.querySelectorAll(`${root} [data-slot="item.name"]`)) {
    const text = (slot.textContent ?? '').trim()
    for (const element of [slot, ...slot.querySelectorAll('*')]) {
      const style = getComputedStyle(element)
      const clamp = (style as CSSStyleDeclaration & { webkitLineClamp: string }).webkitLineClamp
      if (style.textOverflow === 'ellipsis') found.push(`"${text}" has an ellipsis`)
      if (clamp !== 'none' && clamp !== '') found.push(`"${text}" has a line clamp`)
      if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
        found.push(`"${text}" runs past its box`)
      }
      if (element.scrollHeight > element.clientHeight + 1 && style.overflowY !== 'visible') {
        found.push(`"${text}" is clipped in height`)
      }
    }
  }
  return found.slice(0, 12)
}

/** Everything measured at the screen's present width. */
async function measure(page: Page, state: string, root: string): Promise<string[]> {
  await settled(page)
  const targets = await page.evaluate((root) => window.__rmAudit.targets(root), root)
  const contrast = await page.evaluate((root) => window.__rmAudit.textContrast(root), root)
  return [
    ...targets.map((target) => `${target.label}: ${target.width}x${target.height}`),
    ...contrast.low.map((low) => `"${low.text}" at ${low.ratio}:1, needs ${low.needs}:1`),
    ...(await page.evaluate(floorsOf, root)),
  ].map((problem) => `${state}: ${problem}`)
}

for (const variant of DESIGN_VARIANTS) {
  const schemes = variant.id.startsWith('style:')
    ? (['light', 'dark'] as const)
    : (['light'] as const)
  for (const scheme of schemes) {
    test(`${variant.id} on a ${scheme} screen holds every floor at ${WIDTHS.join(', ')} px`, async ({
      page,
    }) => {
      await withAudit(page)
      await page.setViewportSize({ width: WIDTHS[0], height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(`${visualPath(variant)}?lang=bg`)
      await expect(page.locator(FACE)).toBeVisible()
      await expect(page.locator('[data-item]').first()).toBeVisible()
      const problems: string[] = []
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 })
        problems.push(...(await measure(page, `${width} px`, FACE)))
      }
      await page.setViewportSize({ width: WIDTHS[0], height: 800 })
      await page.locator('[data-slot="item.open"]').first().click()
      problems.push(...(await measure(page, 'the dish page', '.rm-overlay')))
      expect(problems).toEqual([])
    })
  }
}
