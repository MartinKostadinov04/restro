import { createHash } from 'node:crypto'
import { CurrentPointerSchema, VenueIndexSchema } from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { describe, expect, it } from 'vitest'

import { faceEntry } from '@/faces/registry'
import { cdnBase } from './cdn'
import {
  buildContext,
  chooseLocale,
  confirmedTable,
  langParam,
  readTableToken,
  rememberedTable,
  rememberTable,
  type TabStorage,
  withCodeInFragment,
} from './context'
import {
  files,
  GuestLoadError,
  LIVE_REFETCH_ATTEMPTS,
  LIVE_REFETCH_DELAY_MS,
  type LoadDeps,
  loadLive,
  loadMenu,
  loadMenuAt,
  loadPointer,
  loadSnapshot,
  loadTableFile,
  loadTableLabel,
  loadVenueIndex,
  refetchLiveForSnapshot,
  resolveGuestAddress,
} from './load'

const BASE = '/cdn'
/** A table code's file is named after its SHA-256 (#70). */
const sha = (code: string) => createHash('sha256').update(code).digest('hex')
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
    [files.table(BASE, sha('tb_0123456789ABCDEFGHIJKL')), table],
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

  it('reads the label from t/<hash>.json: the code itself never goes over the wire', async () => {
    const f = publishedFiles()
    expect(await loadTableLabel(f.deps(), token, CODE)).toBe('12')
    expect(f.asked.at(-1)).toBe(`${BASE}/t/${sha(token)}.json`)
    expect(f.asked.some((url) => url.includes(token))).toBe(false)
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
      [files.table(BASE, sha(token)), new Response('x', { status: 500 })],
    ])
    expect(await loadTableLabel(f.deps(broken), token, CODE)).toBeNull()
  })

  it('checks the code this tab kept when the address has none, and the address code before it', async () => {
    const f = publishedFiles()
    const asked: string[] = []
    const remembered = (publicId: string) => {
      asked.push(publicId)
      return token
    }
    // A reload on a dish page: no code in the address, the tab's copy is checked like any code.
    const menu = await loadMenu(f.deps(), CODE, null, remembered)
    expect(menu.table).toEqual({ token, label: '12' })
    expect(asked).toEqual([CODE])
    expect(f.asked).toContain(files.table(BASE, sha(token)))
    // A code in the address wins: the tab's copy is not even asked for.
    const other = await loadMenu(f.deps(), CODE, 'tb_ZZZZZZZZZZZZZZZZZZZZZZ', remembered)
    expect(other.table).toBeNull()
    expect(asked).toEqual([CODE])
    // A kept code the files no longer know is no table.
    expect(
      (await loadMenu(f.deps(), CODE, null, () => 'tb_ZZZZZZZZZZZZZZZZZZZZZZ')).table,
    ).toBeNull()
  })
})

