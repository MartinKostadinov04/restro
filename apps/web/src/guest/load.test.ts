import { CurrentPointerSchema, VenueIndexSchema } from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { describe, expect, it } from 'vitest'

import { cdnBase } from './cdn'
import { buildContext, chooseLocale, langParam, readTableToken } from './context'
import {
  files,
  GuestLoadError,
  LIVE_REFETCH_ATTEMPTS,
  LIVE_REFETCH_DELAY_MS,
  type LoadDeps,
  loadLive,
  loadMenu,
  loadPointer,
  loadSnapshot,
  loadTableLabel,
  loadVenueIndex,
  refetchLiveForSnapshot,
} from './load'

const BASE = '/cdn'

/** The published files of a fixture, by URL; anything else is a 404. */
function publishedFiles(name = 'tags-dietary', slug = 'demo-club') {
  const { snapshot, overlay } = fixture(name)
  const index = VenueIndexSchema.parse({
    venue_id: snapshot.snapshot.venue_id,
    menu_id: snapshot.snapshot.menu_id,
  })
  const pointer = CurrentPointerSchema.parse({
    snapshot_id: snapshot.snapshot.id,
    version: snapshot.snapshot.version,
    hash: snapshot.snapshot.hash,
  })
  const table = { venue_slug: slug, table_label: '12' }
  const bodies = new Map<string, unknown>([
    [files.index(BASE, slug), index],
    [files.current(BASE, index), pointer],
    [files.snapshot(BASE, pointer), snapshot],
    [files.live(BASE, index), overlay ?? { version: pointer.version, items: {} }],
    [files.table(BASE, 'tb_0123456789ABCDEFGHIJKL'), table],
  ])
  const asked: string[] = []
  const deps = (overrides: Map<string, unknown> = new Map()): LoadDeps => ({
    base: BASE,
    fetch: async (url) => {
      asked.push(url)
      const body = overrides.has(url) ? overrides.get(url) : bodies.get(url)
      if (body === undefined) return new Response(null, { status: 404 })
      if (body instanceof Response) return body
      return Response.json(body)
    },
  })
  return { deps, asked, index, pointer, snapshot, bodies }
}

describe('the guest loader follows the published files (rule 4)', () => {
  it('goes slug index -> pointer -> snapshot -> overlay, and asks for nothing else', async () => {
    const f = publishedFiles()
    const menu = await loadMenu(f.deps(), 'demo-club')
    expect(menu.index).toEqual(f.index)
    expect(menu.pointer).toEqual(f.pointer)
    expect(menu.snapshot.snapshot.id).toBe(f.pointer.snapshot_id)
    expect(menu.live).toEqual({ version: f.pointer.version, items: {} })
    // Every request is under the CDN base and is one of the four files of the chain.
    expect(f.asked).toHaveLength(4)
    expect(f.asked.every((url) => url.startsWith(`${BASE}/`))).toBe(true)
    expect(f.asked[0]).toBe(`${BASE}/v/demo-club.json`)
  })

  it('says the venue is unknown when the slug index is missing', async () => {
    const f = publishedFiles()
    await expect(loadMenu(f.deps(), 'no-such-club')).rejects.toMatchObject({
      reason: 'unknown_venue',
    })
    // A slug that cannot be one is unknown without asking anyone.
    const before = f.asked.length
    await expect(loadVenueIndex(f.deps(), '../etc/passwd')).rejects.toMatchObject({
      reason: 'unknown_venue',
    })
    await expect(loadVenueIndex(f.deps(), 'Demo Club')).rejects.toBeInstanceOf(GuestLoadError)
    expect(f.asked.length).toBe(before)
  })

  it('says the menu is not published yet when the venue has no pointer', async () => {
    const f = publishedFiles()
    // The index names a menu nothing was published for: its pointer file does not exist.
    const other = { venue_id: f.index.venue_id, menu_id: `nd_${'A'.repeat(22)}` }
    const index = new Map<string, unknown>([[files.index(BASE, 'demo-club'), other]])
    await expect(loadMenu(f.deps(index), 'demo-club')).rejects.toMatchObject({
      reason: 'not_published',
    })
  })

  it('shows the menu without sold-out marks when only the overlay is missing', async () => {
    const f = publishedFiles()
    const noLive = new Map<string, unknown>([
      [files.live(BASE, f.index), new Response(null, { status: 404 })],
    ])
    expect((await loadMenu(f.deps(noLive), 'demo-club')).live).toBeNull()
    const broken = new Map<string, unknown>([
      [files.live(BASE, f.index), new Response('nope', { status: 500 })],
    ])
    expect((await loadMenu(f.deps(broken), 'demo-club')).live).toBeNull()
    await expect(loadLive(f.deps(broken), f.index)).rejects.toMatchObject({ reason: 'failed' })
  })

  it('fails (to be retried) on a server error, bad JSON or a file of the wrong shape', async () => {
    const f = publishedFiles()
    const cases: [string, Response | object][] = [
      ['server error', new Response(null, { status: 503 })],
      ['not json', new Response('<html>', { status: 200 })],
      ['wrong shape', { venue_id: 'vn_x' }],
    ]
    for (const [label, body] of cases) {
      const overrides = new Map<string, unknown>([[files.index(BASE, 'demo-club'), body]])
      await expect(loadMenu(f.deps(overrides), 'demo-club'), label).rejects.toMatchObject({
        reason: 'failed',
      })
    }
    const offline: LoadDeps = {
      base: BASE,
      fetch: async () => {
        throw new TypeError('network down')
      },
    }
    await expect(loadMenu(offline, 'demo-club')).rejects.toMatchObject({ reason: 'failed' })
  })

  it('refuses a snapshot that fails the strict schema (e.g. one with a barsy id field)', async () => {
    const f = publishedFiles()
    const bad = { ...f.snapshot, items: { ...f.snapshot.items }, barsy_id: 55001 }
    const overrides = new Map<string, unknown>([[files.snapshot(BASE, f.pointer), bad]])
    await expect(loadSnapshot(f.deps(overrides), f.pointer)).rejects.toMatchObject({
      reason: 'failed',
    })
  })

  it('loads the pointer again for a refresh', async () => {
    const f = publishedFiles()
    expect(await loadPointer(f.deps(), f.index)).toEqual(f.pointer)
  })
})

