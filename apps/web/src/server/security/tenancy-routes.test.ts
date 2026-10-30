// Tenancy and roles on the route handlers that aren't server actions (the repair-review's A7), on a
// real Postgres as restro_app: the CSV downloads, the QR file, the upload, the two file routes.
import type { DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { GET as assetFile } from '../../../app/api/assets/file/[...key]/route'
import { POST as upload } from '../../../app/api/assets/route'
import { GET as qrFile } from '../../../app/api/tables/[tableId]/qr/route'
import { GET as exportFile } from '../../../app/api/venues/[venueId]/export/route'
import { GET as nightFile } from '../../../app/api/venues/[venueId]/night/route'
import { GET as cdnFile } from '../../../app/cdn/[...path]/route'
import { getPool } from '../db'
import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import { asked, refusingFetch } from './attack-session'
import { removeOrgs, type SeededOrg, seedOrg } from './tests/attack-world'

vi.mock('@/server/session', async () => (await import('./attack-session')).sessionModule)
vi.mock('next/cache', async () => (await import('./attack-session')).cacheModule)
vi.mock('next/headers', async () => (await import('./attack-session')).headersModule)
vi.mock('next-intl/server', async () => (await import('./attack-session')).intlModule)
vi.mock('@/server/jobs', async () => (await import('./attack-session')).jobsModule)
vi.mock('@/server/log', async () => (await import('./attack-session')).logModule)

const DAY = new Date().toISOString().slice(0, 10)

describe.skipIf(!hasDatabase)('the route handlers, attacked (as restro_app)', () => {
  let owner: pg.Pool
  let app: DbPool
  let victim: SeededOrg
  let attacker: SeededOrg

  const venueParams = (id: string) => ({ params: Promise.resolve({ venueId: id }) })
  const asOwnerOf = (org: SeededOrg) => {
    asked.person = {
      userId: org.ownerId,
      tenantId: org.tenantId,
      role: 'owner',
      sessionId: `s-${org.ownerId}`,
    }
  }
  const asMemberOf = (org: SeededOrg) => {
    asked.person = {
      userId: org.memberId,
      tenantId: org.tenantId,
      role: 'member',
      sessionId: `s-${org.memberId}`,
    }
  }

  beforeAll(async () => {
    useTestServerEnvironment()
    process.env.WORKER_REVEAL_URL = 'http://localhost:9/attack-no-worker'
    process.env.REVEAL_SERVICE_TOKEN = 'attack-test-token-attack-test-token-000'
    vi.stubGlobal('fetch', refusingFetch)
    owner = openOwnerPool()
    app = getPool()
    victim = await seedOrg(app, owner, 'ROUTEVICTIM')
    attacker = await seedOrg(app, owner, 'ROUTEATTACK')
  }, 120_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await removeOrgs(owner, [victim, attacker])
    await owner?.end()
  }, 120_000)

  const exportUrl = (id: string, kind: string) =>
    new Request(`http://localhost/api/venues/${id}/export?kind=${kind}&from=${DAY}&to=${DAY}`)
  const nightUrl = (id: string) => new Request(`http://localhost/api/venues/${id}/night?day=${DAY}`)
  const qrUrl = (id: string) => new Request(`http://localhost/api/tables/${id}/qr?format=svg`)

  describe('another organisation', () => {
    it("the exports of the victim's venue answer 404", async () => {
      asOwnerOf(attacker)
      const id = victim.venues[0].id
      for (const kind of ['sent', 'log']) {
        expect((await exportFile(exportUrl(id, kind), venueParams(id))).status).toBe(404)
      }
    }, 30_000)

    it("the night file of the victim's venue answers 404", async () => {
      asOwnerOf(attacker)
      const id = victim.venues[0].id
      expect((await nightFile(nightUrl(id), venueParams(id))).status).toBe(404)
    }, 30_000)

    it("the QR of the victim's table answers 404", async () => {
      asOwnerOf(attacker)
      const id = victim.venues[0].table
      const answer = await qrFile(qrUrl(id), { params: Promise.resolve({ tableId: id }) })
      expect(answer.status).toBe(404)
    }, 30_000)
  })

  describe('a plain member of the same organisation', () => {
    it('the exports answer 403', async () => {
      asMemberOf(victim)
      const id = victim.venues[0].id
      for (const kind of ['sent', 'log']) {
        expect((await exportFile(exportUrl(id, kind), venueParams(id))).status).toBe(403)
      }
    }, 30_000)

    it('the night file answers 403', async () => {
      asMemberOf(victim)
      const id = victim.venues[0].id
      expect((await nightFile(nightUrl(id), venueParams(id))).status).toBe(403)
    }, 30_000)

    it('the QR answers 404', async () => {
      asMemberOf(victim)
      const id = victim.venues[0].table
      const answer = await qrFile(qrUrl(id), { params: Promise.resolve({ tableId: id }) })
      expect(answer.status).toBe(404)
    }, 30_000)
  })

  describe('nobody signed in', () => {
    it('every private route answers 401', async () => {
      asked.person = null
      const venue = victim.venues[0].id
      const table = victim.venues[0].table
      expect((await exportFile(exportUrl(venue, 'log'), venueParams(venue))).status).toBe(401)
      expect((await nightFile(nightUrl(venue), venueParams(venue))).status).toBe(401)
      expect(
        (await qrFile(qrUrl(table), { params: Promise.resolve({ tableId: table }) })).status,
      ).toBe(401)
      const body = new FormData()
      body.set('file', new Blob(['x'], { type: 'image/png' }), 'x.png')
      const post = new Request('http://localhost/api/assets', {
        method: 'POST',
        headers: { origin: 'http://localhost', host: 'localhost' },
        body,
      })
      expect((await upload(post)).status).toBe(401)
    }, 30_000)
  })

  describe('the upload', () => {
    const post = (file: Blob, origin: string | null) => {
      const body = new FormData()
      body.set('file', file, 'x')
      const headers: Record<string, string> = { host: 'localhost' }
      if (origin !== null) headers.origin = origin
      return new Request('http://localhost/api/assets', { method: 'POST', headers, body })
    }

    it('refuses another origin and no origin', async () => {
      asOwnerOf(attacker)
      const png = new Blob([new Uint8Array(10)], { type: 'image/png' })
      expect((await upload(post(png, 'https://evil.example'))).status).toBe(403)
      expect((await upload(post(png, null))).status).toBe(403)
    }, 30_000)

    for (const [name, text] of [
      [
        'an SVG with a script',
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ],
      ['HTML named as an image', '<!doctype html><script>alert(1)</script>'],
    ] as const) {
      it(`refuses ${name}, whatever the type it claims`, async () => {
        asOwnerOf(attacker)
        const file = new Blob([text], { type: 'image/png' })
        const answer = await upload(post(file, 'http://localhost'))
        expect(answer.status).toBe(415)
      }, 30_000)
    }
  })

  describe('the file routes', () => {
    const paths = [
      '../../../../etc/passwd',
      '..%2f..%2fetc%2fpasswd',
      'menus/../../secret',
      '.env',
      'C:/Windows/win.ini',
    ]
    for (const path of paths) {
      it(`/cdn/${path} answers 404`, async () => {
        const answer = await cdnFile(new Request(`http://localhost/cdn/x`), {
          params: Promise.resolve({ path: path.split('/') }),
        })
        expect(answer.status).toBe(404)
      })
    }

    it("a signed-in person of another organisation doesn't get a file by its key", async () => {
      asOwnerOf(attacker)
      const key = `${victim.tenantId}/${victim.asset}/original.png`
      const answer = await assetFile(
        new Request(`http://localhost/api/assets/file/${key}?exp=9999999999&sig=x`),
        { params: Promise.resolve({ key: key.split('/') }) },
      )
      expect([403, 404]).toContain(answer.status)
    }, 30_000)
  })
})
