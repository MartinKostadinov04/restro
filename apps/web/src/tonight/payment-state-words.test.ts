// The words of a payment (#115): every state the database knows has one in both languages, and every
// release reason core writes either has a word or is on the list of codes still waiting for one (a
// code with no word is never drawn raw; a new code fails here until someone decides).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { PAYMENT_STATES } from '@restro/db'
import { describe, expect, it } from 'vitest'

import {
  PAYMENT_ANSWER_WORDS,
  PAYMENT_RELEASE_REASONS,
  PAYMENT_STATE_WORDS,
  releaseReasonWord,
} from './payment-state-words'

const messages = (locale: 'en' | 'bg'): Record<string, string> =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../messages/${locale}.json`, import.meta.url)), 'utf8'),
  ).tonight

/** The reasons core writes on a released payment, with their words or none yet (stop-and-ask). */
const CORE_RELEASE_REASONS = [
  'cancelled',
  'busy',
  'paying_paused',
  'paying_not_offered',
  'check_failed',
  'no_receipt',
  'not_on_till',
  'expired',
  'hold_refused',
  'below_minimum',
  // Written by core, still without a word in the plan (asked of the lead, #115): never shown raw.
  'item_unavailable',
  'enter_refused',
  'bill_changed',
  'ask_waiter_to_split',
  'isolate_refused',
]
const WITHOUT_WORD = [
  'item_unavailable',
  'enter_refused',
  'bill_changed',
  'ask_waiter_to_split',
  'isolate_refused',
]

describe('the payment state words', () => {
  it('has a word in both languages for every state', () => {
    for (const state of PAYMENT_STATES) {
      const key = PAYMENT_STATE_WORDS[state]
      expect(key, state).toBeDefined()
      for (const locale of ['en', 'bg'] as const) {
        expect(messages(locale)[key ?? ''], `${locale} ${state}`).toBeTruthy()
      }
    }
  })

  it("has the plan's words", () => {
    expect(messages('en').ps_held).toBe('on hold')
    expect(messages('bg').ps_captured).toBe('таксувано')
    expect(messages('en').ps_capture_failed).toBe('card not charged')
  })
})

describe('the release reasons', () => {
  it('words every code with a word, in both languages, and the rest are the listed ones', () => {
    const wordless = CORE_RELEASE_REASONS.filter(
      (code) => PAYMENT_RELEASE_REASONS[code] === undefined,
    )
    expect(wordless.sort()).toEqual([...WITHOUT_WORD].sort())
    for (const code of Object.keys(PAYMENT_RELEASE_REASONS)) {
      for (const locale of ['en', 'bg'] as const) {
        expect(
          messages(locale)[PAYMENT_RELEASE_REASONS[code] ?? ''],
          `${locale} ${code}`,
        ).toBeTruthy()
      }
    }
  })

  it('never returns a raw code', () => {
    const say = (key: string) => messages('en')[key] ?? key
    expect(releaseReasonWord(say, 'expired')).toBe('the hold ran out')
    expect(releaseReasonWord(say, 'bill_changed')).toBeNull()
    expect(releaseReasonWord(say, null)).toBeNull()
  })
})

describe('the words of an answer', () => {
  it("keeps the till's answers apart from the receipt's", () => {
    const en = messages('en')
    expect(en[PAYMENT_ANSWER_WORDS.receipt_printed ?? '']).toBe('Receipt printed')
    expect(en[PAYMENT_ANSWER_WORDS.no_receipt ?? '']).toBe('No receipt')
    expect(en[PAYMENT_ANSWER_WORDS.on_till ?? '']).toBe('On the till')
    expect(en[PAYMENT_ANSWER_WORDS.not_on_till ?? '']).toBe('Not on the till')
  })
})
