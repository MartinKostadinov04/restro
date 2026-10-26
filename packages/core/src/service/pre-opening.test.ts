// The pre-opening check's alert (#82, D120) on a real Postgres, as the restro_app role: a failed
// check raises one alert for the venue's staff and one for Restro's admin team, once per night; a
// second night is a second alert; only the worker may send it. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import type { ServiceContext } from './context'

describe.skipIf(!hasDatabase)('the pre-opening alert (as the restro_app role)', () => {
  let world: ServiceWorld

  const worker = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `jb-${randomUUID()}`,
  })
  const raise = async (serviceDate: string, cause = 'credentials') =>
    (
      await applyService(
        world.app,
        {
          type: 'hours.pre_opening_alert',
          serviceDate,
          opensAt: `${serviceDate}T19:00:00.000Z`,
          cause,
        },
        worker(),
      )
    ).result
  const openAlerts = async () =>
    (
      await world.owner.query<{
        audience: string
        permission: string | null
        service_date: string
        subject_id: string
        details: Record<string, unknown>
      }>(
        `select audience, permission, to_char(service_date, 'YYYY-MM-DD') as service_date, subject_id, details
           from restro.alerts where venue_id = $1 and kind = 'pre_opening_check' and done_at is null
          order by audience, service_date`,
        [world.venueId],
      )
    ).rows

  beforeAll(async () => {
    world = await openServiceWorld('pre-opening')
  })
  afterAll(async () => {
    await world?.close()
  })
  beforeEach(async () => {
    await world.owner.query('delete from restro.alerts where venue_id = $1', [world.venueId])
  })

  it('raises one alert for the venue and one for Restro, with the reason', async () => {
    expect(await raise('2026-10-23')).toMatchObject({ status: 'accepted', details: { raised: 2 } })
    expect(await openAlerts()).toEqual([
      {
        audience: 'restro',
        permission: null,
        service_date: '2026-10-23',
        subject_id: world.venueId,
        details: { cause: 'credentials', opensAt: '2026-10-23T19:00:00.000Z' },
      },
      {
        audience: 'venue',
        permission: 'alerts.answer',
        service_date: '2026-10-23',
        subject_id: world.venueId,
        details: { cause: 'credentials', opensAt: '2026-10-23T19:00:00.000Z' },
      },
    ])
  })

  it('raises nothing more when the check fails again the same night', async () => {
    await raise('2026-10-23')
    expect(await raise('2026-10-23', 'unreachable')).toMatchObject({ details: { raised: 0 } })
    expect(await openAlerts()).toHaveLength(2)
  })

  it('alerts again for the next night', async () => {
    await raise('2026-10-23')
    expect(await raise('2026-10-24')).toMatchObject({ details: { raised: 2 } })
    expect(await openAlerts()).toHaveLength(4)
  })

  it('writes a Log entry for each alert', async () => {
    await raise('2026-10-23')
    const { rows } = await world.owner.query(
      `select l.reason, l.details->>'audience' as audience
         from restro.log_entries l join restro.alerts a on a.id = l.details->>'alertId'
        where a.venue_id = $1 and l.kind = 'alert.raised' order by 2`,
      [world.venueId],
    )
    expect(rows).toEqual([
      { reason: 'pre_opening_check', audience: 'restro' },
      { reason: 'pre_opening_check', audience: 'venue' },
    ])
  })

  it("is the worker's alone", async () => {
    const { result } = await applyService(
      world.app,
      {
        type: 'hours.pre_opening_alert',
        serviceDate: '2026-10-23',
        opensAt: '2026-10-23T19:00:00.000Z',
        cause: 'credentials',
      },
      { ...worker(), origin: 'guest', actor: { kind: 'guest' }, tableCodeHash: 'a'.repeat(64) },
    )
    expect(result.status).toBe('refused')
  })
})
