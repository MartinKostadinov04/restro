import { describe, expect, it } from 'vitest'

import { evaluateHealth, HEARTBEAT_MAX_AGE_MS, WorkerStatus } from './health'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('evaluateHealth', () => {
  it('is 200 with the documented body while started and the beat is fresh', () => {
    expect(evaluateHealth({ pgboss: 'started', lastBeatAt: ago(30_000), now: NOW })).toEqual({
      httpStatus: 200,
      body: { status: 'ok', lastBeatAt: '2026-10-08T11:59:30.000Z', pgboss: 'started' },
    })
  })

  it('accepts a beat exactly three minutes old and rejects one a millisecond older', () => {
    expect(
      evaluateHealth({ pgboss: 'started', lastBeatAt: ago(HEARTBEAT_MAX_AGE_MS), now: NOW }),
    ).toMatchObject({ httpStatus: 200 })
    const stale = evaluateHealth({
      pgboss: 'started',
      lastBeatAt: ago(HEARTBEAT_MAX_AGE_MS + 1),
      now: NOW,
    })
    expect(stale.httpStatus).toBe(503)
    expect(stale.body).toMatchObject({
      status: 'unavailable',
      pgboss: 'started',
      reason: 'last heartbeat is older than 3 minutes',
    })
  })

  it.each(['starting', 'stopping', 'stopped'] as const)('is 503 while pg-boss is %s', (state) => {
    const report = evaluateHealth({ pgboss: state, lastBeatAt: ago(1000), now: NOW })
    expect(report.httpStatus).toBe(503)
    expect(report.body).toMatchObject({ status: 'unavailable', pgboss: state })
    expect(report.body.reason).toBe(`pg-boss is ${state}`)
  })

  it('is 503 before the first heartbeat, with lastBeatAt null', () => {
    const report = evaluateHealth({ pgboss: 'started', lastBeatAt: null, now: NOW })
    expect(report).toEqual({
      httpStatus: 503,
      body: {
        status: 'unavailable',
        lastBeatAt: null,
        pgboss: 'started',
        reason: 'no heartbeat recorded yet',
      },
    })
  })
})

describe('WorkerStatus', () => {
  it('starts unavailable and turns healthy once pg-boss is started and a beat is recorded', () => {
    const status = new WorkerStatus()
    expect(status.report(NOW).httpStatus).toBe(503)
    status.setPgBoss('started')
    expect(status.report(NOW).body.reason).toBe('no heartbeat recorded yet')
    status.recordBeat(ago(1000))
    expect(status.report(NOW).httpStatus).toBe(200)
    expect(status.lastBeatAt).toEqual(ago(1000))
  })

  it('turns stale with time and healthy again with a newer beat', () => {
    const status = new WorkerStatus()
    status.setPgBoss('started')
    status.recordBeat(NOW)
    const later = new Date(NOW.getTime() + HEARTBEAT_MAX_AGE_MS + 1)
    expect(status.report(later).httpStatus).toBe(503)
    status.recordBeat(later)
    expect(status.report(later).httpStatus).toBe(200)
  })

  it('never moves the last beat backwards', () => {
    const status = new WorkerStatus()
    status.recordBeat(NOW)
    status.recordBeat(ago(60_000))
    expect(status.lastBeatAt).toEqual(NOW)
  })
})
