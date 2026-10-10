import pkg from '../package.json' with { type: 'json' }

/** The version in apps/worker/package.json (written to worker_heartbeats, shown at start). */
export const WORKER_VERSION: string = pkg.version
