// The pure parts of the end of the night's payments (#115): the meta line drops the pieces a
// payment doesn't have yet, and the CSV carries a payment under our own id, never a provider's.
import { describe, expect, it } from 'vitest'

import { moneyCsvRows, paymentCsvRow } from '@/server/tonight/night-csv'
import type { MoneySectionsView, PaymentRowView } from '@/server/tonight/payment-view'

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

describe('refunds and disputes in the CSV (#222)', () => {
  const say = (key: string, values?: Record<string, string | number>) =>
    `${key}${values === undefined ? '' : JSON.stringify(values)}`
  const money: MoneySectionsView = {
    alerts: [],
    refunds: [
      {
        refundId: 'rf_1',
        paymentId: 'py_1',
        paymentNumber: 'AB3CD',
        table: '7',
        numbered: true,
        amountMinor: 500,
        currency: 'EUR',
        receiptNumber: 'R-000123',
        serviceDate: '2026-10-28',
        earlier: false,
        failed: false,
        storno: { by: { who: { kind: 'person', name: 'Ivan' }, telegram: false }, time: '12:30' },
      },
      {
        refundId: 'rf_2',
        paymentId: 'py_1',
        paymentNumber: 'AB3CD',
        table: '7',
        numbered: true,
        amountMinor: 300,
        currency: 'EUR',
        receiptNumber: null,
        serviceDate: '2026-10-27',
        earlier: true,
        failed: false,
        storno: null,
      },
    ],
    disputes: [
      {
        paymentId: 'py_9',
        paymentNumber: 'KQ7MD',
        table: '3',
        numbered: true,
        amountMinor: 4600,
        currency: 'EUR',
        state: 'open',
        serviceDate: '2026-10-25',
        due: { date: '2026-11-04', time: '11:00' },
      },
    ],
    openDisputes: 1,
  }

  it('has a row per refund and per dispute, "refund" and "dispute" in the what column, our ids only', () => {
    const rows = moneyCsvRows(money, { say, provider: 'Stripe' })
    expect(rows.map((row) => [row.section, row.what, row.reference])).toEqual([
      ['nt_refunds', 'refund', 'py_1'],
      ['nt_refunds', 'refund', 'py_1'],
      ['nt_disputes', 'dispute', 'py_9'],
    ])
    expect(rows[0]).toMatchObject({ state: 'st_ok', amountMinor: 500, detail: 'R-000123' })
    expect(rows[1]).toMatchObject({ state: 'nt_fix_storno', amountMinor: 300, detail: '' })
    expect(rows[2]).toMatchObject({
      state: 'py_disputed',
      amountMinor: 4600,
      reason: 'd_due{"provider":"Stripe","date":"2026-11-04 11:00"}',
    })
  })
})
