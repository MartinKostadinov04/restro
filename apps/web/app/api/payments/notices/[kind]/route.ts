// POST /api/payments/notices/<provider kind>: a payment provider's notice (webhook). The logic is
// in ./handle.ts; this file only wires it to the app's pool, settings and clock.
import { newId } from '@restro/core'
import { recordProviderNotice } from '@restro/core/service/notices'

import { noticeConnectorFor, paymentsEnv } from '@/connectors/notices'
import { getPool } from '@/server/db'

import { handleNotice } from './handle'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
): Promise<Response> {
  const { kind } = await params
  return handleNotice(request, kind, {
    env: process.env,
    paymentsEnv: paymentsEnv(),
    connectorFor: noticeConnectorFor,
    record: (input) => recordProviderNotice(getPool(), input),
    newJobId: () => newId('jb'),
    now: () => new Date(),
  })
}
