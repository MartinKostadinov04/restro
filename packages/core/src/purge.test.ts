import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  CHANGE_LOG_DAYS,
  cutoff,
  INSTANCE_BIN_DAYS,
  isDue,
  MENU_BIN_DAYS,
  TABLE_BIN_DAYS,
  VENUE_BIN_DAYS,
  VERSION_PURGE_DAYS,
  VERSIONS_KEPT,
  type VersionRow,
  versionsToPurge,
} from './purge'

const NOW = new Date('2026-10-12T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

function row(version: number, ageDays: number, overrides: Partial<VersionRow> = {}): VersionRow {
  return {
    id: `sn_${String(version).padStart(22, '0')}`,
    version,
    status: 'published',
    reason: 'manual',
    hasBody: true,
    restoresSnapshotId: null,
    createdAt: daysAgo(ageDays),
    ...overrides,
  }
}

describe('how long the bin keeps things (D83)', () => {
  it('is 30 days for a venue, a menu and a table, and 61 for the change log', () => {
    expect([VENUE_BIN_DAYS, MENU_BIN_DAYS, TABLE_BIN_DAYS, CHANGE_LOG_DAYS]).toEqual([
      30, 30, 30, 61,
    ])
    expect(isDue(daysAgo(29), NOW, VENUE_BIN_DAYS)).toBe(false)
    expect(isDue(daysAgo(29), NOW, MENU_BIN_DAYS)).toBe(false)
    expect(isDue(daysAgo(29), NOW, TABLE_BIN_DAYS)).toBe(false)
    expect(isDue(daysAgo(59), NOW, CHANGE_LOG_DAYS)).toBe(false)
  })

  it('is 30 days for a removed POS instance (D91) and for a version that is not live (D96), and 2 are kept (D96)', () => {
    expect(INSTANCE_BIN_DAYS).toBe(30)
    expect(VERSION_PURGE_DAYS).toBe(30)
    expect(VERSIONS_KEPT).toBe(2)
  })
})

describe('what is due (D83)', () => {
  it('a venue is due 30 days after its deletion, not before; nothing undated is due', () => {
    expect(isDue(daysAgo(VENUE_BIN_DAYS), NOW, VENUE_BIN_DAYS)).toBe(true)
    expect(isDue(daysAgo(VENUE_BIN_DAYS + 5).toISOString(), NOW, VENUE_BIN_DAYS)).toBe(true)
    expect(isDue(daysAgo(VENUE_BIN_DAYS - 1), NOW, VENUE_BIN_DAYS)).toBe(false)
    expect(isDue(null, NOW, VENUE_BIN_DAYS)).toBe(false)
    expect(cutoff(NOW, CHANGE_LOG_DAYS).getTime()).toBe(daysAgo(CHANGE_LOG_DAYS).getTime())
  })
})

describe('which versions go (D96)', () => {
  it('keeps the live one, the two newest restorable ones that are young, and purges the rest', () => {
    const rows = [row(1, 40), row(2, 35), row(3, 10), row(4, 5), row(5, 1)]
    const decision = versionsToPurge({ now: NOW, currentSnapshotId: rows[4]?.id ?? '', rows })
    // 5 is live; 4 and 3 are the two restorable ones; 2 and 1 are older than 30 days anyway.
    expect(decision.keep).toEqual([rows[4]?.id, rows[3]?.id, rows[2]?.id])
    expect(decision.purge).toEqual([rows[0]?.id, rows[1]?.id])
  })

  it('a restorable version older than 30 days goes even when it is one of the last two', () => {
    const rows = [row(1, 45), row(2, 31), row(3, 0)]
    const decision = versionsToPurge({ now: NOW, currentSnapshotId: rows[2]?.id ?? '', rows })
    expect(decision.purge).toEqual([rows[0]?.id, rows[1]?.id])
  })

  it('an older restorable version beyond the last two stays only while it is young', () => {
    const rows = [row(1, 3), row(2, 2), row(3, 1), row(4, 0)]
    const decision = versionsToPurge({ now: NOW, currentSnapshotId: rows[3]?.id ?? '', rows })
    // Three days old: not restorable (beyond the two), but still history.
    expect(decision.purge).toEqual([])
    const later = versionsToPurge({
      now: daysAgo(-VERSION_PURGE_DAYS),
      currentSnapshotId: rows[3]?.id ?? '',
      rows,
    })
    expect(later.purge).toEqual([rows[0]?.id, rows[1]?.id, rows[2]?.id])
  })

  it('held, rejected and rollback rows are history: kept 30 days, never restorable', () => {
    const rows = [
      row(1, 50),
      row(2, 20, { status: 'held', hasBody: true }),
      row(3, 20, { status: 'rejected', hasBody: true }),
      row(4, 40, {
        reason: 'rollback',
        hasBody: false,
        restoresSnapshotId: 'sn_0000000000000000000001',
      }),
      row(5, 0),
    ]
    const decision = versionsToPurge({ now: NOW, currentSnapshotId: rows[4]?.id ?? '', rows })
    expect(decision.purge).toEqual([rows[0]?.id, rows[3]?.id])
    expect(decision.keep).toEqual([rows[4]?.id, rows[2]?.id, rows[1]?.id])
  })

  it('a kept rollback record keeps the snapshot it restored, however old that is', () => {
    const target = row(1, 90)
    const rollback = row(3, 2, {
      reason: 'rollback',
      hasBody: false,
      restoresSnapshotId: target.id,
    })
    const rows = [target, row(2, 60), rollback, row(4, 0)]
    const decision = versionsToPurge({ now: NOW, currentSnapshotId: rows[3]?.id ?? '', rows })
    expect(decision.purge).toEqual([rows[1]?.id])
    expect(decision.keep).toContain(target.id)
  })

  it('with nothing published, every row is history and goes by age', () => {
    const rows = [row(1, 40), row(2, 10)]
    const decision = versionsToPurge({ now: NOW, currentSnapshotId: null, rows })
    expect(decision.purge).toEqual([rows[0]?.id])
  })

  it('property: the live version is never purged, at most two others are restorable, and a kept rollback keeps its target', () => {
    const rowArb = fc.record({
      ageDays: fc.integer({ min: 0, max: 120 }),
      status: fc.constantFrom('published', 'held', 'rejected') as fc.Arbitrary<
        VersionRow['status']
      >,
      rollback: fc.boolean(),
    })
    fc.assert(
      fc.property(fc.array(rowArb, { minLength: 1, maxLength: 12 }), fc.nat(), (specs, pick) => {
        const rows: VersionRow[] = []
        specs.forEach((spec, index) => {
          const isRollback = spec.rollback && index > 0 && spec.status === 'published'
          rows.push(
            row(index + 1, spec.ageDays, {
              status: spec.status,
              reason: isRollback ? 'rollback' : 'manual',
              hasBody: !isRollback,
              restoresSnapshotId: isRollback ? (rows[pick % index]?.id ?? null) : null,
            }),
          )
        })
        const live = rows.filter((r) => r.status === 'published' && r.hasBody)
        const current = live.length === 0 ? null : (live[pick % live.length]?.id ?? null)
        const decision = versionsToPurge({ now: NOW, currentSnapshotId: current, rows })
        const purged = new Set(decision.purge)
        if (current !== null) expect(purged.has(current)).toBe(false)
        // The two newest restorable versions (besides the live one) stay while young.
        const restorable = rows
          .filter((r) => r.id !== current && r.status === 'published' && r.hasBody)
          .sort((a, b) => b.version - a.version)
          .slice(0, VERSIONS_KEPT)
        for (const r of restorable) {
          if (!isDue(r.createdAt, NOW, VERSION_PURGE_DAYS)) expect(purged.has(r.id)).toBe(false)
        }
        // Everything purged is old, or a restorable version beyond the newest two.
        const newestTwo = new Set(restorable.map((r) => r.id))
        for (const r of rows) {
          if (!purged.has(r.id)) continue
          const old = isDue(r.createdAt, NOW, VERSION_PURGE_DAYS)
          const beyond = r.status === 'published' && r.hasBody && !newestTwo.has(r.id)
          expect(old || beyond).toBe(true)
        }
        // A kept rollback record keeps its target.
        for (const r of rows) {
          if (purged.has(r.id)) continue
          if (r.restoresSnapshotId !== null) expect(purged.has(r.restoresSnapshotId)).toBe(false)
        }
        // Purged rows come oldest first and are not kept.
        expect([...decision.purge]).toEqual(
          rows
            .filter((r) => purged.has(r.id))
            .sort((a, b) => a.version - b.version)
            .map((r) => r.id),
        )
        for (const id of decision.keep) expect(purged.has(id)).toBe(false)
      }),
    )
  })
})
