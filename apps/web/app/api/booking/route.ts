// POST /api/booking: a guest's request for a night on the booking page (#577). The logic is in
// src/server/booking-api.ts.
import { bookingApiDeps, handleBookingRequest } from '@/server/booking-api'
import { getPool } from '@/server/db'

export function POST(request: Request): Promise<Response> {
  return handleBookingRequest(request, bookingApiDeps(getPool()))
}
