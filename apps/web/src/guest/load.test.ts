import { CurrentPointerSchema, VenueIndexSchema } from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { describe, expect, it } from 'vitest'

import { faceEntry } from '@/faces/registry'
import { cdnBase } from './cdn'
import { buildContext, chooseLocale, confirmedTable, langParam, readTableToken } from './context'
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
/** The public code of the venue in these tests; the slug is only decoration (D68). */
const CODE = 'k3x9p2m7qa1z'

/** The published files of a fixture, by URL; anything else is a 404. */
function publishedFiles(name = 'tags-dietary', code = CODE) {
  const { snapshot, overlay } = fixture(name)
  const index = VenueIndexSchema.parse({
    venue_id: snapshot.snapshot.venue_id,
    menu_id: snapshot.snapshot.menu_id,
    slug: 'demo-club',
  })
  const pointer = CurrentPointerSchema.parse({
    snapshot_id: snapshot.snapshot.id,
    version: snapshot.snapshot.version,
    hash: snapshot.snapshot.hash,
  })
  const table = { venue_public_id: code, venue_slug: 'demo-club', table_label: '12' }
  const bodies = new Map<string, unknown>([
    [files.index(BASE, code), index],
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
  it('goes venue index -> pointer -> snapshot -> overlay, and asks for nothing else', async () => {
    const f = publishedFiles()
    const menu = await loadMenu(f.deps(), CODE)
    expect(menu.index).toEqual(f.index)
    expect(menu.pointer).toEqual(f.pointer)
    expect(menu.snapshot.snapshot.id).toBe(f.pointer.snapshot_id)
    expect(menu.live).toEqual({ version: f.pointer.version, items: {} })
    // Every request is under the CDN base and is one of the four files of the chain.
    expect(f.asked).toHaveLength(4)
    expect(f.asked.every((url) => url.startsWith(`${BASE}/`))).toBe(true)
    expect(f.asked[0]).toBe(`${BASE}/v/${CODE}.json`)
  })

  it('carries the current slug in the venue index', async () => {
    const f = publishedFiles()
    expect((await loadVenueIndex(f.deps(), CODE)).slug).toBe('demo-club')
  })

  it('says the venue is unknown when the index of the code is missing', async () => {
    const f = publishedFiles()
    await expect(loadMenu(f.deps(), '000000000000')).rejects.toMatchObject({
      reason: 'unknown_venue',
    })
    // Something that cannot be a public code is unknown without asking anyone.
    const before = f.asked.length
    await expect(loadVenueIndex(f.deps(), '../etc/passwd')).rejects.toMatchObject({
      reason: 'unknown_venue',
    })
    await expect(loadVenueIndex(f.deps(), 'Demo Club')).rejects.toBeInstanceOf(GuestLoadError)
    // A slug alone is no code, and neither is a code in capitals.
    await expect(loadVenueIndex(f.deps(), 'demo-club')).rejects.toMatchObject({
      reason: 'unknown_venue',
    })
    await expect(loadVenueIndex(f.deps(), CODE.toUpperCase())).rejects.toMatchObject({
      reason: 'unknown_venue',
    })
    expect(f.asked.length).toBe(before)
  })

  it('says the menu is not published yet when the venue has no pointer', async () => {
    const f = publishedFiles()
    // The index names a menu nothing was published for: its pointer file does not exist.
    const other = { venue_id: f.index.venue_id, menu_id: `nd_${'A'.repeat(22)}`, slug: 'demo-club' }
    const index = new Map<string, unknown>([[files.index(BASE, CODE), other]])
    await expect(loadMenu(f.deps(index), CODE)).rejects.toMatchObject({
      reason: 'not_published',
    })
  })

  it('shows the menu without sold-out marks when only the overlay is missing', async () => {
    const f = publishedFiles()
    const noLive = new Map<string, unknown>([
      [files.live(BASE, f.index), new Response(null, { status: 404 })],
    ])
    expect((await loadMenu(f.deps(noLive), CODE)).live).toBeNull()
    const broken = new Map<string, unknown>([
      [files.live(BASE, f.index), new Response('nope', { status: 500 })],
    ])
    expect((await loadMenu(f.deps(broken), CODE)).live).toBeNull()
    await expect(loadLive(f.deps(broken), f.index)).rejects.toMatchObject({ reason: 'failed' })
  })

  it('reads an overlay that has keys this loader does not know, and keeps its marks (A5-F2)', async () => {
    const f = publishedFiles()
    const [first = ''] = Object.keys(f.snapshot.items)
    const newer = {
      version: f.pointer.version,
      items: { [first]: { sold_out: true } },
      ordering: { state: 'on' },
    }
    const overrides = new Map<string, unknown>([[files.live(BASE, f.index), newer]])
    const live = await loadLive(f.deps(overrides), f.index)
    expect(live?.items).toEqual({ [first]: { sold_out: true } })
    expect((await loadMenu(f.deps(overrides), CODE)).live?.items).toEqual({
      [first]: { sold_out: true },
    })
    // Inside `items` nothing is guessed: a mark of another shape is still a failed parse.
    const odd = new Map<string, unknown>([
      [files.live(BASE, f.index), { version: 1, items: { [first]: { sold_out: true, hint: 1 } } }],
    ])
    await expect(loadLive(f.deps(odd), f.index)).rejects.toMatchObject({ reason: 'failed' })
  })

  it('fails (to be retried) on a server error, bad JSON or a file of the wrong shape', async () => {
    const f = publishedFiles()
    const cases: [string, Response | object][] = [
      ['server error', new Response(null, { status: 503 })],
      ['not json', new Response('<html>', { status: 200 })],
      ['wrong shape', { venue_id: 'vn_x' }],
      // The older index, without the slug.
      ['no slug', { venue_id: f.index.venue_id, menu_id: f.index.menu_id }],
    ]
    for (const [label, body] of cases) {
      const overrides = new Map<string, unknown>([[files.index(BASE, CODE), body]])
      await expect(loadMenu(f.deps(overrides), CODE), label).rejects.toMatchObject({
        reason: 'failed',
      })
    }
    const offline: LoadDeps = {
      base: BASE,
      fetch: async () => {
        throw new TypeError('network down')
      },
    }
    await expect(loadMenu(offline, CODE)).rejects.toMatchObject({ reason: 'failed' })
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
    expect(await loadTableLabel(f.deps(), token, CODE)).toBe('12')
    expect(f.asked.at(-1)).toBe(`${BASE}/t/${token}.json`)
  })

  it('leaves the banner out for an unknown code, another venue, a bad token or a failure', async () => {
    const f = publishedFiles()
    expect(await loadTableLabel(f.deps(), 'tb_ZZZZZZZZZZZZZZZZZZZZZZ', CODE)).toBeNull()
    // Another venue is told apart by its public code; the slug in the file proves nothing.
    expect(await loadTableLabel(f.deps(), token, 'zzzzzzzzzzzz')).toBeNull()
    expect(await loadTableLabel(f.deps(), token, 'demo-club')).toBeNull()
    const before = f.asked.length
    expect(await loadTableLabel(f.deps(), '../x', CODE)).toBeNull()
    expect(f.asked.length).toBe(before)
    const broken = new Map<string, unknown>([
      [files.table(BASE, token), new Response('x', { status: 500 })],
    ])
    expect(await loadTableLabel(f.deps(broken), token, CODE)).toBeNull()
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

  it('tells the shell about a table only when the lookup of that very code found one (A5-F5)', () => {
    const token = 'tb_0123456789ABCDEFGHIJKL'
    const found = { token, label: '12' }
    expect(confirmedTable(token, found)).toEqual(found)
    // No code asked for, no answer yet or an unknown code: no table.
    expect(confirmedTable(null, found)).toBeNull()
    expect(confirmedTable(token, null)).toBeNull()
    // An answer left over from another code (the address changed) counts for nothing.
    expect(confirmedTable('tb_ZZZZZZZZZZZZZZZZZZZZZZ', found)).toBeNull()
  })

  it('builds a qr context with ordering off', () => {
    const context = buildContext({
      locale: 'bg_BG',
      now: new Date('2026-10-10T12:00:00Z'),
      tableToken: null,
      manifest: faceEntry(null).manifest,
    })
    expect(context).toMatchObject({ channel: 'qr', orderingEnabled: false, tableToken: null })
  })

  it('asks for the photo size the chosen template’s manifest declares (R10)', () => {
    const input = {
      locale: 'bg_BG' as const,
      now: new Date('2026-10-10T12:00:00Z'),
      tableToken: null,
    }
    const manifest = faceEntry(null).manifest
    expect(buildContext({ ...input, manifest }).images).toEqual({
      item: { variant: 'card', density: 1 },
    })
    // A template that wants its photos at full size gets them at full size.
    const wide = {
      ...manifest,
      slots: {
        ...manifest.slots,
        'item.image': { optional: true as const, variant: 'full' as const },
      },
    }
    expect(buildContext({ ...input, manifest: wide }).images).toEqual({
      item: { variant: 'full', density: 1 },
    })
  })
})
