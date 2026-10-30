// @vitest-environment jsdom
// The guest attack checks that depend on the template being bound (#239; the repair review's
// section 5 lists the checks to re-run on another template). The merged checks of the review
// (`apps/web/src/server/security/`) render each template without its services; once Editorial
// Market is bound to the table's services it also draws what the guest API says: order lines with
// a note another phone typed, the bill's lines, the payment, the sent orders, the waiter's request
// and the location consent with the venue's name. Every one of those is whatever someone typed, so
// each must come out as text. And a guest page reaches the guest API only with a table of its own
// venue, with the table's code in a header and our ids in the body.
import { createHash } from 'node:crypto'
import type { MenuSnapshot } from '@restro/core'
import { EDITORIAL_MARKET_MANIFEST, EditorialMarketFace } from '@restro/editorial-market'
import {
  buildViewModel,
  EMPTY_SERVICE_STATE,
  GuestTableStateSchema,
  imageSlotsFor,
  type PaymentView,
  type ServiceBinding,
  type ServiceState,
  type TableBillView,
} from '@restro/shell'
import { fixture, fixtureId, snapshotFromSpec } from '@restro/shell/testing'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_FACE_ID, faceEntry } from '@/faces/registry'

import { GuestMenu } from './guest-menu'
import { files } from './load'

const PAYLOADS = [
  '<script>window.__xss=1</script>',
  '<img src=x onerror=window.__xss=1>',
  '"><svg onload=window.__xss=1>',
  "' onmouseover='window.__xss=1",
  'javascript:window.__xss=1',
  '</style><script>window.__xss=1</script>',
  '<a href="javascript:window.__xss=1">x</a>',
  '{{7*7}}',
]

const both = (text: string) => ({ en_US: text, bg_BG: text })

/** A menu with every service on and markup in the item, its choices and its tag. */
function hostileView(payload: string) {
  const tag = fixtureId('tg', 1)
  const snapshot = snapshotFromSpec({
    locales: { default: 'en_US', available: ['en_US', 'bg_BG'] },
    menuTitle: both(payload),
    features: {
      filters: false,
      call_waiter: { enabled: true, kinds: ['waiter'] },
      bill: true,
      ordering: true,
      pay: true,
    },
    tags: { [tag]: both(payload) },
    sections: [
      {
        title: both(payload),
        items: [
          {
            name: both(payload),
            price: 700,
            tags: [tag],
            groups: [
              {
                name: both(payload),
                min: 0,
                max: 1,
                options: [{ name: both(payload), delta: 100 }],
              },
            ],
          },
        ],
      },
    ],
  } as never)
  return buildViewModel(snapshot, null, {
    locale: 'en_US',
    now: '2026-10-07T20:30:00+03:00',
    orderingEnabled: true,
    tableToken: 'fixture-table-token',
    capabilities: { callWaiter: true, bill: true, ordering: true, pay: true },
    images: imageSlotsFor(EDITORIAL_MARKET_MANIFEST, 1),
  })
}

/** The state of a table in which every text the host sends is the payload. */
function hostileState(payload: string, view: ReturnType<typeof hostileView>): ServiceState {
  const item = view.sections[0]?.items[0]
  if (item === undefined) throw new Error('the menu has no item')
  const option = item.modifierGroups[0]?.options[0]
  const bill: TableBillView = {
    readAgoSeconds: 3,
    complete: true,
    currency: 'EUR',
    totalMinor: 700,
    paidMinor: 0,
    owedMinor: 700,
    parts: [
      {
        id: 'bill-1',
        beingPaid: false,
        totalMinor: 700,
        paidMinor: 0,
        lines: [
          {
            id: 'bn_0000000000000000000001',
            name: both(payload),
            quantity: '1',
            amountMinor: 700,
            beingPaid: false,
          },
        ],
      },
    ],
    paidLines: [{ name: both(payload), quantity: '1', amountMinor: 700 }],
  }
  const payment: PaymentView = {
    id: 'py_1',
    mode: 'bill',
    number: payload,
    state: 'captured',
    reason: null,
    currency: 'EUR',
    amountMinor: 700,
    tipMinor: 0,
    lines: [{ name: both(payload), quantity: '1', amountMinor: 700 }],
    paidAt: '2026-10-07T20:30:00+03:00',
    receiptEmailed: null,
    receiptEmail: null,
    timeZone: 'Europe/Sofia',
    form: null,
  }
  return {
    ...EMPTY_SERVICE_STATE,
    bill: {
      revision: 1,
      total: { minor: 700, currency: 'EUR', text: '€7.00' },
      updatedAt: '',
      rounds: [
        {
          id: 'r1',
          origin: 'guest',
          time: payload,
          actionId: null,
          lines: [
            {
              id: 'l1',
              name: { text: payload, lang: 'en_US' },
              qty: 1,
              total: { minor: 700, currency: 'EUR', text: '€7.00' },
              status: 'received',
              options: [{ text: payload, lang: 'en_US' }],
            },
          ],
        },
      ],
    },
    requests: [{ id: 'wc_1', actionId: 'a1', kind: 'waiter', status: 'sent', note: payload }],
    tableBill: bill,
    payment,
    paying: {
      state: 'on',
      minCardMinor: 50,
      processor: payload,
      venueName: payload,
      legal: { name: payload, eik: '123456789', address: payload, privacyUrl: 'https://x.test/p' },
      electronicReceipt: false,
      recent: null,
    },
    ordering: { state: 'on', notesAndOptions: true, tips: true },
    order: {
      lines: [
        {
          id: 'ol_0000000000000000000001',
          itemId: item.id,
          optionIds: option === undefined ? [] : [option.id],
          qty: 1,
          note: payload,
          mode: 'on_bill',
          held: false,
          pending: false,
        },
      ],
      removed: [],
      earlier: null,
    },
    sentOrders: [
      {
        id: 'so_1',
        state: 'unconfirmed',
        reason: payload,
        ref: payload,
        lines: [{ itemId: item.id, optionIds: [], qty: 1 }],
        sentAt: Date.now(),
        sentClock: payload,
        mine: false,
      },
    ],
  } as ServiceState
}

