// A venue's tags against Postgres as the restro_app role (brief S3-06, integration tests): the
// writers (create, rename, reorder, archive, restore), tenant and venue isolation, the `unknown_tag`
// check of apply(), the atomic bulk assignment, and the publisher's tag vocabulary.
import { createPool, type DbPool, tags } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { type NodeId, newId, type TagId } from '../ids'
import * as core from '../index'
import { TAG_COLORS } from '../tags'
import { ApplyError, apply } from './apply'
import * as applyEntry from './index'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { loadCurrentSnapshot, publishMenu } from './publish'
import { listTags, setItemTags } from './tags'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool } from './test-database'

/** A pool that is never used: the input checks run before any query. */
const unusedPool = {} as DbPool

describe('module boundary', () => {
  it('exports the tag writers from @restro/core/apply and the tag words from @restro/core', () => {
    expect(Object.keys(applyEntry)).toEqual(
      expect.arrayContaining([
        'createTag',
        'updateTag',
        'moveTag',
        'archiveTag',
        'restoreTag',
        'listTags',
        'setItemTags',
        'loadTagVocabulary',
      ]),
    )
    expect(Object.keys(core)).toEqual(expect.arrayContaining(['TAG_COLORS', 'checkTagLabel']))
    expect(Object.keys(core)).not.toContain('createTag')
  })
})

describe('input checks (no database needed)', () => {
  const venueId = newId('vn')
  it('refuses a malformed colour, id or position before touching the database', async () => {
    const { createTag, moveTag } = applyEntry
    const label = { bg_BG: 'Люто' }
    await expect(
      createTag(unusedPool, newId('tn'), { venueId, label, color: '#ff0000' }),
    ).resolves.toMatchObject({ ok: false, error: 'invalid_input' })
    await expect(
      createTag(unusedPool, newId('tn'), { venueId, label, id: 'nd_not_a_tag' }),
    ).resolves.toMatchObject({ ok: false, error: 'invalid_input' })
    await expect(
      moveTag(unusedPool, newId('tn'), { venueId, id: newId('tg'), position: 'middle' }),
    ).resolves.toMatchObject({ ok: false, error: 'invalid_input' })
  })

  it('refuses a bulk change with nothing to do, too many items, or an actor with personal data', async () => {
    const item = newId('nd')
    const base = { venueId, itemIds: [item], add: [newId('tg')], remove: [], actor: 'system' }
    await expect(setItemTags(unusedPool, newId('tn'), { ...base, add: [] })).rejects.toMatchObject({
      name: 'SetItemTagsError',
    })
    await expect(
      setItemTags(unusedPool, newId('tn'), { ...base, itemIds: [] }),
    ).rejects.toMatchObject({ name: 'SetItemTagsError' })
    await expect(
      setItemTags(unusedPool, newId('tn'), { ...base, actor: 'martin@example.com' } as never),
    ).rejects.toMatchObject({ name: 'SetItemTagsError' })
  })
})

