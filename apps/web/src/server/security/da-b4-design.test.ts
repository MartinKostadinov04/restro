// Designer audit, B4 (attack): the three design writes of the menu designer wave
// (`saveDesignAction`, `saveStyleAction`, `setStyleStatusAction`) attacked on a real Postgres as
// restro_app, with the attack world's two organisations. What the attack table does not try:
//   - another organisation's saved Style named by id in a save (the table's own comment says it
//     should, its entry passes `styleId: null`);
//   - a logo that is another tenant's stored image, a pending or failed one, one with no size, a
//     made-up one and malformed ids;
//   - a person with every permission at a venue (a manager or waiter's account) against the three;
//   - what a Style can carry from one venue to another (D128: never colours, roles, logo or body font).
// Red where the action does not refuse before the database does.
import { randomUUID } from 'node:crypto'

import { BASIC_DESIGN_VALUES, DEFAULT_DESIGN, newId, styleValuesOf } from '@restro/core'
import { PERMISSIONS } from '@restro/core/service'
import type { DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPool } from '../db'
import * as design from '../design/actions'
import { loadMyStyles } from '../design/styles'
import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import { asked, refusingFetch, seen } from './attack-session'
import {
  changedTables,
  fingerprint,
  removeOrgs,
  type SeededOrg,
  seedOrg,
} from './tests/attack-world'

vi.mock('@/server/session', async () => (await import('./attack-session')).sessionModule)
vi.mock('next/cache', async () => (await import('./attack-session')).cacheModule)
vi.mock('next/headers', async () => (await import('./attack-session')).headersModule)
vi.mock('next-intl/server', async () => (await import('./attack-session')).intlModule)
vi.mock('@/server/jobs', async () => (await import('./attack-session')).jobsModule)
vi.mock('@/server/log', async () => (await import('./attack-session')).logModule)

const DATABASE_REFUSAL = /Failed query|violates|duplicate key|permission denied|row-level security/

const as = (org: SeededOrg, role: 'owner' | 'admin' | 'member') => {
  const userId = role === 'owner' ? org.ownerId : role === 'admin' ? org.adminId : org.memberId
  asked.person = { userId, tenantId: org.tenantId, role, sessionId: `s-${userId}` }
}

/** An asset row of `tenantId`, in the state given. */
async function seedAsset(
  owner: pg.Pool,
  tenantId: string,
  state: 'stored' | 'stored-no-size' | 'pending' | 'failed',
): Promise<string> {
  const id = newId('as')
  const stored = state === 'stored' || state === 'stored-no-size'
  await owner.query(
    `insert into restro.assets
       (id, tenant_id, origin, checksum, content_type, width, height, storage_key, status)
     values ($1, $2, 'upload', $3, $4, $5, $6, $7, $8)`,
    [
      id,
      tenantId,
      stored ? randomUUID().replace(/-/g, '').repeat(2) : null,
      stored ? 'image/png' : null,
      state === 'stored' ? 200 : null,
      state === 'stored' ? 100 : null,
      stored ? `originals/${id}` : null,
      stored ? 'stored' : state,
    ],
  )
  return id
}

