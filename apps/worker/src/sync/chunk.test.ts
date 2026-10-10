// The chunker on the real mapper output (the demo catalogue plus the burger combo): the rules
// from S2-02's report as properties of the result.
import { type ChangeSet, type ChangeSetOp, type NodeRef, newId } from '@restro/core'
import { describe, expect, it } from 'vitest'

// Test-only reach into barsy's mapping and its test data (the worker may import @restro/barsy;
// the fixtures helpers are not part of its public surface).
import { mapCatalogue } from '../../../../packages/barsy/src/mapping/catalogue.ts'
import {
  article,
  config,
  demoArticles,
  demoBurgerSupplements,
  input,
} from '../../../../packages/barsy/src/mapping/test-data.ts'
import { chunkChangeSet, MAX_CHUNK_OPS, sliceOps } from './chunk'

function mapped(): ChangeSet {
  const burger = article(7183, { categories: ['370'], has_supplements: 1 })
  const mapping = mapCatalogue(
    input({
      articles: [...demoArticles, burger],
      supplementsByArticle: { '7183': demoBurgerSupplements },
    }),
    config(),
  )
  if (!mapping.changeSet) throw new Error('no change set')
  return mapping.changeSet
}

const keyOfRef = (ref: NodeRef, idToLink: Map<string, string>): string =>
  'link' in ref
    ? `${ref.link.externalType}:${ref.link.externalId}`
    : (idToLink.get(ref.id) ?? `id:${ref.id}`)

/** The unit an op belongs to, computed independently of the chunker. */
function unitOf(op: ChangeSetOp, idToLink: Map<string, string>): string {
  switch (op.op) {
    case 'setPlacement':
    case 'removePlacement':
      return `placement:${keyOfRef(op.item, idToLink)}`
    case 'createNode':
      return idToLink.get(op.id) ?? `id:${op.id}`
    case 'linkSource':
    case 'setLinkState':
      return `${op.link.externalType}:${op.link.externalId}`
    default:
      return keyOfRef(op.node, idToLink)
  }
}

describe('chunkChangeSet', () => {
  const original = mapped()
  let counter = 0
  const chunks = chunkChangeSet(original, () => newId('cs'), MAX_CHUNK_OPS)
  const idToLink = new Map<string, string>()
  for (const op of original.ops) {
    if (op.op === 'linkSource' && 'id' in op.node) {
      idToLink.set(op.node.id, `${op.link.externalType}:${op.link.externalId}`)
    }
  }

  it('is a real split: the demo needs several chunks, none above 200 ops', () => {
    expect(original.ops.length).toBeGreaterThan(MAX_CHUNK_OPS)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.ops.length).toBeLessThanOrEqual(MAX_CHUNK_OPS)
    counter += 1
  })

  it('loses and repeats no op', () => {
    const canonical = (ops: readonly ChangeSetOp[]) => ops.map((op) => JSON.stringify(op)).sort()
    expect(canonical(chunks.flatMap((chunk) => chunk.ops))).toEqual(canonical(original.ops))
  })

  it('every chunk is its own change set: new cs_ id, same source, job, actor and time', () => {
    const ids = new Set(chunks.map((chunk) => chunk.id))
    expect(ids.size).toBe(chunks.length)
    expect(ids.has(original.id)).toBe(false)
    for (const chunk of chunks) {
      expect(chunk.id).toMatch(/^cs_[0-9A-Za-z]{22}$/)
      expect(chunk).toMatchObject({
        source: original.source,
        jobId: original.jobId,
        actor: original.actor,
        observedAt: original.observedAt,
      })
    }
  })

  it('never splits one node’s ops, nor the placements of one item, across two chunks', () => {
    const chunkOfUnit = new Map<string, number>()
    chunks.forEach((chunk, index) => {
      for (const op of chunk.ops) {
        const unit = unitOf(op, idToLink)
        const seen = chunkOfUnit.get(unit)
        if (seen !== undefined) expect(seen, unit).toBe(index)
        chunkOfUnit.set(unit, index)
      }
    })
    expect(chunkOfUnit.size).toBeGreaterThan(100)
  })

  it('keeps the dependency order: sections, items, placements, groups, options', () => {
    const order = ['category', 'article', 'placement', 'supplement_group', 'supplement']
    const phases = chunks
      .flatMap((chunk) => chunk.ops)
      .map((op) => order.indexOf(unitOf(op, idToLink).split(':')[0] ?? ''))
    expect(phases.every((phase) => phase >= 0)).toBe(true)
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i] as number).toBeGreaterThanOrEqual(phases[i - 1] as number)
    }
  })

  it('keeps a node’s own ops in their original order (create, link, then its fields)', () => {
    const byUnit = new Map<string, string[]>()
    for (const op of chunks.flatMap((chunk) => chunk.ops)) {
      const unit = unitOf(op, idToLink)
      byUnit.set(unit, [...(byUnit.get(unit) ?? []), op.op])
    }
    const originalByUnit = new Map<string, string[]>()
    for (const op of original.ops) {
      const unit = unitOf(op, idToLink)
      originalByUnit.set(unit, [...(originalByUnit.get(unit) ?? []), op.op])
    }
    expect(byUnit).toEqual(originalByUnit)
    expect(byUnit.get('article:11')?.slice(0, 2)).toEqual(['createNode', 'linkSource'])
  })

  it('a small change set stays one chunk; a unit above the limit gets a chunk of its own', () => {
    expect(chunkChangeSet(original, () => newId('cs'), 100_000)).toHaveLength(1)
    const tiny = chunkChangeSet(original, () => newId('cs'), 1)
    expect(tiny.every((chunk) => chunk.ops.length >= 1)).toBe(true)
    expect(tiny.flatMap((chunk) => chunk.ops)).toHaveLength(original.ops.length)
    expect(() => chunkChangeSet(original, () => newId('cs'), 0)).toThrow(RangeError)
    expect(counter).toBe(1)
  })
})

describe('sliceOps', () => {
  it('cuts a flat list into change sets of at most the limit, in order', () => {
    const ops = Array.from({ length: 450 }, (_, index) => ({
      op: 'setLinkState' as const,
      link: { integration: 'in_x', externalType: 'article', externalId: String(index + 1) },
      state: 'active' as const,
    }))
    const sets = sliceOps(
      {
        source: 'barsy:in_x',
        jobId: 'jb_x',
        actor: 'integration:in_x',
        observedAt: '2026-10-09T10:00:00Z',
      },
      ops,
      () => newId('cs'),
    )
    expect(sets.map((set) => set.ops.length)).toEqual([200, 200, 50])
    expect(sets.flatMap((set) => set.ops)).toEqual(ops)
    expect(new Set(sets.map((set) => set.id)).size).toBe(3)
    expect(
      sliceOps({ source: 'manual', jobId: 'j', actor: 'system', observedAt: 'x' }, [], () =>
        newId('cs'),
      ),
    ).toEqual([])
  })
})
