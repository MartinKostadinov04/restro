// A till venue's menus are the roots the till designates (D88, adjustments B3): the demo venue
// gets its public menu (1171) and its till tree (1091) as two menus of one venue, items shared,
// sections per menu; a venue mapped before D88 keeps its menu for the root the picker chose,
// and that menu stays live; a second pull creates nothing.
import { JOB_NAMES } from '@restro/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { allowSlowSetup, hasDatabase, SETUP_TIMEOUT_MS } from './database'
import { createFakeBarsy } from './fake-barsy'
import { createWorld, DEMO_PUBLIC_CAT, DEMO_ROOT_CAT, type World } from './world'

allowSlowSetup()

describe.skipIf(!hasDatabase)('two menus from the till’s roots (D88)', () => {
  const fake = createFakeBarsy()
  let world: World

  beforeAll(async () => {
    fake.listen()
    world = await createWorld(fake, { publicMenu: true })
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    fake.close()
    await world?.close()
  })

  const payload = () => ({
    tenantId: world.tenantId,
    integrationId: world.integrationId,
    venueId: world.venueId,
  })

  it('a full pull keeps one menu per root: the old menu for the tree, a new one for the public menu', async () => {
    await world.run(JOB_NAMES.barsyFullPull, payload())
    const [run] = await world.query<{ status: string; counters: Record<string, number> }>(
      `select status, counters from restro.job_runs
       where integration_id = $1 and kind = 'barsy_full_pull' order by created_at desc limit 1`,
      [world.integrationId],
    )
    expect(run?.status).toBe('completed')
    expect(run?.counters.menus).toBe(2)

    const menus = await world.query<{ id: string; deleted_at: string | null }>(
      'select id, deleted_at from restro.menus where venue_id = $1',
      [world.venueId],
    )
    expect(menus).toHaveLength(2)
    expect(menus.every((menu) => menu.deleted_at === null)).toBe(true)

    const roots = await world.query<{ external_id: string; node_id: string }>(
      `select external_id, node_id from restro.source_links
       where integration_id = $1 and external_type = 'menu_root'`,
      [world.integrationId],
    )
    const byRoot = Object.fromEntries(roots.map((root) => [root.external_id, root.node_id]))
    expect(Object.keys(byRoot).sort()).toEqual(
      [`${DEMO_PUBLIC_CAT}@${world.venueId}`, `${DEMO_ROOT_CAT}@${world.venueId}`].sort(),
    )
    // The menu the picker filled before D88 is adopted for the tree root and stays live.
    expect(byRoot[`${DEMO_ROOT_CAT}@${world.venueId}`]).toBe(world.menuId)
    const [venue] = await world.query<{ live_menu_id: string }>(
      'select live_menu_id from restro.venues where id = $1',
      [world.venueId],
    )
    expect(venue?.live_menu_id).toBe(world.menuId)

    // Each menu has sections of its own; an article is one item however many menus show it.
    for (const menu of menus) {
      const [count] = await world.query<{ n: number }>(
        `select count(*)::int as n from restro.nodes where parent_id = $1 and node_type = 'section'`,
        [menu.id],
      )
      expect(count?.n ?? 0).toBeGreaterThan(0)
    }
    const [articles] = await world.query<{ links: number; nodes: number }>(
      `select count(*)::int as links, count(distinct node_id)::int as nodes
       from restro.source_links where integration_id = $1 and external_type = 'article'`,
      [world.integrationId],
    )
    expect(articles?.links).toBe(articles?.nodes)
  })

  it('the public menu’s sections take keys of their own where the tree holds the plain one', async () => {
    const sections = await world.query<{ external_id: string }>(
      `select external_id from restro.source_links
       where integration_id = $1 and external_type = 'category'`,
      [world.integrationId],
    )
    const ids = sections.map((section) => section.external_id)
    expect(ids.length).toBeGreaterThan(0)
    // No key twice, and a qualified key names a menu of this venue, never a venue of another.
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      const qualifier = id.split('@')[1]
      if (qualifier !== undefined) expect(qualifier).toMatch(/^nd_/)
    }
  })

  it('a second full pull creates nothing: the menus, links and nodes are what they were', async () => {
    const before = await world.query<{ n: number }>('select count(*)::int as n from restro.nodes')
    await world.run(JOB_NAMES.barsyFullPull, payload())
    const [run] = await world.query<{ status: string; counters: Record<string, number> }>(
      `select status, counters from restro.job_runs
       where integration_id = $1 and kind = 'barsy_full_pull' order by created_at desc limit 1`,
      [world.integrationId],
    )
    expect(run?.status).toBe('completed')
    expect(run?.counters).toMatchObject({ menus: 2, created: 0, nodes_created: 0 })
    const after = await world.query<{ n: number }>('select count(*)::int as n from restro.nodes')
    expect(after[0]?.n).toBe(before[0]?.n)
    const menus = await world.query<{ id: string }>(
      'select id from restro.menus where venue_id = $1',
      [world.venueId],
    )
    expect(menus).toHaveLength(2)
  })
})
