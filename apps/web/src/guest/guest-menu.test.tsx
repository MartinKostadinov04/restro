// @vitest-environment jsdom
// The guest page end to end in a page-like environment, with a fake `fetch` standing in for the
// CDN: the loading skeleton, the menu, the table banner from ?t=, the language from ?lang=, and the
// friendly notices. The page may only ask for files under /cdn (rule 4).
import { fixture } from '@restro/shell/testing'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GuestMenu } from './guest-menu'
import { files } from './load'

const TOKEN = 'tb_0123456789ABCDEFGHIJKL'

function published() {
  const { snapshot } = fixture('tags-dietary')
  const index = { venue_id: snapshot.snapshot.venue_id, menu_id: snapshot.snapshot.menu_id }
  const pointer = {
    snapshot_id: snapshot.snapshot.id,
    version: snapshot.snapshot.version,
    hash: snapshot.snapshot.hash,
  }
  return new Map<string, unknown>([
    [files.index('/cdn', 'demo-club'), index],
    [files.current('/cdn', index), pointer],
    [files.snapshot('/cdn', pointer), snapshot],
    [files.live('/cdn', index), { version: pointer.version, items: {} }],
    [files.table('/cdn', TOKEN), { venue_slug: 'demo-club', table_label: '12' }],
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

function visit(search: string, languages = ['bg-BG']) {
  window.history.replaceState(null, '', `/m/demo-club${search}`)
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
    render(<GuestMenu slug="demo-club" />)
    expect(screen.getByTestId('menu-skeleton')).toBeTruthy()

    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
    expect(screen.queryByTestId('menu-skeleton')).toBeNull()
    expect(screen.getByText('Negroni')).toBeTruthy()
    expect(document.documentElement.lang).toBe('en-US')
    expect(requested.every((url) => url.startsWith('/cdn/'))).toBe(true)
    expect(requested.some((url) => url.includes('/api/') || url.includes('/venues'))).toBe(false)
  })

  it('takes the language from ?lang= over the browser, and switching it updates the address', async () => {
    serve(published())
    visit('?lang=bg', ['en-US'])
    render(<GuestMenu slug="demo-club" />)
    expect(await screen.findByText('Негрони')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(await screen.findByText('Negroni')).toBeTruthy()
    expect(new URLSearchParams(window.location.search).get('lang')).toBe('en')
  })

  it('shows the table banner for a known table code (?t=) and keeps the code in the address', async () => {
    serve(published())
    visit(`?t=${TOKEN}`)
    render(<GuestMenu slug="demo-club" />)
    expect(await screen.findByText('Маса 12')).toBeTruthy()
    expect(window.location.search).toContain(TOKEN)
  })

  it('leaves the banner out for an unknown table code, the menu still shows', async () => {
    serve(published())
    visit('?t=tb_ZZZZZZZZZZZZZZZZZZZZZZ')
    render(<GuestMenu slug="demo-club" />)
    expect(await screen.findByText('Негрони')).toBeTruthy()
    expect(screen.queryByText(/Маса/)).toBeNull()
  })

  it('says the venue is unknown (no retry button) when there is no slug index', async () => {
    serve(new Map())
    visit('')
    render(<GuestMenu slug="nowhere" />)
    expect(await screen.findByText('Менюто не е намерено')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says the menu is not published yet when the venue has no pointer', async () => {
    const bodies = published()
    bodies.delete(files.current('/cdn', bodies.get(files.index('/cdn', 'demo-club')) as never))
    serve(bodies)
    visit('')
    render(<GuestMenu slug="demo-club" />)
    expect(await screen.findByText('Менюто още не е публикувано')).toBeTruthy()
  })

  describe('an overlay made for another snapshot version (S3-10)', () => {
    const { snapshot } = fixture('tags-dietary')
    const version = snapshot.snapshot.version
    const [negroni = '', hummus = ''] = Object.keys(snapshot.items)
    const index = { venue_id: snapshot.snapshot.venue_id, menu_id: snapshot.snapshot.menu_id }
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
      render(<GuestMenu slug="demo-club" />)

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
      render(<GuestMenu slug="demo-club" />)

      expect(await screen.findByText('Hummus')).toBeTruthy()
      await waitFor(() => expect(bustedRequests()).toEqual([bust(1)]))
      // Nothing matching arrived: what was on the screen stays.
      expect(screen.getAllByText('Sold out')).toHaveLength(1)
      expect(bustedRequests().length).toBeLessThanOrEqual(3)
    })

    it('does not ask again when the overlay is for the snapshot on the screen', async () => {
      serve(published())
      visit('', ['en-GB'])
      render(<GuestMenu slug="demo-club" />)
      expect(await screen.findByText('Hummus')).toBeTruthy()
      // Give an unwanted refetch time to show up.
      await new Promise((done) => setTimeout(done, 100))
      expect(bustedRequests()).toEqual([])
      expect(requested.filter((url) => url.includes('live.json'))).toEqual([plain])
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
    render(<GuestMenu slug="demo-club" />)
    expect(await screen.findByText('The menu could not be loaded')).toBeTruthy()

    broken = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByText('Negroni')).toBeTruthy())
  })
})
