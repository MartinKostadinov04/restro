import { describe, expect, it } from 'vitest'

import { tableOfAlert } from './log'

describe('tableOfAlert (RR-91)', () => {
  it('gives the table an alert names, for the Log line of its Done', () => {
    expect(tableOfAlert({ tableId: 'tb_abc123', reference: 'K7Q' })).toEqual({
      tableId: 'tb_abc123',
    })
  })

  it('gives nothing for an alert with no table, or one that is not our id', () => {
    expect(tableOfAlert({})).toEqual({})
    expect(tableOfAlert({ tableId: null })).toEqual({})
    expect(tableOfAlert({ tableId: 'table-7' })).toEqual({})
    expect(tableOfAlert({ tableId: 4 })).toEqual({})
  })
})
