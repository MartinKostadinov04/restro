// The venue's template and guest services (brief SH-01 §9–11): the writers `setVenuePresentation`
// and `setGuestFeatures`, and the publisher writing `presentation` and `features` into the
// snapshot. Postgres as restro_app.
import { createPool, type DbPool, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { type NodeId, newId } from '../ids'
import { DEFAULT_GUEST_FEATURES, type GuestFeatures } from '../theme'
import { apply } from './apply'
import { GuestFeaturesError, setGuestFeatures } from './guest-features'
import * as applyEntry from './index'
import { setVenuePresentation, VenuePresentationError } from './presentation'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { publishMenu } from './publish'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

const PRESENTATION = { face: 'editorial-market', options: { layout: 'two', compact: true } }
const FEATURES: GuestFeatures = {
  filters: true,
  call_waiter: { enabled: true, kinds: ['other', 'bill', 'waiter'] },
  bill: true,
  ordering: false,
  pay: false,
}
const CANONICAL: GuestFeatures = {
  ...FEATURES,
  call_waiter: { enabled: true, kinds: ['waiter', 'bill', 'other'] },
}

describe('module boundary', () => {
  it('exports the writers from @restro/core/apply', () => {
    expect(Object.keys(applyEntry)).toEqual(
      expect.arrayContaining(['setVenuePresentation', 'setGuestFeatures', 'setVenueTheme']),
    )
  })
})

describe('input checks (no database needed)', () => {
  it.each([
    ['a malformed venue id', { venueId: 'vn_nope', presentation: null }],
    [
      'an upper-case face',
      { venueId: newId('vn'), presentation: { face: 'Editorial', options: {} } },
    ],
    [
      'an option value with a space',
      { venueId: newId('vn'), presentation: { face: 'f', options: { layout: 'two up' } } },
    ],
    ['an unknown field', { venueId: newId('vn'), presentation: null, features: null }],
  ])('setVenuePresentation refuses %s', async (_label, input) => {
    await expect(
      setVenuePresentation({} as DbPool, newId('tn'), input as never),
    ).rejects.toMatchObject({ name: 'VenuePresentationError', code: 'invalid_input' })
  })

  it.each([
    ['a malformed venue id', { venueId: 'vn_nope', features: null }],
    ['a missing switch', { venueId: newId('vn'), features: { filters: true } }],
    [
      'an unknown request kind',
      {
        venueId: newId('vn'),
        features: { ...DEFAULT_GUEST_FEATURES, call_waiter: { enabled: true, kinds: ['taxi'] } },
      },
    ],
    [
      'a repeated request kind',
      {
        venueId: newId('vn'),
        features: {
          ...DEFAULT_GUEST_FEATURES,
          call_waiter: { enabled: true, kinds: ['bill', 'bill'] },
        },
      },
    ],
  ])('setGuestFeatures refuses %s', async (_label, input) => {
    await expect(setGuestFeatures({} as DbPool, newId('tn'), input as never)).rejects.toMatchObject(
      {
        name: 'GuestFeaturesError',
        code: 'invalid_input',
      },
    )
  })
})

describe.skipIf(!hasDatabase)('presentation and guest features against Postgres', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: `vn_${string}`
  let menu: ProvisionedMenu
  const water = newId('nd') as NodeId
  const soda = newId('nd') as NodeId

  const settingsOf = async () =>
    (
      await withTenant(app, tenant, (tx) => tx.select().from(venues).where(eq(venues.id, venueId)))
    )[0]?.settings

  const publish = (minutes: number) =>
    publishMenu(
      app,
      tenant,
      { menuId: menu.id, venueId, reason: 'manual', actor: 'user:us_test' },
      { now: new Date(Date.parse('2026-10-11T18:00:00Z') + minutes * 60_000) },
    )

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-presentation-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Template test club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('main') }))
      .id as `vn_${string}`
    menu = await provisionMenu(app, tenant, venueId)
    const section = newId('nd')
    const manual = (node: string, fieldKey: string, value: unknown) => ({
      op: 'setField',
      node: { id: node },
      fieldKey,
      layer: 'manual',
      scope: 'master',
      value,
    })
    const result = await apply(app, tenant, {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_test',
      observedAt: new Date().toISOString(),
      ops: [
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: menu.id },
          status: 'active',
          sortKey: 'end',
        },
        manual(section, 'title', { bg_BG: 'Бар', en_US: 'Bar' }),
        ...[water, soda].flatMap((item, index) => [
          { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
          manual(
            item,
            'name',
            index === 0 ? { bg_BG: 'Вода', en_US: 'Water' } : { bg_BG: 'Сода', en_US: 'Soda' },
          ),
          manual(item, 'price', { amount_minor: 300 + index * 100, currency: 'EUR' }),
          manual(item, 'allergens', []),
          // Rule 3's leak guard: internal notes that read exactly like an option value and a
          // request kind the venue publishes. They must not block the publish.
          manual(item, 'internal_note', index === 0 ? 'two' : 'bill'),
          { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
        ]),
      ],
    } as ChangeSet)
    expect(result.rejected).toEqual([])
  })
  afterAll(async () => {
    if (owner) await cleanUp(owner, [tenant, otherTenant])
    await owner?.end()
    await app?.end()
  })

  it('publishes the default services and no template while the venue has chosen none', async () => {
    const first = await publish(0)
    expect(first.status).toBe('published')
    expect(first.snapshot.body?.features).toEqual(DEFAULT_GUEST_FEATURES)
    expect(first.snapshot.body).not.toHaveProperty('presentation')
  })

  it('saves the template, keeps other settings, is idempotent, and publishes it', async () => {
    await owner.query(
      `update restro.venues set settings = settings || '{"other": 1}'::jsonb where id = $1`,
      [venueId],
    )
    expect(
      await setVenuePresentation(app, tenant, { venueId, presentation: PRESENTATION }),
    ).toEqual(PRESENTATION)
    expect(await settingsOf()).toEqual({ other: 1, presentation: PRESENTATION })
    expect(
      await setVenuePresentation(app, tenant, { venueId, presentation: PRESENTATION }),
    ).toEqual(PRESENTATION)
    expect(await settingsOf()).toEqual({ other: 1, presentation: PRESENTATION })

    const published = await publish(10)
    expect(published.status).toBe('published')
    // The internal note "two" is no leak: "two" is the venue's own option value.
    expect(published.snapshot.body?.presentation).toEqual(PRESENTATION)
    expect((await publish(11)).status).toBe('unchanged')
  })

  it('saves the services in vocabulary order, keeps other settings, is idempotent, and publishes them', async () => {
    expect(await setGuestFeatures(app, tenant, { venueId, features: FEATURES })).toEqual(CANONICAL)
    expect(await settingsOf()).toEqual({
      other: 1,
      presentation: PRESENTATION,
      guest_features: CANONICAL,
    })
    expect(await setGuestFeatures(app, tenant, { venueId, features: CANONICAL })).toEqual(CANONICAL)
    expect(await settingsOf()).toMatchObject({ guest_features: CANONICAL })

    const published = await publish(20)
    expect(published.status).toBe('published')
    // The internal note "bill" is no leak: "bill" is a request kind and a service.
    expect(published.snapshot.body?.features).toEqual(CANONICAL)
    expect(published.snapshot.body?.presentation).toEqual(PRESENTATION)
  })

  it("refuses an unknown venue and never writes another tenant's venue", async () => {
    for (const [forTenant, id] of [
      [tenant, newId('vn')],
      [otherTenant, venueId],
    ] as const) {
      await expect(
        setVenuePresentation(app, forTenant, { venueId: id, presentation: PRESENTATION }),
      ).rejects.toMatchObject({ name: 'VenuePresentationError', code: 'venue_not_found' })
      await expect(
        setGuestFeatures(app, forTenant, { venueId: id, features: DEFAULT_GUEST_FEATURES }),
      ).rejects.toMatchObject({ name: 'GuestFeaturesError', code: 'venue_not_found' })
    }
    await expect(
      setVenuePresentation(app, otherTenant, { venueId, presentation: null }),
    ).rejects.toBeInstanceOf(VenuePresentationError)
    await expect(
      setGuestFeatures(app, otherTenant, { venueId, features: null }),
    ).rejects.toBeInstanceOf(GuestFeaturesError)
    expect(await settingsOf()).toMatchObject({
      presentation: PRESENTATION,
      guest_features: CANONICAL,
    })
  })

  it('goes back to the defaults with null, leaving other settings alone', async () => {
    expect(await setGuestFeatures(app, tenant, { venueId, features: null })).toEqual(
      DEFAULT_GUEST_FEATURES,
    )
    expect(await setVenuePresentation(app, tenant, { venueId, presentation: null })).toBeNull()
    expect(await settingsOf()).toEqual({ other: 1 })
    const reset = await publish(40)
    expect(reset.snapshot.body?.features).toEqual(DEFAULT_GUEST_FEATURES)
    expect(reset.snapshot.body).not.toHaveProperty('presentation')
  })
})
