// The draw of a venue's public code in `provisionVenue` (brief CF-14, D68): a clash with a code
// that is taken is drawn again once, and a second clash is an error. Real Postgres, as the
// restro_app role; only the random source is faked, to make the clash happen on demand.
import { randomUUID } from 'node:crypto'

import { createPool, type DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { newId } from '../ids'
import { provisionTenant, provisionVenue } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

const draws = vi.hoisted(() => ({ queue: [] as string[] }))

vi.mock('../public-id', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../public-id')>()
  // The codes the test queued first, then the real thing.
  return { ...actual, newPublicId: () => draws.queue.shift() ?? actual.newPublicId() }
})

/** A code nobody else holds (hex is within a-z0-9). */
const freshCode = () => randomUUID().replaceAll('-', '').slice(0, 12)

describe.skipIf(!hasDatabase)('the public code draw in provisionVenue (as restro_app)', () => {
  const tenantA = newId('tn')
  const tenantB = newId('tn')
  let app: DbPool
  let owner: pg.Pool

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-tests' })
    await provisionTenant(app, { tenantId: tenantA, name: 'Club A' })
    await provisionTenant(app, { tenantId: tenantB, name: 'Club B' })
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenantA, tenantB])
      await owner.end()
    }
  })

  it('draws again, once, when the code is taken (also by another tenant, whose rows it cannot see)', async () => {
    const taken = freshCode()
    const next = freshCode()
    draws.queue.push(taken)
    const first = await provisionVenue(app, tenantA, { name: 'First', slug: testSlug('first') })
    expect(first.publicId).toBe(taken)

    // The second venue's first draw is the code tenant A holds; the unique index refuses it.
    draws.queue.push(taken, next)
    const second = await provisionVenue(app, tenantB, { name: 'Second', slug: testSlug('second') })
    expect(second.publicId).toBe(next)
    expect(draws.queue).toEqual([])
  })

  it('gives up after the second clash instead of looping, and creates nothing', async () => {
    const taken = freshCode()
    draws.queue.push(taken)
    await provisionVenue(app, tenantA, { name: 'Holder', slug: testSlug('holder') })

    draws.queue.push(taken, taken)
    const slug = testSlug('never')
    await expect(provisionVenue(app, tenantB, { name: 'Never', slug })).rejects.toThrow()
    expect(draws.queue).toEqual([])
    const { rows } = await owner.query('select id from restro.venues where slug = $1', [slug])
    expect(rows).toEqual([])
  })
})