describe.skipIf(!hasDatabase)('B4: the design writes, attacked (as restro_app)', () => {
  let owner: pg.Pool
  let app: DbPool
  let victim: SeededOrg
  let attacker: SeededOrg

  beforeAll(async () => {
    useTestServerEnvironment()
    vi.stubGlobal('fetch', refusingFetch)
    owner = openOwnerPool()
    app = getPool()
    victim = await seedOrg(app, owner, 'VICTIMB4')
    attacker = await seedOrg(app, owner, 'ATTACKB4')
  }, 60_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    if (victim !== undefined && attacker !== undefined) await removeOrgs(owner, [victim, attacker])
    await owner?.end()
  }, 60_000)

  beforeEach(() => seen.reset())

  /** Calls `run` as the attacker's owner; answers what came back and what moved at the victim. */
  async function attack(run: () => Promise<unknown>) {
    as(attacker, 'owner')
    seen.reset()
    const before = await fingerprint(owner, victim.tenantId)
    const answer = await run()
    const moved = changedTables(before, await fingerprint(owner, victim.tenantId))
    return {
      answer,
      moved,
      leaked: JSON.stringify(answer ?? null).includes(victim.marker),
      databaseRefused: seen.errors.filter((line) => DATABASE_REFUSAL.test(line)),
    }
  }

  describe("organisation B against A's saved Style", () => {
    it("saveStyleAction naming A's Style id: refused by the action as not found, not by the database", async () => {
      const result = await attack(() =>
        design.saveStyleAction({
          styleId: victim.styleId,
          name: 'Attack replaces it',
          style: 'club',
          values: styleValuesOf(BASIC_DESIGN_VALUES),
        }),
      )
      expect(result.moved, "A's rows moved").toEqual([])
      expect(result.leaked).toBe(false)
      // What a save with an id means is "replace that one": an id this organisation does not hold
      // is unknown, as setStyleStatus answers it.
      expect(result.answer).toEqual({ ok: false, error: 'not_found' })
      expect(result.databaseRefused, 'the primary key refused it, not the action').toEqual([])
    })

    it("saveStyleAction with a made-up id of its own: an update of nothing creates a row with the caller's id", async () => {
      const madeUp = newId('ds')
      const result = await attack(() =>
        design.saveStyleAction({
          styleId: madeUp,
          name: 'Made-up id',
          style: 'basic',
          values: styleValuesOf(BASIC_DESIGN_VALUES),
        }),
      )
      expect(result.moved).toEqual([])
      // An id is the server's to make (`newId` when styleId is null); a named id it never made is unknown.
      expect(result.answer).toEqual({ ok: false, error: 'not_found' })
    })

    it("setStyleStatusAction on A's Style, both ways: not found, nothing moved", async () => {
      for (const status of ['removed', 'active'] as const) {
        const result = await attack(() =>
          design.setStyleStatusAction({ styleId: victim.styleId, status }),
        )
        expect(result.answer).toEqual({ ok: false, error: 'not_found' })
        expect(result.moved).toEqual([])
        expect(result.databaseRefused).toEqual([])
      }
    })

    it("B's My styles never shows A's Styles or venues", async () => {
      const mine = await loadMyStyles(app, attacker.tenantId, attacker.venues[0].id)
      expect(JSON.stringify(mine)).not.toContain(victim.marker)
      expect(JSON.stringify(mine)).not.toContain(victim.styleId)
    })
  })

  describe('the logo of a design save (setDesign: a stored image of this tenant)', () => {
    const save = (org: SeededOrg, logo: unknown) =>
      design.saveDesignAction({
        venueId: org.venues[0].id,
        expectedRevision: 0,
        design: { ...DEFAULT_DESIGN, logo_asset_id: logo },
      })

    it("A's stored image as B's logo: logo_not_usable, nothing moved, nothing written at B", async () => {
      const foreign = await seedAsset(owner, victim.tenantId, 'stored')
      const beforeB = await fingerprint(owner, attacker.tenantId)
      const result = await attack(() => save(attacker, foreign))
      expect(result.answer).toEqual({ ok: false, error: 'logo_not_usable' })
      expect(result.moved).toEqual([])
      expect(changedTables(beforeB, await fingerprint(owner, attacker.tenantId))).toEqual([])
    })

    for (const state of ['pending', 'failed', 'stored-no-size'] as const) {
      it(`B's own ${state} image: logo_not_usable`, async () => {
        const own = await seedAsset(owner, attacker.tenantId, state)
        const result = await attack(() => save(attacker, own))
        expect(result.answer).toEqual({ ok: false, error: 'logo_not_usable' })
      })
    }

    it('an id no one holds: logo_not_usable', async () => {
      const result = await attack(() => save(attacker, newId('as')))
      expect(result.answer).toEqual({ ok: false, error: 'logo_not_usable' })
    })

    for (const malformed of [
      'as_',
      'as_../../x',
      "as_x' or '1'='1",
      'vn_0000000000000000000000',
      `as_${'a'.repeat(5000)}`,
      42,
      { id: 'as_x' },
    ]) {
      it(`a malformed logo id (${String(malformed).slice(0, 24)}): invalid before any read`, async () => {
        const result = await attack(() => save(attacker, malformed))
        expect(result.answer).toEqual({ ok: false, error: 'invalid' })
        expect(result.databaseRefused).toEqual([])
      })
    }

    it("the positive control: B's own stored image is taken", async () => {
      const own = await seedAsset(owner, attacker.tenantId, 'stored')
      const result = await attack(() => save(attacker, own))
      expect(result.answer).toMatchObject({ ok: true })
    })
  })

  describe('a person with every permission at venue 1 (a manager or a waiter) against the three', () => {
    beforeAll(async () => {
      await owner.query('update restro.staff_members set user_id = $2 where id = $1', [
        victim.venues[0].staff,
        victim.memberId,
      ])
      await owner.query('update restro.venue_roles set permissions = $2::jsonb where id = $1', [
        victim.venues[0].role,
        JSON.stringify(PERMISSIONS),
      ])
    })

    const calls: readonly [string, (org: SeededOrg) => Promise<unknown>][] = [
      [
        'saveDesignAction',
        (org) =>
          design.saveDesignAction({
            venueId: org.venues[0].id,
            expectedRevision: 0,
            design: { ...DEFAULT_DESIGN, style: 'club' },
          }),
      ],
      [
        'saveStyleAction (new)',
        () =>
          design.saveStyleAction({
            styleId: null,
            name: 'Manager style',
            style: 'basic',
            values: styleValuesOf(BASIC_DESIGN_VALUES),
          }),
      ],
      [
        'saveStyleAction (replace)',
        (org) =>
          design.saveStyleAction({
            styleId: org.styleId,
            name: 'Manager renamed it',
            style: 'basic',
            values: styleValuesOf(BASIC_DESIGN_VALUES),
          }),
      ],
      [
        'setStyleStatusAction',
        (org) => design.setStyleStatusAction({ styleId: org.styleId, status: 'removed' }),
      ],
    ]
    for (const [name, call] of calls) {
      it(`${name}: forbidden, nothing moved`, async () => {
        as(victim, 'member')
        const before = await fingerprint(owner, victim.tenantId)
        const answer = await call(victim)
        expect(answer).toEqual({ ok: false, error: 'forbidden' })
        expect(changedTables(before, await fingerprint(owner, victim.tenantId))).toEqual([])
      })
    }
  })

  describe('what a Style carries (D128: never colours, roles, logo or the body font)', () => {
    it('a Style save with the body font, colours, a logo or roles is refused whole', async () => {
      as(attacker, 'owner')
      const values = styleValuesOf(BASIC_DESIGN_VALUES) as unknown as {
        general: Record<string, string>
      }
      const tries = [
        { ...values, general: { ...values.general, body_font: 'inter' } },
        { ...values, colors: { primary: '#000000', secondary: '#111111', tertiary: '#222222' } },
        { ...values, logo_asset_id: attacker.asset },
        { ...values, general: { ...values.general, heading_font: 'url(https://x.test/f.woff)' } },
      ]
      for (const bad of tries) {
        const answer = await design.saveStyleAction({
          styleId: null,
          name: 'Carrier',
          style: 'basic',
          values: bad,
        })
        expect(answer).toEqual({ ok: false, error: 'invalid' })
      }
    })

    it("another venue's design as a tile carries no colours, roles, logo or body font", async () => {
      as(attacker, 'owner')
      const logo = await seedAsset(owner, attacker.tenantId, 'stored')
      const branded = await design.saveDesignAction({
        venueId: attacker.venues[1].id,
        expectedRevision: 0,
        design: {
          ...DEFAULT_DESIGN,
          style: 'club',
          values: {
            ...BASIC_DESIGN_VALUES,
            general: { ...BASIC_DESIGN_VALUES.general, body_font: 'unbounded' },
          },
          colors: { primary: '#101010', secondary: '#202020', tertiary: '#c0ffee' },
          overrides: { light: { accent: '#c0ffee' } },
          logo_asset_id: logo,
        },
      })
      expect(branded).toMatchObject({ ok: true })
      const { venues } = await loadMyStyles(app, attacker.tenantId, attacker.venues[0].id)
      const tile = venues.find((venue) => venue.venueId === attacker.venues[1].id)
      expect(tile).toBeDefined()
      const text = JSON.stringify(tile?.values)
      expect(text).not.toContain('c0ffee')
      expect(text).not.toContain(logo)
      expect(text).not.toContain('body_font')
      expect(Object.keys(tile ?? {}).sort()).toEqual(['style', 'values', 'venueId', 'venueName'])
    })
  })
})
