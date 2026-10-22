// Set-up shared by the integration tests of the service path (they need a real Postgres; see
// ../apply/test-database.ts). It lives outside core/service because it writes service tables
// directly, which the write-target guard rightly forbids every non-test file there. One world per test file: a tenant with its Better Auth organisation,
// a venue with an area and tables, and helpers that seed what #72 and the commands will write
// later (people, roles, shared devices, sittings, sent orders). Seeds go in through the owner pool:
// they stand in for writers that don't exist yet, never for the service path under test.
import { createPool, type DbPool } from '@restro/db'
import type pg from 'pg'

import { provisionTenant, provisionVenue } from '../apply/provision'
import { createArea, createTable } from '../apply/tables'
import { appDatabaseUrl, cleanUp, openOwnerPool, testSlug } from '../apply/test-database'
import { newId } from '../ids'
import { serviceDate } from '../service-day'

/** The provenance of seeded rows. */
const SEED = ['restro', 'system', 'test-seed'] as const

/** One test file's tenant, venue and tables, and the helpers that seed the rest. */
export interface ServiceWorld {
  readonly app: DbPool
  readonly owner: pg.Pool
  readonly tenantId: string
  readonly venueId: string
  /** Four tables of the venue, in creation order. */
  readonly tables: readonly string[]
  /** An account (auth_user), a member of the organisation when `role` is given. */
  addUser(role?: string): Promise<string>
  /** A person with a role at the venue holding `permissions`; linked to an account if given. */
  addStaff(permissions: readonly string[], userId?: string): Promise<string>
  /** A shared device of the venue signed in with `sessionId`. */
  addSharedDevice(sessionId: string): Promise<string>
  /** A grant to Restro's admin team for this account. */
  addOperator(userId: string, revoked?: boolean): Promise<void>
  /** Opens a sitting on the table (what `table.open` will do) and returns its id. */
  openSitting(tableId: string, serviceDate?: string): Promise<string>
  /** A sent order of the table's open sitting, made by `actionId`. */
  addSentOrder(input: {
    readonly tableId: string
    readonly sittingId: string
    readonly actionId: string
    readonly reference: string
    readonly serviceDate?: string
  }): Promise<string>
  /** Removes everything this world made. */
  close(): Promise<void>
}

/** Builds a world named `name` (used in the venue's slug and the pool's application name). */
export async function openServiceWorld(name: string): Promise<ServiceWorld> {
  const owner = openOwnerPool()
  const app = createPool(appDatabaseUrl(), { applicationName: `restro-core-${name}-tests` })
  const tenantId = newId('tn')
  const users: string[] = []

  await provisionTenant(app, { tenantId, name: `Service ${name}` })
  // The tenant id is the Better Auth organisation id (D122 §7): owners and admins are its members.
  await owner.query('insert into restro.auth_organization (id, name, slug) values ($1, $2, $1)', [
    tenantId,
    `Service ${name}`,
  ])
  const venue = await provisionVenue(app, tenantId, { name: 'Club', slug: testSlug(name) })
  const area = await createArea(app, tenantId, venue.id, 'Hall')
  if (!area.ok) throw new Error(`area refused: ${JSON.stringify(area)}`)
  const tables: string[] = []
  for (const number of ['1', '2', '3', '4']) {
    const table = await createTable(app, tenantId, { areaId: area.area.id, name: null, number })
    if (!table.ok) throw new Error(`table refused: ${JSON.stringify(table)}`)
    tables.push(table.table.id)
  }

  const today = (): string => serviceDate(new Date(), venue.timezone, venue.serviceDayEndsAt)

  return {
    app,
    owner,
    tenantId,
    venueId: venue.id,
    tables,

    async addUser(role) {
      const userId = `svc-${newId('us').slice(3)}`
      users.push(userId)
      await owner.query('insert into restro.auth_user (id, name, email) values ($1, $2, $3)', [
        userId,
        'Test person',
        `${userId}@example.test`,
      ])
      if (role !== undefined) {
        await owner.query(
          'insert into restro.auth_member (id, organization_id, user_id, role) values ($1, $2, $3, $4)',
          [`mb-${userId}`, tenantId, userId, role],
        )
      }
      return userId
    },

    async addStaff(permissions, userId) {
      const staffMemberId = newId('sm')
      const roleId = newId('rl')
      await owner.query(
        `insert into restro.staff_members (id, tenant_id, display_name, user_id, source, actor, job_id)
         values ($1, $2, 'Waiter', $3, $4, $5, $6)`,
        [staffMemberId, tenantId, userId ?? null, ...SEED],
      )
      await owner.query(
        `insert into restro.venue_roles (id, tenant_id, venue_id, name, permissions, source, actor, job_id)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
        [
          roleId,
          tenantId,
          venue.id,
          `Role ${roleId.slice(3, 9)}`,
          JSON.stringify(permissions),
          ...SEED,
        ],
      )
      await owner.query(
        `insert into restro.staff_assignments (tenant_id, staff_member_id, venue_id, role_id, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, staffMemberId, venue.id, roleId, ...SEED],
      )
      return staffMemberId
    },

    async addSharedDevice(sessionId) {
      const id = newId('dv')
      await owner.query(
        `insert into restro.shared_devices (id, tenant_id, venue_id, name, session_id, source, actor, job_id)
         values ($1, $2, $3, 'Bar tablet', $4, $5, $6, $7)`,
        [id, tenantId, venue.id, sessionId, ...SEED],
      )
      return id
    },

    async addOperator(userId, revoked = false) {
      await owner.query(
        `insert into restro.operators (user_id, granted_by, revoked_at)
         values ($1, 'test', case when $2 then now() else null end)`,
        [userId, revoked],
      )
    },

    async openSitting(tableId, serviceDate = today()) {
      const id = newId('st')
      await owner.query(
        `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
         values ($1, $2, $3, $4, $5, 'one', $6, $7, $8)`,
        [id, tenantId, venue.id, tableId, serviceDate, ...SEED],
      )
      return id
    },

    async addSentOrder(input) {
      const id = newId('so')
      await owner.query(
        `insert into restro.sent_orders
           (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, reference, state,
            lines, total_minor, action_id, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, 'on_bill', $7, 'waiting', '[{"n":1}]'::jsonb, 500, $8,
                 'guest', 'guest', 'test-seed')`,
        [
          id,
          tenantId,
          venue.id,
          input.tableId,
          input.sittingId,
          input.serviceDate ?? today(),
          input.reference,
          input.actionId,
        ],
      )
      return id
    },

    async close() {
      await app.end()
      await cleanUp(owner, [tenantId])
      await owner.query('delete from restro.operators where user_id = any($1)', [users])
      await owner.query('delete from restro.auth_member where organization_id = $1', [tenantId])
      await owner.query('delete from restro.auth_organization where id = $1', [tenantId])
      await owner.query('delete from restro.auth_user where id = any($1)', [users])
      await owner.end()
    },
  }
}
