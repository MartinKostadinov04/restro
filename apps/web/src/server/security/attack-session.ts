// The fakes an attack test puts around the real server code: who is asking (session), the job
// queue, the page cache and the Next.js request helpers. Everything else is the real code on a real
// Postgres as restro_app. A test wires them with:
//
//   vi.mock('@/server/session', async () => (await import('./attack-session')).sessionModule)
//
// and so on. The state is one plain object, so a test switches person between calls.
export interface AskedPerson {
  readonly userId: string
  readonly tenantId: string
  readonly role: string
  /** The Better Auth session id: what a shared device is known by. */
  readonly sessionId: string
}

export const asked: { person: AskedPerson | null } = { person: null }

/** Everything the code under attack tried to reach outside itself. */
export const seen = {
  jobs: [] as { name: string; data: unknown }[],
  fetches: [] as string[],
  errors: [] as string[],
  warnings: [] as Record<string, string | number>[],
  revalidated: [] as string[],
  reset(): void {
    seen.jobs.length = 0
    seen.fetches.length = 0
    seen.errors.length = 0
    seen.warnings.length = 0
    seen.revalidated.length = 0
  },
}

function access() {
  const person = asked.person
  if (person === null) return null
  return {
    user: {
      id: person.userId,
      name: 'Attack person',
      email: `${person.userId}@example.test`,
    },
    sessionId: person.sessionId,
    signedInAt: new Date(),
    organizations: [],
    organization: {
      id: person.tenantId,
      name: 'Attack organisation',
      slug: 'attack-organisation',
      role: person.role,
    },
  }
}

export const sessionModule = {
  LOGIN_PATH: '/login',
  getAccess: async () => access(),
  requireAccess: async () => {
    const found = access()
    if (found === null) throw new Error('NEXT_REDIRECT_LOGIN')
    return found
  },
  requireTenant: async () => {
    const found = access()
    if (found === null) throw new Error('NEXT_REDIRECT_LOGIN')
    return found
  },
}

export const cacheModule = {
  revalidatePath: (path: string) => {
    seen.revalidated.push(path)
  },
}

export const jobsModule = {
  enqueueJob: async (name: string, data: unknown) => {
    seen.jobs.push({ name, data })
    return 'job-attack'
  },
  JOB_NAMES: {},
}

export const logModule = {
  logError: (...parts: unknown[]) => {
    seen.errors.push(
      parts.map((part) => (part instanceof Error ? part.message : String(part))).join(' '),
    )
  },
  logWarn: (event: string, fields: Record<string, string | number> = {}) => {
    seen.warnings.push({ event, ...fields })
  },
  logInfo: () => undefined,
}

export const headersModule = {
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}

export const intlModule = {
  getLocale: async () => 'en',
  getTranslations: async () => (key: string) => key,
}

/** A `fetch` that records and refuses: no attack test reaches a third party or the worker. */
export const refusingFetch = async (input: unknown): Promise<Response> => {
  seen.fetches.push(String(input))
  return new Response('refused by the attack test', { status: 500 })
}
