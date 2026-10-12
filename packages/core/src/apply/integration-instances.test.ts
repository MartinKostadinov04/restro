// Integration tests of the writers behind Settings › Integrations (adjustments I1, D81), as the
// restro_app role on a real Postgres: the systems an organisation chose (`setOrganizationSystems`,
// refused for a system that still has instances) and removing an instance (`removeIntegration`,
// refused while a venue links to it; the row stays), with tenants kept apart.
import { createPool, type DbPool, integrations, tenants, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../ids'
import { mapBarsyVenue, upsertBarsyVenues } from './barsy-venues'
import { readOrganizationSystems, setOrganizationSystems } from './organization'
import { provisionTenant, provisionVenue } from './provision'
import { createIntegration, removeIntegration, updateIntegration } from './sources'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe.skipIf(!hasDatabase)('systems and instances of an organisation (as restro_app)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-instance-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Instances club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  const settingsOf = async (tenantId: string) =>
    (
      await withTenant(app, tenantId, (tx) =>
        tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)),
      )
    )[0]?.settings
  const rowOf = async (id: string) =>
    (
      await withTenant(app, tenant, (tx) =>
        tx.select().from(integrations).where(eq(integrations.id, id)),
      )
    )[0]

  describe('setOrganizationSystems', () => {
    it('starts with no system chosen', async () => {
      expect(await readOrganizationSystems(app, tenant)).toEqual([])
    })

    it('saves the chosen systems, keeps the other settings, and reads them back', async () => {
      await owner.query(
        `update restro.tenants set settings = settings || '{"other": {"kept": true}}'::jsonb where id = $1`,
        [tenant],
      )
      expect(await setOrganizationSystems(app, tenant, ['barsy'])).toEqual({
        ok: true,
        systems: ['barsy'],
      })
      expect(await readOrganizationSystems(app, tenant)).toEqual(['barsy'])
      expect(await settingsOf(tenant)).toEqual({ systems: ['barsy'], other: { kept: true } })
      // Saving again changes nothing; unselecting a system with no instance is fine.
      expect(await setOrganizationSystems(app, tenant, ['barsy'])).toMatchObject({ ok: true })
      expect(await setOrganizationSystems(app, tenant, [])).toEqual({ ok: true, systems: [] })
      expect(await readOrganizationSystems(app, tenant)).toEqual([])
      expect(await settingsOf(tenant)).toEqual({ systems: [], other: { kept: true } })
    })

    it('accepts only known system kinds, each once', async () => {
      for (const bad of [['nope'], ['barsy', 'barsy'], ['BARSY'], [''], [1 as never]]) {
        expect(await setOrganizationSystems(app, tenant, bad)).toEqual({
          ok: false,
          error: 'invalid_input',
        })
      }
      expect(await setOrganizationSystems(app, tenant, 'barsy' as never)).toEqual({
        ok: false,
        error: 'invalid_input',
      })
      // Nothing of the refused input was saved.
      expect(await readOrganizationSystems(app, tenant)).toEqual([])
      await expect(setOrganizationSystems(app, 'tn_nope', ['barsy'])).rejects.toMatchObject({
        code: 'invalid_input',
      })
    })

    it('refuses to unselect a system that still has instances, and allows it once they are removed', async () => {
      await setOrganizationSystems(app, tenant, ['barsy'])
      const instance = await createIntegration(app, tenant, { kind: 'barsy', host: 'systems.test' })
      expect(await setOrganizationSystems(app, tenant, [])).toEqual({
        ok: false,
        error: 'has_instances',
      })
      expect(await readOrganizationSystems(app, tenant)).toEqual(['barsy'])
      expect(await removeIntegration(app, tenant, instance.id)).toEqual({ ok: true })
      expect(await setOrganizationSystems(app, tenant, [])).toEqual({ ok: true, systems: [] })
    })

    it('keeps tenants apart', async () => {
      await setOrganizationSystems(app, otherTenant, ['barsy'])
      expect(await readOrganizationSystems(app, otherTenant)).toEqual(['barsy'])
      expect(await readOrganizationSystems(app, tenant)).toEqual([])
      // Another tenant's instance does not block this tenant's change.
      await createIntegration(app, otherTenant, { kind: 'barsy', host: 'elsewhere.test' })
      expect(await setOrganizationSystems(app, tenant, ['barsy'])).toMatchObject({ ok: true })
      expect(await readOrganizationSystems(app, otherTenant)).toEqual(['barsy'])
    })

    it('reads a damaged stored list as what it holds that is known', async () => {
      await owner.query(
        `update restro.tenants set settings = jsonb_build_object('systems', '["barsy","nope",3]'::jsonb) where id = $1`,
        [tenant],
      )
      expect(await readOrganizationSystems(app, tenant)).toEqual(['barsy'])
      await owner.query(
        `update restro.tenants set settings = '{"systems": "barsy"}'::jsonb where id = $1`,
        [tenant],
      )
      expect(await readOrganizationSystems(app, tenant)).toEqual([])
    })
  })

  describe('removeIntegration', () => {
    it('hides an instance for good: it is marked, never erased, and its credentials stay', async () => {
      const id = newId('in')
      await createIntegration(app, tenant, {
        kind: 'barsy',
        host: 'remove.test',
        id,
        name: 'barsy – Remove me',
        credentialsSealed: 'rs1.AAAA',
      })
      expect(await rowOf(id)).toMatchObject({ removedAt: null })
      expect(await removeIntegration(app, tenant, id)).toEqual({ ok: true })
      const removed = await rowOf(id)
      expect(removed?.removedAt).toBeInstanceOf(Date)
      expect(removed).toMatchObject({
        name: 'barsy – Remove me',
        host: 'remove.test',
        credentialsSealed: 'rs1.AAAA',
      })
      // Removed already: it is not there any more.
      expect(await removeIntegration(app, tenant, id)).toEqual({
        ok: false,
        error: 'unknown_integration',
      })
    })

    it('says unknown_integration for an instance that does not exist or is another tenant’s', async () => {
      expect(await removeIntegration(app, tenant, newId('in'))).toEqual({
        ok: false,
        error: 'unknown_integration',
      })
      const theirs = await createIntegration(app, otherTenant, {
        kind: 'barsy',
        host: 'theirs.test',
      })
      expect(await removeIntegration(app, tenant, theirs.id)).toEqual({
        ok: false,
        error: 'unknown_integration',
      })
      expect(
        (
          await withTenant(app, otherTenant, (tx) =>
            tx.select().from(integrations).where(eq(integrations.id, theirs.id)),
          )
        )[0]?.removedAt,
      ).toBeNull()
      await expect(removeIntegration(app, tenant, 'in_nope')).rejects.toMatchObject({
        code: 'invalid_input',
      })
      await expect(removeIntegration(app, 'tn_nope', newId('in'))).rejects.toMatchObject({
        code: 'invalid_input',
      })
    })

    it('is refused while a venue links to the instance, and works once the link is gone', async () => {
      const instance = await createIntegration(app, tenant, { kind: 'barsy', host: 'linked.test' })
      await upsertBarsyVenues(app, tenant, instance.id, [
        { bid: 1, name: 'Main bar' },
        { bid: 2, name: 'Roof' },
      ])
      // A till venue that serves no venue does not block.
      const venue = await provisionVenue(app, tenant, {
        name: 'Linked venue',
        slug: testSlug('linked-venue'),
      })
      expect(await mapBarsyVenue(app, tenant, instance.id, 1, venue.id)).toMatchObject({ ok: true })
      expect(await removeIntegration(app, tenant, instance.id)).toEqual({
        ok: false,
        error: 'has_venues',
      })
      expect((await rowOf(instance.id))?.removedAt).toBeNull()
      // Freed by linking the venue elsewhere: the first instance has no venue left.
      const other = await createIntegration(app, tenant, { kind: 'barsy', host: 'other.test' })
      await upsertBarsyVenues(app, tenant, other.id, [{ bid: 7, name: 'Elsewhere' }])
      expect(await mapBarsyVenue(app, tenant, other.id, 7, venue.id)).toMatchObject({ ok: true })
      expect(await removeIntegration(app, tenant, instance.id)).toEqual({ ok: true })
      // The new home of the venue now blocks.
      expect(await removeIntegration(app, tenant, other.id)).toEqual({
        ok: false,
        error: 'has_venues',
      })
    })
  })

  describe('createIntegration and removed instances', () => {
    it('makes a new instance for a host whose instance was removed, and leaves the old row alone', async () => {
      const first = await createIntegration(app, tenant, { kind: 'barsy', host: 'again.test' })
      expect(await removeIntegration(app, tenant, first.id)).toEqual({ ok: true })
      const second = await createIntegration(app, tenant, { kind: 'barsy', host: 'again.test' })
      expect(second).toMatchObject({ created: true, host: 'again.test' })
      expect(second.id).not.toBe(first.id)
      expect((await rowOf(first.id))?.removedAt).toBeInstanceOf(Date)
      expect((await rowOf(second.id))?.removedAt).toBeNull()
      // A second attempt for the live host finds the live instance.
      expect(await createIntegration(app, tenant, { kind: 'barsy', host: 'again.test' })).toEqual({
        ...second,
        created: false,
      })
    })

    it('still lets the worker update a removed instance (a job queued before the removal)', async () => {
      const instance = await createIntegration(app, tenant, { kind: 'barsy', host: 'late.test' })
      await removeIntegration(app, tenant, instance.id)
      expect(
        await updateIntegration(app, tenant, instance.id, { status: 'connected' }),
      ).toMatchObject({ status: 'connected' })
    })
  })
})
