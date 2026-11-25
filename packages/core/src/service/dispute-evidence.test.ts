// The "Dispute evidence" text (#222; D122 §8): the same fields in the same order in both
// languages, in the venue's clock, with no link, no card digits and no device or IP identifier.
// Pure: no database.
import { describe, expect, it } from 'vitest'

import { type DisputeEvidenceInput, disputeEvidenceText } from './dispute-evidence'

const evidence = (fields: Partial<DisputeEvidenceInput> = {}): DisputeEvidenceInput => ({
  paymentNumber: '4821',
  serviceDate: '2026-10-28',
  timeZone: 'Europe/Sofia',
  currency: 'EUR',
  amountMinor: 4600,
  tipMinor: 400,
  capturedMinor: 4600,
  table: '7',
  tableNumbered: true,
  payTable: 'Pay 1',
  payTableNumbered: false,
  bar: 'Main bar',
  lines: [
    { name: 'Gin tonic', quantity: '2', amountMinor: 2400 },
    { name: 'Mojito', quantity: '1.000000', amountMinor: 1800 },
  ],
  steps: [
    {
      at: new Date('2026-10-28T20:55:00Z'),
      kind: 'payment.state',
      toState: 'held',
      reason: null,
      who: { kind: 'guest' },
    },
    {
      at: new Date('2026-10-28T21:03:00Z'),
      kind: 'payment.answered',
      toState: null,
      reason: 'receipt_printed',
      who: { kind: 'person', name: 'Maria' },
    },
    {
      at: new Date('2026-10-28T21:04:00Z'),
      kind: 'payment.state',
      toState: 'captured',
      reason: null,
      who: { kind: 'restro' },
    },
  ],
  threeDs: 'authenticated',
  providerPaymentRef: 'pi_3Test123',
  authorisationCode: 'A1B2C3',
  receiptNumber: 'R-000123',
  fiscalMemoryNumber: 'FM-77881',
  dispute: {
    state: 'open',
    openedAt: new Date('2026-11-02T08:00:00Z'),
    dueAt: new Date('2026-11-12T08:59:00Z'),
    closedAt: null,
  },
  refunds: [
    {
      amountMinor: 500,
      seenAt: new Date('2026-10-30T10:00:00Z'),
      failed: false,
      storno: { who: { kind: 'person', name: 'Ivan' }, at: new Date('2026-10-30T12:30:00Z') },
    },
    { amountMinor: 700, seenAt: new Date('2026-10-31T10:00:00Z'), failed: true, storno: null },
  ],
  ...fields,
})

const ENGLISH = `Evidence for a card payment dispute
Payment: 4821
Night: 2026-10-28
Total: 46.00 EUR
Tip: 4.00 EUR
Charged: 46.00 EUR

Guest's table: Table 7
Payment table: Pay 1
Bar: Main bar

Items the guest confirmed:
- 2 × Gin tonic: 24.00 EUR
- 1 × Mojito: 18.00 EUR

Steps:
- 2026-10-28 22:55 amount held
- 2026-10-28 23:04 charged

Staff's answers:
- 2026-10-28 23:03 receipt printed (Maria)

3-D Secure: authenticated by the bank
Provider's payment id: pi_3Test123
Authorisation code: A1B2C3
Receipt number: R-000123
Fiscal memory number: FM-77881

Refunds:
- 2026-10-30 12:00 5.00 EUR: storno done, Ivan, 2026-10-30 14:30
- 2026-10-31 12:00 7.00 EUR: the refund didn't go through

Dispute: open
Opened: 2026-11-02 10:00
Answer by: 2026-11-12 10:59`

const BULGARIAN = `Доказателства по спор за плащане с карта
Плащане: 4821
Вечер: 2026-10-28
Общо: 46.00 EUR
Бакшиш: 4.00 EUR
Таксувано: 46.00 EUR

Маса на госта: Маса 7
Маса за плащане: Pay 1
Бар: Main bar

Артикули, потвърдени от госта:
- 2 × Gin tonic: 24.00 EUR
- 1 × Mojito: 18.00 EUR

Стъпки:
- 2026-10-28 22:55 сумата е задържана
- 2026-10-28 23:04 таксувано

Отговори на персонала:
- 2026-10-28 23:03 бележката е отпечатана (Maria)

3-D Secure: удостоверено от банката
Номер на плащането при доставчика: pi_3Test123
Код за одобрение: A1B2C3
Номер на бележка: R-000123
Номер на фискална памет: FM-77881

Връщания:
- 2026-10-30 12:00 5.00 EUR: сторно направено, Ivan, 2026-10-30 14:30
- 2026-10-31 12:00 7.00 EUR: връщането не е минало

Спор: отворен
Открит: 2026-11-02 10:00
Отговор до: 2026-11-12 10:59`

describe('the dispute evidence text', () => {
  it('is pinned in English and in Bulgarian, in the venue’s own clock', () => {
    expect(disputeEvidenceText(evidence(), 'en')).toBe(ENGLISH)
    expect(disputeEvidenceText(evidence(), 'bg')).toBe(BULGARIAN)
  })

  it('holds no link, no card digits and no device or IP identifier', () => {
    for (const locale of ['en', 'bg'] as const) {
      const text = disputeEvidenceText(evidence(), locale)
      expect(text).not.toMatch(/https?:|www\./i)
      expect(text).not.toMatch(/\b\d{12,19}\b/)
      expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/)
      expect(text).not.toMatch(/\bip\b|device/i)
    }
  })

  it('leaves out what a payment does not have, and words a field it lacks as a dash', () => {
    const text = disputeEvidenceText(
      evidence({
        tipMinor: 0,
        payTable: null,
        bar: null,
        lines: [],
        steps: [],
        threeDs: null,
        authorisationCode: null,
        receiptNumber: null,
        fiscalMemoryNumber: null,
        dispute: null,
        refunds: [],
      }),
      'en',
    )
    expect(text).not.toContain('Tip:')
    expect(text).not.toContain('Items the guest confirmed')
    expect(text).not.toContain('Refunds:')
    expect(text).not.toContain('Dispute:')
    expect(text).toContain('Payment table: -')
    expect(text).toContain('3-D Secure: -')
    expect(text).toContain('Receipt number: -')
    expect(text).toContain('Fiscal memory number: -')
  })

  it('words an unanswered refund and a closed dispute', () => {
    const text = disputeEvidenceText(
      evidence({
        refunds: [
          {
            amountMinor: 500,
            seenAt: new Date('2026-10-30T10:00:00Z'),
            failed: false,
            storno: null,
          },
        ],
        dispute: {
          state: 'lost',
          openedAt: new Date('2026-11-02T08:00:00Z'),
          dueAt: null,
          closedAt: new Date('2026-11-20T08:00:00Z'),
        },
      }),
      'en',
    )
    expect(text).toContain('5.00 EUR: storno not done yet')
    expect(text).toContain('Dispute: lost')
    expect(text).toContain('Closed: 2026-11-20 10:00')
    expect(text).not.toContain('Answer by')
  })
})
