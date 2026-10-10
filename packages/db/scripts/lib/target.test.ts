import { afterEach, describe, expect, it, vi } from 'vitest'

import { ALLOW_REMOTE_ENV, assertSafeTarget, describeTarget, isLocalTarget } from './target.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isLocalTarget', () => {
  it.each([
    'postgres://postgres:postgres@localhost:54329/restro',
    'postgres://u:p@127.0.0.1:5432/restro',
    'postgres://u:p@[::1]:5432/restro',
    'postgres:///restro?host=/var/run/postgresql',
  ])('treats %s as local', (url) => {
    expect(isLocalTarget(url)).toBe(true)
  })

  it.each([
    'postgresql://postgres.abcdefghij:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
    'postgres://u:p@db.example.com/restro',
    'postgres://u:p@localhost/restro?host=db.example.com',
  ])('treats %s as remote', (url) => {
    expect(isLocalTarget(url)).toBe(false)
  })
})

describe('assertSafeTarget', () => {
  const remote =
    'postgresql://postgres.ref:hunter2-secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'

  it('refuses a remote database without the opt-in, and never prints the password', () => {
    vi.stubEnv(ALLOW_REMOTE_ENV, '')
    expect(() => assertSafeTarget(remote, 'db:migrate')).toThrow(/refuses to run against/)
    expect(() => assertSafeTarget(remote, 'db:migrate')).not.toThrow(/hunter2/)
  })

  it('allows a remote database only with RESTRO_DB_ALLOW_REMOTE=1', () => {
    vi.stubEnv(ALLOW_REMOTE_ENV, '1')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(() => assertSafeTarget(remote, 'db:migrate')).not.toThrow()
    expect(warn.mock.calls.flat().join(' ')).not.toContain('hunter2')
    warn.mockRestore()
  })

  it('allows a local database', () => {
    expect(() =>
      assertSafeTarget('postgres://postgres:postgres@localhost:54329/restro', 'db:roles'),
    ).not.toThrow()
  })
})

describe('describeTarget', () => {
  it('shows user, host, port and database but not the password', () => {
    expect(describeTarget('postgres://restro_app:s3cret@localhost:54329/restro')).toBe(
      'restro_app@localhost:54329/restro',
    )
  })
})
