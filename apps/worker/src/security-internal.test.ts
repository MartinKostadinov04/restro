// The worker's internal endpoints, attacked (the repair-review's A7), on a real Postgres as
// restro_app. Green: another organisation's ids and a plain member get nothing through a reveal, the
// service token is required, a public name is a 404. What should hold and doesn't is in
// security-internal.red.test.ts.
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto'
import { request } from 'node:http'

import { sealTableCode } from '@restro/core/seal'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  openServiceWorld,
  type ServiceWorld,
} from '../../../packages/core/src/testing/service-world'
import { type HealthServer, startHealthServer } from './health-server'
import { RevealRequestSchema, reveal } from './reveal'

const hasDatabase = process.env.DATABASE_URL_OWNER !== undefined
const keys = generateKeyPairSync('x25519')
const TOKEN = 'attack-service-token-attack-service-token'

function call(
  port: number,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'POST', agent: false, headers },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

describe('the internal endpoints, over HTTP', () => {
  let server: HealthServer
  beforeAll(async () => {
    server = await startHealthServer(0, () => ({
      httpStatus: 200,
      body: { status: 'ok', lastBeatAt: null, pgboss: 'started' },
    }))
    server.setRevealHandler({
      token: TOKEN,
      reveal: async () => ({ status: 'refused', code: 'x' }),
      failed: () => {},
    } as never)
  })
  afterAll(async () => {
    await server?.close()
  })

  const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
  it('a public name is a 404, with the token too', async () => {
    const answer = await call(
      server.port,
      '/internal/reveal',
      { ...auth, host: 'restro.example' },
      '{}',
    )
    expect(answer).toBe(404)
  })
  it('no token, and a wrong token, are a 401', async () => {
    const host = { host: 'localhost', 'content-type': 'application/json' }
    expect(await call(server.port, '/internal/reveal', host, '{}')).toBe(401)
    expect(
      await call(server.port, '/internal/reveal', { ...host, authorization: 'Bearer wrong' }, '{}'),
    ).toBe(401)
    expect(
      await call(
        server.port,
        '/internal/reveal',
        { ...host, authorization: `bearer ${TOKEN}` },
        '{}',
      ),
    ).toBe(401)
  })
})

describe.skipIf(!hasDatabase)('a reveal (as restro_app)', () => {
  let victim: ServiceWorld
  let attacker: ServiceWorld
  let attackerOwner: string
  let member: string
  let table: string

  const asOwner = () => ({
    tenantId: attacker.tenantId,
    venueId: attacker.venueId,
    actor: { kind: 'user' as const, userId: attackerOwner, sessionId: `s-${attackerOwner}` },
    signedInAt: new Date().toISOString(),
  })

  beforeAll(async () => {
    victim = await openServiceWorld('reveal-victim')
    attacker = await openServiceWorld('reveal-attacker')
    attackerOwner = await attacker.addUser('owner')
    member = await victim.addUser('member')
    table = victim.tables[0] as string
    const code = `code${randomUUID().replaceAll('-', '')}`
    await victim.owner.query(
      'update restro.tables set qr_code_sealed = $2, qr_code_hash = $3 where id = $1',
      [
        table,
        sealTableCode(keys.publicKey, code, { tenantId: victim.tenantId, tableId: table }),
        createHash('sha256').update(code).digest('hex'),
      ],
    )
  }, 120_000)

  afterAll(async () => {
    await victim?.close()
    await attacker?.close()
  }, 60_000)

  const deps = () => ({ pool: victim.app, privateKey: keys.privateKey })

  it("another organisation's owner, their own venue, the victim's tables: no code", async () => {
    const answer = await reveal(
      deps(),
      RevealRequestSchema.parse({ ...asOwner(), tableIds: [table] }),
    )
    expect(JSON.stringify(answer)).not.toContain(table)
  }, 30_000)

  it("the victim's venue under the attacker's tenant: refused", async () => {
    const answer = await reveal(
      deps(),
      RevealRequestSchema.parse({ ...asOwner(), venueId: victim.venueId, tableIds: [table] }),
    )
    expect(answer.status).toBe('refused')
  }, 30_000)

  it('a plain member of the same organisation: refused, codes and PINs', async () => {
    const asMember = {
      tenantId: victim.tenantId,
      venueId: victim.venueId,
      actor: { kind: 'user' as const, userId: member, sessionId: `s-${member}` },
      signedInAt: new Date().toISOString(),
    }
    const codes = await reveal(
      deps(),
      RevealRequestSchema.parse({ ...asMember, tableIds: [table] }),
    )
    expect(codes.status).toBe('refused')
    const staff = await victim.addStaff(['alerts.answer'])
    const pins = await reveal(
      deps(),
      RevealRequestSchema.parse({ ...asMember, staffMemberIds: [staff] }),
    )
    expect(pins.status).toBe('refused')
  }, 30_000)

  it('someone named as an operator who is not one: refused', async () => {
    const answer = await reveal(
      deps(),
      RevealRequestSchema.parse({
        tenantId: victim.tenantId,
        venueId: victim.venueId,
        actor: { kind: 'operator', userId: attackerOwner },
        tableIds: [table],
      }),
    )
    expect(answer.status).toBe('refused')
  }, 30_000)
})
