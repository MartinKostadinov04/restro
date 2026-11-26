// The booking page where guests choose an Area (#580; spec #322 story 4), on a production build,
// on a 390 px phone: Booking Club's Demo Bar, whose plan holds "Table 1" on Table 1 in the Area
// "Main hall", and two bar stools with no Table (and so in no Area).
//
//   - the guest chooses the night and the Area, the only one that holds a spot; the answer says the
//     request is with the club, and the club's book holds it Requested, asking for "Main hall",
//     with no spot (the hostess places the party);
//   - the Area is required: Send does not go without one.
//
// The night-only page is booking-page.spec.ts; picking a spot is booking-spot.spec.ts.
import { expect, test } from '@playwright/test'

import {
  booked,
  expectNoSidewaysScroll,
  fillGuest,
  openBooking,
  PHONE_390,
  type Seeded,
  seedChoice,
} from './booking-guest'

test.use(PHONE_390)
test.describe.configure({ mode: 'serial' })

test.describe('the booking page where guests choose an Area', () => {
  let seeded: Seeded

  test.beforeAll(() => {
    seeded = seedChoice('area')
  })

  test('a guest asks for a night in an Area, and the request names it', async ({ page }) => {
    test.setTimeout(90_000)
    await openBooking(page, seeded.path)
    await page.getByLabel('Night').selectOption(seeded.open)
    const area = page.getByLabel('Area')
    // Only the Area that holds a spot is offered.
    await expect(area.locator('option')).toHaveText(['Choose an area', 'Main hall'])
    // No plan is drawn: the guest chooses where, not which spot.
    await expect(page.getByRole('group', { name: 'Your spot' })).toHaveCount(0)
    await expectNoSidewaysScroll(page)

    await fillGuest(page, 'Area Guest')
    // Without an Area the browser keeps the request back.
    await page.getByRole('button', { name: 'Send the request' }).click()
    await expect(page.getByRole('status')).toHaveCount(0)
    expect(await area.evaluate((select) => (select as HTMLSelectElement).validity.valid)).toBe(
      false,
    )

    await area.selectOption({ label: 'Main hall' })
    await page.getByRole('button', { name: 'Send the request' }).click()
    await expect(page.getByRole('status')).toContainText('Your request is with the club', {
      timeout: 20_000,
    })
    expect(booked(seeded.open)).toContainEqual({
      status: 'requested',
      area: 'Main hall',
      spots: [],
    })
  })
})
