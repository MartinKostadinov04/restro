// What the platform's Integrations service asks of one connector (adjustments I1, I2, D81, D82),
// so the service itself names no system: how to read a host, seal credentials, queue the
// connector's jobs, tell whether a venue can be pulled, and supply the connector's own settings
// (the system settings card of an instance, the part of a venue's Menu source that is the
// connector's). Server only; the client side of the same registry is `ui.tsx`. One implementation
// per connector, in its own folder (`barsy/server.ts` today), listed in `server.ts`.
import type { IntegrationKind, JobPayload, ProducedJobName } from '@restro/core'
import type { DbPool, Integration, ReadTx } from '@restro/db'

import type { InstanceSettingsData, VenueSourceData } from './data'
import type { HeldSyncEntry } from './sync-reads'
import type { TillVenueLink } from './till-venues'

/** Puts a job in the queue (`enqueueJob`); resolves to null when an identical job is waiting. */
export type Enqueue = <N extends ProducedJobName>(
  name: N,
  data: JobPayload<N>,
) => Promise<string | null>

/** The address a manager typed, reduced to the host the instance stores, or refused. */
export type HostCheck = { readonly ok: true; readonly host: string } | { readonly ok: false }

/** What saving a connector setting answers. */
export type SettingsSave = 'saved' | 'invalid' | 'not_found'

/** What the sealed credentials are bound to (so they open for this instance and host only). */
export interface SealBinding {
  readonly publicKey: string
  readonly tenantId: string
  readonly integrationId: string
  readonly host: string
}

export interface ConnectorServer {
  readonly kind: IntegrationKind
  /** The names of the connector's queue jobs, to tell whether one is waiting for an instance. */
  readonly jobNames: { readonly connect: string; readonly pull: string }
  /**
   * The keys of `integrations.config` that belong to one installation and mean nothing at another
   * host: forgotten (set to null) when the host of an instance that serves no venue changes.
   */
  readonly installationConfigKeys: readonly string[]

  /** Reduces what the manager typed to the host the instance stores. */
  parseHost(input: string): HostCheck
  /** Seals the API user and password for the worker; throws core's `SealError` when it cannot. */
  seal(credentials: { user: string; password: string }, binding: SealBinding): string
  /** Queues the connection check of an instance. */
  queueConnect(
    enqueue: Enqueue,
    ids: { readonly tenantId: string; readonly integrationId: string },
  ): Promise<void>
  /** Queues a full pull of one venue of ours; null when an identical one is waiting. */
  queuePull(
    enqueue: Enqueue,
    ids: {
      readonly tenantId: string
      readonly integrationId: string
      readonly venueId: string
    },
  ): Promise<string | null>
  /** Forgets what was chosen for the instance's venues at its old host (they mean nothing at the new one). */
  forgetInstallation(pool: DbPool, tenantId: string, integrationId: string): Promise<void>

  /** Whether the system has told us what to read for a linked venue, so that a pull can run. */
  canPull(link: TillVenueLink): boolean
  /** The latest of the last full and the last incremental pull of a linked venue, from the sync state. */
  lastSyncedAt(integration: Integration, link: TillVenueLink): string | null
  /** The complete full pulls of the instance that held their conclusion back (T62). */
  readHeldSyncs(tx: ReadTx, integrationId: string): Promise<HeldSyncEntry[]>

  /** The data of the instance's system settings card. */
  loadInstanceSettings(tx: ReadTx, integration: Integration): Promise<InstanceSettingsData>
  /** Validates and saves the system settings card's input. */
  saveInstanceSettings(
    deps: { readonly pool: DbPool; readonly tenantId: string; readonly integration: Integration },
    input: unknown,
  ): Promise<SettingsSave>
  /** The data of the connector's part of a venue's Menu source card. */
  loadVenueSource(integration: Integration, link: TillVenueLink): VenueSourceData
  /** Validates and saves the connector part's input for one venue. */
  saveVenueSource(
    deps: {
      readonly pool: DbPool
      readonly tenantId: string
      readonly integration: Integration
      readonly link: TillVenueLink
    },
    input: unknown,
  ): Promise<SettingsSave>
}