describe('the table code a tab keeps', () => {
  const code = 'tb_0123456789ABCDEFGHIJKL'
  function memoryStorage(): TabStorage & { readonly items: Map<string, string> } {
    const items = new Map<string, string>()
    return {
      items,
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
      removeItem: (key) => void items.delete(key),
    }
  }

  it('keeps one code per venue, replaces it with a newer one and forgets it on null', () => {
    const storage = memoryStorage()
    expect(rememberedTable(storage, CODE)).toBeNull()
    rememberTable(storage, CODE, code)
    expect(rememberedTable(storage, CODE)).toBe(code)
    // Another venue has its own.
    expect(rememberedTable(storage, 'zzzzzzzzzzzz')).toBeNull()
    rememberTable(storage, CODE, 'tb_ZZZZZZZZZZZZZZZZZZZZZZ')
    expect(rememberedTable(storage, CODE)).toBe('tb_ZZZZZZZZZZZZZZZZZZZZZZ')
    rememberTable(storage, CODE, null)
    expect(rememberedTable(storage, CODE)).toBeNull()
    expect(storage.items.size).toBe(0)
  })

  it('reads only a well-formed code back', () => {
    const storage = memoryStorage()
    storage.items.set(`restro.table.${CODE}`, '../../x')
    expect(rememberedTable(storage, CODE)).toBeNull()
  })

  it('works without storage, or with one that throws (private mode): nothing is kept', () => {
    const throwing: TabStorage = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
      removeItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
    }
    for (const storage of [null, throwing]) {
      expect(() => rememberTable(storage, CODE, code)).not.toThrow()
      expect(() => rememberTable(storage, CODE, null)).not.toThrow()
      expect(rememberedTable(storage, CODE)).toBeNull()
    }
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

  it('writes the short language form and reads only well-formed table codes', () => {
    const code = 'tb_0123456789ABCDEFGHIJKL'
    expect(langParam('bg_BG')).toBe('bg')
    // The fragment first (D122), then the query of an older link.
    expect(readTableToken('', `#t=${code}`)).toBe(code)
    expect(readTableToken('?t=tb_ZZZZZZZZZZZZZZZZZZZZZZ', `#t=${code}`)).toBe(code)
    expect(readTableToken(`?t=${code}`)).toBe(code)
    expect(readTableToken('?t=short')).toBeNull()
    expect(readTableToken('', '#t=../../x')).toBeNull()
    expect(readTableToken('?t=../../x')).toBeNull()
    expect(readTableToken('', '')).toBeNull()
  })

  it('moves a code in the query into the fragment, keeping the rest of the address', () => {
    const code = 'tb_0123456789ABCDEFGHIJKL'
    expect(withCodeInFragment(`https://x.test/m/a?t=${code}&lang=bg`)).toBe(
      `https://x.test/m/a?lang=bg#t=${code}`,
    )
    // A code already in the fragment wins.
    expect(withCodeInFragment(`https://x.test/m/a?t=other00000#t=${code}`)).toBe(
      `https://x.test/m/a#t=${code}`,
    )
    expect(withCodeInFragment('https://x.test/m/a?lang=bg')).toBeNull()
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

describe('the address /m/<organisation>/<venue> (D84) and the menu a table opens (D95)', () => {
  const ORG = 'night-group'
  const SECOND_MENU = `nd_${'B'.repeat(22)}`
  const TABLE_CODE = 'tb_0123456789ABCDEFGHIJKL'

  /** The published files with the organisation's index and a second published menu. */
  function organizationFiles() {
    const f = publishedFiles()
    const organization = {
      organization_id: `tn_${'C'.repeat(22)}`,
      slug: ORG,
      venues: {
        'demo-club': {
          venue_id: f.index.venue_id,
          menu_id: f.index.menu_id,
          public_id: CODE,
        },
      },
      old_names: { 'old-club': 'demo-club' },
    }
    const secondIndex = { venue_id: f.index.venue_id, menu_id: SECOND_MENU }
    const secondPointer = { ...f.pointer }
    f.bodies.set(files.organization(BASE, ORG), organization)
    f.bodies.set(files.organization(BASE, 'old-group'), { redirect_to: ORG })
    f.bodies.set(files.current(BASE, secondIndex), secondPointer)
    f.bodies.set(files.live(BASE, secondIndex), { version: f.pointer.version, items: {} })
    f.bodies.set(files.table(BASE, sha(TABLE_CODE)), {
      venue_public_id: CODE,
      venue_slug: 'demo-club',
      organization_slug: ORG,
      table_label: '7',
      menu_id: SECOND_MENU,
    })
    return { ...f, organization }
  }

  it('starts from the organisation’s file and ends at the venue’s live menu', async () => {
    const f = organizationFiles()
    const resolved = await resolveGuestAddress(f.deps(), { organization: ORG, venue: 'demo-club' })
    expect(resolved).toEqual({
      index: { ...f.index, organization: ORG },
      publicId: CODE,
      canonical: { organization: ORG, venue: 'demo-club' },
    })
    const menu = await loadMenuAt(f.deps(), { organization: ORG, venue: 'demo-club' })
    expect(menu.index.menu_id).toBe(f.index.menu_id)
    expect(menu.publicId).toBe(CODE)
    expect(menu.table).toBeNull()
    expect(menu.canonical).toEqual({ organization: ORG, venue: 'demo-club' })
    expect(f.asked[0]).toBe(`${BASE}/o/${ORG}.json`)
  })

  it('follows a renamed organisation and a renamed venue, and says the address to show', async () => {
    const f = organizationFiles()
    const menu = await loadMenuAt(f.deps(), { organization: 'old-group', venue: 'old-club' })
    expect(menu.canonical).toEqual({ organization: ORG, venue: 'demo-club' })
    expect(menu.index.slug).toBe('demo-club')
    expect(f.asked.slice(0, 2)).toEqual([`${BASE}/o/old-group.json`, `${BASE}/o/${ORG}.json`])
  })

  it('is an unknown venue for an unknown organisation, an unlisted venue, or a malformed part', async () => {
    const f = organizationFiles()
    for (const address of [
      { organization: 'nobody', venue: 'demo-club' },
      { organization: ORG, venue: 'nobody' },
      { organization: 'Not A Slug', venue: 'demo-club' },
      { organization: ORG, venue: '../x' },
    ]) {
      await expect(loadMenuAt(f.deps(), address)).rejects.toMatchObject({
        reason: 'unknown_venue',
      })
    }
    // A redirect that loops leads nowhere.
    const loop = new Map<string, unknown>([
      [files.organization(BASE, 'a-loop'), { redirect_to: 'b-loop' }],
      [files.organization(BASE, 'b-loop'), { redirect_to: 'a-loop' }],
    ])
    await expect(
      loadMenuAt(f.deps(loop), { organization: 'a-loop', venue: 'demo-club' }),
    ).rejects.toMatchObject({ reason: 'unknown_venue' })
  })

  it('a table’s code may name the menu it opens: that menu’s files are read, and the table is confirmed', async () => {
    const f = organizationFiles()
    const menu = await loadMenuAt(f.deps(), { organization: ORG, venue: 'demo-club' }, TABLE_CODE)
    expect(menu.index.menu_id).toBe(SECOND_MENU)
    expect(menu.table).toEqual({ token: TABLE_CODE, label: '7' })
    expect(f.asked).toContain(files.table(BASE, sha(TABLE_CODE)))
    expect(f.asked).toContain(
      files.current(BASE, { venue_id: f.index.venue_id, menu_id: SECOND_MENU }),
    )
    // The address of before honours the table's menu too.
    const legacy = await loadMenu(f.deps(), CODE, TABLE_CODE)
    expect(legacy.index.menu_id).toBe(SECOND_MENU)
    expect(legacy.table).toEqual({ token: TABLE_CODE, label: '7' })
    // A code of another venue, or one with no menu, leaves the live menu.
    const foreign = new Map<string, unknown>([
      [
        files.table(BASE, sha(TABLE_CODE)),
        { venue_public_id: '000000000000', venue_slug: 'x', table_label: '1' },
      ],
    ])
    const stranger = await loadMenuAt(
      f.deps(foreign),
      { organization: ORG, venue: 'demo-club' },
      TABLE_CODE,
    )
    expect(stranger.index.menu_id).toBe(f.index.menu_id)
    expect(stranger.table).toBeNull()
    expect(await loadTableFile(f.deps(foreign), TABLE_CODE, CODE)).toBeNull()
  })

  it('the address of before moves to the new one when the venue’s file names the organisation', async () => {
    const f = publishedFiles()
    expect((await loadMenu(f.deps(), CODE)).canonical).toBeNull()
    const withOrganization = new Map<string, unknown>([
      [files.index(BASE, CODE), { ...f.index, organization: ORG }],
    ])
    expect((await loadMenu(f.deps(withOrganization), CODE)).canonical).toEqual({
      organization: ORG,
      venue: 'demo-club',
    })
  })
})
