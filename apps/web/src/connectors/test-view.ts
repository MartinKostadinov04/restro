// Fixtures of the component tests of Settings -> Integrations and the venue's Menu source card.
// Not part of the app.
import type { BarsyInstanceSettings, BarsyVenueSource } from '@/connectors/data'
import type {
  InstanceView,
  IntegrationsView,
  LinkedMenuSource,
  RunView,
  SystemOption,
} from '@/server/integration/view'

export const VENUE_ID = 'vn_0123456789ABCDEFGHIJKL'
export const INSTANCE_ID = 'in_0123456789ABCDEFGHIJKL'

/** What the allergen settings card shows by default: detection finds "Алергени". */
export function barsySettings(
  overrides: Partial<BarsyInstanceSettings> = {},
): BarsyInstanceSettings {
  return {
    kind: 'barsy',
    allergenKey: null,
    allergenDetected: { key: 'k102', name: 'Алергени' },
    allergenOptions: [
      { key: 'k101', name: 'Годност в дни' },
      { key: 'k102', name: 'Алергени' },
    ],
    defaultLocale: 'bg_BG',
    ...overrides,
  }
}

/** A connected instance used by one venue, a sync possible, and no runs. */
export function instanceView(overrides: Partial<InstanceView> = {}): InstanceView {
  return {
    id: INSTANCE_ID,
    kind: 'barsy',
    source: 'barsy',
    name: 'barsy – Sofia',
    host: 'demo.barsyonline.com',
    hasCredentials: true,
    status: 'connected',
    statusDetail: null,
    lastCheckedAt: '2026-10-09T10:00:00.000Z',
    timeZone: 'Europe/Sofia',
    activeJob: null,
    venues: [{ id: VENUE_ID, name: 'Demo Club Sofia' }],
    heldSyncs: [],
    gate: { enabled: true },
    runs: [],
    settings: barsySettings(),
    ...overrides,
  }
}

/** An instance nobody has saved credentials for yet. */
export function newInstanceView(overrides: Partial<InstanceView> = {}): InstanceView {
  return instanceView({
    hasCredentials: false,
    status: 'new',
    lastCheckedAt: null,
    venues: [],
    gate: { enabled: false, reason: 'no_credentials' },
    ...overrides,
  })
}

export const SYSTEMS: readonly SystemOption[] = [{ kind: 'barsy', label: 'barsy', instances: 1 }]

/** An organisation that chose its one system and has one connected instance. */
export function integrationsView(overrides: Partial<IntegrationsView> = {}): IntegrationsView {
  return {
    canManage: true,
    sealReady: true,
    systems: SYSTEMS,
    chosen: ['barsy'],
    instances: [instanceView()],
    ...overrides,
  }
}

/** An organisation that has chosen nothing yet. */
export function emptyView(overrides: Partial<IntegrationsView> = {}): IntegrationsView {
  return integrationsView({
    systems: [{ kind: 'barsy', label: 'barsy', instances: 0 }],
    chosen: [],
    instances: [],
    ...overrides,
  })
}

export function barsyVenueSource(overrides: Partial<BarsyVenueSource> = {}): BarsyVenueSource {
  return { kind: 'barsy', priceSource: 'actual_price', ...overrides }
}

/** A venue linked to a venue of the system, a sync possible. */
export function linkedMenuSource(overrides: Partial<LinkedMenuSource> = {}): LinkedMenuSource {
  return {
    state: 'linked',
    canManage: true,
    timeZone: 'Europe/Sofia',
    source: 'barsy',
    instanceName: 'barsy – Sofia',
    tillVenueName: 'Main bar',
    lastSyncedAt: '2026-10-09T09:30:00.000Z',
    heldSync: null,
    activeJob: null,
    gate: { enabled: true },
    runs: [],
    connector: barsyVenueSource(),
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
