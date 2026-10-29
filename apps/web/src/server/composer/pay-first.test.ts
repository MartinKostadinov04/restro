import { describe, expect, it, vi } from 'vitest'

const possible = vi.hoisted(() => ({ value: false }))
vi.mock('@restro/core/service', () => ({ payFirstPossibleAt: async () => possible.value }))
vi.mock('@restro/db', () => ({
  withTenant: async (_pool: unknown, _tenant: string, run: (tx: unknown) => unknown) => run({}),
}))

import type { DbPool } from '@restro/db'

import { readItemPayFirstDefault } from './pay-first'

const pool = {} as DbPool
const saved = { itemMode: 'pay_first', applies: true, groups: {}, tables: {} }
const venue = (settings: Record<string, unknown>) => ({ id: 'vn_x', settings }) as never

describe("the composer's pay-first default (#218)", () => {
  it("is null where pay first can't take effect, whatever the settings say", async () => {
    possible.value = false
    expect(await readItemPayFirstDefault(pool, 'tn_x', venue({ payFirst: saved }))).toBeNull()
  })

  it("is the venue's item default where it can: on the bill until set", async () => {
    possible.value = true
    expect(await readItemPayFirstDefault(pool, 'tn_x', venue({}))).toBe('on_bill')
    expect(await readItemPayFirstDefault(pool, 'tn_x', venue({ payFirst: saved }))).toBe(
      'pay_first',
    )
  })
})