function bindingOf(state: ServiceState): ServiceBinding {
  return {
    state,
    dispatch: (command) =>
      Promise.resolve({ actionId: command.actionId, status: 'pending', message: null, ref: null }),
    location: {
      allow: async () => null,
      decline: () => {},
      reopen: () => {},
      dismiss: () => {},
      stop: () => {},
    },
  }
}

const SCREENS = [
  ['the order', '#bag'],
  ['the bill', '#tab'],
  ['the waiter', '#call'],
  ['paying', '#pay'],
] as const

function elementsOf(root: Element): Element[] {
  return [root, ...root.querySelectorAll('*')]
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.matchMedia = (() => ({
    matches: true,
    media: '',
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
  Reflect.deleteProperty(window, '__xss')
})

describe.each(PAYLOADS)(
  'Editorial Market bound to the table’s services, markup %s everywhere',
  (payload) => {
    const view = hostileView(payload)

    it.each(SCREENS)(
      'draws %s from the host’s texts as text, with no element or handler from them',
      async (_name, hash) => {
        window.history.replaceState(null, '', `/${hash}`)
        const state = hostileState(payload, view)
        const { container } = render(
          <EditorialMarketFace view={view} services={bindingOf(state)} tableLabel={payload} />,
        )
        await screen.findAllByRole('dialog')
        for (const element of [...elementsOf(container), ...elementsOf(document.body)]) {
          const tag = element.tagName.toLowerCase()
          expect(['iframe', 'object', 'embed', 'script'], tag).not.toContain(tag)
          for (const attribute of element.getAttributeNames()) {
            expect(attribute.toLowerCase().startsWith('on'), `${tag} ${attribute}`).toBe(false)
          }
          const url = element.getAttribute('href') ?? element.getAttribute('src') ?? ''
          expect(url.toLowerCase().startsWith('javascript:'), url).toBe(false)
        }
        expect(Reflect.get(window, '__xss')).toBeUndefined()
        // The test reaches the texts: the payload is on the screen as text.
        expect(document.body.textContent).toContain(payload)
        // And it never reached the page as markup: no image, no svg, no link came from it. (An
        // attribute may hold the text, as the label of a button; it is a value, not a tag.)
        expect(
          document.querySelector('img[src="x"], svg[onload], a[href^="javascript:"]'),
        ).toBeNull()
        expect(document.querySelector('[onerror], [onload], [onmouseover]')).toBeNull()
      },
    )

    it('draws the location consent with a venue named by the payload as text', () => {
      const state: ServiceState = {
        ...EMPTY_SERVICE_STATE,
        location: {
          state: 'needed',
          prompt: 'consent',
          consent: 'unknown',
          venueName: payload,
          privacyUrl: 'https://club.example/privacy',
        },
      }
      render(<EditorialMarketFace view={view} services={bindingOf(state)} />)
      expect(document.body.textContent).toContain(payload)
      for (const element of elementsOf(document.body)) {
        const tag = element.tagName.toLowerCase()
        expect(['iframe', 'object', 'embed', 'script'], tag).not.toContain(tag)
        for (const attribute of element.getAttributeNames()) {
          expect(attribute.toLowerCase().startsWith('on'), `${tag} ${attribute}`).toBe(false)
        }
      }
      expect(Reflect.get(window, '__xss')).toBeUndefined()
    })
  },
)

describe('what the guest API may hand the page', () => {
  const state = {
    unchanged: false,
    version: 1,
    next: 10_000,
    table: { label: '12' },
    ordering: {
      state: 'on',
      notesAndOptions: true,
      payFirst: 'off',
      paying: 'off',
      payingProvider: null,
      payingLegal: null,
      minCardMinor: 50,
      tips: false,
      receiptEmail: false,
      night: { state: 'open', at: null },
    },
    location: {
      state: 'needed',
      passSeconds: null,
      dayEndsInSeconds: 3_600,
      venueName: 'Club',
      privacyUrl: 'https://club.example/privacy',
    },
    order: null,
    sentOrders: [],
    waiterCall: null,
    bill: null,
  }

  it('refuses a privacy link that is not https, so the consent text cannot carry a script link', () => {
    expect(GuestTableStateSchema.safeParse(state).success).toBe(true)
    for (const privacyUrl of ['javascript:window.__xss=1', 'data:text/html,x', 'http://x.test']) {
      const hostile = { ...state, location: { ...state.location, privacyUrl } }
      expect(GuestTableStateSchema.safeParse(hostile).success, privacyUrl).toBe(false)
    }
  })

  it('refuses a legal block whose privacy link is not https', () => {
    const legal = { name: 'X', eik: '123456789', address: 'Y', privacyUrl: 'javascript:alert(1)' }
    const hostile = { ...state, ordering: { ...state.ordering, payingLegal: legal } }
    expect(GuestTableStateSchema.safeParse(hostile).success).toBe(false)
  })
})

describe('the page reaches the guest API only with a table of its own venue', () => {
  const TOKEN = 'tb_guestTestTable0000001'
  const CODE = 'k3x9p2m7qa1z'
  const SLUG = 'demo-club'
  const PARAM = `${SLUG}-${CODE}`
  const sha = (code: string) => createHash('sha256').update(code).digest('hex')

  beforeAll(async () => {
    await faceEntry(DEFAULT_FACE_ID).load()
  }, 60_000)

  function published(tableFile: Record<string, unknown>) {
    const snapshot: MenuSnapshot = fixture('features-on').snapshot
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
      [files.table('/cdn', sha(TOKEN)), tableFile],
    ])
  }

  const requests: { url: string; init: RequestInit | undefined }[] = []
  function serve(bodies: Map<string, unknown>, state: unknown) {
    requests.length = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init })
        if (url.startsWith('/api/guest/')) {
          return Response.json(url.startsWith('/api/guest/state') ? state : {})
        }
        const body = bodies.get(url)
        return body === undefined ? new Response(null, { status: 404 }) : Response.json(body)
      }),
    )
  }

  const tableState = () => ({
    unchanged: false,
    version: 1,
    next: 10_000,
    table: { label: '12' },
    ordering: {
      state: 'on',
      notesAndOptions: true,
      payFirst: 'off',
      paying: 'off',
      payingProvider: null,
      payingLegal: null,
      minCardMinor: 50,
      tips: false,
      receiptEmail: false,
      night: { state: 'open', at: null },
    },
    location: {
      state: 'off',
      passSeconds: null,
      dayEndsInSeconds: 3_600,
      venueName: 'Club',
      privacyUrl: null,
    },
    order: { lines: [], removed: [], earlier: null },
    sentOrders: [],
    waiterCall: null,
    bill: null,
  })

  it('takes a code that another venue owns for no table: menu only, and not one call to the guest API', async () => {
    serve(
      published({ venue_public_id: 'someotherclub', venue_slug: 'other', table_label: '1' }),
      tableState(),
    )
    window.history.replaceState(null, '', `/m/${PARAM}?lang=en#t=${TOKEN}`)
    render(<GuestMenu venue={PARAM} />)
    expect(await screen.findByText('Hummus')).toBeTruthy()
    expect(document.querySelector('[data-slot="item.add"]')).toBeNull()
    expect(document.querySelector('[data-slot="menu.bill"]')).toBeNull()
    expect(requests.filter((request) => request.url.startsWith('/api/guest/'))).toEqual([])
  })

  it('sends an add with the code in a header, our ids in the body and no price, name or POS field', async () => {
    serve(published({ venue_public_id: CODE, venue_slug: SLUG, table_label: '12' }), tableState())
    window.history.replaceState(null, '', `/m/${PARAM}?lang=en#t=${TOKEN}`)
    render(<GuestMenu venue={PARAM} />)
    await waitFor(() => expect(document.querySelector('[data-slot="item.add"]')).not.toBeNull())
    await userEvent.click(screen.getAllByRole('button', { name: /^Add / })[0] as HTMLElement)
    await waitFor(() =>
      expect(requests.some((request) => request.url.startsWith('/api/guest/actions'))).toBe(true),
    )
    const post = requests.find((request) => request.url.startsWith('/api/guest/actions'))
    expect(post?.url).not.toContain(TOKEN)
    const headers = new Headers(post?.init?.headers)
    expect(headers.get('authorization')).toBe(`Table ${TOKEN}`)
    expect(headers.get('x-restro-phone')).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const body = JSON.parse(String(post?.init?.body)) as { command: Record<string, unknown> }
    expect(body.command.kind).toBe('order.add')
    expect(String(body.command.itemId)).toMatch(/^nd_/)
    expect(Object.keys(body.command).sort()).toEqual([
      'actionId',
      'itemId',
      'kind',
      'note',
      'optionIds',
      'qty',
    ])
    expect(JSON.stringify(body)).not.toMatch(/price|minor|cost|barsy|article|"name"/i)
  })
})
