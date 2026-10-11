import { CONNECTOR_LABELS, INTEGRATION_KINDS, type MenuDocument } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { tillLabelOf, tillLabelOfKind } from './till-label'

type Link = MenuDocument['links'][number]

const link = (nodeId: string, source: Link['source']): Link => ({
  nodeId: nodeId as Link['nodeId'],
  source,
  externalType: 'article',
  state: 'active',
})

describe('the name of a till ({source} in messages)', () => {
  it('is the connector kind’s label, or the kind itself for a kind core does not know', () => {
    for (const kind of INTEGRATION_KINDS) expect(tillLabelOfKind(kind)).toBe(CONNECTOR_LABELS[kind])
    expect(tillLabelOfKind('another')).toBe('another')
  })

  it('comes from the integration of the till links, never from a manual source', () => {
    const labels = { in_first: 'First till', in_second: 'Second till' }
    const links = [link('nd_a', 'till:in_second'), link('nd_b', 'till:in_first')]
    // The document: the first till link in id order.
    expect(tillLabelOf(links, labels)).toBe('First till')
    // One node: its own link.
    expect(tillLabelOf(links, labels, 'nd_a')).toBe('Second till')
    // No till link, or an integration without a name: no name.
    expect(tillLabelOf([link('nd_c', 'manual')], labels)).toBe('')
    expect(tillLabelOf(links, labels, 'nd_c')).toBe('')
    expect(tillLabelOf([link('nd_d', 'till:in_gone')], labels)).toBe('')
  })
})
