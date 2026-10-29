import { afterEach, describe, expect, it, vi } from 'vitest'
import { payment as payScenarioPayment, RECEIPT_LOOK } from '../testing/paying'
import {
  type ConfirmationCanvas,
  confirmationOf,
  confirmationWords,
  DOWNLOAD_LINK_MS,
  drawConfirmation,
  formatPaidAt,
  prepareConfirmation,
  type SaveCanvas,
  type SaveEnv,
  type SaveShare,
  saveConfirmation,
} from './confirmation'
import { payMoney } from './paying'
import type { PaymentView } from './services'
import { stringsFor } from './strings'

const captured: PaymentView = payScenarioPayment({
  state: 'captured',
  form: null,
  tipMinor: 250,
  amountMinor: 2500,
  paidAt: '2026-10-29T19:42:00.000Z',
  timeZone: 'Europe/Sofia',
})

const LOCALES = ['bg_BG', 'en_US'] as const

describe('formatPaidAt', () => {
  it('shows the instant on the venue’s clock, not the phone’s', () => {
    // 19:42 UTC is 21:42 in Sofia after the clocks went back (29 Oct 2026).
    expect(formatPaidAt('2026-10-29T19:42:00.000Z', 'Europe/Sofia', 'en_US')).toContain('9:42')
    expect(formatPaidAt('2026-10-29T19:42:00.000Z', 'Europe/Sofia', 'bg_BG')).toContain('21:42')
    expect(formatPaidAt('2026-10-29T19:42:00.000Z', 'America/New_York', 'bg_BG')).toContain('15:42')
  })

  it('says nothing for an instant or a zone it cannot read', () => {
    expect(formatPaidAt(null, 'Europe/Sofia', 'en_US')).toBeNull()
    expect(formatPaidAt('not a date', 'Europe/Sofia', 'en_US')).toBeNull()
    expect(formatPaidAt('2026-10-29T19:42:00.000Z', 'Nowhere/Land', 'en_US')).toBeNull()
  })
})

