// Two seeded organisations for the attack tests (the repair-review's A7). Each has an owner, an
// admin and a plain member, two venues, and one row of nearly everything a command can name: menu,
// section, item, tag, area, table with a code, person, role, device, sitting, sent order, payment,
// refund, alert, call, pause, snapshots, asset, integration, bar. Every name carries a marker, so a
// leak in an answer shows; `fingerprint` hashes every tenant-bound row, so a write shows.
import { randomUUID } from 'node:crypto'

import { hashTableCode, newId } from '@restro/core'
import {
  createArea,
  createIntegration,
  createTable,
  provisionMenu,
  provisionTenant,
  provisionVenue,
} from '@restro/core/apply'
import { endpointHashOf } from '@restro/core/service'
import type pg from 'pg'

import { createItemAction, createSectionAction } from '@/composer/actions'
import { createTagAction } from '@/composer/tag-actions'

import { asked } from '../attack-session'

const SEED = ['restro', 'system', 'attack-seed'] as const

export interface SeededVenue {
  readonly id: string
  readonly name: string
  readonly menu: string
  readonly section: string
  readonly item: string
  readonly tag: string
  readonly area: string
  readonly table: string
  readonly table2: string
  readonly tableCode: string
  readonly role: string
  readonly staff: string
  readonly device: string
  readonly deviceSession: string
  readonly sitting: string
  readonly sentOrder: string
  readonly payment: string
  readonly refund: string
  readonly alert: string
  readonly waiterCall: string
  readonly pause: string
  readonly bar: string
  readonly heldSnapshot: string
  readonly publishedSnapshot: string
}

export interface SeededOrg {
  readonly tenantId: string
  readonly marker: string
  readonly ownerId: string
  readonly adminId: string
  readonly memberId: string
  readonly integration: string
  readonly asset: string
  /** A device of the owner's for Web Push, which an attack may name but never end. */
  readonly pushEndpoint: string
  readonly venues: readonly [SeededVenue, SeededVenue]
}

/** Every id the organisation holds: what must never show up in another's rows. */
export function idsOf(org: SeededOrg): string[] {
  const ids = [org.tenantId, org.integration, org.asset]
  for (const venue of org.venues) {
    for (const value of Object.values(venue)) {
      if (/^[a-z]{2}_/.test(value)) ids.push(value)
    }
  }
  return ids
}

/** A random 64-character hash, as the hash columns want. */
function hex64(): string {
  return `${randomUUID()}${randomUUID()}`.replaceAll('-', '')
}

