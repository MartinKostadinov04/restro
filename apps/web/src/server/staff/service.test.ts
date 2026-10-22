// Restro's admin team as the web app sees it (#72), on a real Postgres as the app role: an account
// with an unrevoked `operators` row is one, a revoked or missing row is not, and only a member of
// the team asking as such gets the `operator` actor.
import { randomUUID } from 'node:crypto'

import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import { isOperator, ownActor } from './service'

describe.skipIf(!hasDatabase)("Restro's admin team (as the app role)", () => {
  let owner: pg.Pool
  const users: string[] = []

  const addUser = async (grant: 'none' | 'live' | 'revoked') => {
    const userId = `op-${randomUUID()}`
    users.push(userId)
    await owner.query('insert into restro.auth_user (id, name, email) values ($1, $2, $3)', [
      userId,
      'Test operator',
      `${userId}@example.test`,
    ])
    if (grant !== 'none') {
      await owner.query(
        `insert into restro.operators (user_id, granted_by, revoked_at)
         values ($1, 'test', case when $2 then now() else null end)`,
        [userId, grant === 'revoked'],
      )
    }
    return userId
  }

  beforeAll(() => {
    useTestServerEnvironment()
    owner = openOwnerPool()
  })

  afterAll(async () => {
    if (owner) {
      await owner.query('delete from restro.operators where user_id = any($1)', [users])
      await owner.query('delete from restro.auth_user where id = any($1)', [users])
      await owner.end()
    }
  })

  it('knows a live grant from a revoked or missing one', async () => {
    expect(await isOperator(await addUser('live'))).toBe(true)
    expect(await isOperator(await addUser('revoked'))).toBe(false)
    expect(await isOperator(await addUser('none'))).toBe(false)
  })

  it('names the operator actor only when a member of the team asks as such', async () => {
    const operatorId = await addUser('live')
    const personId = await addUser('none')
    expect(await ownActor({ id: operatorId }, 'sess-1', { asOperator: true })).toEqual({
      kind: 'operator',
      userId: operatorId,
    })
    expect(await ownActor({ id: operatorId }, 'sess-1')).toEqual({
      kind: 'user',
      userId: operatorId,
      sessionId: 'sess-1',
    })
    expect(await ownActor({ id: personId }, 'sess-2', { asOperator: true })).toEqual({
      kind: 'user',
      userId: personId,
      sessionId: 'sess-2',
    })
  })
})
