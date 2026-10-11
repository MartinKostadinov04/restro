// Changing the barsy address of a connection that already holds a menu (brief CF-02, B1-F14):
// barsy ids are unique only per installation, so another installation's article 11 would land on
// our old item 11 and keep its photo and copy. The change is refused, before anything is written;
// with no menu yet it still resets the connection as before; the same address with new
// credentials is not a change. As the restro_app role, on a real Postgres.
import { generateKeyPairSync } from 'node:crypto'

import { type ChangeSet, newId } from '@restro/core'
import { apply, provisionMenu, provisionTenant, provisionVenue } from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { appDatabaseUrl, hasDatabase, openOwnerPool, testSlug } from '../test-database'
import {
  type IntegrationScope,
  type IntegrationServices,
  loadIntegrationView,
  saveConnection,
} from './service'

const keys = generateKeyPairSync('x25519')
const PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')
const PASSWORD = 'correct horse battery staple 8F3kZ'
const API_USER = 'api-user-for-tests'

describe.skipIf(!hasDatabase)('changing the host of a connection that holds a menu', () => {
  const tenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let scope: IntegrationScope
  const sent: string[] = []
  const services: IntegrationServices = {
    sealPublicKey: PUBLIC_KEY,
    enqueue: async (name) => {
      sent.push(name)
      return 'job-1'
    },
  }
  const connect = (host: string, password = PASSWORD) =>
    saveConnection(scope, services, { host, user: API_USER, password })

  const integrationRow = async () =>
    (
      await owner.query(
        'select id, host, status, credentials_sealed, config from restro.integrations where tenant_id = $1',
        [tenant],
      )
    ).rows[0] as {
      id: string
      host: string
      status: string
      credentials_sealed: string | null
      config: Record<string, unknown>
    }

  /** One barsy-linked item, as a pull leaves it. */
  async function linkAnItem(integrationId: string) {
    const node = newId('nd')
    const changeSet: ChangeSet = {
      id: newId('cs'),
      source: `till:${integrationId}`,
      jobId: newId('jb'),
      actor: `integration:${integrationId}`,
      observedAt: new Date().toISOString(),
      ops: [
        { op: 'createNode', id: node, nodeType: 'item', parent: null, status: 'active' },
        {
          op: 'linkSource',
          node: { id: node },
          link: { integration: integrationId, externalType: 'article', externalId: '11' },
        },
      ],
    }
    expect((await apply(app, tenant, changeSet)).rejected).toEqual([])
  }

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-web-host-change-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Host change club' })
    const venue = await provisionVenue(app, tenant, {
      name: 'Venue',
      slug: testSlug('host-change'),
    })
    await provisionMenu(app, tenant, venue.id)
    scope = { pool: app, tenantId: tenant, canManage: true }
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      for (const table of [
        'events',
        'field_values',
        'placements',
        'source_links',
        'menus',
        'nodes',
        'source_records',
        'job_runs',
        'barsy_venues',
        'integrations',
        'venues',
      ]) {
        await owner.query(`delete from restro.${table} where tenant_id = $1`, [tenant])
      }
      await owner.query('delete from restro.tenants where id = $1', [tenant])
      await owner.end()
    }
  })

  it('with no menu yet the host can be changed, as before', async () => {
    expect(await connect('first.barsyonline.com')).toEqual({ ok: true, queued: true })
    const before = await integrationRow()
    expect(before.host).toBe('first.barsyonline.com')

    expect(await connect('second.barsyonline.com')).toEqual({ ok: true, queued: true })
    const after = await integrationRow()
    expect(after).toMatchObject({ id: before.id, host: 'second.barsyonline.com', status: 'new' })
    expect(after.credentials_sealed).not.toBe(before.credentials_sealed)
  })

  it('same host with new credentials is allowed, with or without a menu', async () => {
    const before = await integrationRow()
    expect(await connect('second.barsyonline.com', 'another password 7Hq2mW')).toEqual({
      ok: true,
      queued: true,
    })
    const after = await integrationRow()
    expect(after.host).toBe('second.barsyonline.com')
    expect(after.credentials_sealed).not.toBe(before.credentials_sealed)
  })

  it('refuses a different host once the connection has any link, and writes nothing', async () => {
    const before = await integrationRow()
    await linkAnItem(before.id)
    // Something the host change would have reset: it must still be there afterwards.
    await owner.query(
      `update restro.integrations set config = config || '{"catalogue_trees": {"10": {"fetched_at": "2026-10-09T10:00:00Z", "categories": []}}, "sync": {"10": {"cursor": "2026-10-09T10:00:00Z"}}}'::jsonb where id = $1`,
      [before.id],
    )
    const withMenu = await integrationRow()
    sent.length = 0

    expect(await connect('third.barsyonline.com')).toEqual({
      ok: false,
      error: 'host_change_blocked',
    })

    const after = await integrationRow()
    expect(after).toEqual(withMenu)
    expect(after.host).toBe('second.barsyonline.com')
    expect(after.config).toHaveProperty('catalogue_trees')
    expect(after.config).toHaveProperty('sync')
    expect(sent).toEqual([])
  })

  it('same host with new credentials is still allowed while the connection holds a menu', async () => {
    const before = await integrationRow()
    expect(await connect('second.barsyonline.com', 'a third password 5Tn9xC')).toEqual({
      ok: true,
      queued: true,
    })
    const after = await integrationRow()
    expect(after.host).toBe('second.barsyonline.com')
    expect(after.credentials_sealed).not.toBe(before.credentials_sealed)
    // The menu's identity is untouched: the host did not change, so nothing was forgotten.
    expect(after.config).toHaveProperty('sync')
  })

  it('a link in any state blocks the change: missing and deleted links still hold items', async () => {
    const { id } = await integrationRow()
    await owner.query(
      `update restro.source_links set state = 'missing' where integration_id = $1`,
      [id],
    )
    expect(await connect('fourth.barsyonline.com')).toEqual({
      ok: false,
      error: 'host_change_blocked',
    })
    await owner.query(
      `update restro.source_links set state = 'deleted' where integration_id = $1`,
      [id],
    )
    expect(await connect('fourth.barsyonline.com')).toEqual({
      ok: false,
      error: 'host_change_blocked',
    })
    expect((await integrationRow()).host).toBe('second.barsyonline.com')
  })

  it('the view still loads for a connection whose change was refused', async () => {
    const view = await loadIntegrationView(scope, services)
    expect(view.integration?.host).toBe('second.barsyonline.com')
  })
})
