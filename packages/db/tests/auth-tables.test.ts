// Integration tests on a real Postgres for the Better Auth tables (brief S1-05): they are system
// tables, so the app role uses them with no tenant set, an organisation id must be a tenant id,
// and DELETE exists only where a kept flow needs it.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { appDatabaseUrl, hasDatabase, openOwnerPool, testId } from './database'

const PERMISSION_DENIED = /permission denied/

describe.skipIf(!hasDatabase)('the Better Auth tables (system tables)', () => {
  const organization = testId('tn')
  const userId = `auth-test-${testId('us')}`
  const memberId = `auth-test-${testId('mb')}`
  const sessionId = `auth-test-${testId('ss')}`
  let owner: pg.Pool
  let app: pg.Client

  beforeAll(async () => {
    owner = await openOwnerPool()
    app = new pg.Client({ connectionString: appDatabaseUrl() })
    await app.connect()
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await owner.query('delete from restro.auth_member where id = $1', [memberId])
      await owner.query('delete from restro.auth_organization where id = $1', [organization])
      await owner.query('delete from restro.auth_user where id = $1', [userId])
      await owner.end()
    }
  })

  it('lets the app role create a user, an organisation and a membership with no tenant set', async () => {
    await app.query("insert into restro.auth_user (id, name, email) values ($1, 'Test', $2)", [
      userId,
      `${userId}@example.test`,
    ])
    await app.query(
      "insert into restro.auth_organization (id, name, slug) values ($1, 'Org', $1)",
      [organization],
    )
    await app.query(
      "insert into restro.auth_member (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')",
      [memberId, organization, userId],
    )
    const { rows } = await app.query(
      'select role from restro.auth_member where organization_id = $1',
      [organization],
    )
    expect(rows).toEqual([{ role: 'owner' }])
  })

  it('refuses an organisation id that is not a tenant id (tn_ + base62)', async () => {
    await expect(
      app.query(
        "insert into restro.auth_organization (id, name, slug) values ('org_x', 'Bad', 'bad')",
      ),
    ).rejects.toThrow(/auth_organization_id_is_tenant_id/)
  })

  it('refuses a second membership of the same person in the same organisation', async () => {
    await expect(
      app.query(
        'insert into restro.auth_member (id, organization_id, user_id) values ($1, $2, $3)',
        [`${memberId}-again`, organization, userId],
      ),
    ).rejects.toThrow(/auth_member_organization_id_user_id_unique/)
  })

  it('lets the app role delete a session (sign-out) but nothing else', async () => {
    await app.query(
      `insert into restro.auth_session (id, expires_at, token, user_id)
       values ($1, now() + interval '1 day', $1, $2)`,
      [sessionId, userId],
    )
    const deleted = await app.query('delete from restro.auth_session where id = $1', [sessionId])
    expect(deleted.rowCount).toBe(1)

    await expect(app.query('delete from restro.auth_user where id = $1', [userId])).rejects.toThrow(
      PERMISSION_DENIED,
    )
    await expect(
      app.query('delete from restro.auth_organization where id = $1', [organization]),
    ).rejects.toThrow(PERMISSION_DENIED)
    await expect(
      app.query('delete from restro.auth_member where id = $1', [memberId]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })
})
