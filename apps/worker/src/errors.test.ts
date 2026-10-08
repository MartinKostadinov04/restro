import { describe, expect, it } from 'vitest'

import { describeError, summarizeError } from './errors'

const SECRET = 'jane.doe@example.com'

/** Shaped like Drizzle's DrizzleQueryError: the message is the SQL and its parameters. */
class DrizzleQueryError extends Error {
  query: string
  params: unknown[]
  constructor(query: string, params: unknown[], cause?: Error) {
    super(`Failed query: ${query}\nparams: ${params.join(',')}`)
    this.query = query
    this.params = params
    this.cause = cause
  }
}

/** Shaped like node-postgres's DatabaseError. */
class DatabaseError extends Error {
  code: string
  detail: string
  where = `row ${SECRET}`
  severity = 'ERROR'
  constructor(message: string, code: string, detail: string) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

function postgresError(message: string, code: string, detail: string): Error {
  return new DatabaseError(message, code, detail)
}

describe('describeError', () => {
  it('keeps type, message and code of an ordinary error', () => {
    const error = Object.assign(new TypeError('boom'), { code: 'E_BOOM' })
    expect(describeError(error)).toMatchObject({
      type: 'TypeError',
      message: 'boom',
      code: 'E_BOOM',
    })
    expect(describeError(error).stack).toContain('TypeError: boom')
  })

  it('drops the message and stack of a Drizzle query wrapper and reports its cause', () => {
    const cause = postgresError(
      'duplicate key value violates unique constraint "venues_pkey"',
      '23505',
      `Key (email)=(${SECRET}) already exists.`,
    )
    const described = describeError(new DrizzleQueryError('insert into x', [SECRET], cause))
    expect(described.type).toBe('DrizzleQueryError')
    expect(described.message).toBeUndefined()
    expect(described.stack).toBeUndefined()
    expect(described.cause).toMatchObject({
      message: 'duplicate key value violates unique constraint "venues_pkey"',
      code: '23505',
    })
    expect(JSON.stringify(described)).not.toContain(SECRET)
  })

  it('recognises a wrapper by its message even when the class is not Drizzle’s', () => {
    const wrapped = new Error(`Failed query: select 1\nparams: ${SECRET}`)
    expect(JSON.stringify(describeError(wrapped))).not.toContain(SECRET)
  })

  it('never copies Postgres detail, where or hint', () => {
    const described = describeError(postgresError('bad', '23502', `row (${SECRET})`))
    expect(JSON.stringify(described)).not.toContain(SECRET)
    expect(described).not.toHaveProperty('detail')
    expect(described).not.toHaveProperty('where')
  })

  it('follows the cause chain but stops at a fixed depth', () => {
    let error: Error = new Error('root')
    for (let level = 0; level < 20; level += 1)
      error = new Error(`level ${level}`, { cause: error })
    let depth = 0
    for (let node = describeError(error).cause; node; node = node.cause) depth += 1
    expect(depth).toBe(5)
  })

  it('describes values that are not errors', () => {
    expect(describeError('plain text')).toEqual({ type: 'string', message: 'plain text' })
    expect(describeError(undefined)).toEqual({ type: 'undefined', message: 'undefined' })
    expect(describeError({ message: 'from pg-boss', code: 'X' })).toMatchObject({
      type: 'object',
      message: 'from pg-boss',
      code: 'X',
    })
  })

  it('truncates a very long message', () => {
    expect(describeError(new Error('x'.repeat(5000))).message?.length).toBeLessThan(1100)
  })
})

describe('summarizeError', () => {
  it('names the wrapper and the Postgres cause in one line, without parameters', () => {
    const cause = postgresError('relation "x" does not exist', '42P01', SECRET)
    const summary = summarizeError(new DrizzleQueryError('select * from x', [SECRET], cause))
    expect(summary).toBe(
      'DrizzleQueryError, caused by DatabaseError: relation "x" does not exist (42P01)',
    )
    expect(summary).not.toContain(SECRET)
  })

  it('works for a plain error', () => {
    expect(summarizeError(new Error('nope'))).toBe('Error: nope')
  })
})
