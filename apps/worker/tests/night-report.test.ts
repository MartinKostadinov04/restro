// The end-of-night message of a closed service day (#86; plan
// `docs/deliverables/2026-10-27-tonight-end-of-night-plan.md` §7): sent to the venue's own group
// in the venue's language, counts and problems only, never a money amount or a tip; nothing for a
// venue with no group; a failed send is logged and never throws (the close already happened).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const read = vi.hoisted(() => vi.fn())
const paid = vi.hoisted(() => vi.fn())

vi.mock('@restro/core/service', async (original) => ({
  ...(await original<typeof import('@restro/core/service')>()),
  readNightReport: read,
  readNightPaymentsReport: paid,
}))

import { DEFAULT_ORDERING_SETTINGS } from '@restro/core'
import type { DbPool } from '@restro/db'

import { sendNightReport } from '../src/alerts/night-report'
import type { TelegramClient } from '../src/alerts/telegram'

const day = { tenantId: 'tn_A1', venueId: 'vn_A1', serviceDate: '2026-10-26' }
const report = (fields: Record<string, unknown> = {}) => ({
  venueName: 'Club Luna',
  day: '2026-10-26',
  settings: { ordering: { ...DEFAULT_ORDERING_SETTINGS, telegramChatId: '-1001' } },
  defaultLocale: 'en_US',
  sentOrders: 84,
  added: 79,
  notSent: 3,
  unconfirmed: 2,
  fix: [
    { reference: 'K7Q', name: null, number: '7' },
    { reference: 'M2P', name: 'Loge', number: null },
  ],
  ...fields,
})

function deps(telegram: TelegramClient | null) {
  const warnings: unknown[] = []
  return {
    warnings,
    deps: {
      pool: {} as DbPool,
      telegram,
      log: { warn: (fields: unknown) => warnings.push(fields) },
    },
  }
}

function fakeTelegram(fail = false) {
  const sent: { chatId: string; text: string }[] = []
  const client = {
    sendMessage: async (chatId: string, text: string) => {
      if (fail) throw new Error('telegram down')
      sent.push({ chatId, text })
      return { chatId, messageId: 1 }
    },
  } as unknown as TelegramClient
  return { sent, client }
}

beforeEach(() => {
  paid.mockReset()
  paid.mockResolvedValue({ taken: 0, fix: [] })
})

describe('the end-of-night message', () => {
  it("goes to the venue's group with the totals and the problems", async () => {
    read.mockResolvedValueOnce(report())
    const telegram = fakeTelegram()
    const { deps: d } = deps(telegram.client)
    expect(await sendNightReport(d, day)).toBe(true)
    expect(telegram.sent).toEqual([
      {
        chatId: '-1001',
        text: [
          'Club Luna · night of 26 October',
          'Sent orders: 84 (added 79, not sent 3, unconfirmed 2)',
          'To fix (2):',
          '· Sent order K7Q, Table 7: still unconfirmed',
          '· Sent order M2P, Loge: still unconfirmed',
        ].join('\n'),
      },
    ])
  })

  it('is worded in Bulgarian for a Bulgarian venue, and says when nothing is to fix', async () => {
    read.mockResolvedValueOnce(report({ defaultLocale: 'bg_BG', unconfirmed: 0, fix: [] }))
    const telegram = fakeTelegram()
    await sendNightReport(deps(telegram.client).deps, day)
    expect(telegram.sent[0]?.text).toBe(
      [
        'Club Luna · вечерта на 26 октомври',
        'Поръчки: 84 (добавени 79, неизпратени 3, непотвърдени 0)',
        'Няма нищо за оправяне.',
      ].join('\n'),
    )
  })

  it('adds the payments as counts and words, with no amount (#115)', async () => {
    read.mockResolvedValueOnce(report({ fix: [] }))
    paid.mockResolvedValueOnce({
      taken: 41,
      fix: [{ name: null, number: '7', what: 'capture_failed' }],
    })
    const telegram = fakeTelegram()
    await sendNightReport(deps(telegram.client).deps, day)
    expect(telegram.sent[0]?.text).toBe(
      [
        'Club Luna · night of 26 October',
        'Sent orders: 84 (added 79, not sent 3, unconfirmed 2)',
        'Payments: 41 taken, 1 to fix',
        'To fix (1):',
        '· Payment, Table 7: card not charged after the bill closed',
      ].join('\n'),
    )
  })

  it('carries no money amount and no tip', async () => {
    read.mockResolvedValueOnce(report({ tipMinor: 999, capturedMinor: 12345, addedMinor: 77700 }))
    const telegram = fakeTelegram()
    await sendNightReport(deps(telegram.client).deps, day)
    expect(telegram.sent[0]?.text).not.toMatch(/999|12345|77700|[€$]|tip/i)
  })

  it('sends nothing to a venue with no group, a worker with no bot, or a day that is gone', async () => {
    read.mockResolvedValueOnce(report({ settings: {} }))
    const telegram = fakeTelegram()
    expect(await sendNightReport(deps(telegram.client).deps, day)).toBe(false)
    expect(await sendNightReport(deps(null).deps, day)).toBe(false)
    read.mockResolvedValueOnce(null)
    expect(await sendNightReport(deps(telegram.client).deps, day)).toBe(false)
    expect(telegram.sent).toEqual([])
  })

  it('logs a send that failed and does not throw', async () => {
    read.mockResolvedValueOnce(report())
    const { deps: d, warnings } = deps(fakeTelegram(true).client)
    expect(await sendNightReport(d, day)).toBe(false)
    expect(warnings).toHaveLength(1)
  })
})
