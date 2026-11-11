// What the guest ordering and paying specs share: they run on the renderer in both premade Styles
// (D128), Basic and Editorial. The renderer keeps the table's order and paying in sheets the guest
// opens from the bar and the header; the helpers below bring a screen up, and the spec reads the
// same markers on either Style (`data-order-line`, `data-location-prompt`, `data-send`,
// `data-sent-order`, `data-slot="pay.*"`).
import { expect, type Page } from '@playwright/test'
import { styleCases } from '@restro/shell/testing'

/** The Styles the specs run on. */
export const ORDER_STYLES = ['basic', 'editorial'] as const

/** One of the Styles above. */
export type OrderStyle = (typeof ORDER_STYLES)[number]

/** A Style as a design record: what a harness outside the web app saves through `setDesign`. */
export function styleDesign(style: OrderStyle) {
  const values = styleCases().find((one) => one.id === `style:${style}`)?.values
  if (values === undefined) throw new Error(`the contract has no Style "${style}"`)
  return { style, values, logo_asset_id: null }
}

/** The renderer's root element on the page. */
export function faceRoot(page: Page) {
  return page.locator('[data-face="editorial-market"]').first()
}

const ORDER_SHEET = '[data-slot="order.sheet"]'

/** Brings the table's order on screen: the bag sheet. */
export async function showOrder(page: Page): Promise<void> {
  const sheet = page.locator(ORDER_SHEET)
  if ((await sheet.count()) === 0) {
    await page.locator('[data-slot="menu.bag"] button').click()
  }
  await expect(sheet).toBeVisible()
}

/** Puts the menu back in reach: closes the bag sheet. */
export async function hideOrder(page: Page): Promise<void> {
  if ((await page.locator(ORDER_SHEET).count()) === 0) return
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator(ORDER_SHEET)).toHaveCount(0)
}

/** Brings the table's bill and paying on screen: the pay sheet from the header. */
export async function showPaying(page: Page): Promise<void> {
  const entry = page.locator('button[data-slot="menu.pay"]')
  await expect(entry).toBeVisible({ timeout: 30_000 })
  await entry.click()
  await expect(page.locator('[data-slot="pay.choose"]')).toBeVisible({ timeout: 30_000 })
}
