// What a night is measured by (D142, #335), on a production build: a guest scans Demo Bar's table
// 1, adds a Negroni twice, takes one off again and switches the menu to English. Every one of those
// is an event of the table — the scan and the language from the phone itself, the lines from the
// write that put them on the order — and nothing about the phone goes with them. The test reads the
// rows back through scripts/read-guest-events.ts and checks the table's own columns: there is no
// column for a phone number, a name, an address, an IP address or anything a guest typed.
//
// The fixture is the Send's own (scripts/seed-send-e2e.ts): a fresh code, a fresh sitting, no
// pause. Nothing here Sends, so this spec spends none of D118's pace (6 rounds per table per 15
// minutes) and leaves guest-send.spec.ts its four.
//
// The file is named to sort beside guest-send.spec.ts on purpose. Playwright runs a shard's files
// in name order on one worker, and the admin specs later in the shard open "the first venue card",
// so which venue a seed creates first is shared state. Sitting next to the spec whose fixture this
// is keeps that order as it was; a name that sorted first (guest-events) made Demo Bar the first
// card and broke touch-targets.spec.ts.
import { devices, expect, test } from '@playwright/test'

import { runScript } from './global-setup'

test.use({ ...devices['Pixel 7'] })

const PORT = Number(process.env.E2E_PORT ?? 3100)
const SIM = `127.0.0.1:${PORT + 3}`

/** Field names an event must never be able to carry (D142). */
const PERSONAL = [
  'phone',
  'name',
  'email',
  'ip',
  'address',
  'device',
  'agent',
  'note',
  'text',
  'comment',
  'latitude',
  'longitude',
  'card',
]

interface EventRow {
  readonly kind: string
  readonly node_id: string | null
  readonly locale: string | null
  readonly source: string
  readonly actor: string
  readonly retention: string
}

function seed(): { path: string; code: string } {
  const output = runScript('./scripts/seed-send-e2e.ts', 'seed', SIM)
  const line = output
    .split('\n')
    .reverse()
    .find((candidate) => candidate.includes('seed_send_e2e_done'))
  if (!line) throw new Error(`the seed printed no result:\n${output}`)
  return JSON.parse(line) as { path: string; code: string }
}

function readEvents(code: string): { events: EventRow[]; columns: string[] } {
  const output = runScript('./scripts/read-guest-events.ts', 'read', code)
  const line = output
    .split('\n')
    .reverse()
    .find((candidate) => candidate.includes('guest_events_read'))
  if (!line) throw new Error(`the read printed no result:\n${output}`)
  return JSON.parse(line) as { events: EventRow[]; columns: string[] }
}

test('a night at a table is measured, and nothing about the phone is kept', async ({ page }) => {
  const { path, code } = seed()

  // The scan.
  await page.goto(`${path}?lang=bg#t=${code}`)
  await expect(page.locator('[data-face="qr-phone"]').first()).toBeVisible()

  // Two taps of the same item: one line of two.
  await page.locator('[data-slot="item.add"]').first().click()
  const line = page.locator('[data-order-line]')
  await expect(line).toHaveCount(1, { timeout: 20_000 })
  await page.locator('[data-slot="item.add"]').first().click()
  await expect(line).toHaveAttribute('data-qty', '2', { timeout: 20_000 })

  // One off again: the first control of a line is its minus.
  await page.locator('[data-order-line] button').first().click()
  await expect(line).toHaveAttribute('data-qty', '1', { timeout: 20_000 })

  // The language the guest chose.
  const english = page.locator('[data-slot="menu.language"] button[lang="en-US"]')
  await english.click()
  await expect(english).toHaveAttribute('aria-pressed', 'true')

  // The page sends what it saw on a wait of its own; hiding the page flushes it at once.
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pagehide'))
  })

  await expect
    .poll(() => readEvents(code).events.map((event) => event.kind), { timeout: 20_000 })
    .toEqual(
      expect.arrayContaining([
        'menu.opened',
        'order.line_added',
        'order.line_added',
        'order.line_removed',
        'language.chosen',
      ]),
    )

  const { events, columns } = readEvents(code)
  expect(events.filter((event) => event.kind === 'order.line_added')).toHaveLength(2)
  expect(events.filter((event) => event.kind === 'order.line_removed')).toHaveLength(1)
  expect(events.filter((event) => event.kind === 'menu.opened')).toHaveLength(1)
  // The phone's own carry what the guest chose; the scan carries no dish and the order's three
  // all name the one dish that moved, which is what makes them worth anything (D142).
  const chosen = events.find((event) => event.kind === 'language.chosen')
  expect(chosen?.locale).toBe('en_US')
  expect(chosen?.source).toBe('guest')
  expect(events.find((event) => event.kind === 'menu.opened')?.node_id).toBeNull()
  const moved = events.filter((event) => event.kind.startsWith('order.line_'))
  expect(moved).toHaveLength(3)
  expect(new Set(moved.map((event) => event.node_id)).size).toBe(1)
  expect(moved[0]?.node_id).toMatch(/^nd_[0-9A-Za-z]+$/)
  for (const event of events) {
    expect(event.actor).toBe('guest')
    expect(event.retention).toBe('record')
  }

  // The table itself has nowhere to put anything personal.
  for (const column of columns) {
    for (const word of PERSONAL) {
      expect(column, `${column} looks like personal data`).not.toContain(word)
    }
  }
})
