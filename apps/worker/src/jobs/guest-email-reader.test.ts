// The guest email's reader on a real Postgres as restro_app (#579): for an online booking it reads
// the parts of the guest's own link (the stored hash, the organisation's and the venue's address),
// and the link the email carries is the one the request made. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { DEFAULT_ORDERING_SETTINGS, type ServiceHours } from '@restro/core'
import {
  applyService,
  guestLinkToken,
  guestLinkTokenHash,
  requestBooking,
  type ServiceCommand,
} from '@restro/core/service'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  openServiceWorld,
  type ServiceWorld,
} from '../../../../packages/core/src/testing/service-world'
import { guestLinkOf } from '../guest-email/link'
import { readGuestEmailNews } from './guest-email'

const hasDatabase = process.env.DATABASE_URL_OWNER !== undefined
const KEY = `worker-test-guest-link-key-${'z'.repeat(32)}`
const NOW = new Date('2026-10-20T10:00:00Z')
const FRIDAY = '2026-10-23'
const HOURS: ServiceHours = {
  ...DEFAULT_ORDERING_SETTINGS.serviceHours,
  fri: { opens: '22:00', lastOrders: '04:30', closes: '05:30' },
}
const ORGANIZATION_SLUG = 'reader-club'

describe.skipIf(!hasDatabase)("the guest email's reader (as restro_app)", () => {
  let world: ServiceWorld
  let venueSlug: string

  beforeAll(async () => {
    world = await openServiceWorld('guest-email-reader')
    const ownerId = await world.addUser('owner')
    await world.owner.query('update restro.auth_organization set slug = $2 where id = $1', [
      world.tenantId,
      ORGANIZATION_SLUG,
    ])
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, serviceHours: HOURS })],
    )
    venueSlug = (
      await world.owner.query<{ slug: string }>('select slug from restro.venues where id = $1', [
        world.venueId,
      ])
    ).rows[0]?.slug as string
    const staff = {
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin: 'staff' as const,
      actor: { kind: 'user' as const, userId: ownerId, sessionId: `sess-${randomUUID()}` },
      jobId: `req-${randomUUID()}`,
      signedInAt: NOW,
      now: NOW,
    }
    for (const command of [
      { type: 'reservation_settings.set', turnMinutes: 120 },
      { type: 'reservation_online.set', bookingPage: true },
    ]) {
      const { result } = await applyService(world.app, command as ServiceCommand, staff)
      if (result.status !== 'accepted') throw new Error(`${command.type}: ${result.code}`)
    }
  }, 60_000)

  afterAll(async () => {
    await world?.close()
  })

  it("reads the link's parts of an online booking, and the email's link is the request's", async () => {
    const asked = await requestBooking(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actionId: randomUUID(),
      serviceDate: FRIDAY,
      partySize: 2,
      guestName: 'Reader',
      phone: `+35988${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      email: 'reader@example.com',
      note: null,
      humanToken: 'token',
      humanCheck: async () => 'passed' as const,
      now: NOW,
      guestLinkKey: KEY,
    })
    if (asked.status !== 'accepted') throw new Error(`request refused: ${asked.code}`)
    const reservationId = asked.details.reservationId as string
    const entry = (
      await world.owner.query<{ seq: string }>(
        `select max(seq) as seq from restro.log_entries
          where reservation_id = $1 and kind = 'reservation.created'`,
        [reservationId],
      )
    ).rows[0]?.seq
    const news = await readGuestEmailNews(world.app, {
      tenantId: world.tenantId as never,
      venueId: world.venueId as never,
      reservationId: reservationId as never,
      kind: 'reservation_requested',
      entry: Number(entry),
    })
    const token = guestLinkToken(KEY, reservationId)
    expect(news?.linkParts).toEqual({
      tokenHash: guestLinkTokenHash(token),
      organization: ORGANIZATION_SLUG,
      venue: venueSlug,
    })
    expect(news?.latestEntry).toBe(Number(entry))
    expect(guestLinkOf(reservationId, news ?? {}, { key: KEY, baseUrl: 'https://m.example' })).toBe(
      `https://m.example/book/${ORGANIZATION_SLUG}/${venueSlug}/${token}`,
    )
  })
})
