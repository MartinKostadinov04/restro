// @vitest-environment jsdom
// The guest page end to end in a page-like environment, with a fake `fetch` standing in for the
// CDN: the loading skeleton, the menu, the table banner from ?t=, the language from ?lang=, and the
// friendly notices. The page may only ask for files under /cdn (rule 4). The address is
// `/m/<slug>-<code>` (D68): only the code finds the venue, and the page corrects the slug.
import type { MenuSnapshot } from '@restro/core'
import * as shell from '@restro/shell'
import { fixture } from '@restro/shell/testing'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_FACE_ID, faceEntry } from '@/faces/registry'

import { GuestMenu } from './guest-menu'
import { files } from './load'

// The template's code loads on demand (SH-04). Load it once before the tests, so its first,
// cold transform on a busy machine does not count against the first test's wait for the menu.
beforeAll(async () => {
  await faceEntry(DEFAULT_FACE_ID).load()
}, 60_000)

// The real shell, watched: what the page tells it about the table is what these tests are about.
vi.mock('@restro/shell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@restro/shell')>()
  return { ...actual, buildViewModel: vi.fn(actual.buildViewModel) }
})

/** The table codes the page has given the shell so far, one per view model it built. */
const tableTokensGiven = () =>
  vi.mocked(shell.buildViewModel).mock.calls.map(([, , context]) => context.tableToken)

const TOKEN = 'tb_0123456789ABCDEFGHIJKL'
const CODE = 'k3x9p2m7qa1z'
const SLUG = 'demo-club'
/** The canonical route parameter and path of the venue. */
const PARAM = `${SLUG}-${CODE}`
const PATH = `/m/${PARAM}`

/** The published files of the fixture menu; `look` changes the snapshot's look and template. */
function published(look: Partial<MenuSnapshot> = {}) {
  const snapshot: MenuSnapshot = { ...fixture('tags-dietary').snapshot, ...look }
  const index = {
    venue_id: snapshot.snapshot.venue_id,
    menu_id: snapshot.snapshot.menu_id,
    slug: SLUG,
  }
  const pointer = {
    snapshot_id: snapshot.snapshot.id,
    version: snapshot.snapshot.version,
    hash: snapshot.snapshot.hash,
  }
  return new Map<string, unknown>([
    [files.index('/cdn', CODE), index],
    [files.current('/cdn', index), pointer],
    [files.snapshot('/cdn', pointer), snapshot],
    [files.live('/cdn', index), { version: pointer.version, items: {} }],
    [files.table('/cdn', TOKEN), { venue_public_id: CODE, venue_slug: SLUG, table_label: '12' }],
  ])
}

let requested: string[]

function serve(bodies: Map<string, unknown>) {
  requested = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requested.push(url)
      const body = bodies.get(url)
      return body === undefined ? new Response(null, { status: 404 }) : Response.json(body)
    }),
  )
}

function visit(search: string, languages = ['bg-BG'], param = PARAM) {
  window.history.replaceState(null, '', `/m/${param}${search}`)
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages)
}

