// The server side of the simulated POS for the platform's Integrations service (#71): the kind
// `sim`, for tests, demos and staging. It is POS-neutral: no credentials, no menu settings, and its
// "pull" is the floor reading. The web app never calls the simulator (the worker does); this only
// reads and writes our own database and queue. It is offered only where `simOffered` says so (never
// in production: see `../server.ts`).
import { type IntegrationId, JOB_NAMES, type TenantId, type VenueId } from '@restro/core'
import { clearBarsyVenueChoices } from '@restro/core/apply'

import type { SimInstanceSettings, SimVenueSource } from '../data'
import type { ConnectorServer, HostCheck } from '../server-types'

/** A host name or IP address with an optional port: `localhost:4010`, `demo.sim.example`. */
const HOST_WITH_PORT =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(?::[1-9][0-9]{0,4})?$/

/** Reduces what a person typed to the bare host (and port) the instance stores, or refuses it. */
export function parseSimHost(input: string): HostCheck {
  const text = typeof input === 'string' ? input.trim().toLowerCase() : ''
  if (text === '' || text.length > 253 || !HOST_WITH_PORT.test(text)) return { ok: false }
  const port = /:([0-9]+)$/.exec(text)?.[1]
  if (port !== undefined && Number(port) > 65535) return { ok: false }
  return { ok: true, host: text }
}

export const simServer: ConnectorServer = {
  kind: 'sim',
  // A floor reading is the simulated POS's only job: it stands for both the check and the pull.
  jobNames: { connect: JOB_NAMES.floorRead, pull: JOB_NAMES.floorRead },
  installationConfigKeys: ['sim_scenario'],

  parseHost: parseSimHost,

  seal() {
    throw new Error('the simulated POS has no credentials to seal')
  },

  async queueConnect() {
    // Nothing to check: the simulator has no login to test. The venue's floor read does the work.
  },

  queuePull(enqueue, ids) {
    return enqueue(JOB_NAMES.floorRead, {
      tenantId: ids.tenantId as TenantId,
      integrationId: ids.integrationId as IntegrationId,
      venueId: ids.venueId as VenueId,
    })
  },

  async forgetInstallation(pool, tenantId, integrationId) {
    await clearBarsyVenueChoices(pool, tenantId, integrationId)
  },

  canPull: () => true,
  lastSyncedAt: () => null,
  readHeldSyncs: async () => [],

  async loadInstanceSettings(): Promise<SimInstanceSettings> {
    return { kind: 'sim' }
  },
  async saveInstanceSettings() {
    return 'invalid'
  },
  loadVenueSource(): SimVenueSource {
    return { kind: 'sim' }
  },
  async saveVenueSource() {
    return 'invalid'
  },
}
