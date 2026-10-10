// Splits the mapper's change set into chunks of at most 200 ops for apply() (brief S2-03b,
// decisions from S2-02's report):
//
//   - never split one node's ops across two chunks: a node's createNode, linkSource and its field
//     writes travel together, and so do all the placements of one item (`onlyIfUnplaced` counts
//     only placements that existed before the change set, so an item's second placement must see
//     the same "before" as its first);
//   - keep the dependency order: sections, then items, then their placements, then modifier
//     groups, then options (a child names its parent by link, which must exist by then);
//   - every chunk is its own change set with its own `cs_` id: the mapper's id is deterministic
//     and must not be reused.
//
// Pure: the ids are drawn by the caller-supplied function.

import type { ChangeSet, ChangeSetOp, NodeRef, SourceLink } from '@restro/core'

/** The most ops one apply() call gets. */
export const MAX_CHUNK_OPS = 200

const linkKey = (link: SourceLink) => `${link.externalType}:${link.externalId}`

/** Phases in dependency order, by the kind of barsy object a unit stands for. */
const PHASE: Readonly<Record<string, number>> = {
  category: 0,
  article: 1,
  placement: 2,
  supplement_group: 3,
  supplement: 4,
}

interface Unit {
  readonly key: string
  readonly phase: number
  readonly ops: ChangeSetOp[]
}

/** Splits `changeSet` into chunks that keep a node's ops together and the dependency order. */
export function chunkChangeSet(
  changeSet: ChangeSet,
  newChangeSetId: () => ChangeSet['id'],
  maxOps: number = MAX_CHUNK_OPS,
): ChangeSet[] {
  if (!Number.isInteger(maxOps) || maxOps < 1) throw new RangeError('maxOps must be positive')

  // A node created in this set is named by id in its createNode and linkSource and by link
  // everywhere after: learn which link belongs to which id first.
  const linkOfNode = new Map<string, string>()
  for (const op of changeSet.ops) {
    if (op.op === 'linkSource' && 'id' in op.node) linkOfNode.set(op.node.id, linkKey(op.link))
  }
  const nodeKey = (ref: NodeRef): string =>
    'link' in ref ? linkKey(ref.link) : (linkOfNode.get(ref.id) ?? `id:${ref.id}`)

  const units = new Map<string, Unit>()
  const unitFor = (key: string, phaseName: string): Unit => {
    let unit = units.get(key)
    if (!unit) {
      unit = { key, phase: PHASE[phaseName] ?? PHASE.article ?? 1, ops: [] }
      units.set(key, unit)
    }
    return unit
  }
  const phaseOf = (key: string): string => key.slice(0, key.indexOf(':'))

  for (const op of changeSet.ops) {
    switch (op.op) {
      case 'setPlacement':
      case 'removePlacement':
        unitFor(`placement:${nodeKey(op.item)}`, 'placement').ops.push(op)
        break
      case 'createNode': {
        const key = linkOfNode.get(op.id) ?? `id:${op.id}`
        unitFor(key, phaseOf(key)).ops.push(op)
        break
      }
      case 'setLinkState':
      case 'linkSource': {
        const key = linkKey(op.link)
        unitFor(key, phaseOf(key)).ops.push(op)
        break
      }
      case 'setField':
      case 'clearField':
      case 'setNodeStatus':
      case 'unlinkSource':
      case 'moveNode': {
        const key = nodeKey(op.node)
        unitFor(key, phaseOf(key)).ops.push(op)
        break
      }
    }
  }

  // Array.prototype.sort is stable: units of one phase keep the mapper's order (a parent
  // section before its sub-sections).
  const ordered = [...units.values()].sort((a, b) => a.phase - b.phase)

  const chunks: ChangeSetOp[][] = []
  let current: ChangeSetOp[] = []
  for (const unit of ordered) {
    if (current.length > 0 && current.length + unit.ops.length > maxOps) {
      chunks.push(current)
      current = []
    }
    current.push(...unit.ops)
  }
  if (current.length > 0) chunks.push(current)

  return chunks.map((ops) => ({
    id: newChangeSetId(),
    source: changeSet.source,
    jobId: changeSet.jobId,
    actor: changeSet.actor,
    observedAt: changeSet.observedAt,
    ops,
  })) as ChangeSet[]
}

/** Splits a flat list of independent ops (link-state updates) into change sets of at most `maxOps`. */
export function sliceOps(
  base: Pick<ChangeSet, 'source' | 'jobId' | 'actor' | 'observedAt'>,
  ops: readonly ChangeSetOp[],
  newChangeSetId: () => ChangeSet['id'],
  maxOps: number = MAX_CHUNK_OPS,
): ChangeSet[] {
  const sets: ChangeSet[] = []
  for (let start = 0; start < ops.length; start += maxOps) {
    sets.push({
      id: newChangeSetId(),
      ...base,
      ops: ops.slice(start, start + maxOps),
    } as ChangeSet)
  }
  return sets
}
