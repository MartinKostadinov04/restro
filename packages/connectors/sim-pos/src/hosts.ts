// Host guard (CLAUDE.md rule 9). The simulated POS runs only where nothing real is: a local
// development host (localhost, 127.0.0.1, ::1, *.localhost, *.test) or a host the deployment
// lists. A production environment is refused outright, so no configuration can point Restro's
// production at a simulator, or a simulator's settings at a real POS.

export const SIM_ENVS = ['development', 'test', 'staging', 'production'] as const
export type SimEnv = (typeof SIM_ENVS)[number]

export class SimHostNotAllowedError extends Error {
  override name = 'SimHostNotAllowedError'
}

export interface SimHostOptions {
  readonly env: SimEnv
  /** Further hosts allowed outside production (a staging demo's own host). */
  readonly allowHosts?: readonly string[]
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.test')
  )
}

/** Checks a simulator base URL; returns it parsed, or throws `SimHostNotAllowedError`. */
export function checkSimHost(baseUrl: string, options: SimHostOptions): URL {
  if (options.env === 'production') {
    throw new SimHostNotAllowedError('the simulated POS is never used in production')
  }
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new SimHostNotAllowedError('the simulated POS base URL is not a URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SimHostNotAllowedError('the simulated POS base URL is http or https')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new SimHostNotAllowedError('the simulated POS base URL carries no user info or query')
  }
  const hostname = url.hostname.toLowerCase()
  const listed = (options.allowHosts ?? []).some((host) => host.toLowerCase() === hostname)
  if (!isLocalHost(hostname) && !listed) {
    throw new SimHostNotAllowedError(`the simulated POS host ${hostname} is not allowed`)
  }
  return url
}
