// GET /api/booking/night: whether a night can be booked on the booking page (#577), and nothing
// else. The logic is in src/server/booking-api.ts.
import { bookingApiDeps, handleBookingNight } from '@/server/booking-api'
import { getPool } from '@/server/db'

export function GET(request: Request): Promise<Response> {
  return handleBookingNight(request, bookingApiDeps(getPool()))
}
