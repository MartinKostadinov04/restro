// The `guest-email` job (#576) with a fake sender and a fake reader: what one run sends, to whom,
// in which language, what it logs (never the address, never the name), and when it sends nothing.

import { type GuestEmailJob, newId } from '@restro/core'
import { guestLinkToken, guestLinkTokenHash } from '@restro/core/service'
import type { DbPool } from '@restro/db'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  createFakeEmailSender,
  EmailSendError,
  type FakeEmailSender,
} from '../../tests/fake-email-sender'
import { createLogger } from '../logger'
import {
  type GuestEmailNews,
  guestEmailDecision,
  guestLinkOf,
  sendGuestEmailOf,
} from './guest-email'

const ADDRESS = 'maria.guest@example.test'
const NAME = 'Мария Петрова'

const job: GuestEmailJob = {
  tenantId: newId('tn'),
  venueId: newId('vn'),
  reservationId: newId('rv'),
  kind: 'reservation_cancelled',
  entry: 17,
}

const NEWS: GuestEmailNews = {
  status: 'cancelled',
  deleted: false,
  serviceDate: '2026-11-28',
  startsAt: new Date('2026-11-28T20:30:00Z'),
  partySize: 4,
  latestEntry: 17,
  email: ` ${ADDRESS} `,
  venueName: 'Club Нощ',
  timeZone: 'Europe/Sofia',
}

const pool = {} as DbPool
let lines: string[]
let sender: FakeEmailSender

async function log() {
  return createLogger({
    level: 'trace',
    pretty: false,
    destination: { write: (line: string) => void lines.push(line) },
  })
}

async function run(news: GuestEmailNews | null, over: { sender?: FakeEmailSender | null } = {}) {
  return sendGuestEmailOf(job, {
    pool,
    log: await log(),
    sender: over.sender === undefined ? sender : over.sender,
    read: async () => news,
  })
}

beforeEach(() => {
  lines = []
  sender = createFakeEmailSender()
})

describe('the guest email job (#576)', () => {
  it('sends one email about a cancel, in Bulgarian, keyed by the news, and logs no personal data', async () => {
    expect(await run(NEWS)).toBe('sent')
    expect(sender.guestSent).toHaveLength(1)
    const [email] = sender.guestSent
    expect(email?.to).toBe(ADDRESS)
    expect(email?.venueName).toBe('Club Нощ')
    expect(email?.words.subject).toBe('Резервацията ви е отменена')
    expect(email?.words.text).toContain('Club Нощ')
    expect(email?.idempotencyKey).toBe(`${job.reservationId}-reservation_cancelled-17`)
    expect(sender.sent).toEqual([])
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      reservationId: job.reservationId,
      kind: 'reservation_cancelled',
      language: 'bg',
      outcome: 'sent',
    })
    expect(lines.join('\n')).not.toMatch(/example\.test|maria|Мария/i)
  })

  it('sends nothing to a reservation without an email', async () => {
    expect(await run({ ...NEWS, email: null })).toBe('no_email')
    expect(await run({ ...NEWS, email: '  ' })).toBe('no_email')
    expect(sender.guestSent).toEqual([])
  })

  it('sends nothing once the news is no longer true: changed, changed again, deleted or gone', async () => {
    expect(await run({ ...NEWS, status: 'reserved' })).toBe('news_changed')
    expect(await run({ ...NEWS, latestEntry: 18 })).toBe('news_changed')
    expect(await run({ ...NEWS, deleted: true })).toBe('news_changed')
    expect(await run(null)).toBe('reservation_missing')
    expect(sender.guestSent).toEqual([])
  })

  it('reads nothing and sends nothing while guest emails are off', async () => {
    let read = 0
    const outcome = await sendGuestEmailOf(job, {
      pool,
      log: await log(),
      sender: null,
      read: async () => {
        read += 1
        return NEWS
      },
    })
    expect(outcome).toBe('off')
    expect(read).toBe(0)
  })

  it('logs a final refusal and ends; throws what is worth another try', async () => {
    sender.failWith = new EmailSendError(422, false, 'validation_error, status 422')
    expect(await run(NEWS)).toBe('refused')
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ outcome: 'refused', status: 422 })
    expect(lines.join('\n')).not.toContain(ADDRESS)

    sender.failWith = new EmailSendError(503, true, 'status 503')
    await expect(run(NEWS)).rejects.toBeInstanceOf(EmailSendError)
    sender.failWith = null
    await expect(
      sendGuestEmailOf(job, {
        pool,
        log: await log(),
        sender,
        read: async () => {
          throw new Error('the database went away')
        },
      }),
    ).rejects.toThrow('the database went away')
  })

  it('decides from the news alone, and never names the guest', () => {
    const decision = guestEmailDecision(job, { ...NEWS, venueName: `${NAME}'s bar` })
    expect(decision).toMatchObject({ send: true, to: ADDRESS, language: 'bg' })
  })
})

