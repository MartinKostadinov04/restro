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
// the Payment confirmation, drawn in the Design page's preview of the demo venue (a guest sees
// them only once the platform supports them, D71) with demo data behind them. Each Style, and each
// value of each option of the five screens over Basic, is written into the demo venue's design
// record and previewed on a production build; what the never-list harness cannot see without a
// browser is measured, as in faces-design.spec.ts (faces-floors.ts):
//
//   touch targets   every button, link and radio is at least 44 x 44 px
//   overflow        nothing sticks out of the screen, and the screen does not scroll sideways
//   text            12 px at the least, 16 px in an input
//   contrast        every text reads at 4.5:1 (3:1 when large), as the browser paints it
//
// The screen is 320 or 390 px wide here (the preview's frame, a document of its own);
// the sheets' widest, 640 px, is the guest page's and is held by the stylesheet's own rules.
// The Styles run on a light and a dark screen, a value on a light one. The demo venue's own design is
// put back afterwards.
test.skip(
  FACE_ID !== 'editorial-market',
  'these checks read the service sheets of Editorial Market',
)
// Not serial: a design that breaks a floor fails its own test and the others still run, so one run
// names every breach (the venue's design is written by each test, and put back by afterAll).
test.setTimeout(240_000)

const WIDTHS = [320, 390] as const
/** The job id of the designs this file writes, so a leftover of a failed run is known for what it is. */
const MARK = 'e2e-design-screens'

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
  // A run that failed and was started again meets the design the failed one wrote: that is not the
  // venue's own (its afterAll puts the venue's back, but a worker that died may not have got there).
  const provenance = (found as { provenance?: { job_id?: string } } | null)?.provenance
  return provenance?.job_id === MARK ? null : found
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
      job_id: MARK,
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
        const view = await openPreview(here(), width, scheme)
        await fillBag(view)
        const at = (state: string) => `${width} px, ${state}`
        problems.push(...(await measure(view, at('the page'), PREVIEW_FACE)))
        for (const screen of SCREENS) {
          await onScreen(view, screen, async () => {
            problems.push(...(await measure(view, at(screen), '.rm-overlay')))
          })
        }
      }
      // The paid screen and the Payment confirmation, reached from the pay sheet.
      const paid = await openPreview(here(), WIDTHS[0], scheme)
      await fillBag(paid)
      await paid.locator(`${PREVIEW_FACE} [data-slot="menu.pay"]`).click()
      await expect(dialogs(paid).last()).toBeVisible()
      await payTheBill(paid)
      problems.push(...(await measure(paid, 'the paid screen', '.rm-overlay')))
      await paid.locator('[data-slot="pay.confirmation.toggle"]').click()
      await expect(paid.locator('[data-slot="pay.confirmation"]')).toBeVisible()
      problems.push(...(await measure(paid, 'the confirmation', '.rm-overlay')))
      expect(problems).toEqual([])
    })
  }
}