beforeEach(() => {
  document.title = ''
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the guest menu page', () => {
  it('shows a skeleton, then the menu in the browser language, reading only /cdn files', async () => {
    serve(published())
    visit('', ['en-GB'])
    render(<GuestMenu venue={PARAM} />)
    expect(screen.getByTestId('menu-skeleton')).toBeTruthy()

    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
    expect(screen.queryByTestId('menu-skeleton')).toBeNull()
    expect(screen.getByText('Negroni')).toBeTruthy()
    expect(document.documentElement.lang).toBe('en-US')
    expect(requested.every((url) => url.startsWith('/cdn/'))).toBe(true)
    expect(requested.some((url) => url.includes('/api/') || url.includes('/venues'))).toBe(false)
  })

  it('marks the page as the guest page while it is on screen (the page rules are ours, not the template’s)', async () => {
    serve(published())
    visit('', ['en-GB'])
    const { unmount } = render(<GuestMenu venue={PARAM} />)
    expect(await screen.findByText('Negroni')).toBeTruthy()
    expect(document.documentElement.dataset.guestPage).toBe('')
    unmount()
    expect(document.documentElement.dataset.guestPage).toBeUndefined()
  })

  it('takes the language from ?lang= over the browser, and switching it updates the address', async () => {
    serve(published())
    visit('?lang=bg', ['en-US'])
    render(<GuestMenu venue={PARAM} />)
    expect(await screen.findByText('Негрони')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(await screen.findByText('Negroni')).toBeTruthy()
    expect(new URLSearchParams(window.location.search).get('lang')).toBe('en')
  })

  it('shows the table banner for a known table code (?t=) and keeps the code in the address', async () => {
    serve(published())
    visit(`?t=${TOKEN}`)
    render(<GuestMenu venue={PARAM} />)
    expect(await screen.findByText('Маса 12')).toBeTruthy()
    expect(window.location.search).toContain(TOKEN)
  })

  it('leaves the banner out for an unknown table code, the menu still shows', async () => {
    serve(published())
    visit('?t=tb_ZZZZZZZZZZZZZZZZZZZZZZ')
    render(<GuestMenu venue={PARAM} />)
    expect(await screen.findByText('Негрони')).toBeTruthy()
    expect(screen.queryByText(/Маса/)).toBeNull()
  })

  it('gives the shell a table code only once the published table file confirmed it (A5-F5)', async () => {
    vi.mocked(shell.buildViewModel).mockClear()
    const bodies = published()
    const tableFile = files.table('/cdn', TOKEN)
    // The table file's answer is held back until the menu is on the screen.
    let release: () => void = () => {}
    const gate = new Promise<void>((open) => {
      release = open
    })
    requested = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url)
        if (url === tableFile) await gate
        const body = bodies.get(url)
        return body === undefined ? new Response(null, { status: 404 }) : Response.json(body)
      }),
    )
    visit(`?t=${TOKEN}`)
    render(<GuestMenu venue={PARAM} />)

    // The table's file may name the menu the code opens (D95), so the page waits for it: while
    // the lookup is out nothing is drawn and the shell has not been given the code.
    await waitFor(() => expect(requested).toContain(tableFile))
    await new Promise((done) => setTimeout(done, 50))
    expect(screen.queryByText('Негрони')).toBeNull()
    expect(tableTokensGiven()).toEqual([])

    release()
    expect(await screen.findByText('Негрони')).toBeTruthy()
    expect(await screen.findByText('Маса 12')).toBeTruthy()
    expect(tableTokensGiven().at(-1)).toBe(TOKEN)
  })

  it('treats a well-formed but unknown table code like no code at all (A5-F5)', async () => {
    vi.mocked(shell.buildViewModel).mockClear()
    serve(published())
    visit('?t=tb_ZZZZZZZZZZZZZZZZZZZZZZ')
    render(<GuestMenu venue={PARAM} />)
    expect(await screen.findByText('Негрони')).toBeTruthy()
    // The lookup went out (the file is not there) ...
    await waitFor(() =>
      expect(requested).toContain(files.table('/cdn', 'tb_ZZZZZZZZZZZZZZZZZZZZZZ')),
    )
    await new Promise((done) => setTimeout(done, 50))
    // ... and the shell never heard of the code, before or after the answer.
    expect(tableTokensGiven().length).toBeGreaterThan(0)
    expect(tableTokensGiven().every((token) => token === null)).toBe(true)
  })

  it('does not accept a code that belongs to another venue (A5-F5)', async () => {
    vi.mocked(shell.buildViewModel).mockClear()
    const bodies = published()
    // The file names another venue by its public code (the slug alone proves nothing).
    bodies.set(files.table('/cdn', TOKEN), {
      venue_public_id: 'zzzzzzzzzzzz',
      venue_slug: SLUG,
      table_label: '7',
    })
    serve(bodies)
    visit(`?t=${TOKEN}`)
    render(<GuestMenu venue={PARAM} />)
    expect(await screen.findByText('Негрони')).toBeTruthy()
    await waitFor(() => expect(requested).toContain(files.table('/cdn', TOKEN)))
    await new Promise((done) => setTimeout(done, 50))
    expect(screen.queryByText(/Маса/)).toBeNull()
    expect(tableTokensGiven().every((token) => token === null)).toBe(true)
  })

  it('says the venue is unknown (no retry button) when there is no index for the code', async () => {
    serve(new Map())
    visit('', ['bg-BG'], `nowhere-${'0'.repeat(12)}`)
    render(<GuestMenu venue={`nowhere-${'0'.repeat(12)}`} />)
    expect(await screen.findByText('Това меню не е налично')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says the venue is unknown, without asking anyone, for an address with no code', async () => {
    serve(published())
    // The older address, a slug alone: no longer a way in.
    visit('', ['bg-BG'], SLUG)
    render(<GuestMenu venue={SLUG} />)
    expect(await screen.findByText('Това меню не е налично')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(requested).toEqual([])
  })

  it('says the venue is unknown for an upper-case code, without asking anyone', async () => {
    serve(published())
    const param = `${SLUG}-${CODE.toUpperCase()}`
    visit('', ['bg-BG'], param)
    render(<GuestMenu venue={param} />)
    expect(await screen.findByText('Това меню не е налично')).toBeTruthy()
    expect(requested).toEqual([])
  })

  it('says the menu is not published yet when the venue has no pointer', async () => {
    const bodies = published()
    bodies.delete(files.current('/cdn', bodies.get(files.index('/cdn', CODE)) as never))
    serve(bodies)
    visit('')
    render(<GuestMenu venue={PARAM} />)
    expect(await screen.findByText('Менюто още не е публикувано')).toBeTruthy()
  })

  describe('an overlay made for another snapshot version (S3-10)', () => {
    const { snapshot } = fixture('tags-dietary')
    const version = snapshot.snapshot.version
    const [negroni = '', hummus = ''] = Object.keys(snapshot.items)
    const index = {
      venue_id: snapshot.snapshot.venue_id,
      menu_id: snapshot.snapshot.menu_id,
      slug: SLUG,
    }
    const plain = files.live('/cdn', index)
    const bust = (attempt: number) => files.live('/cdn', index, { version, attempt })
    const marks = (...ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, { sold_out: true as const }]))
    const bustedRequests = () => requested.filter((url) => url.includes('?v='))

    it('applies the mismatched overlay at once, then asks again with ?v= and shows the matching one', async () => {
      const bodies = published()
      bodies.set(plain, { version: version + 1, items: marks(hummus) })
      bodies.set(bust(1), { version, items: marks(negroni, hummus) })
      serve(bodies)
      visit('', ['en-GB'])
      render(<GuestMenu venue={PARAM} />)

      expect(await screen.findByText('Hummus')).toBeTruthy()
      // The overlay of the other version marks Hummus: it applies, it is not ignored.
      // The overlay fetched again with ?v= adds Negroni.
      await waitFor(() => expect(screen.getAllByText('Sold out')).toHaveLength(2))
      expect(bustedRequests()).toEqual([bust(1)])
    })

    it('keeps applying the mismatched overlay when no matching one comes, trying at most three times', async () => {
      const bodies = published()
      bodies.set(plain, { version: version + 1, items: marks(hummus) })
      serve(bodies)
      visit('', ['en-GB'])
      render(<GuestMenu venue={PARAM} />)

      expect(await screen.findByText('Hummus')).toBeTruthy()
      await waitFor(() => expect(bustedRequests()).toEqual([bust(1)]))
      // Nothing matching arrived: what was on the screen stays.
      expect(screen.getAllByText('Sold out')).toHaveLength(1)
      expect(bustedRequests().length).toBeLessThanOrEqual(3)
    })

    it('does not ask again when the overlay is for the snapshot on the screen', async () => {
      serve(published())
      visit('', ['en-GB'])
      render(<GuestMenu venue={PARAM} />)
      expect(await screen.findByText('Hummus')).toBeTruthy()
      // Give an unwanted refetch time to show up.
      await new Promise((done) => setTimeout(done, 100))
      expect(bustedRequests()).toEqual([])
      expect(requested.filter((url) => url.includes('live.json'))).toEqual([plain])
    })
  })

  it('applies the sold-out marks of an overlay file that has a key this page does not know (A5-F2)', async () => {
    const { snapshot } = fixture('tags-dietary')
    const index = {
      venue_id: snapshot.snapshot.venue_id,
      menu_id: snapshot.snapshot.menu_id,
      slug: SLUG,
    }
    const [, hummus = ''] = Object.keys(snapshot.items)
    const bodies = published()
    // A producer that is ahead of this page: a new top-level block next to `version` and `items`.
    bodies.set(files.live('/cdn', index), {
      version: snapshot.snapshot.version,
      items: { [hummus]: { sold_out: true } },
      ordering: { state: 'on' },
    })
    serve(bodies)
    visit('', ['en-GB'])
    render(<GuestMenu venue={PARAM} />)

    expect(await screen.findByText('Hummus')).toBeTruthy()
    // The file is not taken for "no overlay": the mark shows.
    await waitFor(() => expect(screen.getAllByText('Sold out')).toHaveLength(1))
  })

  describe('the address in the browser (D68)', () => {
    it('is left alone when it is already canonical', async () => {
      serve(published())
      visit(`?t=${TOKEN}&lang=bg`)
      const replace = vi.spyOn(window.history, 'replaceState')
      render(<GuestMenu venue={PARAM} />)
      expect(await screen.findByText('Маса 12')).toBeTruthy()
      expect(replace).not.toHaveBeenCalled()
      expect(window.location.pathname).toBe(PATH)
      expect(window.location.search).toBe(`?t=${TOKEN}&lang=bg`)
    })

    it('is corrected when the slug is stale (a renamed venue), keeping ?t= and ?lang=', async () => {
      serve(published())
      const stale = `old-name-${CODE}`
      visit(`?t=${TOKEN}&lang=bg`, ['bg-BG'], stale)
      expect(window.location.pathname).toBe(`/m/${stale}`)
      const push = vi.spyOn(window.history, 'pushState')
      render(<GuestMenu venue={stale} />)
      expect(await screen.findByText('Маса 12')).toBeTruthy()
      await waitFor(() => expect(window.location.pathname).toBe(PATH))
      expect(window.location.search).toBe(`?t=${TOKEN}&lang=bg`)
      // Replaced, not pushed: the stale address is not left in the history.
      expect(push).not.toHaveBeenCalled()
    })

    it('is corrected when it is the bare code, and the menu loads from the code alone', async () => {
      serve(published())
      visit('?lang=en', ['bg-BG'], CODE)
      render(<GuestMenu venue={CODE} />)
      expect(await screen.findByText('Negroni')).toBeTruthy()
      await waitFor(() => expect(window.location.pathname).toBe(PATH))
      expect(window.location.search).toBe('?lang=en')
      expect(requested[0]).toBe(files.index('/cdn', CODE))
    })

    it('is not touched when the venue is unknown', async () => {
      serve(new Map())
      const unknown = `old-name-${CODE}`
      visit('', ['bg-BG'], unknown)
      render(<GuestMenu venue={unknown} />)
      expect(await screen.findByText('Това меню не е налично')).toBeTruthy()
      expect(window.location.pathname).toBe(`/m/${unknown}`)
    })
  })

  it('offers a retry when the load fails, and loads the menu when it works again', async () => {
    const bodies = published()
    let broken = true
    requested = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url)
        if (broken) return new Response(null, { status: 503 })
        const body = bodies.get(url)
        return body === undefined ? new Response(null, { status: 404 }) : Response.json(body)
      }),
    )
    visit('', ['en-US'])
    render(<GuestMenu venue={PARAM} />)
    expect(await screen.findByText('The menu could not be loaded')).toBeTruthy()

    broken = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByText('Negroni')).toBeTruthy())
  })
})

