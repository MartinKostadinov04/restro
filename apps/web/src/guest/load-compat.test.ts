// The guest loader reads snapshots of both ages (brief SH-01 §10): one published before
// `theme.roles` / `theme.scheme` / `presentation` / `features` existed, and one with them. The
// loader checks every snapshot with `MenuSnapshotSchema`; these fields are optional forever inside
// `menu-snapshot/1`, so a phone keeps reading what was published before them.
import { readFileSync } from 'node:fs'

import {
  CurrentPointerSchema,
  DEFAULT_GUEST_FEATURES,
  DEFAULT_THEME,
  deriveRoles,
  type MenuSnapshot,
} from '@restro/core'
import { describe, expect, it } from 'vitest'

import { type LoadDeps, loadSnapshot } from './load'

/** A snapshot published before SH-01 (the demo menu of S3-10), as stored. */
function oldSnapshot(): MenuSnapshot {
  return JSON.parse(
    readFileSync(
      new URL('../../../../docs/guides/shell-handoff/barsy-demo-snapshot.json', import.meta.url),
      'utf8',
    ),
  ) as MenuSnapshot
}

/** Serves `body` for every address. */
function serving(body: unknown): LoadDeps {
  return { base: '/cdn', fetch: async () => Response.json(body) }
}

const pointerOf = (snapshot: MenuSnapshot) =>
  CurrentPointerSchema.parse({
    snapshot_id: snapshot.snapshot.id,
    version: snapshot.snapshot.version,
    hash: snapshot.snapshot.hash,
  })

describe('the guest loader and the snapshot fields of SH-01', () => {
  it('loads a snapshot published before them', async () => {
    const old = oldSnapshot()
    expect(old.theme.roles).toBeUndefined()
    expect(old.features).toBeUndefined()
    const loaded = await loadSnapshot(serving(old), pointerOf(old))
    expect(loaded.theme.palette).toEqual(old.theme.palette)
    expect(loaded.presentation).toBeUndefined()
  })

  it('loads a snapshot with them', async () => {
    const roles = deriveRoles({ primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: '#e0a43a' })
    const fresh = {
      ...oldSnapshot(),
      theme: { ...DEFAULT_THEME, roles, scheme: 'dark' },
      presentation: { face: 'editorial-market', options: { layout: 'two' } },
      features: DEFAULT_GUEST_FEATURES,
    }
    const loaded = await loadSnapshot(serving(fresh), pointerOf(fresh as MenuSnapshot))
    expect(loaded.theme.roles).toEqual(roles)
    expect(loaded.theme.scheme).toBe('dark')
    expect(loaded.presentation?.face).toBe('editorial-market')
    expect(loaded.features).toEqual(DEFAULT_GUEST_FEATURES)
  })
})
