// What the guest ordering and paying specs share when they run on more than one template (#239).
// `qr-phone` (the hidden reference) draws the table's order and bill inline on the page; Editorial
// Market keeps them in sheets the guest opens from the bar and the header. Both carry the same
// markers for what the specs look at (`data-order-line`, `data-location-prompt`, `data-send`,
// `data-sent-order`, `data-slot="pay.*"`), so a spec asks the helpers below to bring the screen up
// and then reads the same selectors on either template.
import { expect, type Page } from '@playwright/test'

/** The templates the specs run on. `qr-phone` keeps its runs until it retires (#171). */
export const ORDER_FACES = ['qr-phone', 'editorial-market'] as const

/** One of the templates above. */
export type OrderFace = (typeof ORDER_FACES)[number]

/** The template's root element on the page. */
export function faceRoot(page: Page, face: OrderFace) {
  return page.locator(`[data-face="${face}"]`).first()
}

const ORDER_SHEET = '[data-slot="order.sheet"]'

/** Brings the table's order on screen: inline on `qr-phone`, the bag sheet on Editorial Market. */
export async function showOrder(page: Page, face: OrderFace): Promise<void> {
  if (face === 'qr-phone') return
  const sheet = page.locator(ORDER_SHEET)
  if ((await sheet.count()) === 0) {
    await page.locator('[data-slot="menu.bag"] button').click()
  }
  await expect(sheet).toBeVisible()
}

/** Puts the menu back in reach: closes the bag sheet where the template has one. */
export async function hideOrder(page: Page, face: OrderFace): Promise<void> {
  if (face === 'qr-phone') return
  if ((await page.locator(ORDER_SHEET).count()) === 0) return
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator(ORDER_SHEET)).toHaveCount(0)
}

/**
 * Brings the table's bill and paying on screen: the bill panel inline on `qr-phone`; on Editorial
 * Market the pay sheet from the header (the choice of lines, the tip and the card form sit there).
 */
export async function showPaying(page: Page, face: OrderFace): Promise<void> {
  if (face === 'qr-phone') {
    await expect(page.locator('[data-slot="menu.bill"]')).toBeVisible({ timeout: 30_000 })
    return
  }
  const entry = page.locator('button[data-slot="menu.pay"]')
  await expect(entry).toBeVisible({ timeout: 30_000 })
  await entry.click()
  await expect(page.locator('[data-slot="pay.choose"]')).toBeVisible({ timeout: 30_000 })
}
