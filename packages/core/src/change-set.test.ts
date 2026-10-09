import { describe, expect, it } from 'vitest'

import {
  CHANGE_SET_OP_NAMES,
  ChangeSetOpSchema,
  ChangeSetSchema,
  type FieldWrite,
  FieldWriteSchema,
  isLayer,
  isScope,
  isSource,
  layerAllowedForSource,
  nodeRefsOf,
  parseChangeSet,
} from './change-set'
import { newId } from './ids'

const itemId = newId('nd')
const sectionId = newId('nd')
const venueId = newId('vn')

function manualSet(ops: unknown[]): Record<string, unknown> {
  return {
    id: newId('cs'),
    source: 'manual',
    jobId: 'job_manual_1',
    actor: 'user:us_42',
    observedAt: '2026-10-08T21:03:41+03:00',
    ops,
  }
}

const describeWrite = {
  op: 'setField',
  node: { id: itemId },
  fieldKey: 'description',
  layer: 'manual',
  scope: 'master',
  value: { en_US: 'Gin, Campari, vermouth' },
} as const

const barsyPrice = {
  op: 'setField',
  node: { link: { integration: 'int_club', externalType: 'article', externalId: '102751' } },
  fieldKey: 'price',
  layer: 'barsy',
  scope: `venue:${venueId}`,
  value: { amount_minor: 1250, currency: 'EUR' },
  sourceRecordId: 'sr_1',
  mappingVersion: 3,
} as const

function issuesOf(json: unknown): string {
  const parsed = parseChangeSet(json)
  expect(parsed.ok).toBe(false)
  return parsed.ok ? '' : parsed.reason
}

