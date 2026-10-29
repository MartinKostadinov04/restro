// `service_day.report_sent` (#179) on a real Postgres, as the restro_app role: it sets
// `service_days.report_sent_at` once; a repeat changes nothing and keeps the first time; a day with
// no `service_days` row is refused; only the worker may run it. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceContext } from './context'
import { applyService } from './index'

const DAY = '2026-01-10'

describe.skipIf(!hasDatabase)(
  'marking the end-of-night message sent (as the restro_app role)',
  () => {
    let world: ServiceWorld
    const worker = (): ServiceContext => ({
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin: 'worker',
      actor: { kind: 'system' },
      jobId: `report-sent-test-${randomUUID()}`,
    })
    const mark = async (day: string, context: ServiceContext = worker()) =>
      (
        await applyService(
          world.app,
          { type: 'service_day.report_sent', serviceDate: day },
          context,
        )
      ).result
    const sentAt = async (day: string) =>
      (
        await world.owner.query(
          'select report_sent_at from restro.service_days where venue_id = $1 and service_date = $2',
          [world.venueId, day],
        )
      ).rows[0]?.report_sent_at as Date | null | undefined

    beforeAll(async () => {
      world = await openServiceWorld('report-sent')
      await world.owner.query(
        `insert into restro.service_days (tenant_id, venue_id, service_date, source, actor, job_id)
       values ($1, $2, $3, 'restro', 'system', 'test-seed')`,
        [world.tenantId, world.venueId, DAY],
      )
    })

    afterAll(async () => {
      await world?.close()
    })

    it('refuses a day that is not closed', async () => {
      expect(await mark('2026-01-09')).toMatchObject({ status: 'refused', code: 'day_not_closed' })
    })

    it('refuses anyone but the worker', async () => {
      const owner = await world.addUser('owner')
      const result = await mark(DAY, {
        ...worker(),
        origin: 'staff',
        actor: { kind: 'user', userId: owner, sessionId: 'session-test' },
        via: 'tonight',
      })
      expect(result.status).toBe('refused')
      expect(await sentAt(DAY)).toBeNull()
    })

    it('sets the time once and changes nothing on a repeat', async () => {
      expect(await sentAt(DAY)).toBeNull()
      const first = await mark(DAY)
      expect(first).toMatchObject({ status: 'accepted', details: { changed: true } })
      const at = await sentAt(DAY)
      expect(at).toBeInstanceOf(Date)

      const again = await mark(DAY)
      expect(again).toMatchObject({ status: 'accepted', details: { changed: false } })
      expect((await sentAt(DAY))?.getTime()).toBe(at?.getTime())
    })
  },
)