describe('the template the venue chose (SH-04)', () => {
  const theme = fixture('tags-dietary').snapshot.theme

  /** The face on the page, once its code has loaded (the skeleton has the same `data-face` marker). */
  const faceRoot = (face: string) =>
    waitFor(() => {
      const root = document.querySelector(`[data-face="${face}"]:not([data-testid])`)
      expect(root, `${face} is on the page`).toBeTruthy()
      return root as HTMLElement
    })

  it('draws the Editorial Market when the snapshot names no template, following the guest’s screen', async () => {
    serve(published())
    visit('', ['en-GB'])
    render(<GuestMenu venue={PARAM} />)
    const root = await faceRoot('editorial-market')
    expect(root.dataset.scheme).toBe('auto')
    // A snapshot without the menu's layout (D92) starts as a list.
    expect(root.dataset.layout).toBe('list')
    expect(screen.queryByTestId('menu-skeleton')).toBeNull()
  })

  it('draws the template the snapshot names, in the menu layout it carries (D92)', async () => {
    serve(
      published({
        presentation: { face: 'editorial-market', options: {} },
        layout: { default: 'one', guest_switch: false },
      }),
    )
    visit('', ['en-GB'])
    render(<GuestMenu venue={PARAM} />)
    const root = await faceRoot('editorial-market')
    expect(root.dataset.layout).toBe('one')
    // The menu does not let guests switch: no switch on the page.
    expect(root.querySelector('[data-slot="menu.layout_switch"]')).toBeNull()
  })

  it('draws another template when the snapshot names it', async () => {
    serve(published({ presentation: { face: 'qr-phone', options: {} } }))
    visit('', ['en-GB'])
    render(<GuestMenu venue={PARAM} />)
    await faceRoot('qr-phone')
    expect(document.querySelector('[data-face="editorial-market"]')).toBeNull()
    expect(await screen.findByText('Negroni')).toBeTruthy()
  })

  it('draws the Editorial Market for a template it does not know, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    serve(published({ presentation: { face: 'a-template-from-the-future', options: {} } }))
    visit('', ['en-GB'])
    render(<GuestMenu venue={PARAM} />)
    await faceRoot('editorial-market')
    expect(warn.mock.calls.filter(([line]) => String(line).includes('unknown_face'))).toHaveLength(
      1,
    )
  })

  it('forces the scheme the snapshot carries onto the template', async () => {
    serve(published({ theme: { ...theme, scheme: 'dark' } }))
    visit('', ['en-GB'])
    render(<GuestMenu venue={PARAM} />)
    expect((await faceRoot('editorial-market')).dataset.scheme).toBe('dark')
  })

  it('gives the template our own copy of the font the venue chose, first in its stack', async () => {
    serve(published({ theme: { ...theme, font: 'Playfair Display' } }))
    visit('', ['en-GB'])
    render(<GuestMenu venue={PARAM} />)
    const root = await faceRoot('editorial-market')
    expect(root.style.getPropertyValue('--rm-font')).toMatch(
      /^var\(--font-playfair-display\), "Playfair Display", /,
    )
  })

  it('draws the template with the confirmed table and the languages of the menu', async () => {
    serve(published())
    visit(`?t=${TOKEN}`, ['bg-BG'])
    render(<GuestMenu venue={PARAM} />)
    await faceRoot('editorial-market')
    expect(await screen.findByText('Маса 12')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'EN' })).toBeTruthy()
  })
})
