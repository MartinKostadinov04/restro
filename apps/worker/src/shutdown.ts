// Clean shutdown on SIGTERM (Railway stopping or redeploying the service) and SIGINT (Ctrl+C).
//
// What happens, in order:
//   1. The first signal calls worker.stop(): /health answers 503, pg-boss stops fetching jobs and
//      gives running jobs up to 20 seconds, then both connection pools close (see worker.ts).
//   2. When stop() succeeds the exit code is set to 0 and the process ends by itself, because
//      nothing is left that keeps it alive. If it does not end within FORCE_EXIT_AFTER_MS (a
//      leaked handle, a hung job) the timer below forces exit code 1 and the log says so.
//   3. If stop() fails, the error is logged and the process exits with code 1 at once.
//   4. A second signal while stopping exits with code 1 immediately (an impatient Ctrl+C).
// The service's shutdown grace period on the platform must be longer than the 20 seconds that
// pg-boss waits, or the process is killed before it finishes.
import type { Logger } from './logger'

export const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const

/** Longer than pg-boss's 20 second grace period plus closing the pools. */
export const FORCE_EXIT_AFTER_MS = 30_000

interface SignalSource {
  on(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown
  off(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown
}

export interface ShutdownOptions {
  readonly worker: { stop(): Promise<void> }
  readonly log: Logger
  /** Where signals come from. Default: the process. */
  readonly signals?: SignalSource
  /** Sets the exit code the process ends with. Default: `process.exitCode = code`. */
  readonly setExitCode?: (code: number) => void
  /** Ends the process now. Default: `process.exit`. */
  readonly forceExit?: (code: number) => void
  readonly forceExitAfterMs?: number
}

/** Installs the handlers. Returns a function that removes them (tests). */
export function installShutdownHandlers(options: ShutdownOptions): () => void {
  const { worker, log } = options
  const signals = options.signals ?? process
  const setExitCode =
    options.setExitCode ??
    ((code: number) => {
      process.exitCode = code
    })
  const forceExit = options.forceExit ?? ((code: number) => process.exit(code))
  const forceExitAfterMs = options.forceExitAfterMs ?? FORCE_EXIT_AFTER_MS

  let shuttingDown = false
  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      log.warn({ signal }, 'second signal while shutting down, exiting now')
      forceExit(1)
      return
    }
    shuttingDown = true
    log.info({ signal }, 'shutdown requested')

    // unref: this timer never keeps a healthy process alive; it only fires if something else does.
    const watchdog = setTimeout(() => {
      log.error({ afterMs: forceExitAfterMs }, 'shutdown did not finish in time, exiting')
      forceExit(1)
    }, forceExitAfterMs)
    watchdog.unref()

    worker.stop().then(
      () => setExitCode(0),
      (error: unknown) => {
        log.error({ err: error }, 'shutdown failed')
        clearTimeout(watchdog)
        forceExit(1)
      },
    )
  }

  for (const signal of SHUTDOWN_SIGNALS) signals.on(signal, onSignal)
  return () => {
    for (const signal of SHUTDOWN_SIGNALS) signals.off(signal, onSignal)
  }
}
