import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  LocalPublishStore,
  publishPutOptions,
  tableTokenPath,
  venueIndexPath,
  writeTableTokenFile,
} from '@restro/assets'
import { hashTableCode, newId } from '@restro/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { BadCodeLimiter } from '../guard/bad-codes'
import { serveCdn } from './cdn'
import { cdnSource, inactivePageHtml, tableTokenResponse } from './table-token'

const TOKEN = 'tb_0123456789ABCDEFGHIJKL'
const CODE = 'k3x9p2m7qa1z'
const FILE = { venue_public_id: CODE, venue_slug: 'demo-club', table_label: '12' }
/** The code's file is named after its hash (#70). */
let HASH = ''
beforeAll(async () => {
  HASH = await hashTableCode(TOKEN)
})

describe('/t/<code> (no database)', () => {
  let root: string
  let store: LocalPublishStore

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'restro-table-token-'))
    store = new LocalPublishStore({ rootDir: root })
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('redirects a known code to the canonical menu path with the code in the fragment (302, never cached, no referrer)', async () => {
    await writeTableTokenFile(store, HASH, FILE)
    const response = await tableTokenResponse(TOKEN, store)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`/m/demo-club-${CODE}#t=${TOKEN}`)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('looks the code up by its hash only: a file named after the code itself is not found', async () => {
    await writeTableTokenFile(store, TOKEN, FILE)
    expect((await tableTokenResponse(TOKEN, store)).status).toBe(404)
    const get = vi.fn(async () => null)
    await tableTokenResponse(TOKEN, { get })
    expect(get).toHaveBeenCalledWith(`t/${HASH}.json`)
  })

  it('redirects to /m/<organisation>/<venue> when the file names the organisation (D84)', async () => {
    await writeTableTokenFile(store, HASH, { ...FILE, organization_slug: 'night-group' })
    const response = await tableTokenResponse(TOKEN, store)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`/m/night-group/demo-club#t=${TOKEN}`)
  })

  it('redirects with the slug the file holds; a renamed venue is corrected by the guest page', async () => {
    await writeTableTokenFile(store, HASH, { ...FILE, venue_slug: 'old-name' })
    const response = await tableTokenResponse(TOKEN, store)
    expect(response.headers.get('location')).toBe(`/m/old-name-${CODE}#t=${TOKEN}`)
  })

  it('treats a token file of the older shape (no public code) as no file', async () => {
    const file = tableTokenPath(HASH)
    await store.put(
      file,
      new TextEncoder().encode(JSON.stringify({ venue_slug: 'demo-club', table_label: '12' })),
      publishPutOptions(file),
    )
    expect((await tableTokenResponse(TOKEN, store)).status).toBe(404)
  })

  it('shows the "not active" page for a code nobody knows, in both languages, with no venue data', async () => {
    const response = await tableTokenResponse('tb_ZZZZZZZZZZZZZZZZZZZZZZ', store)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    const html = await response.text()
    expect(html).toContain('This table code is not active.')
    expect(html).toContain('Ask the staff.')
    expect(html).toContain('Този код за маса не е активен.')
    expect(html).toContain('Попитайте персонала.')
    expect(html).toContain('noindex')
    expect(html).not.toMatch(/\/m\/|venue|demo-club/)
  })

  it('does not even look for a token that cannot be one', async () => {
    const get = vi.fn(async () => null)
    for (const token of [
      '',
      'short',
      '../../etc/passwd',
      'a b c d e f g h',
      `${'a'.repeat(129)}`,
    ]) {
      const response = await tableTokenResponse(token, { get })
      expect(response.status, token).toBe(404)
    }
    expect(get).not.toHaveBeenCalled()
  })

  it('treats a malformed or retired token file as not active', async () => {
    const path = tableTokenPath(HASH)
    await store.put(
      path,
      new TextEncoder().encode('{"venue_slug": "Demo Club"}'),
      publishPutOptions(path),
    )
    expect((await tableTokenResponse(TOKEN, store)).status).toBe(404)
  })

  it('says it is unavailable (503) when there is no source or it cannot be read', async () => {
    expect((await tableTokenResponse(TOKEN, null)).status).toBe(503)
    const failing = {
      get: async () => {
        throw new Error('disk on fire')
      },
    }
    expect((await tableTokenResponse(TOKEN, failing)).status).toBe(503)
  })

  it('reads the token file from the CDN when there is no local store', async () => {
    const calls: string[] = []
    const fetchFile = (async (url: string) => {
      calls.push(url)
      return url.endsWith(`${HASH}.json`)
        ? Response.json({ ...FILE, table_label: '7' })
        : new Response(null, { status: 404 })
    }) as unknown as typeof fetch
    const source = cdnSource('https://cdn.example.test/', fetchFile)
    expect((await tableTokenResponse(TOKEN, source)).headers.get('location')).toBe(
      `/m/demo-club-${CODE}#t=${TOKEN}`,
    )
    // Only the hash goes over the wire.
    expect(calls).toEqual([`https://cdn.example.test/t/${HASH}.json`])
    expect((await tableTokenResponse('tb_ZZZZZZZZZZZZZZZZZZZZZZ', source)).status).toBe(404)
  })

  it('has the page text from the interface message files', () => {
    expect(inactivePageHtml()).toContain('lang="bg"')
    expect(inactivePageHtml()).toContain('lang="en"')
  })

  it('counts wrong codes per network: logged at 20, blocked with 429 at 50, others unaffected', async () => {
    await writeTableTokenFile(store, HASH, FILE)
    let now = 0
    const limiter = new BadCodeLimiter(undefined, () => now)
    const guard = { limiter, network: '203.0.113.7' }
    const warnings: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation((line: unknown) => {
      warnings.push(String(line))
    })
    try {
      for (let wrong = 1; wrong < 50; wrong += 1) {
        // Malformed codes and unknown ones count alike.
        const code = wrong % 2 === 0 ? 'short' : `tb_unknown${String(wrong).padStart(12, '0')}`
        expect((await tableTokenResponse(code, store, guard)).status).toBe(404)
      }
      // A right code still works until the block.
      expect((await tableTokenResponse(TOKEN, store, guard)).status).toBe(302)
      expect(warnings.map((line) => JSON.parse(line).event)).toEqual([
        'bad_code_turnstile_required',
      ])
      const blocked = await tableTokenResponse('tb_unknownXXXXXXXXXXXX', store, guard)
      expect(blocked.status).toBe(429)
      expect(blocked.headers.get('retry-after')).toBe(String(15 * 60))
      expect(warnings.map((line) => JSON.parse(line).event)).toEqual([
        'bad_code_turnstile_required',
        'bad_code_block',
      ])
      // Nothing logged names the network or a code.
      expect(warnings.join('\n')).not.toMatch(/203\.0\.113|tb_/)
      // Blocked: even a right code, and nothing is read.
      const get = vi.fn(async () => null)
      expect((await tableTokenResponse(TOKEN, { get }, guard)).status).toBe(429)
      expect(get).not.toHaveBeenCalled()
      // Another network is not.
      const other = { limiter, network: '198.51.100.1' }
      expect((await tableTokenResponse(TOKEN, store, other)).status).toBe(302)
      // After 15 minutes the block is over.
      now += 15 * 60_000
      expect((await tableTokenResponse(TOKEN, store, guard)).status).toBe(302)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('the venue index and token files are served at /cdn like the others', () => {
  let root: string
  let store: LocalPublishStore

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'restro-cdn-guest-'))
    store = new LocalPublishStore({ rootDir: root })
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('serves v/<code>.json and t/<hash>.json for 30 seconds as json', async () => {
    const index = { venue_id: newId('vn'), menu_id: newId('nd'), slug: 'demo-club' }
    const file = venueIndexPath(CODE)
    await store.put(file, new TextEncoder().encode(JSON.stringify(index)), publishPutOptions(file))
    await writeTableTokenFile(store, HASH, FILE)

    const indexResponse = await serveCdn(file, store)
    expect(indexResponse.status).toBe(200)
    expect(indexResponse.headers.get('cache-control')).toBe('public, max-age=30')
    expect(await indexResponse.json()).toEqual(index)

    const tokenResponse = await serveCdn(tableTokenPath(HASH), store)
    expect(await tokenResponse.json()).toEqual(FILE)
    // The older v/<slug>.json files are not served any more, and neither is a made-up code.
    expect((await serveCdn('v/demo-club.json', store)).status).toBe(404)
    expect((await serveCdn('v/Demo-Club.json', store)).status).toBe(404)
    expect((await serveCdn(`t/../v/${CODE}.json`, store)).status).toBe(404)
  })
})
