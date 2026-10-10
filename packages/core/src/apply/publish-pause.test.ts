// setAutoPublishPaused against Postgres as the restro_app role (brief S3-05): the flag lives at
// config.publish.auto_paused, touches nothing else, and is tenant-scoped.
import { createPool, type DbPool, integrations, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../ids'
import { autoPublishPaused } from '../sync-settings'
import { provisionTenant } from './provision'
import { createIntegration, updateIntegration } from './sources'
import { setAutoPublishPaused } from './sync-config'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool } from './test-database'

describe.skipIf(!hasDatabase)('the automatic-publish pause (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let integrationId: string

  const configOf = async (): Promise<Record<string, unknown> | undefined> =>
    (
      await withTenant(app, tenant, (tx) =>
        tx.select().from(integrations).where(eq(integrations.id, integrationId)),
      )
    )[0]?.config as Record<string, unknown> | undefined

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-pause-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Pause test club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    integrationId = (await createIntegration(app, tenant, { kind: 'barsy', host: 'p.test' })).id
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  it('pauses and resumes, keeping the other publish settings and every other key', async () => {
    await updateIntegration(app, tenant, integrationId, {
      config: {
        price_source: 'current_price',
        publish: { after_sync: 'manual', new_items: 'hold' },
        sync: { '10': { cursor: '2026-10-09T10:00:00Z' } },
      },
    })
    expect(autoPublishPaused(await configOf())).toBe(false)

    expect(await setAutoPublishPaused(app, tenant, integrationId, true)).toBe(true)
    expect(await configOf()).toEqual({
      price_source: 'current_price',
      publish: { after_sync: 'manual', new_items: 'hold', auto_paused: true },
      sync: { '10': { cursor: '2026-10-09T10:00:00Z' } },
    })
    expect(autoPublishPaused(await configOf())).toBe(true)

    // Pausing twice is the same as once.
    expect(await setAutoPublishPaused(app, tenant, integrationId, true)).toBe(true)
    expect((await configOf())?.publish).toEqual({
      after_sync: 'manual',
      new_items: 'hold',
      auto_paused: true,
    })

    expect(await setAutoPublishPaused(app, tenant, integrationId, false)).toBe(true)
    expect((await configOf())?.publish).toEqual({ after_sync: 'manual', new_items: 'hold' })
    expect(autoPublishPaused(await configOf())).toBe(false)
    // Resuming what is not paused changes nothing.
    expect(await setAutoPublishPaused(app, tenant, integrationId, false)).toBe(true)
    expect((await configOf())?.publish).toEqual({ after_sync: 'manual', new_items: 'hold' })
  })

  it('works on a config with no publish settings, and on a damaged one', async () => {
    await updateIntegration(app, tenant, integrationId, { config: { publish: null } })
    expect(await setAutoPublishPaused(app, tenant, integrationId, true)).toBe(true)
    expect((await configOf())?.publish).toEqual({ auto_paused: true })
    await setAutoPublishPaused(app, tenant, integrationId, false)
    expect((await configOf())?.publish).toEqual({})

    await updateIntegration(app, tenant, integrationId, { config: { publish: 'broken' } })
    expect(await setAutoPublishPaused(app, tenant, integrationId, true)).toBe(true)
    expect((await configOf())?.publish).toEqual({ auto_paused: true })
  })

  it('does nothing for an unknown integration or another tenant, and checks its input', async () => {
    expect(await setAutoPublishPaused(app, tenant, newId('in'), true)).toBe(false)
    expect(await setAutoPublishPaused(app, otherTenant, integrationId, true)).toBe(false)
    await expect(setAutoPublishPaused(app, 'tn_nope', integrationId, true)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(setAutoPublishPaused(app, tenant, 'nope', true)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
