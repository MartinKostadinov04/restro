// A barsy installation in memory, for the sync tests: the demo recordings (packages/barsy/
// fixtures/demo) served the way barsy serves them (paging, the `last_update` filter, 401 for wrong
// credentials), with hooks to break a page, change an article or drop one. Built on MSW, so the
// real client, the real reader and the real worker code run against it and nothing leaves the
// machine: any request it does not know fails the test.
//
// The recorded bodies are re-serialised per request. A price such as 2.40 goes out as 2.4: the
// client reads both as the exact decimal text, so the minor units are the same.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { FIXTURES_ROOT } from '@restro/barsy/testing'
import { HttpResponse, http } from 'msw'
import { type SetupServer, setupServer } from 'msw/node'

const DEMO = join(FIXTURES_ROOT, 'demo')

function fixtureJson(file: string): unknown {
  const fixture = JSON.parse(readFileSync(join(DEMO, file), 'utf8')) as { body: string }
  return JSON.parse(fixture.body)
}

type Json = Record<string, unknown>

export interface FakeCall {
  readonly method: string
  readonly bid: string | null
  readonly params: Json
  readonly authorization: string | null
}

/** What a hook may do to a page of articles instead of serving it. */
export type PageFault = 'network' | 'server_error' | 'bad_json'

export interface FakeBarsy {
  readonly host: string
  server: SetupServer
  /** Articles as the list serves them: change them between pulls. */
  articles: Json[]
  tree: Json
  /** Combo article id -> its option groups. */
  supplements: Map<string, unknown>
  modificators: Json[]
  places: Json[]
  venues: Json[]
  /**
   * Per barsy venue (`?bid=`), what it answers instead of the lists above (CF-16: two venues on
   * one catalogue answer in their own context: their own prices and for-sale flags).
   */
  byBid: Map<string, { articles?: Json[]; tree?: Json; places?: Json[] }>
  /** The password the installation accepts (user `demo`). */
  password: string
  /** Called for every `Articles_getlist` page; return a fault to break it. */
  articleFault: ((offset: number, length: number) => PageFault | undefined) | undefined
  /** Called for every `Articlesupplements_get`; return true to fail it. */
  supplementFault: ((articleId: string) => boolean) | undefined
  /** Called for every API request, after it is recorded and before it is answered: make it slow. */
  onCall: ((method: string, params: Json) => Promise<void> | void) | undefined
  /** Called for every photo request, before it is answered. */
  onPhotoRequest: ((path: string) => Promise<void> | void) | undefined
  /** True: a photo request without the right credentials gets 401. */
  photosNeedAuth: boolean
  /** Photos by URL path+query (the tests register what they serve). */
  photos: Map<string, { status: number; body: Uint8Array; headers?: Record<string, string> }>
  readonly calls: FakeCall[]
  /** The calls to one method, in order. */
  callsOf(method: string): FakeCall[]
  /** The authorization headers photo requests carried (null: anonymous). */
  readonly photoRequests: { url: string; authorization: string | null }[]
  listen(): void
  close(): void
  /** Forgets calls, restores the demo data and the default behaviour. */
  reset(): void
  /** `Basic …` for user `demo` and the current password. */
  basic(): string
}

