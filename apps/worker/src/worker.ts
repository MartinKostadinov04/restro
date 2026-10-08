export interface Worker {
  stop(): void
}

/**
 * Starts the worker. Placeholder: it only logs and stays alive like a real service.
 * The pg-boss queues arrive with their own tasks.
 */
export function startWorker(log: (line: string) => void = console.log): Worker {
  log('worker started')
  // Keeps the process running, as the pg-boss polling loop will later.
  const keepAlive = setInterval(() => undefined, 60_000)
  return {
    stop() {
      clearInterval(keepAlive)
      log('worker stopped')
    },
  }
}
