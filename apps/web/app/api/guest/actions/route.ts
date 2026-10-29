// POST /api/guest/actions: one guest command on the table (D121, #75). The logic is in
// src/server/guest-api.ts.
import { getPool } from '@/server/db'
import { guestApiDeps, handleGuestAction } from '@/server/guest-api'

export function POST(request: Request): Promise<Response> {
  return handleGuestAction(request, guestApiDeps(getPool()))
}
