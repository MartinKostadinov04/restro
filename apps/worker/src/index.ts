// Entry point of the worker process (`pnpm --filter @restro/worker start`, built by tsup).
// Reads the environment, starts the worker and installs the shutdown handlers. The work itself
// lives in worker.ts; the settings are documented in config.ts.
import { ConfigError, loadConfig } from './config'
import { createLogger } from './logger'
import { installShutdownHandlers } from './shutdown'
import { startWorker } from './worker'

async function main(): Promise<void> {
  let config: ReturnType<typeof loadConfig>
  try {
    config = loadConfig()
  } catch (error) {
    // No logger yet (its level comes from the configuration).
    console.error(error instanceof ConfigError ? error.message : 'Could not read the settings.')
    process.exit(1)
  }

  const log = await createLogger({ level: config.logLevel, pretty: config.prettyLogs })

  // A crash is better than a half-working worker: log it safely, exit non-zero, and let the
  // platform restart the process. pg-boss returns the jobs that were running when it died.
  process.on('uncaughtException', (error) => {
    log.fatal({ err: error }, 'uncaught exception')
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    log.fatal({ err: reason }, 'unhandled promise rejection')
    process.exit(1)
  })

  try {
    const worker = await startWorker(config, { logger: log })
    installShutdownHandlers({ worker, log })
  } catch (error) {
    log.fatal({ err: error }, 'worker failed to start')
    process.exit(1)
  }
}

void main()
