// The item sheet's reads and saves against a real Postgres, as the restro_app role: where each
// kind of edit lands (manual, override with a basis, per-language translation), what is locked,
// revert / keep / take barsy's, the picture, the history and tenant isolation (brief S2-06b).

import type { AssetStore } from '@restro/assets'
import { type ChangeSet, newId } from '@restro/core'
import {
  apply,
  archiveTag,
  createMenu,
  createTag,
  deleteMenu,
  type ProvisionedMenu,
  provisionMenu,
  provisionTenant,
  provisionVenue,
} from '@restro/core/apply'
import { createPool, type DbPool, fieldValues, withTenant } from '@restro/db'
import { and, eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { makePng } from '../../../../../packages/assets/src/test-images'
import { storeImage } from '../assets/upload'
import { appDatabaseUrl, hasDatabase, openOwnerPool, testSlug } from '../test-database'
import { tillLabelOfKind } from '../till-label'
import {
  keepOverride,
  loadHistory,
  loadItemSheet,
  removeImage,
  revertField,
  type SheetScope,
  type SheetServices,
  saveField,
  saveTranslation,
  setImage,
} from './service'
import type { ItemSheetData, SheetField, SheetResult } from './types'

// Whether pay-first can take effect at the venue (paying and a POS that opens a bill) is core's
// own test (pay-first-route.test.ts); here, only that the sheet follows its answer.
const payFirst = vi.hoisted(() => ({ possible: false }))
vi.mock('@restro/core/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@restro/core/service')>()),
  payFirstPossibleAt: async () => payFirst.possible,
}))

class MemoryStore implements AssetStore {
  readonly objects = new Map<string, Uint8Array>()
  async put(key: string, bytes: Uint8Array) {
    this.objects.set(key, bytes)
  }
  async getUrl(key: string, ttl: number) {
    return `memory://${key}?ttl=${ttl}`
  }
  async get(key: string) {
    return this.objects.get(key) ?? null
  }
}

const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })

