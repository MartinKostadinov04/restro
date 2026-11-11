import { expect, test } from '@playwright/test'

import { withAudit } from './faces-audit'
import { measure } from './faces-floors'
import { runScript } from './global-setup'
import { DESIGN_VARIANTS, visualPath } from './visual-fixtures'

// The renderer in every design (#171, #172, D130), on a production build: each Style, and each value
// of each option it draws over Basic, on the hard menu of scripts/seed-visual-e2e.ts. What the never-list
// harness (`runDesignContract`) cannot see without a browser is measured here, at phone, tablet and
// PC widths:
//
//   touch targets   every button, link and radio is at least 44 x 44 px, on the page, the dish page
//                   and (for the Styles, the labels and the sheets) the allergen sheet
//   overflow        no sideways scroll, nothing sticks out of the screen
//   names           never cut: no ellipsis, no line clamp, nothing clipped
//   text            12 px at the least, 16 px in an input
//   contrast        every text reads at 4.5:1 (3:1 when large), as the browser paints it
//
// The Styles run on a light and a dark screen; a General value on a light one (`general.screen`
// sweeps the forced schemes). The five guest-feature screens, which need services, are swept by
// faces-design-screens.spec.ts with the same measures (faces-floors.ts).
test.setTimeout(120_000)

const FACE = '[data-face="editorial-market"]:not([data-testid])'
const WIDTHS = [320, 390, 820, 1280] as const

test.beforeAll(() => {
  runScript('./scripts/seed-visual-e2e.ts')
})

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
      if (/^(style|labels|sheets)[:.]/.test(variant.id)) {
        await page.keyboard.press('Escape')
        await expect(page.locator('.rm-overlay')).toHaveCount(0)
        await page.locator('.rm-allergens button').first().click()
        problems.push(...(await measure(page, 'the allergen sheet', '.rm-overlay')))
      }
      expect(problems).toEqual([])
    })
  }
}
