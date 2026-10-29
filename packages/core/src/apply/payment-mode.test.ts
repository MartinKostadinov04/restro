// An item's payment mode for a whole selection (#218; D113, D122 §5) against Postgres as the
// restro_app role: one atomic change set through apply(), in the manual layer; `null` clears it.

import { createPool, type DbPool, fieldValues, withTenant } from '@restro/db'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { type NodeId, newId } from '../ids'
import { apply } from './apply'
import { MAX_PAYMENT_MODE_ITEMS, PaymentModeError, setItemPaymentMode } from './payment-mode'
import { provisionMenu, provisionTenant, provisionVenue } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe('input checks (no database needed)', () => {
  const unusedPool = {} as DbPool
  const valid = {
    venueId: newId('vn'),
    itemIds: [newId('nd')],
    mode: 'pay_first',
    actor: 'user:us_x',
  }

  it.each([
    ['no items', { itemIds: [] }],
    [
      'too many items',
      { itemIds: Array.from({ length: MAX_PAYMENT_MODE_ITEMS + 1 }, () => newId('nd')) },
    ],
    ['a malformed item id', { itemIds: ['nd_nope'] }],
    ['a mode that does not exist', { mode: 'later' }],
    ['no mode at all (null clears; absent is a mistake)', { mode: undefined }],
    ['an actor with personal data', { actor: 'martin@example.com' }],
    ['an unknown field', { value: true }],
  ])('refuses %s before touching the database', async (_label, overrides) => {
    await expect(
      setItemPaymentMode(unusedPool, newId('tn'), { ...valid, ...overrides } as never),
    ).rejects.toMatchObject({ name: 'PaymentModeError', code: 'invalid_input' })
  })
})

describe.skipIf(!hasDatabase)('the payment mode of a selection (as the restro_app role)', () => {
  const tenant = newId('tn')
  let app: DbPool
  let owner: Awaited<ReturnType<typeof openOwnerPool>>
  let venueId: `vn_${string}`
  const items = [newId('nd'), newId('nd'), newId('nd')] as const
  const actor = 'user:us_manager'

  const modeOf = async (node: string) => {
    const rows = await withTenant(app, tenant, (tx) =>
      tx
        .select()
        .from(fieldValues)
        .where(and(eq(fieldValues.nodeId, node), eq(fieldValues.fieldKey, 'payment_mode'))),
    )
    return rows.map((row) => ({ layer: row.layer, scope: row.scope, value: row.value }))
  }
  const set = (ids: readonly string[], mode: 'on_bill' | 'pay_first' | null) =>
    setItemPaymentMode(app, tenant, { venueId, itemIds: [...ids] as NodeId[], mode, actor })

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-payment-mode-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Payment mode test club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('pm') }))
      .id as `vn_${string}`
    await provisionMenu(app, tenant, venueId)
    const changeSet: ChangeSet = {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor,
      observedAt: new Date().toISOString(),
      ops: items.map((id) => ({
        op: 'createNode' as const,
        id,
        nodeType: 'item' as const,
        parent: null,
        status: 'active' as const,
      })),
    }
    expect((await apply(app, tenant, changeSet)).rejected).toEqual([])
  })

  afterAll(async () => {
    await cleanUp(owner, [tenant])
    await owner.end()
    await app.end()
  })

  it('sets the mode of every ticked item in the manual layer, and says nothing changed on a repeat', async () => {
    const first = await set(items, 'pay_first')
    expect(first.applied).toBe(items.length)
    for (const id of items) {
      expect(await modeOf(id)).toEqual([{ layer: 'manual', scope: 'master', value: 'pay_first' }])
    }
    const again = await set(items, 'pay_first')
    expect(again.applied).toBe(0)
    expect(again.unchanged).toBe(items.length)
  })

  it('changes the mode, and null takes our value away (the item follows the venue again)', async () => {
    await set(items, 'on_bill')
    expect(await modeOf(items[0])).toEqual([{ layer: 'manual', scope: 'master', value: 'on_bill' }])
    await set([items[0]], null)
    expect(await modeOf(items[0])).toEqual([])
    expect(await modeOf(items[1])).toEqual([{ layer: 'manual', scope: 'master', value: 'on_bill' }])
  })

  it('refuses the whole selection when one id is not an item: nothing is written', async () => {
    await set(items, null)
    await expect(set([items[0], newId('nd')], 'pay_first')).rejects.toBeInstanceOf(PaymentModeError)
    expect(await modeOf(items[0])).toEqual([])
  })
})
