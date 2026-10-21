// saveSyncSettingsConfig against Postgres as the restro_app role (brief S3-10, CF-09b): one atomic
// UPDATE that writes the schedule and never reads or writes `config.publish` (the publishing rules
// are per venue now; `publish.auto_paused` stays here), so a rollback (pause) or a manual publish
// (resume) that lands while a save is in flight is neither lost nor revived.
import { createPool, type DbPool, integrations, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../ids'
import { autoPublishPaused, parseSyncSettings, SYNC_DEFAULTS } from '../sync-settings'
import { provisionTenant } from './provision'
import { createIntegration, updateIntegration } from './sources'
import { saveSyncSettingsConfig, setAutoPublishPaused } from './sync-config'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool } from './test-database'

const SETTINGS = {
  schedule: {
    incremental_enabled: false,
    incremental_minutes: 15,
    full_pull_enabled: true,
    full_pull_time: '03:30',
  },
} as const

/** What a venue without rules of its own inherits: untouched by a save of the schedule. */
const INHERITED = { after_sync: 'manual', new_items: 'hold' } as const

describe.skipIf(!hasDatabase)('saving the sync settings (as the restro_app role)', () => {
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
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-save-settings-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Save settings club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    integrationId = (await createIntegration(app, tenant, { kind: 'barsy', host: 's.test' })).id
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  /**
   * Starts `save` while another transaction holds the integration's row lock, runs `meanwhile`
   * inside that transaction, then releases it. The save is the statement the lock makes wait: its
   * UPDATE meets the row after `meanwhile` changed it, which is exactly a rollback or a publish
   * landing between the form being loaded and being saved.
   */
  async function saveWhileLocked(meanwhile: string): Promise<boolean> {
    const holder = await owner.connect()
    try {
      await holder.query('begin')
      await holder.query('select 1 from restro.integrations where id = $1 for update', [
        integrationId,
      ])
      const save = saveSyncSettingsConfig(app, tenant, integrationId, SETTINGS)
      // Wait until the save's UPDATE is really waiting for the lock.
      const deadline = Date.now() + 10_000
      for (;;) {
        const { rows } = await owner.query<{ waiting: string }>(
          `select count(*) as waiting from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock'
             and query ilike 'update "restro"."integrations"%'`,
        )
        if (Number(rows[0]?.waiting) > 0) break
        if (Date.now() > deadline) throw new Error('the save never waited for the row lock')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      await holder.query(meanwhile, [integrationId])
      await holder.query('commit')
      return await save
    } finally {
      holder.release()
    }
  }

  it('writes the schedule as sent, and leaves the old publishing rule and every other key alone', async () => {
    await updateIntegration(app, tenant, integrationId, {
      config: {
        publish_after_sync: false,
        publish: INHERITED,
        price_source: 'current_price',
        not_used: { '3': true },
        sync: { '10': { cursor: '2026-10-09T10:00:00Z' } },
        schedule: { incremental_minutes: 30, stale_key: true },
      },
    })
    expect(await saveSyncSettingsConfig(app, tenant, integrationId, SETTINGS)).toBe(true)

    const config = await configOf()
    expect(config).toEqual({
      // The schedule is the form's, whole. The rules a venue inherits (and the flat key below
      // them) are not the form's any more: they stay exactly as they were.
      schedule: SETTINGS.schedule,
      publish: INHERITED,
      publish_after_sync: false,
      price_source: 'current_price',
      not_used: { '3': true },
      sync: { '10': { cursor: '2026-10-09T10:00:00Z' } },
    })
    expect(parseSyncSettings(config).schedule).toEqual(SETTINGS.schedule)
    expect(parseSyncSettings(config).publish).toEqual(INHERITED)
  })

  it('keeps a stored schedule time zone, which the form does not send (CF-16)', async () => {
    await updateIntegration(app, tenant, integrationId, {
      config: { schedule: { time_zone: 'Europe/London', stale_key: true } },
    })
    expect(await saveSyncSettingsConfig(app, tenant, integrationId, SETTINGS)).toBe(true)
    expect((await configOf())?.schedule).toEqual({
      ...SETTINGS.schedule,
      time_zone: 'Europe/London',
    })
  })

  it('leaves publish.auto_paused alone, set or not set, and the other publish keys', async () => {
    await updateIntegration(app, tenant, integrationId, { config: { publish: INHERITED } })
    expect(await setAutoPublishPaused(app, tenant, integrationId, true)).toBe(true)
    expect(await saveSyncSettingsConfig(app, tenant, integrationId, SETTINGS)).toBe(true)
    expect((await configOf())?.publish).toEqual({ ...INHERITED, auto_paused: true })

    expect(await setAutoPublishPaused(app, tenant, integrationId, false)).toBe(true)
    expect(await saveSyncSettingsConfig(app, tenant, integrationId, SETTINGS)).toBe(true)
    expect((await configOf())?.publish).toEqual(INHERITED)
    expect(autoPublishPaused(await configOf())).toBe(false)
  })

  it('a pause that lands while the save waits survives it', async () => {
    await updateIntegration(app, tenant, integrationId, { config: { publish: INHERITED } })
    const saved = await saveWhileLocked(
      `update restro.integrations
       set config = config || jsonb_build_object('publish',
         coalesce(config -> 'publish', '{}'::jsonb) || '{"auto_paused": true}'::jsonb)
       where id = $1`,
    )
    expect(saved).toBe(true)
    expect(autoPublishPaused(await configOf())).toBe(true)
    expect((await configOf())?.publish).toEqual({ ...INHERITED, auto_paused: true })
  })

  it('a pause cleared while the save waits is not revived by it', async () => {
    await updateIntegration(app, tenant, integrationId, {
      config: { publish: { ...INHERITED, auto_paused: true } },
    })
    const saved = await saveWhileLocked(
      `update restro.integrations
       set config = config || jsonb_build_object('publish', (config -> 'publish') - 'auto_paused')
       where id = $1`,
    )
    expect(saved).toBe(true)
    expect(autoPublishPaused(await configOf())).toBe(false)
    expect((await configOf())?.publish).toEqual(INHERITED)
  })

  it('does not touch a publish value that is not an object (the form never writes it)', async () => {
    await updateIntegration(app, tenant, integrationId, { config: { publish: 'broken' } })
    expect(await saveSyncSettingsConfig(app, tenant, integrationId, SETTINGS)).toBe(true)
    expect((await configOf())?.publish).toBe('broken')
  })

  it('puts the default schedule back when it is saved', async () => {
    await updateIntegration(app, tenant, integrationId, {
      config: { publish: null, publish_after_sync: null },
    })
    expect(
      await saveSyncSettingsConfig(app, tenant, integrationId, {
        schedule: SYNC_DEFAULTS.schedule,
      }),
    ).toBe(true)
    expect(parseSyncSettings(await configOf())).toEqual(SYNC_DEFAULTS)
  })

  it('does nothing for an unknown integration or another tenant, and checks its input', async () => {
    expect(await saveSyncSettingsConfig(app, tenant, newId('in'), SETTINGS)).toBe(false)
    expect(await saveSyncSettingsConfig(app, otherTenant, integrationId, SETTINGS)).toBe(false)
    await expect(
      saveSyncSettingsConfig(app, 'tn_nope', integrationId, SETTINGS),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(saveSyncSettingsConfig(app, tenant, 'nope', SETTINGS)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    // The form's own limits apply here too, so a caller cannot store a value the worker would not read.
    await expect(
      saveSyncSettingsConfig(app, tenant, integrationId, {
        schedule: { ...SETTINGS.schedule, incremental_minutes: 7 as never },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    // The publishing rules are per venue: this writer no longer takes them, nor the pause.
    await expect(
      saveSyncSettingsConfig(app, tenant, integrationId, {
        ...SETTINGS,
        publish: { after_sync: 'auto', new_items: 'show' },
      } as never),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      saveSyncSettingsConfig(app, tenant, integrationId, {
        ...SETTINGS,
        publish: { auto_paused: true },
      } as never),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})
