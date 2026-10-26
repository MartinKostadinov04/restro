// GET /api/guest/state: the table's shared state for a phone (D121, #75). The logic is in
// src/server/guest-api.ts.
import { getPool } from '@/server/db'
import { handleGuestState, queueTableReading } from '@/server/guest-api'

export function GET(request: Request): Promise<Response> {
  return handleGuestState(request, { pool: getPool(), queueReading: queueTableReading })
}