describe('an overlay made for another snapshot version (S3-10)', () => {
  const instant = () => {
    const slept: number[] = []
    return { slept, sleep: async (ms: number) => void slept.push(ms) }
  }
  const firstItem = (f: ReturnType<typeof publishedFiles>) => Object.keys(f.snapshot.items)[0] ?? ''
  const overlayFor = (version: number, soldOut: string[] = []) => ({
    version,
    items: Object.fromEntries(soldOut.map((id) => [id, { sold_out: true }])),
  })

  it('addresses live.json with ?v=<snapshot version>, and a try number from the second try on', () => {
    const f = publishedFiles()
    const bust = (attempt: number) => files.live(BASE, f.index, { version: 7, attempt })
    expect(files.live(BASE, f.index)).toBe(
      `${BASE}/m/${f.index.menu_id}/${f.index.venue_id}/live.json`,
    )
    expect(bust(1)).toBe(`${files.live(BASE, f.index)}?v=7`)
    expect(bust(2)).toBe(`${files.live(BASE, f.index)}?v=7&r=2`)
    expect(bust(3)).toBe(`${files.live(BASE, f.index)}?v=7&r=3`)
  })

  it('asks again at once with ?v= and returns the overlay of the snapshot version', async () => {
    const f = publishedFiles()
    const version = f.snapshot.snapshot.version
    const fresh = overlayFor(version, [firstItem(f)])
    const overrides = new Map<string, unknown>([
      [files.live(BASE, f.index), overlayFor(version + 1)],
      [files.live(BASE, f.index, { version, attempt: 1 }), fresh],
    ])
    const waits = instant()
    const result = await refetchLiveForSnapshot(f.deps(overrides), f.index, version, waits)
    expect(result).toEqual(fresh)
    expect(f.asked).toEqual([files.live(BASE, f.index, { version, attempt: 1 })])
    expect(f.asked[0]).toContain('/live.json?v=')
    // The first ask is immediate.
    expect(waits.slept).toEqual([])
  })

  it('tries up to three times, two seconds apart, then leaves it to the normal polling', async () => {
    const f = publishedFiles()
    const version = f.snapshot.snapshot.version
    const stale = overlayFor(version + 1)
    const overrides = new Map<string, unknown>(
      [1, 2, 3].map((attempt) => [files.live(BASE, f.index, { version, attempt }), stale]),
    )
    const waits = instant()
    expect(await refetchLiveForSnapshot(f.deps(overrides), f.index, version, waits)).toBeNull()
    expect(f.asked).toEqual([
      `${files.live(BASE, f.index)}?v=${version}`,
      `${files.live(BASE, f.index)}?v=${version}&r=2`,
      `${files.live(BASE, f.index)}?v=${version}&r=3`,
    ])
    expect(waits.slept).toEqual([LIVE_REFETCH_DELAY_MS, LIVE_REFETCH_DELAY_MS])
    expect([LIVE_REFETCH_ATTEMPTS, LIVE_REFETCH_DELAY_MS]).toEqual([3, 2000])
  })

  it('stops at the first overlay that fits, and counts a failed fetch as a try', async () => {
    const f = publishedFiles()
    const version = f.snapshot.snapshot.version
    const fresh = overlayFor(version, [firstItem(f)])
    const overrides = new Map<string, unknown>([
      [files.live(BASE, f.index, { version, attempt: 1 }), new Response(null, { status: 503 })],
      [files.live(BASE, f.index, { version, attempt: 2 }), fresh],
    ])
    const waits = instant()
    expect(await refetchLiveForSnapshot(f.deps(overrides), f.index, version, waits)).toEqual(fresh)
    expect(f.asked).toHaveLength(2)
    expect(waits.slept).toEqual([LIVE_REFETCH_DELAY_MS])

    const offline: LoadDeps = {
      base: BASE,
      fetch: async () => {
        throw new TypeError('network down')
      },
    }
    expect(await refetchLiveForSnapshot(offline, f.index, version, instant())).toBeNull()
  })

  it('stops asking when nobody wants the answer any more', async () => {
    const f = publishedFiles()
    const version = f.snapshot.snapshot.version
    let asks = 0
    const deps: LoadDeps = {
      base: BASE,
      fetch: async () => {
        asks += 1
        return Response.json(overlayFor(version + 1))
      },
    }
    const result = await refetchLiveForSnapshot(deps, f.index, version, {
      sleep: async () => {},
      cancelled: () => asks >= 1,
    })
    expect(result).toBeNull()
    expect(asks).toBe(1)
  })
})