describe('ChangeSetSchema', () => {
  it('parses a valid manual change set with field writes and structural ops', () => {
    const newItem = newId('nd')
    const parsed = parseChangeSet(
      manualSet([
        { op: 'createNode', id: newItem, nodeType: 'item', parent: null, status: 'active' },
        { ...describeWrite, node: { id: newItem } },
        { op: 'setPlacement', item: { id: newItem }, section: { id: sectionId }, sortKey: 'a0' },
        { op: 'removePlacement', item: { id: itemId }, section: { id: sectionId } },
        { op: 'setNodeStatus', node: { id: itemId }, status: 'hidden' },
        {
          op: 'linkSource',
          node: { id: newItem },
          link: { integration: 'int_club', externalType: 'article', externalId: '102751' },
        },
        {
          ...describeWrite,
          fieldKey: 'name',
          layer: 'override',
          value: { en_US: 'Negroni Sbagliato' },
          basis: { en_US: 'Negroni' },
        },
        {
          ...describeWrite,
          fieldKey: 'for_sale',
          layer: 'edition:service-2026-10-08',
          value: false,
        },
      ]),
    )
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.value.ops).toHaveLength(8)
  })

  it('parses a valid barsy change set that names nodes by link', () => {
    const parsed = parseChangeSet({
      ...manualSet([barsyPrice]),
      source: 'barsy:int_club',
      actor: 'integration:int_club',
      jobId: 'job_barsy_full_7',
    })
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.value.source).toBe('barsy:int_club')
  })

  it('rejects a change set without job, source, actor, time or ops (rule 2)', () => {
    for (const key of ['jobId', 'source', 'actor', 'observedAt', 'id']) {
      const set = manualSet([describeWrite])
      delete set[key]
      expect(ChangeSetSchema.safeParse(set).success, key).toBe(false)
    }
    expect(issuesOf(manualSet([]))).toContain('ops')
    expect(
      issuesOf({ ...manualSet([describeWrite]), observedAt: '2026-10-08T21:03:41' }),
    ).toContain('observedAt')
  })

  it('rejects a field write without a layer, scope or value', () => {
    for (const key of ['layer', 'scope', 'value', 'node', 'fieldKey']) {
      const write: Record<string, unknown> = { ...describeWrite }
      delete write[key]
      expect(FieldWriteSchema.safeParse(write).success, key).toBe(false)
      expect(ChangeSetSchema.safeParse(manualSet([write])).success, key).toBe(false)
    }
  })

  it('rejects writes into a layer the source may not write', () => {
    expect(issuesOf(manualSet([barsyPrice]))).toContain('cannot write the barsy layer')
    const fromImport = { ...manualSet([describeWrite]), source: 'import:wine-list' }
    expect(issuesOf(fromImport)).toContain('cannot write the manual layer')
  })

  it('rejects link refs in manual sets and links of another integration in barsy sets', () => {
    expect(issuesOf(manualSet([{ ...describeWrite, node: barsyPrice.node }]))).toContain(
      'manual change sets name nodes by id',
    )
    const otherIntegration = {
      ...manualSet([barsyPrice]),
      source: 'barsy:int_other',
      actor: 'integration:int_other',
    }
    expect(issuesOf(otherIntegration)).toContain('another integration')
  })

  it('requires a basis on overrides and only there', () => {
    const noBasis = { ...describeWrite, fieldKey: 'name', layer: 'override' }
    expect(issuesOf(manualSet([noBasis]))).toContain('basis')
    expect(issuesOf(manualSet([{ ...noBasis, basis: null }]))).toContain('basis')
    expect(issuesOf(manualSet([{ ...describeWrite, basis: { en_US: 'x' } }]))).toContain('basis')
  })

  it('keeps venue scope to barsy values, with our venue id (never a barsy bid)', () => {
    expect(issuesOf(manualSet([{ ...describeWrite, scope: `venue:${venueId}` }]))).toContain(
      'venue-scoped',
    )
    const withBid = {
      ...manualSet([{ ...barsyPrice, scope: 'venue:1' }]),
      source: 'barsy:int_club',
    }
    expect(issuesOf(withBid)).toContain('scope')
  })

  it('requires source record and mapping version on barsy writes', () => {
    const { sourceRecordId: _record, mappingVersion: _version, ...bare } = barsyPrice
    const set = { ...manualSet([bare]), source: 'barsy:int_club', actor: 'integration:int_club' }
    const reason = issuesOf(set)
    expect(reason).toContain('sourceRecordId')
    expect(reason).toContain('mappingVersion')
  })

  it('checks createNode parents and duplicate ids', () => {
    const id = newId('nd')
    expect(
      issuesOf(
        manualSet([
          { op: 'createNode', id, nodeType: 'item', parent: { id: sectionId }, status: 'active' },
        ]),
      ),
    ).toContain('has no parent')
    expect(
      issuesOf(
        manualSet([{ op: 'createNode', id, nodeType: 'section', parent: null, status: 'active' }]),
      ),
    ).toContain('needs a parent')
    const create = { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' }
    expect(issuesOf(manualSet([create, create]))).toContain('created twice')
  })

  it('rejects bad sort keys, unknown ops and unknown keys', () => {
    const placement = { op: 'setPlacement', item: { id: itemId }, section: { id: sectionId } }
    expect(ChangeSetSchema.safeParse(manualSet([{ ...placement, sortKey: 'a' }])).success).toBe(
      false,
    )
    expect(
      ChangeSetSchema.safeParse(manualSet([{ op: 'deleteNode', node: { id: itemId } }])).success,
    ).toBe(false)
    expect(ChangeSetSchema.safeParse(manualSet([{ ...describeWrite, extra: 1 }])).success).toBe(
      false,
    )
    expect(ChangeSetSchema.safeParse({ ...manualSet([describeWrite]), tenant: 'x' }).success).toBe(
      false,
    )
  })

  it('parses clearField and holds it to the same layer and scope rules as a write', () => {
    const clear = {
      op: 'clearField',
      node: { id: itemId },
      fieldKey: 'name',
      layer: 'override',
      scope: 'master',
    }
    const parsed = parseChangeSet(manualSet([clear]))
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.value.ops[0]?.op).toBe('clearField')
    expect(issuesOf(manualSet([{ ...clear, layer: 'barsy' }]))).toContain(
      'cannot clear the barsy layer',
    )
    expect(issuesOf(manualSet([{ ...clear, scope: `venue:${venueId}` }]))).toContain('venue-scoped')
    expect(issuesOf(manualSet([{ ...clear, node: barsyPrice.node, layer: 'manual' }]))).toContain(
      'manual change sets name nodes by id',
    )
    const barsyClear = {
      ...manualSet([
        { ...clear, node: barsyPrice.node, layer: 'barsy', scope: `venue:${venueId}` },
      ]),
      source: 'barsy:int_club',
      actor: 'integration:int_club',
    }
    expect(parseChangeSet(barsyClear).ok).toBe(true)
  })

  it("accepts the position hint 'end', and only 'end' from adapters", () => {
    const placement = {
      op: 'setPlacement',
      item: barsyPrice.node,
      section: { link: { integration: 'int_club', externalType: 'category', externalId: '7' } },
    }
    const fromBarsy = (sortKey: string) => ({
      ...manualSet([{ ...placement, sortKey }]),
      source: 'barsy:int_club',
      actor: 'integration:int_club',
    })
    expect(parseChangeSet(fromBarsy('end')).ok).toBe(true)
    expect(issuesOf(fromBarsy('a0'))).toContain("places nodes with 'end'")
    const manual = { op: 'setPlacement', item: { id: itemId }, section: { id: sectionId } }
    expect(parseChangeSet(manualSet([{ ...manual, sortKey: 'end' }])).ok).toBe(true)
    expect(parseChangeSet(manualSet([{ ...manual, sortKey: 'a0' }])).ok).toBe(true)
    expect(parseChangeSet(manualSet([{ ...manual, sortKey: 'start' }])).ok).toBe(false)
  })

  it('carries the optional onlyIfUnplaced flag on a placement, and only as a boolean', () => {
    const placement = {
      op: 'setPlacement',
      item: barsyPrice.node,
      section: { link: { integration: 'int_club', externalType: 'category', externalId: '7' } },
      sortKey: 'end',
    }
    const fromBarsy = (op: unknown) => ({
      ...manualSet([op]),
      source: 'barsy:int_club',
      actor: 'integration:int_club',
    })
    const withFlag = parseChangeSet(fromBarsy({ ...placement, onlyIfUnplaced: true }))
    if (!withFlag.ok) throw new Error(withFlag.reason)
    expect(withFlag.value.ops[0]).toMatchObject({ op: 'setPlacement', onlyIfUnplaced: true })
    // Without the flag nothing changes (it stays absent, not false).
    const without = parseChangeSet(fromBarsy(placement))
    if (!without.ok) throw new Error(without.reason)
    expect(without.value.ops[0]).not.toHaveProperty('onlyIfUnplaced')
    expect(parseChangeSet(fromBarsy({ ...placement, onlyIfUnplaced: false })).ok).toBe(true)
    expect(parseChangeSet(fromBarsy({ ...placement, onlyIfUnplaced: 'yes' })).ok).toBe(false)
    expect(parseChangeSet(fromBarsy({ ...placement, onlyIfUnplacd: true })).ok).toBe(false)
  })

  it('setLinkState names a link of its own integration, a lifecycle state, and a hash only with seenAt', () => {
    const link = { integration: 'int_club', externalType: 'article', externalId: '102751' }
    const fromBarsy = (op: unknown, integration = 'int_club') => ({
      ...manualSet([op]),
      source: `barsy:${integration}`,
      actor: `integration:${integration}`,
    })
    const hash = 'a'.repeat(64)
    for (const state of ['active', 'missing', 'deleted']) {
      expect(parseChangeSet(fromBarsy({ op: 'setLinkState', link, state })).ok).toBe(true)
    }
    const seen = parseChangeSet(
      fromBarsy({
        op: 'setLinkState',
        link,
        state: 'active',
        seenAt: '2026-10-09T12:00:00+03:00',
        hash,
      }),
    )
    if (!seen.ok) throw new Error(seen.reason)
    expect(seen.value.ops[0]).toMatchObject({ op: 'setLinkState', hash })
    expect(nodeRefsOf(seen.value.ops[0] as never)).toEqual([])

    expect(issuesOf(fromBarsy({ op: 'setLinkState', link, state: 'active', hash }))).toContain(
      'seenAt',
    )
    expect(parseChangeSet(fromBarsy({ op: 'setLinkState', link, state: 'gone' })).ok).toBe(false)
    expect(
      parseChangeSet(
        fromBarsy({ op: 'setLinkState', link, state: 'active', seenAt: 'yesterday' }),
      ).ok,
    ).toBe(false)
    expect(
      parseChangeSet(
        fromBarsy({
          op: 'setLinkState',
          link,
          state: 'active',
          seenAt: '2026-10-09T12:00:00Z',
          hash: 'A'.repeat(64),
        }),
      ).ok,
    ).toBe(false)
    expect(issuesOf(fromBarsy({ op: 'setLinkState', link, state: 'missing' }, 'int_other'))).toContain(
      'cannot link another integration',
    )
    expect(parseChangeSet(fromBarsy({ op: 'setLinkState', link, state: 'missing', node: { id: itemId } })).ok).toBe(false)
  })

  it('gives a new section, group or option a sibling position, and a menu or item none', () => {
    const create = (nodeType: string, parent: unknown, sortKey?: string) => ({
      op: 'createNode',
      id: newId('nd'),
      nodeType,
      parent,
      status: 'active',
      ...(sortKey === undefined ? {} : { sortKey }),
    })
    const parent = { id: sectionId }
    expect(parseChangeSet(manualSet([create('section', parent)])).ok).toBe(true)
    expect(parseChangeSet(manualSet([create('section', parent, 'end')])).ok).toBe(true)
    expect(parseChangeSet(manualSet([create('option', parent, 'a3')])).ok).toBe(true)
    expect(parseChangeSet(manualSet([create('section', parent, 'oops')])).ok).toBe(false)
    expect(issuesOf(manualSet([create('item', null, 'a0')]))).toContain('no siblings')
    const fromBarsy = {
      ...manualSet([create('section', barsyPrice.node, 'a0')]),
      source: 'barsy:int_club',
      actor: 'integration:int_club',
    }
    expect(issuesOf(fromBarsy)).toContain("places nodes with 'end'")
  })

  it('types a parsed write', () => {
    const write: FieldWrite = FieldWriteSchema.parse(describeWrite)
    expect(write.layer).toBe('manual')
  })
})

