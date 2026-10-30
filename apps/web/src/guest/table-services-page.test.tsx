// @vitest-environment jsdom
// The guest page with a table link, on the default template (Editorial Market, #239): the page
// binds the table's services client, and the template draws the add control, the bag, Send, the
// bill, Pay and Call a waiter. A venue whose own ordering switch is off, and a page with no table,
// stay menu-only. The page only ever asks the guest API for the table's state, with the table's
// code in a header and never in an address (rule 4 for the files, D122 §4 for the API).
import { createHash } from 'node:crypto'
import type { MenuSnapshot } from '@restro/core'
import type { GuestTableState } from '@restro/shell'
import { fixture } from '@restro/shell/testing'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_FACE_ID, faceEntry } from '@/faces/registry'

import { buildContext } from './context'
import { GuestMenu } from './guest-menu'
import { files } from './load'
import { SHARED_ORDER_FACES } from './use-table-services'

beforeAll(async () => {
  await faceEntry(DEFAULT_FACE_ID).load()
}, 60_000)

const TOKEN = 'tb_guestTestTable0000001'
const sha = (code: string) => createHash('sha256').update(code).digest('hex')
const CODE = 'k3x9p2m7qa1z'
const SLUG = 'demo-club'
const PARAM = `${SLUG}-${CODE}`

/** The published files of a features fixture, with the table's file. */
function published(name: 'features-on' | 'features-off') {
  const snapshot: MenuSnapshot = fixture(name).snapshot
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
  return {
    snapshot,
    bodies: new Map<string, unknown>([
      [files.index('/cdn', CODE), index],
      [files.current('/cdn', index), pointer],
      [files.snapshot('/cdn', pointer), snapshot],
      [files.live('/cdn', index), { version: pointer.version, items: {} }],
      [
        files.table('/cdn', sha(TOKEN)),
        { venue_public_id: CODE, venue_slug: SLUG, table_label: '12' },
      ],
    ]),
  }
}

/** What the guest API answers for a table: an order with the given lines. */
function tableState(itemId: string | null): GuestTableState {
  return {
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
    order: {
      lines:
        itemId === null
          ? []
          : [
              {
                id: 'ol_0000000000000000000001' as never,
                itemId: itemId as never,
                optionIds: [],
                qty: 2,
                note: '',
                rev: 1,
                mode: 'on_bill',
                held: null,
              },
            ],
      removed: [],
      earlier: null,
    },
    sentOrders: [],
    waiterCall: null,
    bill: null,
  } as GuestTableState
}

let requests: { url: string; headers: Headers }[]

function serve(bodies: Map<string, unknown>, state: GuestTableState) {
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, headers: new Headers(init?.headers) })
      if (url.startsWith('/api/guest/state')) return Response.json(state)
      const body = bodies.get(url)
      return body === undefined ? new Response(null, { status: 404 }) : Response.json(body)
    }),
  )
}

function visit(hash: string) {
  window.history.replaceState(null, '', `/m/${PARAM}?lang=en${hash}`)
}

const slot = (name: string) => document.querySelector(`[data-slot="${name}"]`)
const guestCalls = () => requests.filter((request) => request.url.startsWith('/api/guest/'))