describe('confirmationOf', () => {
  it('is for a captured payment only (no local success, D72)', () => {
    const words = stringsFor('en_US').services.paying
    for (const state of ['held', 'unconfirmed', 'released', 'capture_failed'] as const) {
      const view = confirmationOf({
        payment: { ...captured, state },
        venueName: 'Club X',
        otherItem: 'Other item',
        locale: 'en_US',
        words,
      })
      expect(view).toBeNull()
    }
  })

  it('carries the venue, time, lines, tip, total, "Paid by card" and the payment number', () => {
    const words = stringsFor('en_US').services.paying
    const view = confirmationOf({
      payment: captured,
      venueName: 'Club X',
      otherItem: 'Other item',
      locale: 'en_US',
      words,
    })
    expect(view).toMatchObject({
      title: 'Payment confirmation',
      venue: 'Club X',
      lines: [
        { text: 'House wine', amount: payMoney(1250, 'EUR', 'en_US') },
        { text: 'Mojito', amount: payMoney(1000, 'EUR', 'en_US') },
      ],
      tip: { label: 'Tip', amount: payMoney(250, 'EUR', 'en_US') },
      total: { label: 'Total', amount: payMoney(2500, 'EUR', 'en_US') },
      paidBy: 'Paid by card',
      number: { label: 'Payment number', value: 'K7Q4M' },
      note: 'This is not your receipt. Your waiter brings the venue’s receipt.',
      saveLabel: 'Save',
    })
    expect(view?.when).not.toBeNull()
  })

  it('leaves out the tip when there was none and marks a line of more than one', () => {
    const words = stringsFor('bg_BG').services.paying
    const view = confirmationOf({
      payment: {
        ...captured,
        tipMinor: 0,
        amountMinor: 2000,
        lines: [
          { name: { bg_BG: 'Мохито', en_US: 'Mojito' }, quantity: '2', amountMinor: 1500 },
          { name: null, quantity: '1', amountMinor: 500 },
        ],
      },
      venueName: '  ',
      otherItem: 'Друг артикул',
      locale: 'bg_BG',
      words,
    })
    expect(view?.tip).toBeNull()
    expect(view?.venue).toBeNull()
    // Each line in the guest's language; a line with no name is "Other item".
    expect(view?.lines).toEqual([
      { text: 'Мохито ×2', amount: payMoney(1500, 'EUR', 'bg_BG') },
      { text: 'Друг артикул', amount: payMoney(500, 'EUR', 'bg_BG') },
    ])
    expect(view?.total.amount).toBe(payMoney(2000, 'EUR', 'bg_BG'))
  })

  it('says the receipt went by email where it did (#186), and the waiter’s line otherwise', () => {
    for (const locale of LOCALES) {
      const words = stringsFor(locale).services.paying
      const plain = confirmationOf({
        payment: captured,
        venueName: 'Club X',
        otherItem: 'Other item',
        locale,
        words,
      })
      const said = (receiptEmailed: 'sent' | 'requested' | null, receiptEmail: string | null) =>
        confirmationOf({
          payment: { ...captured, receiptEmailed, receiptEmail },
          venueName: 'Club X',
          otherItem: 'Other item',
          locale,
          words,
        })
      const emailed = said('sent', 'ana@example.com')
      const requested = said('requested', 'ana@example.com')
      expect(plain?.note).toBe(words.confirmNotReceipt)
      expect(emailed?.note).toBe(words.confirmReceiptEmailed('ana@example.com'))
      expect(requested?.note).toBe(words.confirmReceiptRequested('ana@example.com'))
      expect(emailed?.note).toContain('ana@example.com')
      expect(emailed?.note).not.toContain(words.confirmNotReceipt.slice(-20))
      // No electronic receipt went out, or the address is not known here: the waiter's line.
      expect(said(null, 'ana@example.com')?.note).toBe(words.confirmNotReceipt)
      expect(said('sent', null)?.note).toBe(words.confirmNotReceipt)
    }
  })

  it('never has the look or the words of a receipt, in either language', () => {
    for (const locale of LOCALES) {
      const words = stringsFor(locale).services.paying
      for (const receiptEmailed of [null, 'sent', 'requested'] as const) {
        const view = confirmationOf({
          payment: {
            ...captured,
            receiptEmailed,
            receiptEmail: receiptEmailed === null ? null : 'ana@example.com',
          },
          venueName: 'Club X',
          otherItem: 'Other item',
          locale,
          words,
        })
        expect(view).not.toBeNull()
        const shown = [
          ...(view === null ? [] : confirmationWords(view)),
          words.paidInApp,
          words.confirmTitle,
          words.paidByCard,
          words.confirmNotReceipt,
          words.confirmReceiptEmailed('ana@example.com'),
          words.confirmReceiptRequested('ana@example.com'),
          words.paidReceiptEmailed('ana@example.com'),
          words.paidReceiptRequested('ana@example.com'),
          words.receiptEmail,
          words.confirmSave,
        ]
        for (const text of shown) {
          for (const pattern of RECEIPT_LOOK)
            expect(text, `${locale}: ${pattern}`).not.toMatch(pattern)
        }
        // The one the issue names, on its own.
        for (const text of shown) expect(text).not.toMatch(/(?<!\p{L})бон/u)
      }
    }
  })
})

/** A canvas context that records the text it was asked to draw. */
function recordingCanvas() {
  const drawn: string[] = []
  const ctx: ConfirmationCanvas = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: () => undefined,
    fillText: (text) => {
      drawn.push(text)
    },
    measureText: (text) => ({ width: text.length * 7 }),
  }
  return { ctx, drawn }
}

describe('drawConfirmation', () => {
  const view = confirmationOf({
    payment: captured,
    venueName: 'Club X',
    otherItem: 'Other item',
    locale: 'en_US',
    words: stringsFor('en_US').services.paying,
  })

  it('draws every fact of the page and nothing else', () => {
    expect(view).not.toBeNull()
    if (view === null) return
    const { ctx, drawn } = recordingCanvas()
    const height = drawConfirmation(ctx, view)
    expect(height).toBeGreaterThan(200)
    for (const text of [
      view.title,
      'Club X',
      'House wine',
      payMoney(1250, 'EUR', 'en_US'),
      'Tip',
      'Total',
      payMoney(2500, 'EUR', 'en_US'),
      'Paid by card',
      'K7Q4M',
    ]) {
      expect(drawn).toContain(text)
    }
    expect(drawn.join(' ')).toContain('not your receipt')
  })

  it('measures without painting', () => {
    if (view === null) return
    const { ctx, drawn } = recordingCanvas()
    const height = drawConfirmation(ctx, view, 480, false)
    expect(drawn).toEqual([])
    expect(height).toBe(drawConfirmation(recordingCanvas().ctx, view))
  })

  it('wraps a long line instead of running off the card', () => {
    if (view === null) return
    const long = { ...view, note: 'word '.repeat(60).trim() }
    const { ctx, drawn } = recordingCanvas()
    drawConfirmation(ctx, long)
    const rows = drawn.filter((row) => row.startsWith('word'))
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) expect(row.length * 7).toBeLessThanOrEqual(416)
  })
})

