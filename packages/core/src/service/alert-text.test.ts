import { describe, expect, it } from 'vitest'

import { alertMessage, digestMessage, doneLine, linkedMessage } from './alert-text'

const context = { venueName: 'Club Nova', tableLabel: 'Table 7', source: 'barsy' }

const unconfirmed = {
  kind: 'order_unconfirmed',
  details: {
    reference: 'K7Q',
    items: [
      { name: 'Gin tonic', options: [], qty: 2 },
      { name: 'Mojito', options: ['no mint'], qty: 1 },
    ],
    notes: 'a guest note that must never travel',
    delivery: {},
  },
}

describe('alertMessage', () => {
  it('words an Unconfirmed order with the table, items, reference and where to check (D120)', () => {
    const message = alertMessage(unconfirmed, context, 'new')
    expect(message.title).toBe('Table 7: an order couldn’t be confirmed')
    expect(message.body).toBe(
      '2 × Gin tonic, 1 × Mojito (no mint), ref K7Q. Check the bill in barsy.',
    )
  })

  it('never carries a note or the delivery state', () => {
    const message = alertMessage(unconfirmed, context, 'new')
    expect(`${message.title} ${message.body}`).not.toMatch(/guest note|delivery/)
  })

  it('words a pause, its reminder, "still paused" and "back"', () => {
    const paused = { kind: 'ordering_paused', details: { scope: 'venue' } }
    expect(alertMessage(paused, context, 'new').title).toBe('Ordering is paused at Club Nova')
    expect(alertMessage(paused, context, 'reminder').title).toBe(
      'Ordering is still paused at Club Nova',
    )
    expect(alertMessage(paused, context, 'still_paused').title).toBe(
      'Ordering is still paused at Club Nova',
    )
    expect(alertMessage(paused, context, 'back').title).toBe('Ordering is back at Club Nova')
  })

  it('says which bar when a single bar is paused', () => {
    const paused = { kind: 'ordering_paused', details: { scope: 'bar', barName: 'Rooftop' } }
    expect(alertMessage(paused, context, 'new').title).toBe(
      'Ordering is paused at Rooftop, Club Nova',
    )
  })

  it('words what the Restro team gets, with the venue', () => {
    expect(alertMessage({ kind: 'order_pace', details: {} }, context, 'new').title).toBe(
      'Club Nova: Table 7 hit the order pace limit',
    )
    expect(alertMessage({ kind: 'order_rate', details: {} }, context, 'new').title).toBe(
      'Club Nova: Table 7 changed its order too fast',
    )
    expect(alertMessage({ kind: 'connection_unstable', details: {} }, context, 'new').title).toBe(
      'Club Nova: the connection to barsy is unstable',
    )
    expect(alertMessage({ kind: 'table_code_block', details: {} }, context, 'new').title).toBe(
      'Club Nova: a network was blocked after too many wrong table codes',
    )
  })

  it('words the pre-opening check', () => {
    expect(alertMessage({ kind: 'pre_opening_check', details: {} }, context, 'new').title).toBe(
      'Club Nova can’t open: Restro can’t work with barsy',
    )
  })

  it('falls back to the kind for one it does not know, never to details', () => {
    const message = alertMessage(
      { kind: 'something_new', details: { secret: 'x' } },
      context,
      'new',
    )
    expect(message.title).toBe('Club Nova: something_new')
    expect(message.body).toBe('')
  })
})

describe('digestMessage', () => {
  it('keeps one message as it is', () => {
    const one = alertMessage(unconfirmed, context, 'new')
    expect(digestMessage([one], 'Club Nova')).toEqual(one)
  })

  it('joins several into one push', () => {
    const one = alertMessage(unconfirmed, context, 'new')
    const other = alertMessage(unconfirmed, { ...context, tableLabel: 'Table 9' }, 'new')
    const digest = digestMessage([one, other], 'Club Nova')
    expect(digest.title).toBe('2 alerts at Club Nova')
    expect(digest.body).toBe(`${one.title}\n${other.title}`)
  })
})

describe('doneLine', () => {
  it('names who and when, in the venue’s time', () => {
    expect(doneLine('Maria', new Date('2026-10-23T23:14:00Z'), 'Europe/Sofia')).toBe(
      'Done by Maria, 02:14',
    )
  })
})

describe('linkedMessage', () => {
  it('puts a title and a body in one text', () => {
    expect(linkedMessage({ title: 'T', body: 'B' })).toBe('T\nB')
    expect(linkedMessage({ title: 'T', body: '' })).toBe('T')
  })
})
