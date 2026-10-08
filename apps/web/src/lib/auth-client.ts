import { createAuthClient } from 'better-auth/react'

/**
 * Better Auth's browser client. Sign-in and sign-out go through its HTTP API
 * (/api/auth/*) rather than a server action, so Better Auth's rate limiter and origin check
 * apply to them.
 */
export const authClient = createAuthClient()