describe('the answer to a request (#578)', () => {
  it('sends a confirmation while the booking is Reserved, and a decline while it is Declined', () => {
    const confirmed = { ...job, kind: 'reservation_confirmed' } as const
    expect(guestEmailDecision(confirmed, { ...NEWS, status: 'reserved' })).toMatchObject({
      send: true,
    })
    // Declined or cancelled since: the confirmation is no longer true.
    for (const status of ['declined', 'cancelled', 'requested']) {
      expect(guestEmailDecision(confirmed, { ...NEWS, status })).toEqual({
        send: false,
        reason: 'news_changed',
      })
    }
    const declined = { ...job, kind: 'reservation_declined' } as const
    expect(guestEmailDecision(declined, { ...NEWS, status: 'declined' })).toMatchObject({
      send: true,
    })
    expect(guestEmailDecision(declined, { ...NEWS, status: 'cancelled' })).toEqual({
      send: false,
      reason: 'news_changed',
    })
  })
})

describe('the guest’s own link in the email (#579)', () => {
  const KEY = 'a-guest-link-key-of-thirty-two-chars-or-more'
  const config = { key: KEY, baseUrl: 'https://menu.restro.example' }
  const token = guestLinkToken(KEY, job.reservationId)
  const parts = {
    tokenHash: guestLinkTokenHash(token),
    organization: 'club-nosht',
    venue: 'main-bar',
  }
  const link = `https://menu.restro.example/book/club-nosht/main-bar/${token}`

  it('ends the email with the link the stored hash was made from', async () => {
    const news = { ...NEWS, linkParts: parts }
    expect(guestLinkOf(job.reservationId, news, config)).toBe(link)
    await sendGuestEmailOf(job, {
      pool,
      log: await log(),
      sender,
      read: async () => news,
      guestLink: config,
    })
    expect(sender.guestSent[0]?.words.text.split('\n').at(-1)).toBe(
      `Вижте резервацията си тук: ${link}`,
    )
    // The token opens the booking: it is in the email and in nothing the job logs.
    expect(lines.join('\n')).not.toContain(token)
  })

  it('carries no link without the key, for a booking staff took, or when the key was changed', () => {
    expect(guestLinkOf(job.reservationId, { linkParts: parts }, null)).toBeUndefined()
    expect(guestLinkOf(job.reservationId, {}, config)).toBeUndefined()
    expect(
      guestLinkOf(job.reservationId, { linkParts: { ...parts, tokenHash: null } }, config),
    ).toBeUndefined()
    const other = { key: 'another-guest-link-key-of-thirty-two-chars', baseUrl: config.baseUrl }
    expect(guestLinkOf(job.reservationId, { linkParts: parts }, other)).toBeUndefined()
    expect(
      guestLinkOf(job.reservationId, { linkParts: { ...parts, organization: null } }, config),
    ).toBeUndefined()
  })

  it('warns, with the reservation only, when the key does not give the stored hash', async () => {
    const other = { key: 'another-guest-link-key-of-thirty-two-chars', baseUrl: config.baseUrl }
    const news = { ...NEWS, linkParts: parts }
    lines.length = 0
    await sendGuestEmailOf(job, {
      pool,
      log: await log(),
      sender,
      read: async () => news,
      guestLink: other,
    })
    const text = lines.join('\n')
    expect(text).toContain('guest link left out')
    expect(text).toContain(job.reservationId)
    for (const secret of [token, parts.tokenHash, guestLinkToken(other.key, job.reservationId)]) {
      expect(text).not.toContain(secret)
    }
    // A booking with no stored hash (staff took it) is no mismatch: nothing to warn about.
    lines.length = 0
    await sendGuestEmailOf(job, {
      pool,
      log: await log(),
      sender,
      read: async () => ({ ...news, linkParts: { ...parts, tokenHash: null } }),
      guestLink: config,
    })
    expect(lines.join('\n')).not.toContain('guest link left out')
  })

  it('sends the request email only while the request is still unanswered', () => {
    const requested = { ...job, kind: 'reservation_requested' } as const
    expect(guestEmailDecision(requested, { ...NEWS, status: 'requested' })).toMatchObject({
      send: true,
    })
    expect(guestEmailDecision(requested, { ...NEWS, status: 'reserved' })).toEqual({
      send: false,
      reason: 'news_changed',
    })
  })
})
