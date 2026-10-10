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
import { newId } from '@restro/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { serveCdn } from './cdn'
import { cdnSource, inactivePageHtml, tableTokenResponse } from './table-token'

const TOKEN = 'tb_0123456789ABCDEFGHIJKL'

describe('/t/<token> (no database)', () => {
  let root: string
  let store: LocalPublishStore

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'restro-table-token-'))
    store = new LocalPublishStore({ rootDir: root })
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('redirects a known code to the venue menu with the token (302, never cached)', async () => {
    await writeTableTokenFile(store, TOKEN, { venue_slug: 'demo-club', table_label: '12' })
    const response = await tableTokenResponse(TOKEN, store)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`/m/demo-club?t=${TOKEN}`)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('shows the "not active" page for a code nobody knows, in both languages, with no venue data', async () => {
    const response = await tableTokenResponse('tb_ZZZZZZZZZZZZZZZZZZZZZZ', store)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('cache-control')).toBe('no-store')
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
    const path = tableTokenPath(TOKEN)
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
      return url.endsWith(`${TOKEN}.json`)
        ? Response.json({ venue_slug: 'demo-club', table_label: '7' })
        : new Response(null, { status: 404 })
    }) as unknown as typeof fetch
    const source = cdnSource('https://cdn.example.test/', fetchFile)
    expect((await tableTokenResponse(TOKEN, source)).headers.get('location')).toBe(
      `/m/demo-club?t=${TOKEN}`,
    )
    expect(calls).toEqual([`https://cdn.example.test/t/${TOKEN}.json`])
    expect((await tableTokenResponse('tb_ZZZZZZZZZZZZZZZZZZZZZZ', source)).status).toBe(404)
  })

  it('has the page text from the interface message files', () => {
    expect(inactivePageHtml()).toContain('lang="bg"')
    expect(inactivePageHtml()).toContain('lang="en"')
  })
})

describe('the slug index and token files are served at /cdn like the others', () => {
  let root: string
  let store: LocalPublishStore

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'restro-cdn-guest-'))
    store = new LocalPublishStore({ rootDir: root })
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('serves v/<slug>.json and t/<token>.json for 30 seconds as json', async () => {
    const index = { venue_id: newId('vn'), menu_id: newId('nd') }
    const file = venueIndexPath('demo-club')
    await store.put(file, new TextEncoder().encode(JSON.stringify(index)), publishPutOptions(file))
    await writeTableTokenFile(store, TOKEN, { venue_slug: 'demo-club', table_label: '12' })

    const indexResponse = await serveCdn(file, store)
    expect(indexResponse.status).toBe(200)
    expect(indexResponse.headers.get('cache-control')).toBe('public, max-age=30')
    expect(await indexResponse.json()).toEqual(index)

    const tokenResponse = await serveCdn(tableTokenPath(TOKEN), store)
    expect(await tokenResponse.json()).toEqual({ venue_slug: 'demo-club', table_label: '12' })
    expect((await serveCdn('v/Demo-Club.json', store)).status).toBe(404)
    expect((await serveCdn('t/../v/demo-club.json', store)).status).toBe(404)
  })
})
