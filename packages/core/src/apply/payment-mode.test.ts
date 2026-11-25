// An item's payment mode for a whole selection (#218; D113, D122 §5) against Postgres as the
// restro_app role: one atomic change set through apply(), in the manual layer; `null` clears it.

import { createPool, type DbPool, fieldValues, withTenant } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { sha256Hex } from '../hash'
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
  const integration = newId('in')
  /** An item from the POS, one placed only in another venue's menu, and one placed in no menu. */
  const linked = newId('nd')
  const elsewhere = newId('nd')
  const unplaced = newId('nd')
  const section = newId('nd')
  const otherSection = newId('nd')
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
  const provenanceOf = async (node: string) =>
    (
      await withTenant(app, tenant, (tx) =>
        tx
          .select({
            source: fieldValues.source,
            jobId: fieldValues.jobId,
            actor: fieldValues.actor,
          })
          .from(fieldValues)
          .where(and(eq(fieldValues.nodeId, node), eq(fieldValues.fieldKey, 'payment_mode'))),
      )
    )[0]
  const set = (ids: readonly string[], mode: 'on_bill' | 'pay_first' | null) =>
    setItemPaymentMode(app, tenant, { venueId, itemIds: [...ids] as NodeId[], mode, actor })

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-payment-mode-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Payment mode test club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('pm') }))
      .id as `vn_${string}`
    const menu = await provisionMenu(app, tenant, venueId)
    const otherVenue = (
      await provisionVenue(app, tenant, { name: 'Other', slug: testSlug('pm-other') })
    ).id
    const otherMenu = await provisionMenu(app, tenant, otherVenue)
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.integrations (id, tenant_id, kind, host)
        values (${integration}, ${tenant}, 'barsy', 'demo.example')`),
    )
    const record = newId('sr')
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.source_records
          (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw,
           payload)
        values (${record}, ${tenant}, ${integration}, 'article', 'ext-1', 'master',
                ${sha256Hex(record)}, '{}', '{}'::jsonb)`),
    )
    const item = (id: string) => ({
      op: 'createNode' as const,
      id,
      nodeType: 'item' as const,
      parent: null,
      status: 'active' as const,
    })
    const sectionOf = (id: string, parent: string) => ({
      op: 'createNode' as const,
      id,
      nodeType: 'section' as const,
      parent: { id: parent },
      status: 'active' as const,
      sortKey: 'end',
    })
    const place = (id: string, into: string) => ({
      op: 'setPlacement' as const,
      item: { id },
      section: { id: into },
      sortKey: 'end',
    })
    const changeSet = {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor,
      observedAt: new Date().toISOString(),
      ops: [
        sectionOf(section, menu.id),
        sectionOf(otherSection, otherMenu.id),
        ...items.flatMap((id) => [item(id), place(id, section)]),
        item(unplaced),
        item(elsewhere),
        place(elsewhere, otherSection),
      ],
    } as ChangeSet
    expect((await apply(app, tenant, changeSet)).rejected).toEqual([])
    // The POS's own item: made and valued by the POS's change set, then placed by ours.
    const tillSet = {
      id: newId('cs'),
      source: `till:${integration}`,
      jobId: newId('jb'),
      actor: `integration:${integration}`,
      observedAt: new Date().toISOString(),
      ops: [
        item(linked),
        {
          op: 'linkSource',
          node: { id: linked },
          link: { integration, externalType: 'article', externalId: 'ext-1' },
        },
        {
          op: 'setField',
          node: { id: linked },
          fieldKey: 'name',
          layer: 'till',
          scope: 'master',
          value: { bg_BG: 'Негрони', en_US: 'Negroni' },
          sourceRecordId: record,
          mappingVersion: 1,
        },
      ],
    } as ChangeSet
    expect((await apply(app, tenant, tillSet)).rejected).toEqual([])
    const placed = { ...changeSet, id: newId('cs'), ops: [place(linked, section)] } as ChangeSet
    expect((await apply(app, tenant, placed)).rejected).toEqual([])
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

  it('writes the mode of an item that comes from the POS in our manual layer and leaves the POS value', async () => {
    const result = await set([linked], 'pay_first')
    expect(result.applied).toBe(1)
    expect(await modeOf(linked)).toEqual([{ layer: 'manual', scope: 'master', value: 'pay_first' }])
    const names = await withTenant(app, tenant, (tx) =>
      tx
        .select({ layer: fieldValues.layer })
        .from(fieldValues)
        .where(and(eq(fieldValues.nodeId, linked), eq(fieldValues.fieldKey, 'name'))),
    )
    expect(names).toEqual([{ layer: 'till' }])
  })

  it('records where the value came from: source, job and the person (rule 2)', async () => {
    await set([items[1]], 'pay_first')
    const provenance = await provenanceOf(items[1])
    expect(provenance?.source).toBe('manual')
    expect(provenance?.jobId).toMatch(/^jb_/)
    expect(provenance?.actor).toBe(actor)
  })

  it("refuses an item that sits only in another venue's menu, and allows one placed nowhere", async () => {
    await expect(set([items[0], elsewhere], 'pay_first')).rejects.toMatchObject({
      name: 'PaymentModeError',
      code: 'unknown_item',
    })
    expect(await modeOf(elsewhere)).toEqual([])
    expect((await set([unplaced], 'on_bill')).applied).toBe(1)
  })
})
