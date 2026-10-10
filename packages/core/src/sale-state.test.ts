import { describe, expect, it } from 'vitest'

import { saleStateOf } from './sale-state'

describe('saleStateOf (rule 5: only our own mark is ours to take off)', () => {
  const field = (value: boolean | null, layer: string | null) =>
    ({ value, provenance: 'none', layer }) as Parameters<typeof saleStateOf>[0]

  it('is on sale without a flag, and when every layer says true', () => {
    expect(saleStateOf(undefined)).toEqual({ soldOutTonight: false, offSale: null })
    expect(saleStateOf(field(null, null))).toEqual({ soldOutTonight: false, offSale: null })
    expect(saleStateOf(field(true, 'barsy'))).toEqual({ soldOutTonight: false, offSale: null })
    expect(saleStateOf(field(true, 'default'))).toEqual({ soldOutTonight: false, offSale: null })
  })

  it("reads a false from a service edition as a manager's mark", () => {
    expect(saleStateOf(field(false, 'edition:service:2026-10-09'))).toEqual({
      soldOutTonight: true,
      offSale: null,
    })
  })

  it("reads a false from barsy as barsy's, which no control may undo", () => {
    expect(saleStateOf(field(false, 'barsy'))).toEqual({ soldOutTonight: false, offSale: 'barsy' })
  })

  it('reads a false from any other layer as "other": neither ours to mark nor to clear', () => {
    for (const layer of ['manual', 'import', 'override', 'edition:venue:vn_x']) {
      expect(saleStateOf(field(false, layer)), layer).toEqual({
        soldOutTonight: false,
        offSale: 'other',
      })
    }
  })
})
