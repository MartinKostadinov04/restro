// GET /api/guest/payment: the paying phone's own payment, by the handle in X-Restro-Payment (#110,
// D127). The logic is in src/server/guest-api.ts.
import { getPool } from '@/server/db'
import { guestApiDeps, handleGuestPayment } from '@/server/guest-api'

export function GET(request: Request): Promise<Response> {
  return handleGuestPayment(request, guestApiDeps(getPool()))
}
