import { JOB_NAMES } from '@restro/core'
import { describe, expect, it } from 'vitest'

import type { AlertsConfig } from '../config'
import { createAlertJobs, PING_TIMEOUT_MS, pingHealthcheck } from './alerts'

const NOTHING: AlertsConfig = {
  telegramToken: null,
  teamChatId: null,
  healthchecksUrl: null,
  vapid: null,
}
const VAPID = {
  publicKey: `B${'p'.repeat(86)}`,
  privateKey: 'q'.repeat(43),
  subject: 'mailto:ops@restro.example',
}
const PING_URL = 'https://hc-ping.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const names = (alerts: AlertsConfig) => createAlertJobs({ alerts }).map((job) => job.name)

describe('which alert jobs run', () => {
  it('runs none without a bot, push keys or watchdog address', () => {
    expect(names(NOTHING)).toEqual([])
  })

  it('delivers where the Telegram bot token or the push keys are set', () => {
    expect(names({ ...NOTHING, telegramToken: `1234567:${'T'.repeat(35)}` })).toEqual([
      JOB_NAMES.alertDelivery,
    ])
    expect(names({ ...NOTHING, vapid: VAPID })).toEqual([JOB_NAMES.alertDelivery])
  })

  it('pings the watchdog where its address is set', () => {
    expect(names({ ...NOTHING, healthchecksUrl: PING_URL })).toEqual([JOB_NAMES.healthcheckPing])
  })

  it('schedules both every minute', () => {
    const jobs = createAlertJobs({
      alerts: { ...NOTHING, vapid: VAPID, healthchecksUrl: PING_URL },
    })
    expect(jobs.map((job) => job.schedule?.cron)).toEqual(['* * * * *', '* * * * *'])
  })
})

describe('pingHealthcheck', () => {
  const warnings: unknown[][] = []
  const log = { warn: (...args: unknown[]) => void warnings.push(args) }

  it('asks the address it was given, with a time limit', async () => {
    const asked: { url: string; signal: AbortSignal | undefined }[] = []
    const reached = await pingHealthcheck(PING_URL, log, async (url, init) => {
      asked.push({ url: String(url), signal: init?.signal ?? undefined })
      return new Response('OK', { status: 200 })
    })
    expect(reached).toBe(true)
    expect(asked[0]?.url).toBe(PING_URL)
    expect(asked[0]?.signal).toBeDefined()
    expect(PING_TIMEOUT_MS).toBe(10_000)
  })

  it('says it was not reached, without writing the address into the log', async () => {
    warnings.length = 0
    expect(
      await pingHealthcheck(PING_URL, log, async () => {
        throw new TypeError(`fetch failed ${PING_URL}`)
      }),
    ).toBe(false)
    expect(
      await pingHealthcheck(PING_URL, log, async () => new Response('no', { status: 500 })),
    ).toBe(false)
    expect(JSON.stringify(warnings)).not.toContain('aaaaaaaa')
    expect(warnings).toHaveLength(2)
  })
})
