// GET /api/guest/share: the table's group payment (D160 §3), as any phone of the table sees it,
// with this phone's own part where it sends the part's handle in X-Restro-Payment. The logic is in
// src/server/guest-api.ts.
import { getPool } from '@/server/db'
import { guestApiDeps, handleGuestShare } from '@/server/guest-api'

export function GET(request: Request): Promise<Response> {
  return handleGuestShare(request, guestApiDeps(getPool()))
}
