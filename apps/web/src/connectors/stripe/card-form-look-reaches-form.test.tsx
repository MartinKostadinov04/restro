// @vitest-environment jsdom
// DA-35 (#293): the venue's General look really reaches the provider's card form, and the provider
// maps it to its own Appearance object. The audit's mutation M1 cut the look in two places —
// `useTableServices(…, null)` in guest-menu.tsx and `look: null` in `lookNow()` in
// use-table-services.ts — and 7 files with 136 tests stayed green, because only the sandbox-only
// `guest-pay-card.spec.ts` ever opened a real form. This test opens the form on the real page with
// the registry's connector replaced by a spy, so either cut turns it red, and it needs no sandbox:
// the provider's own mapping is checked as a pure function of the look the form was handed.
import { createHash } from 'node:crypto'
import type { MenuSnapshot } from '@restro/core'
import { buildViewModel, type GuestPaymentAnswer, type GuestTableState } from '@restro/shell'
import { fixture } from '@restro/shell/testing'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_FACE_ID, faceEntry } from '@/faces/registry'

import { files } from '../../guest/load'
import { payHandleKey } from '../../guest/services-client'
import type { CardFormContext } from '../card-form-types'
import { stripeOptions } from './appearance'

/** What the registry's card form was handed, mount by mount. */
const mounted: CardFormContext[] = []

vi.mock('../card-forms', async (importOriginal) => {
  const real = await importOriginal<typeof import('../card-forms')>()
  return {
    ...real,
    cardFormFor: (kind: string) =>
      kind === 'sim-pay'
        ? {
            kind,
            processor: 'Simulated payments',
            returnKeys: [],
            mount: (target: HTMLElement, props: { label: string }, context: CardFormContext) => {
              mounted.push(context)
              const mark = target.ownerDocument.createElement('p')
              mark.dataset.slot = 'pay.form.submit'
              mark.textContent = props.label
              target.replaceChildren(mark)
              return { update: () => {}, unmount: () => target.replaceChildren() }
            },
          }
        : null,
  }
})

beforeAll(async () => {
  await faceEntry(DEFAULT_FACE_ID).load()
}, 60_000)

const TOKEN = 'tb_guestTestTable0000001'
const HANDLE = 'AAAAAAAAAAAAAAAAAAAAAA'
const sha = (code: string) => createHash('sha256').update(code).digest('hex')
const CODE = 'k3x9p2m7qa1z'
const SLUG = 'demo-club'
const PARAM = `${SLUG}-${CODE}`

function published() {
  const snapshot: MenuSnapshot = fixture('features-on').snapshot
  // The files the page reads: the venue's index, its current pointer, the snapshot and the table.
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

/** A table with paying on and nothing else to do. */
const tableState = (): GuestTableState =>
  ({
    unchanged: false,
    version: 1,
    next: 10_000,
    table: { label: '12' },
    ordering: {
      state: 'on',
      notesAndOptions: true,
      payFirst: 'off',
      paying: 'on',
      payingProvider: 'sim-pay',
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
  }) as GuestTableState

/** This phone's payment, waiting at the card form. */
const paymentAnswer = (): GuestPaymentAnswer => ({
  id: 'py_cardformlook000000001',
  mode: 'bill',
  number: 'K7Q4M',
  state: 'awaiting_guest',
  reason: null,
  currency: 'EUR',
  amountMinor: 2250,
  tipMinor: 0,
  lines: [{ name: { en_US: 'House wine' }, quantity: '1', amountMinor: 2250 }],
  paidAt: null,
  receiptEmailed: null,
  timeZone: 'Europe/Sofia',
  form: { provider: 'sim-pay', values: { clientSecret: 'cs_test' }, confirmSeconds: 120 },
  next: 2_000,
})

function serve(bodies: Map<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/guest/payment')) return Response.json(paymentAnswer())
      if (url.startsWith('/api/guest/state')) return Response.json(tableState())
      const body = bodies.get(url)
      return body === undefined ? new Response(null, { status: 404 }) : Response.json(body)
    }),
  )
}

beforeEach(() => {
  mounted.length = 0
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('the venue’s look on the provider’s card form (DA-35, decision 130)', () => {
  it('hands the form the venue’s own colours, font, corners, density, text size and sheet', async () => {
    const { bodies } = published()
    serve(bodies)
    // The phone holds the payment's handle, as it does after a Pay or a redirect back: the value
    // and when the client may forget it.
    window.sessionStorage.setItem(payHandleKey(CODE), `${HANDLE}|${Date.now() + 3_600_000}`)
    window.history.replaceState(null, '', `/m/${PARAM}?lang=en#t=${TOKEN}`)
    const { GuestMenu } = await import('../../guest/guest-menu')
    render(<GuestMenu venue={PARAM} />)
    expect(await screen.findByText('Hummus')).toBeTruthy()
    // The payment opens its own screens; the card form is mounted into the face's slot.
    await waitFor(() => expect(mounted).toHaveLength(1), { timeout: 10_000 })
    const look = mounted[0]?.look ?? null
    expect(look).not.toBeNull()
    if (look === null) return
    // The venue's own, worked out from the published snapshot (rule 4): no default, no null.
    const f = fixture('features-on')
    const view = buildViewModel(f.snapshot, f.overlay, f.context)
    expect(look.colors).toEqual(view.theme.colors)
    expect(look.colorsDark).toEqual(view.theme.colorsDark)
    expect(look.scheme).toBe(view.theme.scheme)
    expect(look.radius).toBe(view.theme.radius)
    expect(look.density).toBe(view.design.general.density)
    expect(look.textSize).toBe(view.design.general.text_size)
    expect(look.sheet).toBe(view.design.sheets.sheets)
    // A stack the provider's frame can read: never a CSS variable of the page.
    expect(look.fontFamily).toContain(`"${view.theme.font}"`)
    expect(look.fontFamily).not.toContain('var(')
    // And the provider's Appearance object is made of it, with no Stripe sandbox in sight.
    const options = stripeOptions(look, 'light')
    expect(options.appearance.theme).toBe('flat')
    expect(options.appearance.variables.colorText).toBe(look.colors.text)
    expect(options.appearance.variables.fontFamily).toBe(look.fontFamily)
    expect(options.appearance.variables.borderRadius).toBe(`${Math.round(look.radius)}px`)
  })
})
