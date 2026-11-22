import { organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/**
 * Better Auth's browser client. Sign-in and sign-out go through its HTTP API
 * (/api/auth/*) rather than a server action, so Better Auth's rate limiter and origin check
 * apply to them. The organisation plugin is here for one call: putting a fresh sign-in back in
 * the organisation the person was working in (Better Auth checks the membership).
 */
export const authClient = createAuthClient({ plugins: [organizationClient()] })
