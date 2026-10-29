// The data access layer for "who is this, and which tenant are they working in". Every admin page
// and server action calls `requireAccess()` itself: layouts do not re-run on client navigation,
// so a layout check is not a guard (Next.js "Authentication" guide), and the proxy only checks
// that a session cookie exists. The tenant is never taken from the URL or the request body: it is
// an organisation the signed-in person is a member of, read from the database.
import { authMember, authOrganization } from '@restro/db'
import { asc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

import { getAuth } from './auth'
import { assertAuthRoleIsSafe, getAuthDb } from './db'

/** An organisation the person belongs to. `id` is the tenant id (`tn_…`). */
export interface Organization {
  readonly id: string
  readonly name: string
  readonly slug: string
  /** The person's role in it: `owner`, `admin` or `member` (Better Auth may join several with commas). */
  readonly role: string
}

/** A signed-in person and the organisation they are working in. */
export interface Access {
  readonly user: { readonly id: string; readonly name: string; readonly email: string }
  /**
   * The session's id (not its token): what the service write path names as the actor's sign-in
   * (`ServiceContext.actor.sessionId`), e.g. for a table code's reveal (#70).
   */
  readonly sessionId: string
  /**
   * When this session began, i.e. when the person last entered their password (#72): a settings
   * change asks for it again after 15 minutes (`FRESH_SIGN_IN_MINUTES`, D122 §7).
   */
  readonly signedInAt: Date
  readonly organizations: readonly Organization[]
  /** The organisation (tenant) every data query is scoped to; null if they belong to none. */
  readonly organization: Organization | null
}

async function organizationsOf(userId: string): Promise<Organization[]> {
  return getAuthDb()
    .select({
      id: authOrganization.id,
      name: authOrganization.name,
      slug: authOrganization.slug,
      role: authMember.role,
    })
    .from(authMember)
    .innerJoin(authOrganization, eq(authOrganization.id, authMember.organizationId))
    .where(eq(authMember.userId, userId))
    .orderBy(asc(authMember.createdAt))
}

/**
 * The signed-in person, or null. The active organisation is the one the session names if the
 * person is still a member of it, else the first one they joined.
 */
export const getAccess = cache(async (): Promise<Access | null> => {
  await assertAuthRoleIsSafe()
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) return null
  const organizations = await organizationsOf(session.user.id)
  const activeId = session.session.activeOrganizationId
  const organization = organizations.find((org) => org.id === activeId) ?? organizations[0] ?? null
  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    sessionId: session.session.id,
    signedInAt: new Date(session.session.createdAt),
    organizations,
    organization,
  }
})

/** Where to send someone who is not signed in. */
export const LOGIN_PATH = '/login'

/** The signed-in person, or a redirect to the sign-in page. */
export async function requireAccess(): Promise<Access> {
  const access = await getAccess()
  if (!access) redirect(LOGIN_PATH)
  return access
}

/** Like `requireAccess`, for pages that need a tenant: returns the organisation too. */
export async function requireTenant(): Promise<Access & { organization: Organization }> {
  const access = await requireAccess()
  if (!access.organization) redirect('/no-organization')
  return { ...access, organization: access.organization }
}
