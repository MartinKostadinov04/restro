// POST /api/guest/events: what the guest's phone itself did (D142, #335). The logic is in
// src/server/guest-api.ts.
import { getPool } from '@/server/db'
import { guestApiDeps, handleGuestEvents } from '@/server/guest-api'

export function POST(request: Request): Promise<Response> {
  return handleGuestEvents(request, guestApiDeps(getPool()))
}