describe('the table banner', () => {
  const token = 'tb_0123456789ABCDEFGHIJKL'

  it('reads the label from t/<token>.json', async () => {
    const f = publishedFiles()
    expect(await loadTableLabel(f.deps(), token, 'demo-club')).toBe('12')
    expect(f.asked.at(-1)).toBe(`${BASE}/t/${token}.json`)
  })

  it('leaves the banner out for an unknown code, another venue, a bad token or a failure', async () => {
    const f = publishedFiles()
    expect(await loadTableLabel(f.deps(), 'tb_ZZZZZZZZZZZZZZZZZZZZZZ', 'demo-club')).toBeNull()
    expect(await loadTableLabel(f.deps(), token, 'other-club')).toBeNull()
    const before = f.asked.length
    expect(await loadTableLabel(f.deps(), '../x', 'demo-club')).toBeNull()
    expect(f.asked.length).toBe(before)
    const broken = new Map<string, unknown>([
      [files.table(BASE, token), new Response('x', { status: 500 })],
    ])
    expect(await loadTableLabel(f.deps(broken), token, 'demo-club')).toBeNull()
  })
})

describe('the CDN address', () => {
  it('is /cdn locally and the configured address, without a trailing slash, elsewhere', () => {
    expect(cdnBase({})).toBe('/cdn')
    expect(cdnBase({ NEXT_PUBLIC_CDN_BASE_URL: '  ' })).toBe('/cdn')
    expect(cdnBase({ NEXT_PUBLIC_CDN_BASE_URL: 'https://cdn.example.test/' })).toBe(
      'https://cdn.example.test',
    )
  })
})

describe('the guest context', () => {
  const available = ['bg_BG', 'en_US'] as const

  it('takes ?lang= first, then the browser, then the menu default', () => {
    const choice = (search: string, browser: string[], menuDefault: 'bg_BG' | 'en_US' = 'bg_BG') =>
      chooseLocale({ search, browser, available, menuDefault })
    expect(choice('?lang=en', ['bg-BG'])).toBe('en_US')
    expect(choice('?lang=bg_BG', ['en-US'])).toBe('bg_BG')
    expect(choice('', ['en-GB', 'bg'])).toBe('en_US')
    expect(choice('', ['de-DE', 'fr'])).toBe('bg_BG')
    expect(choice('', [], 'en_US')).toBe('en_US')
    // A language the menu lacks is passed over.
    expect(choice('?lang=de', ['en-US'])).toBe('en_US')
  })

  it('answers in Bulgarian or English before the menu is loaded, Bulgarian by default', () => {
    const early = (search: string, browser: string[]) =>
      chooseLocale({ search, browser, available: [], menuDefault: null })
    expect(early('?lang=en', [])).toBe('en_US')
    expect(early('', ['en-US'])).toBe('en_US')
    expect(early('', ['de-DE'])).toBe('bg_BG')
  })

  it('writes the short language form and reads only well-formed table tokens', () => {
    expect(langParam('bg_BG')).toBe('bg')
    expect(readTableToken('?t=tb_0123456789ABCDEFGHIJKL')).toBe('tb_0123456789ABCDEFGHIJKL')
    expect(readTableToken('?t=short')).toBeNull()
    expect(readTableToken('?t=../../x')).toBeNull()
    expect(readTableToken('')).toBeNull()
  })

  it('builds a qr context with ordering off', () => {
    const context = buildContext({
      locale: 'bg_BG',
      now: new Date('2026-10-10T12:00:00Z'),
      tableToken: null,
    })
    expect(context).toMatchObject({ channel: 'qr', orderingEnabled: false, tableToken: null })
  })
})
