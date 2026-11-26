// GET and POST /api/booking/link/<token>: a guest's own link to his booking, read and cancelled
// (#579). The logic is in src/server/booking-link-api.ts.
import {
  bookingLinkApiDeps,
  handleGuestLinkCancel,
  handleGuestLinkRead,
} from '@/server/booking-link-api'
import { getPool } from '@/server/db'

type Context = { params: Promise<{ token: string }> }

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { token } = await params
  return handleGuestLinkRead(request, token, bookingLinkApiDeps(getPool()))
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { token } = await params
  return handleGuestLinkCancel(request, token, bookingLinkApiDeps(getPool()))
}