describe('sources, layers and scopes', () => {
  it('recognises the allowed forms', () => {
    expect(['manual', 'import:wine-list', 'barsy:int_club'].every(isSource)).toBe(true)
    expect(['', 'import:', 'barsy', 'webhook:x', 'manual:x'].some(isSource)).toBe(false)
    expect(['barsy', 'import', 'manual', 'override', 'edition:venue-1'].every(isLayer)).toBe(true)
    expect(['edition:', 'master', 'Barsy'].some(isLayer)).toBe(false)
    expect(isScope('master') && isScope(`venue:${venueId}`)).toBe(true)
    expect(isScope('venue:vn_beach') || isScope('venue:')).toBe(false)
  })

  it('maps each source to the layers it may write', () => {
    expect(layerAllowedForSource('barsy:int_club', 'barsy')).toBe(true)
    expect(layerAllowedForSource('barsy:int_club', 'manual')).toBe(false)
    expect(layerAllowedForSource('import:wine-list', 'import')).toBe(true)
    expect(layerAllowedForSource('import:wine-list', 'override')).toBe(false)
    expect(layerAllowedForSource('manual', 'manual')).toBe(true)
    expect(layerAllowedForSource('manual', 'override')).toBe(true)
    expect(layerAllowedForSource('manual', 'edition:venue-1')).toBe(true)
    expect(layerAllowedForSource('manual', 'barsy')).toBe(false)
    expect(layerAllowedForSource('manual', 'import')).toBe(false)
  })
})