describe.skipIf(!hasDatabase)('the item sheet against Postgres (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  const integration = newId('in')
  const userId = 'usertest0123456789abcdefghijklmn'
  let app: DbPool
  let owner: pg.Pool
  let venueId: string
  let otherVenueId: string
  let menu: ProvisionedMenu
  let record: string
  const store = new MemoryStore()
  const services: SheetServices = {
    store,
    userNames: async (ids) => new Map(ids.map((id) => [id, 'Anna Test'])),
  }
  const actor = { userId }

  const section = newId('nd')
  const linked = newId('nd')
  const handMade = newId('nd')
  const busy = newId('nd')

  const scopeOf = (itemId: string, overrides: Partial<SheetScope> = {}): SheetScope => ({
    pool: app,
    tenantId: tenant,
    venueId,
    itemId,
    ...overrides,
  })
  const sheet = async (itemId: string): Promise<ItemSheetData> => {
    const data = await loadItemSheet(scopeOf(itemId), services)
    if (!data) throw new Error('sheet not found')
    return data
  }
  const field = (data: ItemSheetData, key: string): SheetField => {
    const found = data.fields.find((candidate) => candidate.key === key)
    if (!found) throw new Error(`no field ${key}`)
    return found
  }
  const okData = (result: SheetResult): ItemSheetData => {
    if (!result.ok) throw new Error(`save failed: ${result.error} ${result.detail ?? ''}`)
    return result.data
  }
  const storedRow = async (nodeId: string, fieldKey: string, layer: string) =>
    (
      await withTenant(app, tenant, (tx) =>
        tx
          .select()
          .from(fieldValues)
          .where(
            and(
              eq(fieldValues.nodeId, nodeId),
              eq(fieldValues.fieldKey, fieldKey),
              eq(fieldValues.layer, layer),
            ),
          ),
      )
    )[0]

  function changeSet(source: string, ops: unknown[]): ChangeSet {
    return {
      id: newId('cs'),
      source,
      jobId: newId('jb'),
      actor: source === 'manual' ? 'user:us_test' : `integration:${integration}`,
      observedAt: new Date().toISOString(),
      ops,
    } as ChangeSet
  }
  const tillField = (fieldKey: string, value: unknown, scope = 'master') => ({
    op: 'setField',
    node: { link: { integration, externalType: 'article', externalId: 'article-1' } },
    fieldKey,
    layer: 'till',
    scope,
    value,
    sourceRecordId: record,
    mappingVersion: 1,
  })
  /** What a later pull of the article does: barsy's own values change. */
  const barsyChanges = (fieldKey: string, value: unknown) =>
    apply(app, tenant, changeSet(`till:${integration}`, [tillField(fieldKey, value)]))

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-web-item-sheet-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Item sheet test club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('main') })).id
    otherVenueId = (
      await provisionVenue(app, otherTenant, { name: 'Other', slug: testSlug('main') })
    ).id
    await owner.query(
      `insert into restro.integrations (id, tenant_id, kind, host) values ($1, $2, 'barsy', 'demo.example')`,
      [integration, tenant],
    )
    menu = await provisionMenu(app, tenant, venueId)
    record = newId('sr')
    await owner.query(
      `insert into restro.source_records
         (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw, payload)
       values ($1, $2, $3, 'article', 'article-1', 'master', $4, '{}', '{}'::jsonb)`,
      [record, tenant, integration, 'a'.repeat(64)],
    )
    await apply(
      app,
      tenant,
      changeSet(`till:${integration}`, [
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: menu.id },
          status: 'active',
        },
        { op: 'createNode', id: linked, nodeType: 'item', parent: null, status: 'active' },
        {
          op: 'linkSource',
          node: { id: linked },
          link: { integration, externalType: 'article', externalId: 'article-1' },
        },
        tillField('name', { bg_BG: 'Негрони' }),
        tillField('price', eur(1250), `venue:${venueId}`),
        tillField('for_sale', true, `venue:${venueId}`),
        tillField('visible', true),
        tillField('allergens', ['gluten']),
        tillField('portion', { value: 80, unit: 'ml' }),
        { op: 'setPlacement', item: { id: linked }, section: { id: section }, sortKey: 'end' },
        { op: 'createNode', id: handMade, nodeType: 'item', parent: null, status: 'active' },
        { op: 'createNode', id: busy, nodeType: 'item', parent: null, status: 'active' },
      ]),
    )
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      const tenants = [tenant, otherTenant]
      for (const table of [
        'events',
        'field_values',
        'placements',
        'source_links',
        'menus',
        'nodes',
        'source_records',
        'assets',
        'integrations',
        'tags',
        'venues',
      ]) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [tenants])
      await owner.end()
    }
  })

  describe('reading', () => {
    it("shows every item field in template order with the resolver's provenance", async () => {
      const data = await sheet(linked)
      // No paying here: the payment mode could not take effect, so it is left out (D122 §8).
      expect(data.fields.map((f) => f.key)).toEqual([
        'name',
        'description',
        'price',
        'image',
        'allergens',
        'dietary',
        'portion',
        'abv',
        'tags',
        'availability',
        'internal_note',
        'order_mode',
        'for_sale',
        'visible',
      ])
      expect(data).toMatchObject({
        title: 'Негрони',
        linkedToTill: true,
        tillLabel: tillLabelOfKind('barsy'),
        linkState: 'active',
        defaultLocale: 'bg_BG',
        enabledLocales: ['bg_BG', 'en_US'],
        currency: 'EUR',
        timezone: 'Europe/Sofia',
        image: null,
      })
      expect(field(data, 'name')).toMatchObject({ provenance: 'till', access: { kind: 'edit' } })
      expect(field(data, 'description')).toMatchObject({ provenance: 'none', value: null })
      expect(field(data, 'order_mode')).toMatchObject({ provenance: 'none', value: 'orderable' })
    })

    it('shows the payment mode, after the order mode, where pay-first can take effect (#113)', async () => {
      payFirst.possible = true
      try {
        const keys = (await sheet(linked)).fields.map((f) => f.key)
        expect(keys).toContain('payment_mode')
        expect(keys.indexOf('payment_mode')).toBeGreaterThan(keys.indexOf('order_mode'))
      } finally {
        payFirst.possible = false
      }
    })

    it('locks the price of a linked item: "Change this in barsy"', async () => {
      const price = field(await sheet(linked), 'price')
      expect(price).toMatchObject({
        provenance: 'locked',
        value: eur(1250),
        access: { kind: 'readonly', reason: 'locked_to_till' },
      })
    })

    it('does not edit the flags from here, and points the image at the Media tab', async () => {
      const data = await sheet(linked)
      expect(field(data, 'visible').access).toEqual({ kind: 'readonly', reason: 'composer_toggle' })
      expect(field(data, 'for_sale').access).toEqual({
        kind: 'readonly',
        reason: 'sold_out_control',
      })
      expect(field(data, 'image').access).toEqual({ kind: 'media' })
    })

    it("lists the resolver's issues for the item, with the missing English name among them", async () => {
      const issues = (await sheet(linked)).issues
      expect(issues).toContainEqual({
        code: 'V7',
        severity: 'warning',
        fieldKey: 'name',
        locale: 'en_US',
      })
    })

    it("builds the translation grid: barsy's language is read-only, the missing one editable", async () => {
      const row = (await sheet(linked)).translations.find((r) => r.fieldKey === 'name')
      expect(row?.cells.bg_BG).toMatchObject({
        text: 'Негрони',
        provenance: 'till',
        editable: false,
        missing: false,
        ourText: null,
      })
      expect(row?.cells.en_US).toMatchObject({
        text: null,
        provenance: 'none',
        editable: true,
        missing: true,
        review: false,
      })
      const description = (await sheet(linked)).translations.find(
        (r) => r.fieldKey === 'description',
      )
      expect(description?.cells.bg_BG?.editable).toBe(true)
    })

    it('opens an item that no section places, and a hand-made one', async () => {
      const data = await sheet(handMade)
      expect(data).toMatchObject({
        linkedToTill: false,
        tillLabel: '',
        linkState: 'none',
        visible: false,
      })
      expect(data.issues.map((issue) => issue.code)).toContain('V3')
    })

    it('answers null for an item, a venue or a tenant that is not there', async () => {
      expect(await loadItemSheet(scopeOf(newId('nd')), services)).toBeNull()
      expect(await loadItemSheet(scopeOf(section), services)).toBeNull()
      expect(await loadItemSheet(scopeOf(linked, { venueId: otherVenueId }), services)).toBeNull()
      expect(await loadItemSheet(scopeOf(linked, { venueId: 'vn_nope' }), services)).toBeNull()
      expect(
        await loadItemSheet(
          scopeOf(linked, { tenantId: otherTenant, venueId: otherVenueId }),
          services,
        ),
      ).toBeNull()
    })
  })

  describe('saving', () => {
    it('writes a builder-owned field to the manual layer: the badge becomes "Owned here"', async () => {
      const data = okData(
        await saveField(scopeOf(linked), services, actor, {
          fieldKey: 'description',
          value: { bg_BG: 'Горчив и свеж' },
        }),
      )
      expect(field(data, 'description')).toMatchObject({
        provenance: 'owned',
        layer: 'manual',
        value: { bg_BG: 'Горчив и свеж' },
        canRevert: false,
      })
      const row = await storedRow(linked, 'description', 'manual')
      expect(row).toMatchObject({ source: 'manual', actor: `user:${userId}`, valid: true })
      expect(row?.jobId).toMatch(/^jb_/)
    })

    it('saves tags as ids of the venue’s tags in the manual layer, and refuses any other (S3-06)', async () => {
      const made = await createTag(app, tenant, { venueId, label: { bg_BG: 'Фирмено' } })
      const archived = await createTag(app, tenant, { venueId, label: { bg_BG: 'Старо' } })
      if (!made.ok || !archived.ok) throw new Error('the tags were not created')
      await archiveTag(app, tenant, { venueId, id: archived.tag.id })

      const data = okData(
        await saveField(scopeOf(handMade), services, actor, {
          fieldKey: 'tags',
          value: [made.tag.id],
        }),
      )
      expect(field(data, 'tags')).toMatchObject({
        provenance: 'owned',
        layer: 'manual',
        value: [made.tag.id],
      })
      expect((await storedRow(handMade, 'tags', 'manual'))?.value).toEqual([made.tag.id])

      // Free text, an unknown id and an archived tag are refused by apply(): nothing is saved.
      for (const value of [['signature'], [newId('tg')], [made.tag.id, archived.tag.id]]) {
        const result = await saveField(scopeOf(handMade), services, actor, {
          fieldKey: 'tags',
          value,
        })
        expect(result).toMatchObject({ ok: false, error: 'refused', detail: 'unknown_tag' })
      }
      expect((await storedRow(handMade, 'tags', 'manual'))?.value).toEqual([made.tag.id])

      // Taking the last tag off clears the value.
      const cleared = okData(
        await saveField(scopeOf(handMade), services, actor, { fieldKey: 'tags', value: null }),
      )
      expect(field(cleared, 'tags')).toMatchObject({ provenance: 'none', value: null })
      expect(await storedRow(handMade, 'tags', 'manual')).toBeUndefined()
    })

    it("an override of a barsy-owned field keeps barsy's value as its basis; revert removes it", async () => {
      const overridden = okData(
        await saveField(scopeOf(linked), services, actor, {
          fieldKey: 'allergens',
          value: ['gluten', 'milk'],
        }),
      )
      expect(field(overridden, 'allergens')).toMatchObject({
        provenance: 'overridden',
        layer: 'override',
        value: ['gluten', 'milk'],
        canRevert: true,
        canKeep: false,
        tillValue: ['gluten'],
      })
      expect((await storedRow(linked, 'allergens', 'override'))?.basis).toEqual(['gluten'])
      // Our own layer was not touched.
      expect(await storedRow(linked, 'allergens', 'manual')).toBeUndefined()

      const reverted = okData(
        await revertField(scopeOf(linked), services, actor, { fieldKey: 'allergens' }),
      )
      expect(field(reverted, 'allergens')).toMatchObject({
        provenance: 'till',
        value: ['gluten'],
        canRevert: false,
      })
      expect(await storedRow(linked, 'allergens', 'override')).toBeUndefined()
      // Reverting again has nothing to revert.
      expect(
        await revertField(scopeOf(linked), services, actor, { fieldKey: 'allergens' }),
      ).toEqual({
        ok: false,
        error: 'nothing_to_revert',
      })
    })

    it("a stale override can be kept (new basis) or replaced by barsy's value", async () => {
      await saveField(scopeOf(linked), services, actor, {
        fieldKey: 'portion',
        value: { value: 90, unit: 'ml' },
      })
      expect(field(await sheet(linked), 'portion').provenance).toBe('overridden')

      await barsyChanges('portion', { value: 100, unit: 'ml' })
      const stale = field(await sheet(linked), 'portion')
      expect(stale).toMatchObject({
        provenance: 'stale',
        value: { value: 90, unit: 'ml' },
        canKeep: true,
        canRevert: true,
        tillValue: { value: 100, unit: 'ml' },
      })
      expect((await sheet(linked)).issues).toContainEqual(
        expect.objectContaining({ code: 'stale_override', fieldKey: 'portion' }),
      )

      const kept = okData(
        await keepOverride(scopeOf(linked), services, actor, { fieldKey: 'portion' }),
      )
      expect(field(kept, 'portion')).toMatchObject({
        provenance: 'overridden',
        value: { value: 90, unit: 'ml' },
      })
      expect((await storedRow(linked, 'portion', 'override'))?.basis).toEqual({
        value: 100,
        unit: 'ml',
      })

      await barsyChanges('portion', { value: 110, unit: 'ml' })
      expect(field(await sheet(linked), 'portion').provenance).toBe('stale')
      const taken = okData(
        await revertField(scopeOf(linked), services, actor, { fieldKey: 'portion' }),
      )
      expect(field(taken, 'portion')).toMatchObject({
        provenance: 'till',
        value: { value: 110, unit: 'ml' },
      })
    })

    it('refuses the price of a linked item and changes nothing', async () => {
      const before = await loadHistory(scopeOf(linked), services)
      expect(
        await saveField(scopeOf(linked), services, actor, { fieldKey: 'price', value: eur(999) }),
      ).toEqual({ ok: false, error: 'locked' })
      expect(await storedRow(linked, 'price', 'manual')).toBeUndefined()
      expect(await storedRow(linked, 'price', 'override')).toBeUndefined()
      expect((await loadHistory(scopeOf(linked), services)).entries).toHaveLength(
        before.entries.length,
      )
    })

    it('refuses what is not edited from the sheet: the flags and the picture', async () => {
      for (const fieldKey of ['visible', 'for_sale', 'image']) {
        expect(
          await saveField(scopeOf(linked), services, actor, { fieldKey, value: false }),
        ).toEqual({ ok: false, error: 'read_only' })
      }
    })

    it('refuses a value of the wrong shape without keeping a rejected row', async () => {
      expect(
        await saveField(scopeOf(linked), services, actor, { fieldKey: 'abv', value: 'strong' }),
      ).toEqual({ ok: false, error: 'invalid_value' })
      expect(
        await saveField(scopeOf(linked), services, actor, { fieldKey: 'abv', value: 140 }),
      ).toEqual({ ok: false, error: 'invalid_value' })
      expect(
        await saveField(scopeOf(linked), services, actor, {
          fieldKey: 'allergens',
          value: ['gluten', 'kryptonite'],
        }),
      ).toEqual({ ok: false, error: 'invalid_value' })
      expect(await storedRow(linked, 'abv', 'manual')).toBeUndefined()
      expect(
        await saveField(scopeOf(linked), services, actor, { fieldKey: 'nope', value: 1 }),
      ).toEqual({ ok: false, error: 'not_found' })
    })

    it('clearing a value removes it', async () => {
      okData(await saveField(scopeOf(linked), services, actor, { fieldKey: 'abv', value: 24 }))
      const data = okData(
        await saveField(scopeOf(linked), services, actor, { fieldKey: 'abv', value: null }),
      )
      expect(field(data, 'abv')).toMatchObject({ provenance: 'none', value: null })
      expect(await storedRow(linked, 'abv', 'manual')).toBeUndefined()
    })

    it('a hand-made item takes a manual price', async () => {
      const data = okData(
        await saveField(scopeOf(handMade), services, actor, {
          fieldKey: 'price',
          value: eur(900),
        }),
      )
      expect(field(data, 'price')).toMatchObject({
        provenance: 'owned',
        value: eur(900),
        access: { kind: 'edit' },
      })
    })
  })

  describe('display name and translations (D24)', () => {
    it('a new language is a manual translation, not an override', async () => {
      const data = okData(
        await saveTranslation(scopeOf(linked), services, actor, {
          fieldKey: 'name',
          locale: 'en_US',
          text: 'Negroni',
        }),
      )
      const row = data.translations.find((r) => r.fieldKey === 'name')
      expect(row?.cells.en_US).toMatchObject({
        text: 'Negroni',
        provenance: 'owned',
        ourText: 'Negroni',
        editable: true,
        missing: false,
      })
      expect(row?.cells.bg_BG?.provenance).toBe('till')
      expect((await storedRow(linked, 'name', 'manual'))?.value).toEqual({ en_US: 'Negroni' })
      expect(await storedRow(linked, 'name', 'override')).toBeUndefined()
    })

    it('refuses to write a language barsy holds, and a language the venue has not enabled', async () => {
      expect(
        await saveTranslation(scopeOf(linked), services, actor, {
          fieldKey: 'name',
          locale: 'bg_BG',
          text: 'Друго',
        }),
      ).toEqual({ ok: false, error: 'locked' })
      expect(
        await saveTranslation(scopeOf(linked), services, actor, {
          fieldKey: 'name',
          locale: 'de_DE',
          text: 'Negroni',
        }),
      ).toEqual({ ok: false, error: 'invalid_value' })
      expect(
        await saveTranslation(scopeOf(linked), services, actor, {
          fieldKey: 'abv',
          locale: 'en_US',
          text: 'x',
        }),
      ).toEqual({ ok: false, error: 'read_only' })
    })

    it("flags our translation for review once barsy's name changes after it (D24), and it stays live", async () => {
      await barsyChanges('name', { bg_BG: 'Негрони Бианко' })
      const data = await sheet(linked)
      const cell = data.translations.find((r) => r.fieldKey === 'name')?.cells.en_US
      expect(cell).toMatchObject({ text: 'Negroni', review: true })
      expect(data.issues).toContainEqual(
        expect.objectContaining({ code: 'translation_review', fieldKey: 'name', locale: 'en_US' }),
      )
      // Saving the translation again (changed) clears the flag.
      const edited = okData(
        await saveTranslation(scopeOf(linked), services, actor, {
          fieldKey: 'name',
          locale: 'en_US',
          text: 'Negroni Bianco',
        }),
      )
      expect(edited.translations.find((r) => r.fieldKey === 'name')?.cells.en_US?.review).toBe(
        false,
      )
    })

    it("the Details editor splits one edit: barsy's language overridden, a new one manual; revert keeps ours", async () => {
      const data = okData(
        await saveField(scopeOf(linked), services, actor, {
          fieldKey: 'name',
          value: { bg_BG: 'Негрони Класик', en_US: 'Negroni Classic' },
        }),
      )
      expect(field(data, 'name')).toMatchObject({
        provenance: 'overridden',
        value: { bg_BG: 'Негрони Класик', en_US: 'Negroni Classic' },
        localeProvenance: { bg_BG: 'overridden', en_US: 'owned' },
        canRevert: true,
      })
      expect(await storedRow(linked, 'name', 'override')).toMatchObject({
        value: { bg_BG: 'Негрони Класик' },
        basis: { bg_BG: 'Негрони Бианко' },
      })
      expect((await storedRow(linked, 'name', 'manual'))?.value).toEqual({
        en_US: 'Negroni Classic',
      })

      const reverted = okData(
        await revertField(scopeOf(linked), services, actor, { fieldKey: 'name' }),
      )
      expect(field(reverted, 'name')).toMatchObject({
        provenance: 'till',
        value: { bg_BG: 'Негрони Бианко', en_US: 'Negroni Classic' },
      })
    })
  })

  describe('the picture', () => {
    it('attaches an uploaded asset by id, with alt text per language; the value holds no URL', async () => {
      const stored = await storeImage({
        pool: app,
        tenantId: tenant,
        store,
        bytes: makePng(64, 48),
      })
      const data = okData(
        await setImage(scopeOf(linked), services, actor, {
          assetId: stored.assetId,
          alt: { bg_BG: ' Чаша Негрони ', en_US: 'A glass of Negroni', de_DE: '   ' },
          focal: { x: 0.25, y: 0.75 },
        }),
      )
      expect(data.image).toMatchObject({
        assetId: stored.assetId,
        width: 64,
        height: 48,
        contentType: 'image/png',
        provenance: 'owned',
        alt: { bg_BG: 'Чаша Негрони', en_US: 'A glass of Negroni' },
        focal: { x: 0.25, y: 0.75 },
        canRemove: true,
      })
      expect(data.image?.url).toMatch(/^memory:\/\/tenants\/tn_.+\/original\.png\?ttl=3600$/)
      const row = await storedRow(linked, 'image', 'manual')
      expect(row?.value).toEqual({
        asset_id: stored.assetId,
        alt: { bg_BG: 'Чаша Негрони', en_US: 'A glass of Negroni' },
        focal: { x: 0.25, y: 0.75 },
      })
      expect(JSON.stringify(row?.value)).not.toContain('memory://')
    })

    it('updates the alt text of the same picture', async () => {
      const current = (await sheet(linked)).image
      const data = okData(
        await setImage(scopeOf(linked), services, actor, {
          assetId: current?.assetId ?? '',
          alt: { bg_BG: 'Негрони' },
          focal: null,
        }),
      )
      expect(data.image).toMatchObject({ alt: { bg_BG: 'Негрони' }, focal: null })
    })

    it('refuses an asset that does not exist or belongs to another tenant, and a bad focal point', async () => {
      expect(
        await setImage(scopeOf(linked), services, actor, {
          assetId: newId('as'),
          alt: {},
          focal: null,
        }),
      ).toEqual({ ok: false, error: 'asset_not_found' })
      const foreign = await storeImage({
        pool: app,
        tenantId: otherTenant,
        store,
        bytes: makePng(8, 8),
      })
      expect(
        await setImage(scopeOf(linked), services, actor, {
          assetId: foreign.assetId,
          alt: {},
          focal: null,
        }),
      ).toEqual({ ok: false, error: 'asset_not_found' })
      const current = (await sheet(linked)).image
      expect(
        await setImage(scopeOf(linked), services, actor, {
          assetId: current?.assetId ?? '',
          alt: {},
          focal: { x: 1.5, y: 0 },
        }),
      ).toEqual({ ok: false, error: 'invalid_value' })
    })

    it('removing our picture leaves the item without one', async () => {
      const data = okData(await removeImage(scopeOf(linked), services, actor))
      expect(data.image).toBeNull()
      expect(await storedRow(linked, 'image', 'manual')).toBeUndefined()
    })
  })

  describe('history', () => {
    it("lists the item's events newest first with who, what and old to new", async () => {
      const page = await loadHistory(scopeOf(linked), services)
      expect(page.entries.length).toBeGreaterThan(5)
      const seqs = page.entries.map((entry) => entry.seq)
      expect([...seqs].sort((a, b) => b - a)).toEqual(seqs)
      const description = page.entries.find((entry) => entry.fieldKey === 'description')
      expect(description).toMatchObject({
        kind: 'set',
        oldValue: null,
        newValue: { bg_BG: 'Горчив и свеж' },
        layer: 'manual',
        scope: 'master',
        source: 'manual',
        actor: { kind: 'user', name: 'Anna Test' },
        definition: expect.objectContaining({ key: 'description' }),
      })
      // A revert shows as the override being cleared, a barsy pull as a barsy change.
      expect(page.entries).toContainEqual(
        expect.objectContaining({ fieldKey: 'allergens', layer: 'override', kind: 'cleared' }),
      )
      expect(page.entries).toContainEqual(
        expect.objectContaining({
          fieldKey: 'portion',
          layer: 'till',
          kind: 'changed',
          actor: { kind: 'integration', name: null },
        }),
      )
    })

    it('pages: 20 at a time, the cursor is the last seq seen, the last page has none', async () => {
      for (let abv = 1; abv <= 25; abv++) {
        okData(await saveField(scopeOf(busy), services, actor, { fieldKey: 'abv', value: abv }))
      }
      const first = await loadHistory(scopeOf(busy), services)
      expect(first.entries).toHaveLength(20)
      expect(first.entries[0]).toMatchObject({ kind: 'changed', oldValue: 24, newValue: 25 })
      expect(first.nextBefore).toBe(first.entries.at(-1)?.seq)
      const second = await loadHistory(scopeOf(busy), services, first.nextBefore ?? undefined)
      expect(second.nextBefore).toBeNull()
      // Older than the 25 saves: the item's own creation (structural events, S2-06a).
      const fieldEntries = second.entries.filter((entry) => entry.kind !== 'structure')
      expect(fieldEntries).toHaveLength(5)
      expect(fieldEntries.at(-1)).toMatchObject({ kind: 'set', oldValue: null, newValue: 1 })
      expect(second.entries.filter((entry) => entry.kind === 'structure')).toContainEqual(
        expect.objectContaining({ op: 'createNode' }),
      )
    })

    it("shows nothing of another tenant's item", async () => {
      const page = await loadHistory(scopeOf(linked, { tenantId: otherTenant }), services)
      expect(page.entries).toEqual([])
    })
  })

  describe('the menu the composer has open (brief S6)', () => {
    it('reads the item in the menu named, a second menu of the venue too; never one not in use', async () => {
      const second = await createMenu(app, tenant, { venueId, name: 'Brunch' })
      if (!second.ok) throw new Error(second.reason)
      const brunch = newId('nd')
      const pancake = newId('nd')
      const manual = (node: string, fieldKey: string, value: unknown) => ({
        op: 'setField',
        node: { id: node },
        fieldKey,
        layer: 'manual',
        scope: 'master',
        value,
      })
      const result = await apply(
        app,
        tenant,
        changeSet('manual', [
          {
            op: 'createNode',
            id: brunch,
            nodeType: 'section',
            parent: { id: second.menu.id },
            status: 'active',
          },
          manual(brunch, 'title', { bg_BG: 'Брънч' }),
          { op: 'createNode', id: pancake, nodeType: 'item', parent: null, status: 'active' },
          manual(pancake, 'name', { bg_BG: 'Палачинка' }),
          { op: 'setPlacement', item: { id: pancake }, section: { id: brunch }, sortKey: 'end' },
        ]),
      )
      expect(result.rejected).toEqual([])

      const data = await loadItemSheet(scopeOf(pancake, { menuId: second.menu.id }), services)
      expect(data?.title).toBe('Палачинка')
      // Read in its own menu, the item is placed there: not a loose item.
      expect(data?.issues.map((issue) => issue.code)).not.toContain('unplaced_item')
      // No menu named: the venue's live menu, as before.
      expect((await loadItemSheet(scopeOf(linked), services))?.linkedToTill).toBe(true)
      // A menu that is not one of the venue's menus in use finds nothing.
      expect(await loadItemSheet(scopeOf(pancake, { menuId: newId('nd') }), services)).toBeNull()
      expect((await deleteMenu(app, tenant, { venueId, menuId: second.menu.id })).ok).toBe(true)
      expect(await loadItemSheet(scopeOf(pancake, { menuId: second.menu.id }), services)).toBeNull()
    })
  })
})
