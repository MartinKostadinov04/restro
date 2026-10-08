// Better Auth's HTTP API (sign-in, sign-out, session). The endpoints the admin does not offer are
// switched off in src/server/auth.ts; Better Auth's rate limiter guards sign-in here.
import { getAuth } from '@/server/auth'
import { assertAuthRoleIsSafe } from '@/server/db'

async function handle(request: Request): Promise<Response> {
  await assertAuthRoleIsSafe()
  return getAuth().handler(request)
}

export { handle as GET, handle as POST }
