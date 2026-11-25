import { describe, expect, it } from 'vitest'

import { assertDevEnvironment, readAdminCredentials, seedsDemoBar, seedsDemoMenu } from './guard'

const local = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://restro_app:x@localhost:54329/restro',
}

describe('db:seed:dev refusals', () => {
  it('runs for development against a local database', () => {
    expect(() => assertDevEnvironment(local)).not.toThrow()
    expect(() =>
      assertDevEnvironment({ ...local, DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/restro' }),
    ).not.toThrow()
    expect(() =>
      assertDevEnvironment({ ...local, DATABASE_URL: 'postgres://u:p@[::1]:5432/restro' }),
    ).not.toThrow()
  })

  it.each(['production', 'test', 'staging', undefined, ''])(
    'refuses when NODE_ENV is %j',
    (nodeEnv) => {
      expect(() => assertDevEnvironment({ ...local, NODE_ENV: nodeEnv })).toThrow(/NODE_ENV/)
    },
  )

  it.each([
    'postgres://u:p@db.abcdefgh.supabase.co:5432/postgres',
    'postgres://u:p@restro-staging.railway.internal:5432/restro',
    'postgres://u:p@10.0.0.5:5432/restro',
  ])('refuses the remote database %s', (url) => {
    expect(() => assertDevEnvironment({ ...local, DATABASE_URL: url })).toThrow(
      /not on this machine/,
    )
  })

  it('refuses when DATABASE_URL is missing or not a URL', () => {
    expect(() => assertDevEnvironment({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL/)
    expect(() => assertDevEnvironment({ ...local, DATABASE_URL: 'nonsense' })).toThrow(/valid URL/)
  })

  it('does not accept a remote host hidden behind a local-looking name', () => {
    expect(() =>
      assertDevEnvironment({
        ...local,
        DATABASE_URL: 'postgres://u:p@localhost.evil.example:5432/x',
      }),
    ).toThrow(/not on this machine/)
  })

  it('reads the demo owner’s credentials and names only the missing variables', () => {
    expect(
      readAdminCredentials({
        DEV_ADMIN_EMAIL: ' owner@demo-club.test ',
        DEV_ADMIN_PASSWORD: 'longenough1',
      }),
    ).toEqual({ email: 'owner@demo-club.test', password: 'longenough1' })
    expect(() => readAdminCredentials({})).toThrow(/DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD/)
    expect(() =>
      readAdminCredentials({ DEV_ADMIN_EMAIL: 'nope', DEV_ADMIN_PASSWORD: 'longenough1' }),
    ).toThrow(/not an email/)
    expect(() =>
      readAdminCredentials({ DEV_ADMIN_EMAIL: 'a@b.test', DEV_ADMIN_PASSWORD: 'short' }),
    ).toThrow(/8 characters/)
  })
})

describe('SEED_DEMO_MENU', () => {
  it('seeds the demo menus (Demo Bar with them) unless it is 0', () => {
    expect(seedsDemoMenu({})).toBe(true)
    expect(seedsDemoMenu({ SEED_DEMO_MENU: '1' })).toBe(true)
    expect(seedsDemoMenu({ SEED_DEMO_MENU: '0' })).toBe(false)
  })
})

describe('SEED_DEMO_BAR', () => {
  it('seeds Demo Bar unless SEED_DEMO_BAR or SEED_DEMO_MENU is 0', () => {
    expect(seedsDemoBar({})).toBe(true)
    expect(seedsDemoBar({ SEED_DEMO_BAR: '0' })).toBe(false)
    expect(seedsDemoBar({ SEED_DEMO_MENU: '0' })).toBe(false)
    expect(seedsDemoBar({ SEED_DEMO_BAR: '1' })).toBe(true)
  })
})