describe.skipIf(!hasDatabase)('tags against Postgres (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: `vn_${string}`
  let secondVenueId: `vn_${string}`
  let otherTenantVenueId: `vn_${string}`
  let menu: ProvisionedMenu
  let secondMenu: ProvisionedMenu

  const section = newId('nd')
  const secondSection = newId('nd')
  const items = [newId('nd'), newId('nd'), newId('nd'), newId('nd'), newId('nd')] as const
  /** A tag of the second venue and the items placed there. */
  const secondVenueItem = newId('nd')
  const ids: Record<string, TagId> = {}

  const changeSet = (ops: unknown[]): ChangeSet =>
    ({
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_test',
      observedAt: new Date().toISOString(),
      ops,
    }) as ChangeSet
  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })
  const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })
  const tagsOf = async (item: string) => {
    const result = await owner.query<{ value: string[] }>(
      `select value from restro.field_values
       where node_id = $1 and field_key = 'tags' and layer = 'manual' and scope = 'master'`,
      [item],
    )
    // Stored as written; compared as a set.
    return result.rows[0] ? [...result.rows[0].value].sort() : null
  }
  const create = async (name: string, extra: Record<string, unknown> = {}) => {
    const result = await applyEntry.createTag(app, tenant, {
      venueId,
      label: { bg_BG: name, en_US: `${name} EN` },
      ...extra,
    })
    if (!result.ok) throw new Error(`createTag(${name}): ${result.error}`)
    return result.tag
  }
  const names = async (options = {}) =>
    (await listTags(app, tenant, venueId, options)).map((tag) => tag.label.bg_BG)

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-tags-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Tags test club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: 'main' }))
      .id as `vn_${string}`
    secondVenueId = (await provisionVenue(app, tenant, { name: 'Second', slug: 'second' }))
      .id as `vn_${string}`
    otherTenantVenueId = (await provisionVenue(app, otherTenant, { name: 'Other', slug: 'other' }))
      .id as `vn_${string}`
    menu = await provisionMenu(app, tenant, venueId)
    secondMenu = await provisionMenu(app, tenant, secondVenueId)
    const result = await apply(
      app,
      tenant,
      changeSet([
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: menu.id },
          status: 'active',
          sortKey: 'end',
        },
        manual(section, 'title', { bg_BG: 'Коктейли', en_US: 'Cocktails' }),
        {
          op: 'createNode',
          id: secondSection,
          nodeType: 'section',
          parent: { id: secondMenu.id },
          status: 'active',
          sortKey: 'end',
        },
        manual(secondSection, 'title', { bg_BG: 'Бира', en_US: 'Beer' }),
        ...[...items, secondVenueItem].flatMap((id, index) => [
          { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
          manual(id, 'name', { bg_BG: `Напитка ${index}`, en_US: `Drink ${index}` }),
          manual(id, 'price', eur(500 + index * 100)),
          manual(id, 'allergens', []),
          {
            op: 'setPlacement',
            item: { id },
            section: { id: id === secondVenueItem ? secondSection : section },
            sortKey: 'end',
          },
        ]),
      ]),
    )
    expect(result.rejected).toEqual([])
  })

  afterAll(async () => {
    if (owner) await cleanUp(owner, [tenant, otherTenant])
    await owner?.end()
    await app?.end()
  })

  describe('the writers', () => {
    it('creates tags in order, with a name per language and a colour token', async () => {
      const signature = await create('Фирмено')
      const spicy = await create('Люто', { color: 'text' })
      const local = await create('Местно', { color: 'muted' })
      ids.signature = signature.id
      ids.spicy = spicy.id
      ids.local = local.id
      expect(signature).toMatchObject({
        venueId,
        label: { bg_BG: 'Фирмено', en_US: 'Фирмено EN' },
        color: 'accent',
        archived: false,
      })
      expect(spicy.color).toBe('text')
      expect(await names()).toEqual(['Фирмено', 'Люто', 'Местно'])
      expect(signature.id).toMatch(/^tg_[0-9A-Za-z]{22}$/)
    })

    it('creates at a place: before another tag', async () => {
      const first = await create('Първо', { position: { before: ids.signature } })
      ids.first = first.id
      expect(await names()).toEqual(['Първо', 'Фирмено', 'Люто', 'Местно'])
    })

    it('answers a retried create (same id) with the stored tag and creates nothing twice', async () => {
      const again = await applyEntry.createTag(app, tenant, {
        venueId,
        id: ids.spicy,
        label: { bg_BG: 'Нещо друго' },
      })
      expect(again).toMatchObject({ ok: true, tag: { id: ids.spicy, label: { bg_BG: 'Люто' } } })
      expect((await listTags(app, tenant, venueId)).length).toBe(4)
    })

    it('refuses a name without the default language, in a language the venue lacks, or empty', async () => {
      const refuse = (label: unknown) => applyEntry.createTag(app, tenant, { venueId, label })
      await expect(refuse({ en_US: 'Spicy' })).resolves.toMatchObject({
        ok: false,
        error: 'default_language_missing',
      })
      await expect(refuse({ bg_BG: 'Люто', de_DE: 'Scharf' })).resolves.toMatchObject({
        ok: false,
        error: 'language_not_enabled',
      })
      await expect(refuse({ bg_BG: '   ' })).resolves.toMatchObject({
        ok: false,
        error: 'invalid_input',
      })
      await expect(refuse({ bg_BG: 'x'.repeat(41) })).resolves.toMatchObject({
        ok: false,
        error: 'invalid_input',
      })
      await expect(refuse({})).resolves.toMatchObject({ ok: false, error: 'invalid_input' })
      expect((await listTags(app, tenant, venueId)).length).toBe(4)
    })

    it('trims the name and keeps only the colours of the token list', async () => {
      const tag = await create('  Веган  ', { color: 'border' })
      expect(tag.label.bg_BG).toBe('Веган')
      expect(TAG_COLORS).toContain(tag.color)
      ids.vegan = tag.id
      await expect(
        applyEntry.createTag(app, tenant, {
          venueId,
          label: { bg_BG: 'Червено' },
          color: 'red',
        }),
      ).resolves.toMatchObject({ ok: false, error: 'invalid_input' })
    })

    it('renames and recolours, and saying the same thing changes nothing', async () => {
      const renamed = await applyEntry.updateTag(app, tenant, {
        venueId,
        id: ids.spicy,
        label: { bg_BG: 'Люто!', en_US: 'Hot' },
        color: 'accent_text',
      })
      expect(renamed).toMatchObject({
        ok: true,
        tag: { label: { bg_BG: 'Люто!', en_US: 'Hot' }, color: 'accent_text' },
      })
      const [row] = await owner
        .query<{ updated_at: Date }>('select updated_at from restro.tags where id = $1', [
          ids.spicy,
        ])
        .then((r) => r.rows)
      const same = await applyEntry.updateTag(app, tenant, {
        venueId,
        id: ids.spicy,
        label: { bg_BG: 'Люто!', en_US: 'Hot' },
        color: 'accent_text',
      })
      expect(same.ok).toBe(true)
      const [after] = await owner
        .query<{ updated_at: Date }>('select updated_at from restro.tags where id = $1', [
          ids.spicy,
        ])
        .then((r) => r.rows)
      expect(after?.updated_at).toEqual(row?.updated_at)
      await expect(
        applyEntry.updateTag(app, tenant, { venueId, id: ids.spicy, label: { en_US: 'Hot' } }),
      ).resolves.toMatchObject({ ok: false, error: 'default_language_missing' })
    })

    it('reorders: before another tag, and to the end; moving a tag before itself does nothing', async () => {
      // Now: Първо, Фирмено, Люто!, Местно, Веган
      expect(await names()).toEqual(['Първо', 'Фирмено', 'Люто!', 'Местно', 'Веган'])
      await applyEntry.moveTag(app, tenant, {
        venueId,
        id: ids.vegan,
        position: { before: ids.first },
      })
      expect(await names()).toEqual(['Веган', 'Първо', 'Фирмено', 'Люто!', 'Местно'])
      await applyEntry.moveTag(app, tenant, { venueId, id: ids.first, position: 'end' })
      expect(await names()).toEqual(['Веган', 'Фирмено', 'Люто!', 'Местно', 'Първо'])
      await applyEntry.moveTag(app, tenant, {
        venueId,
        id: ids.local,
        position: { before: ids.signature },
      })
      expect(await names()).toEqual(['Веган', 'Местно', 'Фирмено', 'Люто!', 'Първо'])
      const self = await applyEntry.moveTag(app, tenant, {
        venueId,
        id: ids.local,
        position: { before: ids.local },
      })
      expect(self.ok).toBe(true)
      expect(await names()).toEqual(['Веган', 'Местно', 'Фирмено', 'Люто!', 'Първо'])
      await expect(
        applyEntry.moveTag(app, tenant, {
          venueId,
          id: ids.local,
          position: { before: newId('tg') },
        }),
      ).resolves.toMatchObject({ ok: false, error: 'unknown_tag' })
    })

    it('archives and restores: archived tags leave the list but keep their place', async () => {
      const archived = await applyEntry.archiveTag(app, tenant, { venueId, id: ids.local })
      expect(archived).toMatchObject({ ok: true, tag: { archived: true } })
      expect(await names()).toEqual(['Веган', 'Фирмено', 'Люто!', 'Първо'])
      expect(await names({ includeArchived: true })).toEqual([
        'Веган',
        'Местно',
        'Фирмено',
        'Люто!',
        'Първо',
      ])
      // Archiving twice, and restoring something that is not archived, change nothing.
      expect(await applyEntry.archiveTag(app, tenant, { venueId, id: ids.local })).toMatchObject({
        ok: true,
      })
      expect(
        await applyEntry.restoreTag(app, tenant, { venueId, id: ids.signature }),
      ).toMatchObject({ ok: true, tag: { archived: false } })
      const restored = await applyEntry.restoreTag(app, tenant, { venueId, id: ids.local })
      expect(restored).toMatchObject({ ok: true, tag: { archived: false } })
      expect(await names()).toEqual(['Веган', 'Местно', 'Фирмено', 'Люто!', 'Първо'])
    })

    it('knows only the venue’s own tags: another venue, another tenant', async () => {
      const foreign = await applyEntry.createTag(app, tenant, {
        venueId: secondVenueId,
        label: { bg_BG: 'Чуждо' },
      })
      expect(foreign.ok).toBe(true)
      if (foreign.ok) ids.foreign = foreign.tag.id
      // The second venue's tag does not show in the first venue's list, and cannot be changed
      // through it.
      expect(await names({ includeArchived: true })).not.toContain('Чуждо')
      await expect(
        applyEntry.updateTag(app, tenant, { venueId, id: ids.foreign, label: { bg_BG: 'Ха' } }),
      ).resolves.toMatchObject({ ok: false, error: 'unknown_tag' })
      await expect(
        applyEntry.archiveTag(app, tenant, { venueId, id: ids.foreign }),
      ).resolves.toMatchObject({ ok: false, error: 'unknown_tag' })

      // Another tenant sees nothing of this one, and cannot reach its venue or tags.
      expect(await listTags(app, otherTenant, venueId, { includeArchived: true })).toEqual([])
      await expect(
        applyEntry.createTag(app, otherTenant, { venueId, label: { bg_BG: 'Х' } }),
      ).resolves.toMatchObject({ ok: false, error: 'unknown_venue' })
      await expect(
        applyEntry.archiveTag(app, otherTenant, { venueId: otherTenantVenueId, id: ids.signature }),
      ).resolves.toMatchObject({ ok: false, error: 'unknown_tag' })
      const rows = await withTenantWrite(app, otherTenant, (tx) => tx.select().from(tags))
      expect(rows).toEqual([])
    })

    it('rejects a tag id another tenant took', async () => {
      // A tenant cannot reuse (or even probe) another tenant's tag id: it reads as taken.
      const taken = await applyEntry.createTag(app, otherTenant, {
        venueId: otherTenantVenueId,
        id: ids.signature,
        label: { bg_BG: 'Хак' },
      })
      expect(taken.ok).toBe(false)
    })
  })

  describe('apply() checks the tag ids an item is given', () => {
    const write = (item: string, value: unknown, extra: Record<string, unknown> = {}) =>
      apply(app, tenant, changeSet([{ ...manual(item, 'tags', value), ...extra }]))

    it('accepts active tags of the item’s venue, in any order, once each', async () => {
      const result = await write(items[0], [ids.spicy, ids.signature])
      expect(result).toMatchObject({ applied: 1, rejected: [] })
      expect(await tagsOf(items[0])).toEqual([ids.signature, ids.spicy].sort())
    })

    it('refuses an unknown id, a made-up string and a free-text tag with unknown_tag', async () => {
      for (const value of [[newId('tg')], ['signature'], [ids.signature, 'nd_x']]) {
        const result = await write(items[1], value)
        expect(result.applied).toBe(0)
        expect(result.rejected).toMatchObject([{ code: 'unknown_tag', fieldKey: 'tags' }])
      }
      expect(await tagsOf(items[1])).toBeNull()
    })

    it('refuses an archived tag, and a tag of another venue', async () => {
      await applyEntry.archiveTag(app, tenant, { venueId, id: ids.vegan })
      expect((await write(items[1], [ids.vegan])).rejected).toMatchObject([{ code: 'unknown_tag' }])
      expect((await write(items[1], [ids.foreign])).rejected).toMatchObject([
        { code: 'unknown_tag', reason: expect.stringContaining('another venue') },
      ])
      expect(await tagsOf(items[1])).toBeNull()
    })

    it('lets an id the item already holds stay while the tag is archived, and restoring brings it back', async () => {
      await applyEntry.restoreTag(app, tenant, { venueId, id: ids.vegan })
      expect((await write(items[2], [ids.vegan, ids.signature])).rejected).toEqual([])
      await applyEntry.archiveTag(app, tenant, { venueId, id: ids.vegan })
      // The item sheet saves the whole value: the archived id it holds stays, a new one is added.
      expect((await write(items[2], [ids.vegan, ids.signature, ids.spicy])).rejected).toEqual([])
      expect(await tagsOf(items[2])).toEqual([ids.vegan, ids.signature, ids.spicy].sort())
      // A different item cannot pick up the archived tag.
      expect((await write(items[3], [ids.vegan])).rejected).toMatchObject([{ code: 'unknown_tag' }])
      await applyEntry.restoreTag(app, tenant, { venueId, id: ids.vegan })
    })

    it('clears the value (the last tag taken off) without checking anything', async () => {
      const result = await apply(
        app,
        tenant,
        changeSet([
          {
            op: 'clearField',
            node: { id: items[0] },
            fieldKey: 'tags',
            layer: 'manual',
            scope: 'master',
          },
        ]),
      )
      expect(result).toMatchObject({ applied: 1, rejected: [] })
      expect(await tagsOf(items[0])).toBeNull()
    })

    it('lets an item placed in no section take any tag of the tenant (it has no venue yet)', async () => {
      const loose = newId('nd')
      const made = await apply(
        app,
        tenant,
        changeSet([
          { op: 'createNode', id: loose, nodeType: 'item', parent: null, status: 'active' },
        ]),
      )
      expect(made.rejected).toEqual([])
      expect((await write(loose, [ids.signature])).rejected).toEqual([])
      expect((await write(loose, [ids.signature, newId('tg')])).rejected).toMatchObject([
        { code: 'unknown_tag' },
      ])
    })
  })

  describe('setItemTags', () => {
    const run = (
      itemIds: readonly string[],
      add: readonly string[],
      remove: readonly string[] = [],
    ) =>
      setItemTags(app, tenant, {
        venueId,
        itemIds: [...itemIds] as NodeId[],
        add: [...add] as TagId[],
        remove: [...remove] as TagId[],
        actor: 'user:us_test',
      })

    it('adds a tag to every selected item in one change set, keeping what each holds', async () => {
      // Start: items[2] holds vegan+signature+spicy, items[3] holds signature (venue scope, so
      // the master value is empty), the rest nothing.
      const before2 = await tagsOf(items[2])
      const result = await run([items[0], items[1], items[2]], [ids.local])
      expect(result).toMatchObject({ applied: 3, rejected: [] })
      expect(await tagsOf(items[0])).toEqual([ids.local])
      expect(await tagsOf(items[1])).toEqual([ids.local])
      expect(await tagsOf(items[2])).toEqual([...(before2 ?? []), ids.local].sort())
    })

    it('leaves out an item that would not change and counts it', async () => {
      const result = await run([items[0], items[1], items[4]], [ids.local])
      expect(result).toMatchObject({ applied: 1, unchanged: 2 })
      expect(await tagsOf(items[4])).toEqual([ids.local])
    })

    it('removes a tag, and clears the value when it was the last', async () => {
      const result = await run([items[0], items[1], items[4]], [], [ids.local])
      expect(result).toMatchObject({ applied: 3, rejected: [] })
      expect(await tagsOf(items[0])).toBeNull()
      expect(await tagsOf(items[4])).toBeNull()
      expect(await tagsOf(items[2])).toContain(ids.local)
    })

    it('adds and removes in one go', async () => {
      await run([items[0]], [ids.signature, ids.spicy])
      const result = await run([items[0], items[1]], [ids.vegan], [ids.spicy])
      expect(result.rejected).toEqual([])
      expect(await tagsOf(items[0])).toEqual([ids.signature, ids.vegan].sort())
      expect(await tagsOf(items[1])).toEqual([ids.vegan])
    })

    it('is atomic: one refused item refuses the whole selection and writes nothing', async () => {
      const snapshot = async () => JSON.stringify(await Promise.all(items.map(tagsOf)))
      const before = await snapshot()
      const eventCount = async () =>
        (
          await owner.query('select count(*)::int as n from restro.events where tenant_id = $1', [
            tenant,
          ])
        ).rows
      const events = await eventCount()
      // An archived tag cannot be added to anyone.
      await applyEntry.archiveTag(app, tenant, { venueId, id: ids.first })
      const error = await run([...items], [ids.first]).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ApplyError)
      expect(error).toMatchObject({ code: 'change_set_rejected' })
      expect((error as ApplyError).rejected).toHaveLength(items.length)
      expect(await snapshot()).toBe(before)
      expect(await eventCount()).toEqual(events)

      // One item of another venue among valid ones: the others do not get the tag either.
      const mixed = await run([items[4], secondVenueItem], [ids.signature]).catch((e: unknown) => e)
      expect(mixed).toMatchObject({ code: 'change_set_rejected' })
      expect((mixed as ApplyError).rejected).toMatchObject([{ opIndex: 1, code: 'unknown_tag' }])
      expect(await snapshot()).toBe(before)
      await applyEntry.restoreTag(app, tenant, { venueId, id: ids.first })
    })

    it('refuses an id that is not an item', async () => {
      const error = await run([section], [ids.signature]).catch((e: unknown) => e)
      expect(error).toMatchObject({ code: 'change_set_rejected' })
    })
  })

  describe('the published snapshot', () => {
    const publish = (minutes: number) =>
      publishMenu(
        app,
        tenant,
        { menuId: menu.id, venueId, reason: 'manual', actor: 'user:us_test' },
        { now: new Date(Date.parse('2026-10-09T18:00:00Z') + minutes * 60_000) },
      )

    it('carries the venue’s non-archived tags, in order, with name and colour token', async () => {
      const result = await publish(0)
      const body = result.snapshot.body
      const live = (await listTags(app, tenant, venueId)).map((tag) => tag.id)
      expect(Object.keys(body?.tags ?? {}).sort()).toEqual([...live].sort())
      expect(body?.tags[ids.spicy as TagId]).toEqual({
        label: { bg_BG: 'Люто!', en_US: 'Hot' },
        color: 'accent_text',
      })
      expect(body?.tags[ids.vegan as TagId]).toMatchObject({ color: 'border' })
      // Items carry only ids that are in it.
      for (const item of Object.values(body?.items ?? {})) {
        for (const tag of item.tags) expect(Object.keys(body?.tags ?? {})).toContain(tag)
      }
      expect(body?.items[items[0]]?.tags).toEqual([ids.signature, ids.vegan].sort())
      // The second venue's tag is not in this venue's snapshot.
      expect(Object.keys(body?.tags ?? {})).not.toContain(ids.foreign)
    })

    it('leaves an archived tag out of the next snapshot, and its id off the items; old snapshots keep it', async () => {
      const before = await loadCurrentSnapshot(app, tenant, { menuId: menu.id, venueId })
      await applyEntry.archiveTag(app, tenant, { venueId, id: ids.vegan })
      const result = await publish(10)
      expect(result.status).toBe('published')
      const body = result.snapshot.body
      expect(Object.keys(body?.tags ?? {})).not.toContain(ids.vegan)
      expect(body?.items[items[0]]?.tags).toEqual([ids.signature])
      // The earlier snapshot is immutable: it still names the tag.
      expect(Object.keys(before?.body?.tags ?? {})).toContain(ids.vegan)
      expect((await loadCurrentSnapshot(app, tenant, { menuId: menu.id, venueId }))?.id).toBe(
        result.snapshot.id,
      )
    })

    it('a tag change alone makes a new version, and restoring brings the tag back', async () => {
      const unchanged = await publish(15)
      expect(unchanged.status).toBe('unchanged')
      await applyEntry.restoreTag(app, tenant, { venueId, id: ids.vegan })
      const result = await publish(20)
      expect(result.status).toBe('published')
      expect(Object.keys(result.snapshot.body?.tags ?? {})).toContain(ids.vegan)
      expect(result.snapshot.body?.items[items[0]]?.tags).toEqual([ids.signature, ids.vegan].sort())
    })
  })

  it('keeps the tag table’s own row checks (a raw colour or an empty name is refused by the database)', async () => {
    await expect(
      owner.query(
        `insert into restro.tags (id, tenant_id, venue_id, label, color, sort_key)
         values ($1, $2, $3, '{"bg_BG":"X"}', '#ff0000', 'a0')`,
        [newId('tg'), tenant, venueId],
      ),
    ).rejects.toThrow(/tags_color_format/)
    await expect(
      owner.query(
        `insert into restro.tags (id, tenant_id, venue_id, label, color, sort_key)
         values ($1, $2, $3, '{}', 'accent', 'a0')`,
        [newId('tg'), tenant, venueId],
      ),
    ).rejects.toThrow(/tags_label_object/)
    // The composite foreign key: a tag cannot point at another tenant's venue.
    await expect(
      owner.query(
        `insert into restro.tags (id, tenant_id, venue_id, label, color, sort_key)
         values ($1, $2, $3, '{"bg_BG":"X"}', 'accent', 'a0')`,
        [newId('tg'), tenant, otherTenantVenueId],
      ),
    ).rejects.toThrow(/tags_venue_fk/)
  })

  it('has no way to delete a tag as the app role', async () => {
    const error = await withTenantWrite(app, tenant, (tx) =>
      tx.delete(tags).where(eq(tags.id, ids.signature as string)),
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).cause)).toMatch(/permission denied/)
  })
})
