// The Log screen has a sentence for every kind of `LOG_KINDS` (#86; Log plan §5 "A code with no
// sentence"): add a kind to core's list without a sentence and this fails, so "Something happened
// (kind)" is never shown. `lease.taken_over` and `payment.hold_unread` alone have none, and never
// show (D120).
import { LOG_KIND_GROUP, LOG_KINDS } from '@restro/core/service'
import { describe, expect, it } from 'vitest'

import { SENTENCES } from '@/tonight/log-sentence'

describe('every kind of the Log has its place on the screen', () => {
  it('has a sentence for each kind of LOG_KINDS, and for no other', () => {
    expect(Object.keys(SENTENCES).sort()).toEqual(Object.keys(LOG_KINDS).sort())
  })

  it("hides a kind exactly when the Log's grouping hides it", () => {
    const noSentence = Object.entries(SENTENCES)
      .filter(([, sentence]) => sentence === null)
      .map(([kind]) => kind)
    const hidden = Object.entries(LOG_KIND_GROUP)
      .filter(([, group]) => group === null)
      .map(([kind]) => kind)
    expect(noSentence).toEqual(['lease.taken_over', 'payment.hold_unread'])
    expect(hidden).toEqual(noSentence)
  })
})
