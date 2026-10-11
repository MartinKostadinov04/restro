// Fixtures of the component tests of Settings -> Integrations and the venue's Menu source card.
// Not part of the app.
import type {
  IntegrationView,
  LinkedMenuSource,
  RunView,
  TillVenueRow,
} from '@/server/integration/view'

export const VENUE_ID = 'vn_0123456789ABCDEFGHIJKL'

export const TREE = [
  {
    id: 1171,
    name: 'Публично меню',
    children: [
      { id: 1172, name: 'Коктейли', children: [] },
      {
        id: 1173,
        name: 'Бира',
        children: [{ id: 1174, name: 'Наливна', children: [] }],
      },
    ],
  },
  { id: 1091, name: 'Каса Kiosk', children: [] },
] as const

/** The four states of a venue of the installation. */
export const TILL_VENUES: readonly TillVenueRow[] = [
  {
    key: 1,
    name: 'Main bar',
    state: 'linked',
    venue: { id: VENUE_ID, name: 'Demo Club Sofia' },
    hasMenuCategory: true,
  },
  {
    key: 2,
    name: 'Roof terrace',
    state: 'linked',
    venue: { id: 'vn_roofTerrace0000000001', name: 'Roof' },
    hasMenuCategory: false,
  },
  { key: 3, name: 'Garden', state: 'unlinked', venue: null, hasMenuCategory: false },
  { key: 4, name: 'Shop', state: 'not_used', venue: null, hasMenuCategory: false },
]

/** A connected integration with a linked venue, a sync possible, and no runs. */
export function integrationView(overrides: Partial<IntegrationView> = {}): IntegrationView {
  return {
    canManage: true,
    sealReady: true,
    timeZone: 'Europe/Sofia',
    integration: {
      host: 'demo.barsyonline.com',
      hasCredentials: true,
      status: 'connected',
      statusDetail: null,
      lastCheckedAt: '2026-10-09T10:00:00.000Z',
    },
    activeJob: null,
    tillVenues: TILL_VENUES,
    linkableVenues: [
      { id: 'vn_spareVenue000000000001', name: 'Spare venue' },
      { id: 'vn_otherVenue000000000001', name: 'Other venue' },
    ],
    heldSyncs: [],
    mapping: {
      allergenKey: null,
      allergenDetected: { key: 'k102', name: 'Алергени' },
      allergenOptions: [
        { key: 'k101', name: 'Годност в дни' },
        { key: 'k102', name: 'Алергени' },
      ],
      defaultLocale: 'bg_BG',
    },
    syncSettings: {
      incrementalEnabled: true,
      incrementalMinutes: 5,
      fullPullEnabled: true,
      fullPullTime: '12:00',
      scheduleActive: true,
      nextIncrementalAt: '2026-10-09T09:35:00.000Z',
      nextFullPullAt: '2026-10-10T09:00:00.000Z',
    },
    gate: { enabled: true },
    runs: [],
    ...overrides,
  }
}

/** A view of an organisation nobody has connected yet. */
export function emptyView(overrides: Partial<IntegrationView> = {}): IntegrationView {
  return integrationView({
    integration: null,
    tillVenues: [],
    linkableVenues: [],
    gate: { enabled: false, reason: 'no_credentials' },
    syncSettings: {
      incrementalEnabled: true,
      incrementalMinutes: 5,
      fullPullEnabled: true,
      fullPullTime: '12:00',
      scheduleActive: false,
      nextIncrementalAt: null,
      nextFullPullAt: null,
    },
    ...overrides,
  })
}

/** A venue linked to a till venue with its menu category chosen and a sync possible. */
export function linkedMenuSource(overrides: Partial<LinkedMenuSource> = {}): LinkedMenuSource {
  return {
    state: 'linked',
    canManage: true,
    timeZone: 'Europe/Sofia',
    tillVenueName: 'Main bar',
    options: [
      { key: 2, name: 'Roof terrace', usedBy: null, notUsed: false },
      { key: 3, name: 'Garden', usedBy: 'Venue B', notUsed: false },
      { key: 4, name: 'Shop', usedBy: null, notUsed: true },
    ],
    tree: TREE,
    treeFetchedAt: '2026-10-09T09:00:00.000Z',
    rootCatId: 1171,
    priceSource: 'actual_price',
    lastSyncedAt: '2026-10-09T09:30:00.000Z',
    heldSync: null,
    activeJob: null,
    gate: { enabled: true },
    ...overrides,
  }
}

export function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: 'jb_0123456789ABCDEFGHIJKL',
    kind: 'barsy_full_pull',
    status: 'completed',
    venue: { id: VENUE_ID, name: 'Demo Club Sofia' },
    startedAt: '2026-10-09T10:00:00.000Z',
    finishedAt: '2026-10-09T10:01:12.000Z',
    counters: { articles_seen: 58, created: 58, updated: 0, failed_pages: 0 },
    errorSummary: null,
    details: { notes: [], refused: [] },
    ...overrides,
  }
}
