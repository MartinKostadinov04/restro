// Better Auth: email + password sign-in, and the `organization` plugin where an organisation IS a
// tenant. Created lazily (`getAuth()`), because the settings it needs are absent while
// `next build` loads the route modules.
//
// What is deliberately switched off or narrowed:
// - Sign-up (the admin is invite-only; the first owner comes from `pnpm db:seed:dev` or, later,
//   an operator) and every endpoint that would create, rename, delete or invite over HTTP.
// - Organisation creation by users: `allowUserToCreateOrganization: false` refuses it for anyone
//   signed in; server code can still create one by passing a `userId` (that is how the seed does).
// - Deleting rows: the app role has no DELETE on users, organisations or members (see
//   packages/db/src/table-access.ts).
import { provisionTenant } from '@restro/core/apply'
import { authMember } from '@restro/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { organization } from 'better-auth/plugins'
import { asc, eq } from 'drizzle-orm'

import { AUTH_COOKIE_PREFIX } from './cookie-prefix'
import { authSchema, getAuthDb, getPool } from './db'
import { serverEnv } from './env'
import { authModelId } from './ids'
import { logError } from './log'

/** Paths of Better Auth's HTTP API that the admin does not offer (server code is unaffected). */
const DISABLED_HTTP_PATHS = [
  '/sign-up/email',
  '/sign-in/social',
  '/link-social',
  '/unlink-account',
  '/delete-user',
  '/delete-user/callback',
  '/change-email',
  '/organization/create',
  '/organization/update',
  '/organization/delete',
  '/organization/check-slug',
  '/organization/invite-member',
  '/organization/cancel-invitation',
  '/organization/accept-invitation',
  '/organization/reject-invitation',
  '/organization/remove-member',
  '/organization/update-member-role',
  '/organization/leave',
]

/** `scripts: true` leaves out the Next.js cookie plugin, which only works inside a request. */
export function createAuth({ scripts = false }: { scripts?: boolean } = {}) {
  const env = serverEnv()
  const db = getAuthDb()

  return betterAuth({
    appName: 'Restro',
    secret: env.BETTER_AUTH_SECRET,
    ...(env.BETTER_AUTH_URL ? { baseURL: env.BETTER_AUTH_URL } : {}),
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8 },
    rateLimit: { enabled: true },
    disabledPaths: DISABLED_HTTP_PATHS,
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      database: { generateId: ({ model }) => authModelId(model) },
    },
    databaseHooks: {
      session: {
        create: {
          // A new session starts in the person's first organisation (the one they joined first).
          before: async (session) => {
            const [first] = await db
              .select({ organizationId: authMember.organizationId })
              .from(authMember)
              .where(eq(authMember.userId, session.userId))
              .orderBy(asc(authMember.createdAt))
              .limit(1)
            return { data: { ...session, activeOrganizationId: first?.organizationId ?? null } }
          },
        },
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        organizationHooks: {
          // The organisation id is the tenant id: create the matching `restro.tenants` row
          // through core (inside a write transaction scoped to that tenant).
          afterCreateOrganization: async ({ organization }) => {
            try {
              await provisionTenant(getPool(), {
                tenantId: organization.id,
                name: organization.name,
              })
            } catch (error) {
              logError('tenant_provision_failed', error)
              throw error
            }
          },
        },
      }),
      // Must be last: lets server actions that call `auth.api` set cookies.
      ...(scripts ? [] : [nextCookies()]),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

const globals = globalThis as typeof globalThis & { __restroAuth?: Auth }

/** The Better Auth instance (one per process, kept across Next.js hot reloads). */
export function getAuth(): Auth {
  globals.__restroAuth ??= createAuth()
  return globals.__restroAuth
}
