// Venue › Reservations, taking and changing a booking (#328), on a production build: the book of
// the Tonight test club, worked by its owner on a tablet and on a phone.
//
//   a booking taken from a spot on the plan, the seats warning accepted (it never blocks), the same
//   phone twice that night accepted, the spot a colleague holds refused by name and from when,
//   Cancel against Delete told apart on their dialogs, a delete and a manager's restore from the
//   night's bin, a copy to another night, an edit over somebody's change refused, and the form at
//   390 px with nothing lost by a tap that was not Save.
//
// The fixture is scripts/seed-tonight-e2e.ts `book` (scripts/e2e/reservations-night.ts). The admin
// is read in English. The hours are typed, never the form's default, so no run depends on the
// clock; Маса 9 and Бар 13 are free spots of the fixture's plan.
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

import { runScriptWith } from './global-setup'
import {
  ADMIN_PASSWORD,
  TONIGHT_OWNER_EMAIL,
  TONIGHT_PIN_PEPPER,
  TONIGHT_VENUE_NAME,
} from './support'

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const TABLET = { width: 1180, height: 820 }
const PHONE = { width: 390, height: 844 }

function seed(...args: string[]): string {
  return runScriptWith(
    { STAFF_PIN_PEPPER: TONIGHT_PIN_PEPPER },
    './scripts/seed-tonight-e2e.ts',
    ...args,
  )
}

/** Sets the book and answers the two nights the fixture wrote. */
function book(): { day: string; before: string } {
  const printed = seed('book', 'book').trim().split('\n').at(-1) ?? ''
  return JSON.parse(printed) as { day: string; before: string }
}

async function signIn(page: Page, email: string) {
  // Better Auth allows a few sign-ins per 10 seconds, and other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/venues')
    await page.getByLabel('Имейл').fill(email)
    await page.getByLabel('Парола').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Вход' }).click()
    try {
      await expect(page).toHaveURL(/\/venues(\/vn_[^/?]+\?tab=\w+)?$/, { timeout: 8_000 })
      return
    } catch {
      await page.waitForTimeout(10_000)
    }
  }
  throw new Error(`could not sign in as ${email}`)
}

async function person(
  browser: import('@playwright/test').Browser,
  email: string,
  viewport: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await signIn(page, email)
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  return { context, page }
}