beforeEach(() => {
  document.title = ''
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('a table link on Editorial Market', () => {
  it('gets the add control, the bag, the bill, Pay and Call a waiter, and the table’s order from the server', async () => {
    const { snapshot, bodies } = published('features-on')
    const [, mojito = ''] = Object.keys(snapshot.items)
    serve(bodies, tableState(mojito))
    visit(`#t=${TOKEN}`)
    render(<GuestMenu venue={PARAM} />)

    expect(await screen.findByText('Hummus')).toBeTruthy()
    // The venue's own switches are on and the template is bound: every table service is drawn.
    await waitFor(() => expect(slot('item.add')).not.toBeNull())
    for (const name of ['menu.bag', 'menu.bill', 'menu.pay', 'menu.call_waiter']) {
      expect(slot(name), name).not.toBeNull()
    }
    // The order is the server's: the bag button comes with its line, and opens the order sheet with Send.
    const bag = await screen.findByRole('button', { name: /View bag/ })
    expect(bag.textContent).toContain('2')
    await userEvent.click(bag)
    const sheet = await screen.findByRole('dialog', { name: 'Your bag' })
    expect(sheet.querySelector('[data-order-line]')?.getAttribute('data-qty')).toBe('2')
    expect(within(sheet).getByRole('button', { name: 'Send 2 items' })).toBeTruthy()

    // The bill, Pay and the waiter reach the server through the same client: the table's code is in a
    // header, never in an address.
    const calls = guestCalls()
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.url).not.toContain(TOKEN)
      expect(call.headers.get('authorization')).toBe(`Table ${TOKEN}`)
    }
  })

  it('stays menu-only for a venue whose own ordering switch is off, though the table is bound', async () => {
    const { bodies } = published('features-off')
    serve(bodies, tableState(null))
    visit(`#t=${TOKEN}`)
    render(<GuestMenu venue={PARAM} />)
    expect(await screen.findByText('Hummus')).toBeTruthy()
    await waitFor(() => expect(guestCalls().length).toBeGreaterThan(0))
    expect(slot('item.add')).toBeNull()
    for (const name of ['menu.bag', 'menu.bill', 'menu.pay', 'menu.call_waiter']) {
      expect(slot(name), name).toBeNull()
    }
    expect(document.querySelector('.ro-bagbar')).toBeNull()
  })

  it('stays menu-only on a page with no table, and asks the guest API for nothing', async () => {
    const { bodies } = published('features-on')
    serve(bodies, tableState(null))
    visit('')
    render(<GuestMenu venue={PARAM} />)
    expect(await screen.findByText('Hummus')).toBeTruthy()
    expect(slot('item.add')).toBeNull()
    for (const name of ['menu.bag', 'menu.bill', 'menu.pay', 'menu.call_waiter']) {
      expect(slot(name), name).toBeNull()
    }
    expect(guestCalls()).toEqual([])
  })

  it('stays menu-only on an unknown table code', async () => {
    const { bodies } = published('features-on')
    serve(bodies, tableState(null))
    visit('#t=tb_ZZZZZZZZZZZZZZZZZZZZZZ')
    render(<GuestMenu venue={PARAM} />)
    expect(await screen.findByText('Hummus')).toBeTruthy()
    expect(slot('item.add')).toBeNull()
    expect(slot('menu.bill')).toBeNull()
    expect(guestCalls()).toEqual([])
  })
})

describe('what the page tells the shell is supported (buildContext)', () => {
  const input = {
    locale: 'en_US' as const,
    now: new Date('2026-10-10T12:00:00Z'),
    tableToken: 'tb_guestTestTable0000001',
  }
  const editorial = faceEntry('editorial-market').manifest
  const reference = faceEntry('qr-phone').manifest

  it('turns ordering and every table service off for a template that is not bound', () => {
    expect(buildContext({ ...input, manifest: editorial }).capabilities).toEqual({
      ordering: false,
      callWaiter: false,
      bill: false,
      pay: false,
    })
    expect(buildContext({ ...input, manifest: editorial }).orderingEnabled).toBe(false)
  })

  it('turns on the services the bound template declares controls for, and only those', () => {
    const on = buildContext({ ...input, manifest: editorial, sharedOrder: true })
    expect(on.orderingEnabled).toBe(true)
    expect(on.capabilities).toEqual({ ordering: true, callWaiter: true, bill: true, pay: true })
    // The reference template declares only ordering, so it is offered nothing more than before.
    expect(buildContext({ ...input, manifest: reference, sharedOrder: true }).capabilities).toEqual(
      { ordering: true, callWaiter: false, bill: false, pay: false },
    )
  })

  it('binds the table’s services for Editorial Market and the reference template, no other', () => {
    expect([...SHARED_ORDER_FACES].sort()).toEqual(['editorial-market', 'qr-phone'])
  })
})
