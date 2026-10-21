// Views for the component tests: a published menu with one change waiting, nothing held, nothing
// paused (`publishView`, `barView`, `barMenu`). Each test states only what it is about. Not part
// of the app.
import type {
  ChangesView,
  DraftView,
  PublishBarMenu,
  PublishBarView,
  PublishView,
  VersionEntry,
} from '@/server/publish/view'

export const VENUE_ID = 'vn_demoVenueForPublishTests'

const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' as const })

export const NO_CHANGES: ChangesView = {
  total: 0,
  identical: true,
  added: [],
  hidden: [],
  priceChanged: [],
  renamed: [],
  otherChanged: [],
  areas: [],
}

/** One price change waiting: Negroni goes from 12,50 to 14,00. */
export const ONE_PRICE_CHANGE: ChangesView = {
  ...NO_CHANGES,
  total: 1,
  identical: false,
  priceChanged: [
    {
      id: 'nd_negroni',
      name: { bg_BG: 'Негрони', en_US: 'Negroni' },
      from: eur(1250),
      to: eur(1400),
    },
  ],
}

export function readyDraft(changes: ChangesView = ONE_PRICE_CHANGE): DraftView {
  return { state: 'ready', changes, staleOverrides: [], currency: 'EUR' }
}

export function entry(version: number, overrides: Partial<VersionEntry> = {}): VersionEntry {
  return {
    id: `sn_version${version}`,
    version,
    at: `2026-10-0${Math.min(version, 9)}T10:00:00.000Z`,
    status: 'published',
    reason: 'manual',
    actor: { kind: 'person', name: 'Maria Ivanova' },
    restoresVersion: null,
    decisionNote: null,
    held: null,
    counts: null,
    first: false,
    ...overrides,
  }
}

export function publishView(overrides: Partial<PublishView> = {}): PublishView {
  return {
    venueId: VENUE_ID,
    venueSlug: 'demo-club',
    venuePublicId: 'k3x9p2m7qa1z',
    timeZone: 'Europe/Sofia',
    canPublish: true,
    menu: 'ready',
    live: {
      version: 2,
      publishedAt: '2026-10-09T09:30:00.000Z',
      reason: 'manual',
      actor: { kind: 'person', name: 'Maria Ivanova' },
      returned: null,
    },
    draft: readyDraft(),
    held: null,
    paused: false,
    addressServed: true,
    history: {
      entries: [
        entry(2, {
          counts: {
            total: 1,
            added: 0,
            hidden: 0,
            priceChanged: 1,
            renamed: 0,
            otherChanged: 0,
            areas: 0,
          },
        }),
        entry(1, { first: true }),
      ],
      nextBeforeVersion: null,
    },
    busy: null,
    lastRun: null,
    ...overrides,
  }
}

/** The live menu of the venue, published, with the Negroni's new price waiting. */
export function barMenu(overrides: Partial<PublishBarMenu> = {}): PublishBarMenu {
  return {
    menuId: 'nd_liveMenuForPublishTests',
    name: 'Demo Club',
    live: true,
    areas: [],
    changes: 1,
    identical: false,
    blocked: null,
    published: true,
    list: ONE_PRICE_CHANGE,
    busy: null,
    ...overrides,
  }
}

/** The Publish bar of a venue with one menu (`barMenu`), for an owner. */
export function barView(overrides: Partial<PublishBarView> = {}): PublishBarView {
  return {
    venueId: VENUE_ID,
    canPublish: true,
    addressServed: true,
    paused: false,
    guestPath: '/m/demo-org/demo-club',
    lastRun: null,
    menus: [barMenu()],
    ...overrides,
  }
}
