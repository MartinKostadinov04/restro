// Environment guard (CLAUDE.md rules 7 and 9), copied from the simulated POS's host guard: the
// simulated provider runs only where nothing real is. A production environment is refused
// outright, so no configuration can let a guest in production "pay" a simulator.

export const SIM_PAY_ENVS = ['development', 'test', 'staging', 'production'] as const
export type SimPayEnv = (typeof SIM_PAY_ENVS)[number]

export class SimPayNotAllowedError extends Error {
  override name = 'SimPayNotAllowedError'
}

/** Throws `SimPayNotAllowedError` in production or for an environment it does not know. */
export function checkSimPayEnv(env: string): SimPayEnv {
  if (env === 'production') {
    throw new SimPayNotAllowedError('the simulated payment provider is never used in production')
  }
  if (!(SIM_PAY_ENVS as readonly string[]).includes(env)) {
    throw new SimPayNotAllowedError(`the environment ${env} is not one the simulator knows`)
  }
  return env as SimPayEnv
}