/** The night after a service day. */
function nextNight(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

const FIRST = { name: 'Мария Тестова', phone: '+359 888 777 001' }
const SECOND = { name: 'Друга Група', phone: '+359 888 777 001' }
const THIRD = { name: 'Нов Гост', phone: '+359 888 777 003' }

let venueId = ''
let owner: { context: BrowserContext; page: Page }
let nights: { day: string; before: string }

const rows = (page: Page) => page.getByTestId('rv-row')
const rowOf = (page: Page, name: string) => rows(page).filter({ hasText: name })
const form = (page: Page) => page.getByTestId('rv-form-sheet')

async function openList(page: Page) {
  await page.goto(`/venues/${venueId}?tab=reservations`)
  await expect(page.getByTestId('reservations-night')).toBeVisible()
}

/** Fills the fields every booking has; the hour is always typed. */
async function fillParty(
  page: Page,
  party: { name: string; phone: string },
  guests: number,
  time: string,
) {
  await page.getByTestId('rv-f-name').fill(party.name)
  await page.getByTestId('rv-f-phone').fill(party.phone)
  await page.getByTestId('rv-f-guests').fill(String(guests))
  await page.getByTestId('rv-f-time').fill(time)
}

test.beforeAll(async ({ browser }) => {
  seed('seed')
  nights = book()
  owner = await person(browser, TONIGHT_OWNER_EMAIL, TABLET)
  await owner.page
    .getByRole('link', { name: new RegExp(TONIGHT_VENUE_NAME) })
    .first()
    .click()
  await expect(owner.page).toHaveURL(/\/venues\/vn_[^/?]+/)
  venueId = new URL(owner.page.url()).pathname.split('/')[2] ?? ''
})

test.afterAll(async () => {
  await owner?.context.close()
})

test('a booking is taken from a spot on the plan, and more guests than seats only warns', async () => {
  const { page } = owner
  await page.goto(`/venues/${venueId}?tab=reservations&view=plan`)
  await expect(page.getByTestId('rv-plan')).toBeVisible()
  await page.getByTestId('rv-spot').filter({ hasText: 'Маса 9' }).first().click()
  await page.getByTestId('rv-book-spot').click()

  // One form, with the spot already chosen: the plan is not asked a second time.
  await expect(form(page)).toBeVisible()
  await expect(page.getByTestId('rv-f-spots')).toContainText('Маса 9')
  await fillParty(page, FIRST, 6, '22:00')

  // Six guests on a table of four: said once, under Guests, and Save is unchanged (D134).
  await expect(page.getByTestId('rv-w-seats')).toContainText(
    '6 guests on 4 seats. Fine if you say so.',
  )
  await expect(page.getByTestId('rv-f-unsaved')).toBeVisible()
  await page.getByTestId('rv-f-save').click()
  await expect(page.getByText('Reservation saved.')).toBeVisible()
  await expect(form(page)).toHaveCount(0)

  await openList(page)
  await expect(rowOf(page, FIRST.name)).toContainText('Маса 9')
  await expect(rowOf(page, FIRST.name)).toContainText('6 guests')
})

test('the same phone twice that night warns, and the booking is taken all the same', async () => {
  const { page } = owner
  await openList(page)
  await page.getByTestId('rv-new').first().click()
  await fillParty(page, SECOND, 2, '23:30')
  await expect(page.getByTestId('rv-w-same')).toContainText(
    `${FIRST.name} already has a booking tonight at 22:00.`,
  )
  await page.getByTestId('rv-f-save').click()
  await expect(page.getByText('Reservation saved.')).toBeVisible()
  await expect(rowOf(page, SECOND.name)).toHaveCount(1)
  await expect(rowOf(page, FIRST.name)).toHaveCount(1)
})

test('a spot a colleague holds is refused by name and from when, and nothing typed is lost', async () => {
  const { page } = owner
  await openList(page)
  await page.getByTestId('rv-new').first().click()
  await fillParty(page, THIRD, 2, '22:30')
  await page.getByTestId('rv-f-pick-list').click()
  await page.getByTestId('rv-pick-Маса 9').click()

  // Said while she is still choosing, and said again when Save is refused.
  const sentence = `${FIRST.name} holds Маса 9 from 22:00. Pick another spot.`
  await expect(page.getByTestId('rv-w-taken')).toContainText(sentence)
  await page.getByTestId('rv-f-save').click()
  await expect(page.getByText(sentence).last()).toBeVisible()

  // The form is still there with every value, and another spot goes through.
  await expect(page.getByTestId('rv-f-name')).toHaveValue(THIRD.name)
  await page.getByTestId('rv-pick-Маса 9').click()
  await page.getByTestId('rv-pick-Бар 13').click()
  await page.getByTestId('rv-f-save').click()
  await expect(form(page)).toHaveCount(0)
  await expect(rowOf(page, THIRD.name)).toContainText('Бар 13')
})

test('Cancel keeps the booking on the night; Delete takes it out, and a manager brings it back', async () => {
  const { page } = owner
  await openList(page)

  // Cancel: the guest's doing. It names the consequence, and the booking stays, as Cancelled.
  await rowOf(page, SECOND.name).click()
  await page.getByTestId('rv-cancel').click()
  const cancelDialog = page.getByTestId('rv-cancel-dialog')
  await expect(cancelDialog).toContainText('stays on the night as Cancelled')
  await cancelDialog.getByTestId('rv-cancel-dialog-do').click()
  await expect(page.getByText('Reservation cancelled.')).toBeVisible()
  await page.getByTestId('rv-close').click()
  await expect(rowOf(page, SECOND.name)).toHaveAttribute('data-status', 'cancelled')

  // Delete: a booking that should never have existed. It names the party and leaves every list.
  await rowOf(page, THIRD.name).click()
  await page.getByTestId('rv-more').click()
  await page.getByTestId('rv-delete').click()
  const deleteDialog = page.getByTestId('rv-delete-dialog')
  await expect(deleteDialog).toContainText(THIRD.name)
  await expect(deleteDialog).toContainText('for good')
  await deleteDialog.getByTestId('rv-delete-dialog-do').click()
  await expect(page.getByText('Reservation deleted.')).toBeVisible()
  await expect(rowOf(page, THIRD.name)).toHaveCount(0)

  // The bin holds it for someone who may bring it back, and Restore puts it on the night again.
  await expect(page.getByTestId('rv-bin-open')).toContainText('Deleted · 1')
  await page.getByTestId('rv-bin-open').click()
  await page.getByTestId('rv-restore').click()
  await expect(page.getByText('Reservation is back.')).toBeVisible()
  await expect(rowOf(page, THIRD.name)).toHaveCount(1)
  await expect(page.getByTestId('rv-bin')).toHaveCount(0)
})

test('a booking is copied to another night, with its details', async () => {
  const { page } = owner
  const target = nextNight(nights.day)
  await openList(page)
  await rowOf(page, FIRST.name).click()
  await page.getByTestId('rv-more').click()
  await page.getByTestId('rv-copy-open').click()
  const dialog = page.getByTestId('rv-copy')
  await dialog.getByTestId('rv-copy-day').fill(target)
  await dialog.getByTestId('rv-copy-time').fill('22:00')
  await dialog.getByTestId('rv-copy-do').click()
  await expect(page.getByText(/^Copied to /)).toBeVisible()

  // The other night has it, Reserved, with the same guests and the table it asked for.
  await page.getByTestId('day-any').fill(target)
  await expect(rowOf(page, FIRST.name)).toHaveCount(1)
  await expect(rowOf(page, FIRST.name)).toContainText('6 guests')
  await expect(rowOf(page, FIRST.name)).toHaveAttribute('data-status', 'reserved')
})

test('an edit over somebody else’s change is refused and never saves over their work', async ({
  browser,
}) => {
  const { page } = owner
  await openList(page)
  await rowOf(page, FIRST.name).click()
  await page.getByTestId('rv-edit').click()
  await expect(form(page)).toBeVisible()
  await expect(page.getByTestId('rv-f-name')).toHaveValue(FIRST.name)
  await page.getByTestId('rv-f-guests').fill('3')

  // A colleague changes the note while the form is open.
  const colleague = await person(browser, TONIGHT_OWNER_EMAIL, TABLET)
  try {
    await openList(colleague.page)
    await rowOf(colleague.page, FIRST.name).click()
    await colleague.page.getByTestId('rv-edit').click()
    await colleague.page.getByTestId('rv-f-note').fill('Торта при входа')
    await colleague.page.getByTestId('rv-f-save').click()
    await expect(colleague.page.getByText('Reservation saved.')).toBeVisible()
  } finally {
    await colleague.context.close()
  }

  // Hers is refused, in words, and the form is still open with what she typed.
  await page.getByTestId('rv-f-save').click()
  await expect(
    page.getByText(/changed this reservation while you were typing/).first(),
  ).toBeVisible()
  await expect(page.getByTestId('rv-f-guests')).toHaveValue('3')

  // Opened again, the booking is the colleague's version, and her guests are not saved.
  await page.getByTestId('rv-form-reopen').click()
  await expect(page.getByTestId('rv-f-note')).toHaveValue('Торта при входа')
  await expect(page.getByTestId('rv-f-guests')).toHaveValue('6')
})

test('the form holds at 390 px, and leaving it asks before anything typed is lost', async ({
  browser,
}) => {
  const phone = await person(browser, TONIGHT_OWNER_EMAIL, PHONE)
  try {
    const { page } = phone
    await openList(page)
    await page.getByTestId('rv-new').first().click()
    await expect(form(page)).toBeVisible()
    await page.getByTestId('rv-f-name').fill('Само името')

    // No sideways scroll, and Save can be reached.
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(wide).toBe(false)
    await expect(page.getByTestId('rv-f-save')).toBeVisible()

    // Closing with changes asks first; keeping on editing loses nothing.
    await page.getByTestId('rv-f-close').click()
    await expect(page.getByTestId('rv-leave')).toBeVisible()
    await page.getByRole('button', { name: 'Keep editing' }).click()
    await expect(page.getByTestId('rv-f-name')).toHaveValue('Само името')
    await page.getByTestId('rv-f-close').click()
    await page.getByTestId('rv-leave-do').click()
    await expect(form(page)).toHaveCount(0)
  } finally {
    await phone.context.close()
  }
})
