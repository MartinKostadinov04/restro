// Tonight's stock notice (#80) on a real Postgres, as the restro_app role: the worker raises one
// open alert per item the POS says ran out, a repeat raises none, and the item's return closes
// it; each step is a Log entry. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceContext } from './context'
import { applyService, type ServiceCommand } from './index'
import { OUT_OF_STOCK_ALERT } from './stock'

describe.skipIf(!hasDatabase)('the stock notice (as the restro_app role)', () => {
  let world: ServiceWorld
  const integrationId = newId('in')
  const mojito = newId('nd')
  const negroni = newId('nd')

  beforeAll(async () => {
    world = await openServiceWorld('stock-notice')
  })

  afterAll(async () => {
    await world?.close()
  })

  const worker = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `stock-${randomUUID()}`,
  })
  const notice = (out: { itemId: string; name: string }[], back: string[] = []) =>
    ({
      type: 'notice.record',
      notice: OUT_OF_STOCK_ALERT,
      integrationId,
      out,
      back,
    }) as ServiceCommand
  const run = async (command: ServiceCommand, context: ServiceContext = worker()) =>
    (await applyService(world.app, command, context)).result
  const alertsOf = async () =>
    (
      await world.owner.query(
        `select subject_id, kind, audience, permission, details, done_at is not null as done
           from restro.alerts where venue_id = $1 and kind = $2 order by raised_at, subject_id`,
        [world.venueId, OUT_OF_STOCK_ALERT],
      )
    ).rows
  const logOf = async () =>
    (
      await world.owner.query(
        `select kind, details->>'itemId' as item from restro.log_entries
          where venue_id = $1 and reason = $2 order by seq`,
        [world.venueId, OUT_OF_STOCK_ALERT],
      )
    ).rows

  it('raises one open alert per item, with the name and the POS instance, and logs it', async () => {
    expect(await run(notice([{ itemId: mojito, name: 'Mojito' }]))).toMatchObject({
      status: 'accepted',
      details: { raised: 1, done: 0 },
    })
    expect(await alertsOf()).toEqual([
      {
        subject_id: mojito,
        kind: OUT_OF_STOCK_ALERT,
        audience: 'venue',
        permission: 'alerts.answer',
        details: { itemId: mojito, name: 'Mojito', integrationId },
        done: false,
      },
    ])
    expect(await logOf()).toEqual([{ kind: 'alert.raised', item: mojito }])
  })

  it('raises nothing for an item whose alert is open', async () => {
    expect(
      await run(
        notice([
          { itemId: mojito, name: 'Mojito' },
          { itemId: negroni, name: 'Negroni' },
        ]),
      ),
    ).toMatchObject({ details: { raised: 1, done: 0 } })
    expect((await alertsOf()).map((row) => row.subject_id).sort()).toEqual([mojito, negroni].sort())
  })

  it('closes the alert of an item that is back, and nothing else', async () => {
    expect(await run(notice([], [mojito, newId('nd')]))).toMatchObject({
      details: { raised: 0, done: 1 },
    })
    const rows = await alertsOf()
    expect(rows.find((row) => row.subject_id === mojito)?.done).toBe(true)
    expect(rows.find((row) => row.subject_id === negroni)?.done).toBe(false)
    expect((await logOf()).at(-1)).toEqual({ kind: 'alert.done', item: mojito })
    // A later run-out of the same item is a new alert.
    expect(await run(notice([{ itemId: mojito, name: 'Mojito' }]))).toMatchObject({
      details: { raised: 1 },
    })
  })

  it('is a worker step: staff and guests may not send it', async () => {
    const result = await run(notice([{ itemId: mojito, name: 'Mojito' }]), {
      ...worker(),
      origin: 'guest',
      actor: { kind: 'guest' },
    } as ServiceContext)
    expect(result.status).not.toBe('accepted')
  })
})