/** An environment that records what Save does with the phone. */
function fakeEnv(changes: Partial<SaveEnv> = {}) {
  const downloads: { url: string; name: string }[] = []
  const revoked: string[] = []
  const { ctx } = recordingCanvas()
  const canvas = {
    getContext: () => ({ ...ctx, scale: () => undefined }),
    toBlob: (done: (blob: Blob | null) => void) => done(new Blob(['png'], { type: 'image/png' })),
  } as unknown as SaveCanvas
  const env: SaveEnv = {
    createCanvas: () => canvas,
    createObjectURL: () => 'blob:phone/1',
    revokeObjectURL: (url) => {
      revoked.push(url)
    },
    download: (url, name) => {
      downloads.push({ url, name })
    },
    pixelRatio: 2,
    ...changes,
  }
  return { env, downloads, revoked }
}

describe('saveConfirmation', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const view = confirmationOf({
    payment: captured,
    venueName: 'Club X',
    otherItem: 'Other item',
    locale: 'en_US',
    words: stringsFor('en_US').services.paying,
  })

  it('keeps an image on the phone through a blob file, drops its link and sends nothing', async () => {
    if (view === null) throw new Error('no confirmation')
    vi.useFakeTimers()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { env, downloads, revoked } = fakeEnv()
    await expect(saveConfirmation(prepareConfirmation(view, () => env))).resolves.toBe('saved')
    expect(downloads).toEqual([{ url: 'blob:phone/1', name: 'payment-K7Q4M.png' }])
    expect(downloads[0]?.url.startsWith('blob:')).toBe(true)
    // The link does not last.
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(DOWNLOAD_LINK_MS - 1)
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(1)
    expect(revoked).toEqual(['blob:phone/1'])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('hands the image to the phone’s share sheet where it can share a file', async () => {
    if (view === null) throw new Error('no confirmation')
    const shared: SaveShare[] = []
    const { env, downloads } = fakeEnv({
      canShare: () => true,
      share: async (data) => {
        shared.push(data)
      },
    })
    await expect(saveConfirmation(prepareConfirmation(view, () => env))).resolves.toBe('saved')
    expect(shared).toHaveLength(1)
    expect(shared[0]?.files[0]?.name).toBe('payment-K7Q4M.png')
    expect(shared[0]?.files[0]?.type).toBe('image/png')
    expect(downloads).toEqual([])
  })

  it('does not call a closed share sheet a failure, and falls back to a file if sharing breaks', async () => {
    if (view === null) throw new Error('no confirmation')
    vi.useFakeTimers()
    const closed = fakeEnv({
      canShare: () => true,
      share: async () => {
        throw new DOMException('closed', 'AbortError')
      },
    })
    await expect(saveConfirmation(prepareConfirmation(view, () => closed.env))).resolves.toBe(
      'dismissed',
    )
    expect(closed.downloads).toEqual([])

    const broken = fakeEnv({
      canShare: () => true,
      share: async () => {
        throw new Error('no share here')
      },
    })
    await expect(saveConfirmation(prepareConfirmation(view, () => broken.env))).resolves.toBe(
      'saved',
    )
    expect(broken.downloads).toHaveLength(1)
  })

  it('fails (and shows no success) when the phone cannot draw an image', async () => {
    if (view === null) throw new Error('no confirmation')
    const { env } = fakeEnv({
      createCanvas: () => ({ getContext: () => null }) as unknown as SaveCanvas,
    })
    await expect(saveConfirmation(prepareConfirmation(view, () => env))).rejects.toThrow()
  })
})
