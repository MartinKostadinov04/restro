import { expect, type Page, test } from '@playwright/test'
import pg from 'pg'

import { dialogs } from './faces-audit'
import { measure } from './faces-floors'
import {
  FACE_ID,
  fillBag,
  type Owner,
  onScreen,
  openPreview,
  PREVIEW_FACE,
  payTheBill,
  SCREENS,
  servicesBack,
  servicesOn,
  signInAsOwner,
} from './faces-preview'
import { GUEST_SLUG } from './support'
import { SCREEN_VARIANTS } from './visual-fixtures'

// The five guest-feature screens in every design (#173, D130): Call a waiter, Bill, Order, Pay and
// the Payment confirmation, drawn in the Design tab's phone preview of the demo venue (a guest sees
// them only once the platform supports them, D71) with demo data behind them. Each Style, and each
// value of each option of the five screens over Basic, is written into the demo venue's design
// record and previewed on a production build; what the never-list harness cannot see without a
// browser is measured, as in faces-design.spec.ts (faces-floors.ts):
//
//   touch targets   every button, link and radio is at least 44 x 44 px
//   overflow        nothing sticks out of the phone's screen
//   text            12 px at the least, 16 px in an input
//   contrast        every text reads at 4.5:1 (3:1 when large), as the browser paints it
//
// The phone's screen is 320 or 390 px wide here (the Design tab's phone fits the admin's window);
// the sheets' widest, 640 px, is the guest page's and is held by the stylesheet's own rules.
// The Styles run on a light and a dark screen, a value on a light one. The demo venue's own design is
// put back afterwards.
test.skip(
  FACE_ID !== 'editorial-market',
  'these checks read the service sheets of Editorial Market',
)
test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const WIDTHS = [320, 390] as const
const FRAME = '[data-testid="phone-screen"]'

let owner: Owner
let page: Page
let original: Record<string, unknown> | null = null
const here = () => ({ page, venueId: owner.venueId })

async function withOwnerPool(run: (pool: pg.Pool) => Promise<void>): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 1 })
  try {
    await run(pool)
  } finally {
    await pool.end()
  }
}

/** The demo venue's stored design, or null when it has none. */
async function storedDesign(): Promise<Record<string, unknown> | null> {
  let found: Record<string, unknown> | null = null
  await withOwnerPool(async (pool) => {
    const { rows } = await pool.query(
      `select settings->'design' as design from restro.venues where slug = $1`,
      [GUEST_SLUG],
    )
    found = (rows[0]?.design as Record<string, unknown> | null | undefined) ?? null
  })
  return found
}

/** Writes a design record into the demo venue: the stored one with these values (and Style) in it. */
async function writeDesign(style: string, values: unknown): Promise<void> {
  const revision = typeof original?.revision === 'number' ? original.revision + 1 : 1
  const record = {
    logo_asset_id: null,
    ...original,
    style,
    values,
    revision,
    provenance: {
      layer: 'manual',
      source: 'manual',
      actor: 'system',
      job_id: 'e2e-design-screens',
      change_set_id: null,
    },
  }
  await withOwnerPool(async (pool) => {
    await pool.query(
      `update restro.venues set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('design', $1::jsonb) where slug = $2`,
      [JSON.stringify(record), GUEST_SLUG],
    )
  })
}

test.beforeAll(async ({ browser }) => {
  await servicesOn()
  original = await storedDesign()
  owner = await signInAsOwner(browser)
  page = owner.page
})

test.afterAll(async () => {
  await owner?.context.close()
  await withOwnerPool(async (pool) => {
    await pool.query(
      original === null
        ? `update restro.venues set settings = settings - 'design' where slug = $1`
        : `update restro.venues set settings = settings || jsonb_build_object('design', $2::jsonb) where slug = $1`,
      original === null ? [GUEST_SLUG] : [GUEST_SLUG, JSON.stringify(original)],
    )
  })
  await servicesBack()
})

for (const variant of SCREEN_VARIANTS) {
  const isStyle = variant.id.startsWith('style:')
  for (const scheme of isStyle ? (['light', 'dark'] as const) : (['light'] as const)) {
    test(`${variant.id} on a ${scheme} screen holds every floor on the five screens at ${WIDTHS.join(', ')} px`, async () => {
      await writeDesign(isStyle ? variant.id.slice('style:'.length) : 'basic', variant.values)
      const problems: string[] = []
      for (const width of WIDTHS) {
        await openPreview(here(), width, scheme)
        await fillBag(page)
        const at = (state: string) => `${width} px, ${state}`
        problems.push(...(await measure(page, at('the page'), PREVIEW_FACE, FRAME)))
        for (const screen of SCREENS) {
          await onScreen(page, screen, async () => {
            problems.push(...(await measure(page, at(screen), '.rm-overlay', FRAME)))
          })
        }
      }
      // The paid screen and the Payment confirmation, reached from the pay sheet.
      await openPreview(here(), WIDTHS[0], scheme)
      await fillBag(page)
      await page.locator(`${PREVIEW_FACE} [data-slot="menu.pay"]`).click()
      await expect(dialogs(page).last()).toBeVisible()
      await payTheBill(page)
      problems.push(...(await measure(page, 'the paid screen', '.rm-overlay', FRAME)))
      await page.locator('[data-slot="pay.confirmation.toggle"]').click()
      await expect(page.locator('[data-slot="pay.confirmation"]')).toBeVisible()
      problems.push(...(await measure(page, 'the confirmation', '.rm-overlay', FRAME)))
      expect(problems).toEqual([])
    })
  }
}
