// The pure parts of the end of the night's payments (#115): the meta line drops the pieces a
// payment doesn't have yet, and the CSV carries a payment under our own id, never a provider's.
import { describe, expect, it } from 'vitest'

import { paymentCsvRow } from '@/server/tonight/night-csv'
import type { PaymentRowView } from '@/server/tonight/payment-view'

import { joinedMeta } from './night-payments'

const RAW = '{table} · paid at {payTable} · {bar} · receipt {rcpt}'

describe('the meta line of a payment', () => {
  it('names every piece it has', () => {
    expect(
      joinedMeta(RAW, { table: 'Table 7', payTable: 'Pay 1', bar: 'Main bar', rcpt: '1042' }),
    ).toBe('Table 7 · paid at Pay 1 · Main bar · receipt 1042')
  })

  it('leaves out what is not there yet, with its words', () => {
    expect(joinedMeta(RAW, { table: 'Table 7', payTable: 'Pay 1', bar: null, rcpt: null })).toBe(
      'Table 7 · paid at Pay 1',
    )
    expect(joinedMeta(RAW, { table: 'Table 7', payTable: null, bar: '', rcpt: '1042' })).toBe(
      'Table 7 · receipt 1042',
    )
  })
})

describe('a payment in the CSV', () => {
  const say = (key: string, values?: Record<string, string | number>) =>
    `${key}${values === undefined ? '' : JSON.stringify(values)}`
  const row: PaymentRowView = {
    id: 'py_0123456789ABCDEF',
    table: '7',
    numbered: true,
    bar: null,
    payTable: 'Pay 1',
    state: 'released',
    reason: 'busy',
    amountMinor: 3800,
    tipMinor: 200,
    receiptNumber: null,
    currency: 'EUR',
    time: '01:30',
  }

  it('carries our id as its reference, its state and reason words and its amounts', () => {
    expect(paymentCsvRow(row, say)).toMatchObject({
      section: 'nt_pay',
      time: '01:30',
      reference: 'py_0123456789ABCDEF',
      state: 'ps_released',
      reason: 'pr_busy',
      amountMinor: 3800,
      tipMinor: 200,
      detail: '',
    })
  })

  it('has no tip column for a role that never sees tips', () => {
    expect(paymentCsvRow({ ...row, tipMinor: null }, say)).not.toHaveProperty('tipMinor')
  })
})
