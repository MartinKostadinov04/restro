// The booking page where guests pick their own spot (#580; spec #322 stories 5, 32), on a
// production build, on a 390 px phone: Booking Club's Demo Bar, whose plan "Ground floor" holds
// "Table 1" (Main hall), the bar stools "Bar 1" and "Bar 2", and the long thin "Bar counter", with
// bookings that confirm themselves switched on.
//
//   - the plan is readable at 390 px: every spot is a touch target with its name, its seats and
//     free or taken in words, and the page never scrolls sideways;
//   - a guest picks a free spot: the booking confirms itself (Reserved, on that spot), the answer
//     says so, and the next guest sees the spot taken and cannot pick it;
//   - two guests want the same spot: the one who sends second is told it was just taken, and the
//     plan, read again, shows it taken; the club's book holds the spot once.
//
// The night-only page is booking-page.spec.ts; choosing an Area is booking-area.spec.ts.
import { expect, type Page, test } from '@playwright/test'

import {
  booked,
  expectNoSidewaysScroll,
  fillGuest,
  openBooking,
  PHONE_390,
  PHONE_390_CONTEXT,
  refusal,
  type Seeded,
  seedChoice,
} from './booking-guest'

test.use(PHONE_390)
test.describe.configure({ mode: 'serial' })

const spot = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name}, `) })

/** Opens the page on the night, and waits for the night to say which spots are free. */
async function openOnNight(page: Page, path: string, night: string): Promise<void> {
  await openBooking(page, path)
  await page.getByLabel('Night').selectOption(night)
  await expect(
    page.getByText('Tap a free spot to pick it. You can pick more than one.'),
  ).toBeVisible({ timeout: 20_000 })
}

test.describe('the booking page where guests pick their own spot', () => {
  let seeded: Seeded

  test.beforeAll(() => {
    seeded = seedChoice('spot')
  })

  test('draws the plan readable at 390 px, each spot free in words', async ({ page }) => {
    await openOnNight(page, seeded.path, seeded.open)
    const plan = page.getByRole('group', { name: 'Your spot' })
    await expect(plan).toBeVisible()
    await expect(spot(page, 'Table 1')).toHaveAccessibleName('Table 1, Main hall, 4 seats, free')
    await expect(spot(page, 'Bar 1')).toHaveAccessibleName('Bar 1, 1 seat, free')
    // The counter is 300 × 30: the plan is sized from its height too, so it is no thinner than 44.
    for (const name of ['Table 1', 'Bar 1', 'Bar 2', 'Bar counter']) {
      const button = spot(page, name)
      await expect(button).toBeEnabled()
      const box = await button.boundingBox()
      expect(box?.width ?? 0, name).toBeGreaterThanOrEqual(44)
      expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44)
    }
    await expectNoSidewaysScroll(page)
  })

  test('a guest picks a free spot and the booking confirms itself', async ({ page, browser }) => {
    test.setTimeout(90_000)
    await openOnNight(page, seeded.path, seeded.open)
    await spot(page, 'Bar 1').click()
    await expect(spot(page, 'Bar 1')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Picked: Bar 1')).toBeVisible()
    await fillGuest(page, 'Spot Guest')
    await page.getByRole('button', { name: 'Send the request' }).click()

    const answer = page.getByRole('status')
    await expect(answer).toContainText('Your booking is confirmed', { timeout: 20_000 })
    await expect(answer).toContainText('Your spot is kept for you. You will get an email.')
    expect(booked(seeded.open)).toContainEqual({ status: 'reserved', area: null, spots: ['Bar 1'] })

    // The next guest sees it taken, and cannot pick it.
    const next = await browser.newPage(PHONE_390_CONTEXT)
    try {
      await openOnNight(next, seeded.path, seeded.open)
      await expect(spot(next, 'Bar 1')).toHaveAccessibleName('Bar 1, 1 seat, taken')
      await expect(spot(next, 'Bar 1')).toBeDisabled()
    } finally {
      await next.close()
    }
  })

  test('the second of two guests on one spot is told it was just taken', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000)
    // The slower guest reads the night while Bar 2 is still free, and picks it.
    await openOnNight(page, seeded.path, seeded.open)
    await spot(page, 'Bar 2').click()
    await fillGuest(page, 'Slower Guest')

    // Meanwhile another guest books Bar 2.
    const faster = await browser.newPage(PHONE_390_CONTEXT)
    try {
      await openOnNight(faster, seeded.path, seeded.open)
      await spot(faster, 'Bar 2').click()
      await fillGuest(faster, 'Faster Guest')
      await faster.getByRole('button', { name: 'Send the request' }).click()
      await expect(faster.getByRole('status')).toContainText('Your booking is confirmed', {
        timeout: 20_000,
      })
    } finally {
      await faster.close()
    }

    await page.getByRole('button', { name: 'Send the request' }).click()
    await expect(refusal(page)).toHaveText(
      'Someone just took that spot. Pick another one on the plan.',
      { timeout: 20_000 },
    )
    // The plan, read again, shows it taken; the pick is gone, and the form is still there.
    await expect(spot(page, 'Bar 2')).toHaveAccessibleName('Bar 2, 1 seat, taken')
    await expect(page.getByText('No spot picked: the club will seat you.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send the request' })).toBeEnabled()

    const onBar2 = booked(seeded.open).filter((row) => row.spots.includes('Bar 2'))
    expect(onBar2).toEqual([{ status: 'reserved', area: null, spots: ['Bar 2'] }])
  })
})