export function createFakeBarsy(host = 'demo.barsyonline.com'): FakeBarsy {
  const fresh = () => ({
    articles: fixtureJson('articles-bid10-page1.json') as Json[],
    tree: fixtureJson('tree-bid10.json') as Json,
    supplements: new Map<string, unknown>([['7183', fixtureJson('supplements-7183-burger.json')]]),
    modificators: fixtureJson('modificators-bid10.json') as Json[],
    places: fixtureJson('places-bid10.json') as Json[],
    venues: fixtureJson('barsys.json') as Json[],
    byBid: new Map<string, { articles?: Json[]; tree?: Json; places?: Json[] }>(),
  })
  const languages = fixtureJson('languages.json')
  const currencies = fixtureJson('currencies.json')
  const details = fixtureJson('article-details.json')
  const wrongPassword = readFileSync(join(DEMO, 'ping-user-unauthorised.json'), 'utf8')
  const unauthorisedBody = (JSON.parse(wrongPassword) as { body: string }).body

  const calls: FakeCall[] = []
  const photoRequests: { url: string; authorization: string | null }[] = []
  const state = fresh()

  const fake: FakeBarsy = {
    host,
    ...state,
    password: 'demo-password',
    articleFault: undefined,
    supplementFault: undefined,
    onCall: undefined,
    onPhotoRequest: undefined,
    photos: new Map(),
    photosNeedAuth: false,
    calls,
    photoRequests,
    server: undefined as unknown as SetupServer,
    callsOf: (method) => calls.filter((call) => call.method === method),
    listen: () => fake.server.listen({ onUnhandledRequest: 'error' }),
    close: () => fake.server.close(),
    basic: () => `Basic ${Buffer.from(`demo:${fake.password}`).toString('base64')}`,
    reset() {
      calls.length = 0
      photoRequests.length = 0
      Object.assign(fake, fresh())
      fake.password = 'demo-password'
      fake.articleFault = undefined
      fake.supplementFault = undefined
      fake.onCall = undefined
      fake.onPhotoRequest = undefined
      fake.photos.clear()
      fake.photosNeedAuth = false
      fake.server.resetHandlers()
    },
  }

  const json = (body: unknown) => HttpResponse.json(body as never)
  const unauthorised = () =>
    new HttpResponse(unauthorisedBody, {
      status: 401,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })

  fake.server = setupServer(
    http.post(`https://${host}/endpoints/json/:method`, async ({ request, params }) => {
      const method = String(params.method)
      const text = await request.text()
      const body = (text === '' ? {} : JSON.parse(text)) as Json
      const authorization = request.headers.get('authorization')
      const bid = new URL(request.url).searchParams.get('bid')
      calls.push({ method, bid, params: body, authorization })
      const own = bid === null ? undefined : fake.byBid.get(bid)
      await fake.onCall?.(method, body)
      if (method === 'Misc_ping') return json(1)
      if (authorization !== fake.basic()) return unauthorised()

      switch (method) {
        case 'Misc_ping_user':
          return json(1)
        case 'Barsys_getlist':
          return json(fake.venues)
        case 'Languages_getlist':
          return json(languages)
        case 'Currencies_getlist':
          return json(currencies)
        case 'Articledetails_gettree':
          return json(details)
        case 'Categories_getalltree':
          return json(own?.tree ?? fake.tree)
        case 'Places_getlist':
          return json(own?.places ?? fake.places)
        case 'Modificators_getlist': {
          const offset = Number(body.offset ?? 0)
          return json(fake.modificators.slice(offset, offset + Number(body.length ?? 50)))
        }
        case 'Articlesupplements_get': {
          const id = String(body.article_id)
          if (fake.supplementFault?.(id)) return new HttpResponse('boom', { status: 500 })
          return json(fake.supplements.get(id) ?? [])
        }
        case 'Articles_getlist': {
          const offset = Number(body.offset ?? 0)
          const length = Number(body.length ?? 50)
          const fault = fake.articleFault?.(offset, length)
          if (fault === 'network') return HttpResponse.error()
          if (fault === 'server_error') return new HttpResponse('too slow', { status: 504 })
          if (fault === 'bad_json') return new HttpResponse('<html>', { status: 200 })
          const filters = (body.filters ?? {}) as Json
          let list = own?.articles ?? fake.articles
          // A whole-catalogue read (CF-16): the articles of that catalogue only. The subtree
          // filter (`cat_id_deep`) is not applied: the mapping keeps to the root itself.
          if (typeof filters.menu_id === 'string') {
            list = list.filter((article) => String(article.menu_id) === filters.menu_id)
          }
          if (typeof filters.last_update === 'string' && filters.last_update.startsWith('>')) {
            const after = filters.last_update.slice(1)
            list = list.filter((article) => String(article.last_update ?? '') > after)
          }
          list = [...list].sort((a, b) => Number(a.article_id) - Number(b.article_id))
          return json(list.slice(offset, offset + length))
        }
        default:
          return new HttpResponse(`fake-barsy: no handler for ${method}`, { status: 501 })
      }
    }),

    http.get(`https://${host}/endpoints/res/files_get`, async ({ request }) => {
      const url = new URL(request.url)
      const authorization = request.headers.get('authorization')
      photoRequests.push({ url: `${url.pathname}${url.search}`, authorization })
      await fake.onPhotoRequest?.(`${url.pathname}${url.search}`)
      if (fake.photosNeedAuth && authorization !== fake.basic()) return unauthorised()
      const entry = fake.photos.get(`${url.pathname}${url.search}`)
      if (!entry) return new HttpResponse('no such picture', { status: 404 })
      return new HttpResponse(entry.body as never, {
        status: entry.status,
        headers: { 'content-type': 'image/png', ...entry.headers },
      })
    }),
  )
  return fake
}
