// Fixtures of the Integration tab's component tests. Not part of the app.
import type { IntegrationView, RunView } from '@/server/integration/view'

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

/** A connected integration with everything chosen, a pull possible, and no runs. */
export function integrationView(overrides: Partial<IntegrationView> = {}): IntegrationView {
  return {
    canManage: true,
    sealReady: true,
    timeZone: 'Europe/Sofia',
    venueName: 'Demo Club Sofia',
    integration: {
      host: 'demo.barsyonline.com',
      hasCredentials: true,
      status: 'connected',
      statusDetail: null,
      lastCheckedAt: '2026-10-09T10:00:00.000Z',
    },
    activeJob: null,
    barsyVenues: [
      { key: 1, name: 'Main bar', mappedHere: true, usedBy: null },
      { key: 2, name: 'Roof terrace', mappedHere: false, usedBy: null },
      { key: 3, name: 'Garden', mappedHere: false, usedBy: 'Venue B' },
    ],
    venueMapped: true,
    tree: TREE,
    treeFetchedAt: '2026-10-09T09:00:00.000Z',
    rootCatId: 1171,
    settings: {
      priceSource: 'actual_price',
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
      afterSync: 'auto',
      newItems: 'show',
      scheduleActive: true,
      nextIncrementalAt: '2026-10-09T09:35:00.000Z',
      nextFullPullAt: '2026-10-10T09:00:00.000Z',
    },
    lastSyncedAt: '2026-10-09T09:30:00.000Z',
    heldSync: null,
    gate: { enabled: true },
    runs: [],
    ...overrides,
  }
}

/** A view of a venue nobody has connected yet. */
export function emptyView(overrides: Partial<IntegrationView> = {}): IntegrationView {
  return integrationView({
    integration: null,
    barsyVenues: [],
    venueMapped: false,
    tree: null,
    treeFetchedAt: null,
    rootCatId: null,
    lastSyncedAt: null,
    gate: { enabled: false, reason: 'no_credentials' },
    ...overrides,
  })
}

export function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: 'jb_0123456789ABCDEFGHIJKL',
    kind: 'barsy_full_pull',
    status: 'completed',
    startedAt: '2026-10-09T10:00:00.000Z',
    finishedAt: '2026-10-09T10:01:12.000Z',
    counters: { articles_seen: 58, created: 58, updated: 0, failed_pages: 0 },
    errorSummary: null,
    details: { notes: [], refused: [] },
    ...overrides,
  }
}