/** Today's service day as the database's clock has it: good enough for a seeded row. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function seedVenue(
  app: Parameters<typeof provisionVenue>[0],
  owner: pg.Pool,
  org: { tenantId: string; marker: string; ownerId: string },
  index: number,
): Promise<SeededVenue> {
  const { tenantId, marker } = org
  const name = `${marker} club ${index}`
  const venue = await provisionVenue(app, tenantId, {
    name,
    slug: `attack-${randomUUID().replaceAll('-', '').slice(0, 10)}`,
  })
  const menu = await provisionMenu(app, tenantId, venue.id)
  const menuId = menu.id
  asked.person = { userId: org.ownerId, tenantId, role: 'owner', sessionId: `s-${org.ownerId}` }

  const section = newId('nd')
  const sectionDone = await createSectionAction({
    venueId: venue.id,
    menuId,
    id: section,
    parentId: null,
    title: { bg_BG: `${marker} section` },
    sortKey: 'a0',
  })
  if (!sectionDone.ok) throw new Error(`section refused: ${JSON.stringify(sectionDone)}`)
  const item = newId('nd')
  const itemDone = await createItemAction({
    venueId: venue.id,
    menuId,
    id: item,
    sectionId: section,
    name: { bg_BG: `${marker} item` },
    price: '4.50',
    sortKey: 'a0',
  })
  if (!itemDone.ok) throw new Error(`item refused: ${JSON.stringify(itemDone)}`)
  const tag = newId('tg')
  const tagDone = await createTagAction({
    venueId: venue.id,
    id: tag,
    label: { bg_BG: `${marker} tag` },
    color: 'accent',
  })
  if (!tagDone.ok) throw new Error(`tag refused: ${JSON.stringify(tagDone)}`)
  asked.person = null

  const area = await createArea(app, tenantId, venue.id, `${marker} hall`)
  if (!area.ok) throw new Error('area refused')
  const tableOne = await createTable(app, tenantId, {
    areaId: area.area.id,
    name: `${marker} table`,
    number: '1',
  })
  const tableTwo = await createTable(app, tenantId, {
    areaId: area.area.id,
    name: `${marker} table 2`,
    number: '2',
  })
  if (!tableOne.ok || !tableTwo.ok) throw new Error('table refused')
  const table = tableOne.table.id
  const table2 = tableTwo.table.id
  const tableCode = `code${randomUUID().replaceAll('-', '')}`
  await owner.query('update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1', [
    table,
    tableCode,
    await hashTableCode(tableCode),
  ])

  const day = today()
  const role = newId('rl')
  const staff = newId('sm')
  await owner.query(
    `insert into restro.staff_members (id, tenant_id, display_name, source, actor, job_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [staff, tenantId, `${marker} waiter`, ...SEED],
  )
  await owner.query(
    `insert into restro.venue_roles (id, tenant_id, venue_id, name, permissions, source, actor, job_id)
     values ($1, $2, $3, $4, '["night.view","tables.open_close"]'::jsonb, $5, $6, $7)`,
    [role, tenantId, venue.id, `${marker} role`.slice(0, 40), ...SEED],
  )
  await owner.query(
    `insert into restro.staff_assignments (tenant_id, staff_member_id, venue_id, role_id, source, actor, job_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, staff, venue.id, role, ...SEED],
  )
  const device = newId('dv')
  const deviceSession = `device-${randomUUID()}`
  await owner.query(
    `insert into restro.shared_devices (id, tenant_id, venue_id, name, session_id, source, actor, job_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [device, tenantId, venue.id, `${marker} tablet`.slice(0, 40), deviceSession, ...SEED],
  )
  const sitting = newId('st')
  await owner.query(
    `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
     values ($1, $2, $3, $4, $5, 'one', $6, $7, $8)`,
    [sitting, tenantId, venue.id, table, day, ...SEED],
  )
  const sentOrder = newId('so')
  await owner.query(
    `insert into restro.sent_orders
       (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, reference, state, lines,
        total_minor, action_id, source, actor, job_id)
     values ($1, $2, $3, $4, $5, $6, 'on_bill', $7, 'waiting', $8::jsonb, 500, $9, 'guest', 'guest', 'attack-seed')`,
    [
      sentOrder,
      tenantId,
      venue.id,
      table,
      sitting,
      day,
      `REF${index}`,
      JSON.stringify([{ name: `${marker} line`, n: 1 }]),
      randomUUID(),
    ],
  )
  const payment = newId('py')
  await owner.query(
    `insert into restro.payments
       (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
        currency, provider_kind, source, actor, job_id)
     values ($1, $2, $3, $4, $5, $6, 'on_bill', 'entered', $7, 'EUR', 'sim', 'guest', 'guest', 'attack-seed')`,
    [payment, tenantId, venue.id, table, sitting, day, hex64()],
  )
  const refund = newId('rf')
  await owner.query(
    `insert into restro.payment_refunds
       (id, tenant_id, venue_id, payment_id, amount_minor, service_date, source, actor, job_id)
     values ($1, $2, $3, $4, 100, $5, $6, $7, $8)`,
    [refund, tenantId, venue.id, payment, day, ...SEED],
  )
  const alert = newId('al')
  await owner.query(
    `insert into restro.alerts (id, tenant_id, venue_id, service_date, kind, subject_id, source, actor, job_id)
     values ($1, $2, $3, $4, 'till_down', $5, $6, $7, $8)`,
    [alert, tenantId, venue.id, day, table, ...SEED],
  )
  const waiterCall = newId('wc')
  await owner.query(
    `insert into restro.waiter_calls (id, tenant_id, venue_id, table_id, sitting_id, service_date, source, actor, job_id)
     values ($1, $2, $3, $4, $5, $6, 'guest', 'guest', 'attack-seed')`,
    [waiterCall, tenantId, venue.id, table, sitting, day],
  )
  const pause = newId('pa')
  await owner.query(
    `insert into restro.pauses (id, tenant_id, venue_id, service_date, scope, target_id, cause, restro_started, source, actor, job_id)
     values ($1, $2, $3, $4, 'table', $5, 'staff', true, $6, $7, $8)`,
    [pause, tenantId, venue.id, day, table, ...SEED],
  )
  const bar = newId('br')
  await owner.query(
    `insert into restro.bars (id, tenant_id, venue_id, name, source_key) values ($1, $2, $3, $4, $5)`,
    [bar, tenantId, venue.id, `${marker} bar`, bar],
  )
  const heldSnapshot = newId('sn')
  const publishedSnapshot = newId('sn')
  await owner.query(
    `insert into restro.snapshots
       (id, tenant_id, menu_id, venue_id, version, hash, status, reason, actor, body, held_reason, published_at)
     values ($1, $2, $4, $3, 1, $6, 'held', 'auto_sync', 'system', '{}'::jsonb, '{"why":"attack seed"}'::jsonb, null),
            ($5, $2, $4, $3, 2, $7, 'published', 'manual', 'system', '{}'::jsonb, null, now())`,
    [heldSnapshot, tenantId, venue.id, menuId, publishedSnapshot, hex64(), hex64()],
  )
  return {
    id: venue.id,
    name,
    menu: menuId,
    section,
    item,
    tag,
    area: area.area.id,
    table,
    table2,
    tableCode,
    role,
    staff,
    device,
    deviceSession,
    sitting,
    sentOrder,
    payment,
    refund,
    alert,
    waiterCall,
    pause,
    bar,
    heldSnapshot,
    publishedSnapshot,
  }
}

/** One organisation with its people and two venues. `marker` is in every name it holds. */
export async function seedOrg(
  app: Parameters<typeof provisionVenue>[0],
  owner: pg.Pool,
  marker: string,
): Promise<SeededOrg> {
  const tenantId = newId('tn')
  await provisionTenant(app, { tenantId, name: `${marker} organisation` })
  await owner.query('insert into restro.auth_organization (id, name, slug) values ($1, $2, $3)', [
    tenantId,
    `${marker} organisation`,
    tenantId.toLowerCase().replaceAll('_', '-'),
  ])
  const people: Record<string, string> = {}
  for (const role of ['owner', 'admin', 'member']) {
    const userId = `atk-${newId('us').slice(3)}`
    people[role] = userId
    await owner.query('insert into restro.auth_user (id, name, email) values ($1, $2, $3)', [
      userId,
      `${marker} ${role}`,
      `${userId}@example.test`,
    ])
    await owner.query(
      'insert into restro.auth_member (id, organization_id, user_id, role) values ($1, $2, $3, $4)',
      [`mb-${userId}`, tenantId, userId, role],
    )
  }
  const ownerId = people.owner as string
  const adminId = people.admin as string
  const memberId = people.member as string
  const context = { tenantId, marker, ownerId }
  const one = await seedVenue(app, owner, context, 1)
  const two = await seedVenue(app, owner, context, 2)
  const integration = await createIntegration(app, tenantId, {
    kind: 'sim',
    host: `${tenantId.slice(3, 15).toLowerCase()}.attack.test`,
  })
  const asset = newId('as')
  await owner.query(`insert into restro.assets (id, tenant_id, origin) values ($1, $2, 'upload')`, [
    asset,
    tenantId,
  ])
  const pushEndpoint = `https://fcm.googleapis.com/fcm/send/${tenantId}-${'x'.repeat(30)}`
  await owner.query(
    `insert into restro.push_subscriptions
       (tenant_id, user_id, endpoint_hash, endpoint, p256dh, auth, source, actor, job_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      tenantId,
      ownerId,
      endpointHashOf(pushEndpoint),
      pushEndpoint,
      `B${'p'.repeat(86)}`,
      'a'.repeat(22),
      ...SEED,
    ],
  )
  return {
    tenantId,
    marker,
    ownerId,
    adminId,
    memberId,
    integration: integration.id,
    asset,
    pushEndpoint,
    venues: [one, two],
  }
}

/** The tenant-bound tables, found once per call. */
async function tenantTables(owner: pg.Pool): Promise<string[]> {
  const { rows } = await owner.query<{ table_name: string }>(
    `select c.table_name from information_schema.columns c
       join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = 'restro' and c.column_name = 'tenant_id' and t.table_type = 'BASE TABLE'
      order by 1`,
  )
  return rows.map((row) => row.table_name)
}

/** Per table, a hash of the organisation's rows (with its members and its name). */
export async function fingerprint(owner: pg.Pool, tenantId: string): Promise<Map<string, string>> {
  const { rows } = await owner.query<{ table_name: string; hash: string }>(
    (await tenantTables(owner))
      .map(
        (table) =>
          `select '${table}' as table_name, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as hash
             from restro."${table}" t where tenant_id = $1`,
      )
      .concat(
        [
          ['auth_member', 'organization_id'],
          ['auth_organization', 'id'],
          ['auth_invitation', 'organization_id'],
          ['tenants', 'id'],
        ].map(
          ([table, column]) =>
            `select '${table}' as table_name, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as hash
               from restro."${table}" t where "${column}" = $1`,
        ),
      )
      .join(' union all '),
    [tenantId],
  )
  return new Map(rows.map((row) => [row.table_name, row.hash]))
}

/** The tables whose hash moved between two fingerprints. */
export function changedTables(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...after.entries()]
    .filter(([table, hash]) => before.get(table) !== hash)
    .map(([table]) => table)
}

/** The tables where `tenantId`'s rows mention any of `ids`: a mix of two organisations. */
export async function rowsMentioning(
  owner: pg.Pool,
  tenantId: string,
  ids: readonly string[],
): Promise<string[]> {
  const pattern = ids.join('|')
  const found: string[] = []
  for (const table of await tenantTables(owner)) {
    const { rows } = await owner.query<{ n: string }>(
      `select count(*) as n from restro."${table}" t where tenant_id = $1 and t::text ~ $2`,
      [tenantId, pattern],
    )
    if (Number(rows[0]?.n) > 0) found.push(table)
  }
  return found
}

/** Removes the organisations and everything they hold (owner pool, foreign keys off). */
export async function removeOrgs(owner: pg.Pool, orgs: readonly SeededOrg[]): Promise<void> {
  const client = await owner.connect()
  try {
    await client.query("set session_replication_role = 'replica'")
    const tables = await tenantTables(owner)
    for (const org of orgs) {
      for (const table of tables) {
        await client.query(`delete from restro."${table}" where tenant_id = $1`, [org.tenantId])
      }
      await client.query('delete from restro.auth_member where organization_id = $1', [
        org.tenantId,
      ])
      await client.query('delete from restro.auth_organization where id = $1', [org.tenantId])
      await client.query('delete from restro.auth_user where id = any($1)', [
        [org.ownerId, org.adminId, org.memberId],
      ])
      await client.query('delete from restro.tenants where id = $1', [org.tenantId])
    }
  } finally {
    await client.query("set session_replication_role = 'origin'")
    client.release()
  }
}

/** Every id a venue holds. */
export function idsOfVenue(venue: SeededVenue): string[] {
  return Object.values(venue).filter((value) => /^[a-z]{2}_/.test(value))
}

/** Per table, a hash of the organisation's rows that mention one of `ids`. */
export async function fingerprintMentioning(
  owner: pg.Pool,
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const pattern = ids.join('|')
  const { rows } = await owner.query<{ table_name: string; hash: string }>(
    (await tenantTables(owner))
      .map(
        (table) =>
          `select '${table}' as table_name, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as hash
             from restro."${table}" t where tenant_id = $1 and t::text ~ $2`,
      )
      .join(' union all '),
    [tenantId, pattern],
  )
  return new Map(rows.map((row) => [row.table_name, row.hash]))
}
