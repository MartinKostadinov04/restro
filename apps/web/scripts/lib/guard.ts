// Refusals of the dev seed. It creates a known owner with a password taken from the environment,
// so it must never run against anything but a developer's own machine.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Throws unless NODE_ENV is `development` and DATABASE_URL points at this machine. */
export function assertDevEnvironment(env: Record<string, string | undefined>): void {
  if (env.NODE_ENV !== 'development') {
    throw new Error(
      `db:seed:dev refuses to run: NODE_ENV is "${env.NODE_ENV ?? ''}", it must be "development".`,
    )
  }
  const url = env.DATABASE_URL
  if (!url) throw new Error('db:seed:dev refuses to run: DATABASE_URL is not set.')
  let host: string
  try {
    const parsed = new URL(url)
    host = parsed.searchParams.get('host') ?? parsed.hostname
  } catch {
    throw new Error('db:seed:dev refuses to run: DATABASE_URL is not a valid URL.')
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `db:seed:dev refuses to run: the database host "${host}" is not on this machine.`,
    )
  }
}

/** The demo owner's credentials from the environment, checked; names only in errors. */
export function readAdminCredentials(env: Record<string, string | undefined>): {
  email: string
  password: string
} {
  const email = env.DEV_ADMIN_EMAIL?.trim()
  const password = env.DEV_ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error('Set DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD in .env.local (see .env.example).')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('DEV_ADMIN_EMAIL is not an email address.')
  }
  if (password.length < 8) throw new Error('DEV_ADMIN_PASSWORD needs at least 8 characters.')
  return { email, password }
}