describe('moveNode', () => {
  const move = { op: 'moveNode', node: { id: sectionId }, parent: { id: newId('nd') } }

  it('takes a fractional key or the hint end, from a person', () => {
    expect(parseChangeSet(manualSet([{ ...move, sortKey: 'end' }])).ok).toBe(true)
    expect(parseChangeSet(manualSet([{ ...move, sortKey: 'a0' }])).ok).toBe(true)
    expect(parseChangeSet(manualSet([{ ...move, sortKey: 'start' }])).ok).toBe(false)
    expect(parseChangeSet(manualSet([{ ...move }])).ok).toBe(false)
    expect(parseChangeSet(manualSet([{ ...move, sortKey: 'a0', extra: 1 }])).ok).toBe(false)
  })

  it("holds an adapter to 'end', like every other position", () => {
    const fromBarsy = (sortKey: string) => ({
      ...manualSet([{ ...move, sortKey }]),
      source: 'barsy:int_club',
      actor: 'integration:int_club',
    })
    expect(parseChangeSet(fromBarsy('end')).ok).toBe(true)
    expect(issuesOf(fromBarsy('a0'))).toContain("places nodes with 'end'")
  })

  it('names both nodes it touches, so they are loaded and checked like any reference', () => {
    const op = ChangeSetSchema.parse(manualSet([{ ...move, sortKey: 'end' }])).ops[0]
    expect(op && nodeRefsOf(op)).toEqual([move.node, move.parent])
  })
})

describe('op names', () => {
  it('list every op the schema knows, once', () => {
    const schemaOps = ChangeSetOpSchema.options.map((option) => option.shape.op.value).sort()
    expect([...CHANGE_SET_OP_NAMES].sort()).toEqual(schemaOps)
  })
})
