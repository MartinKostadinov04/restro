// GET /t/<code>: the address on a table's QR sticker (brief S3-03, D61). It reads the file named
// after the code's hash from the publish store, never the database, and redirects to
// /m/<venue>#t=<code> or shows the "this table code is not active" page; wrong codes count against
// the network they came from (#70). Public by design: the sign-in gate (proxy.ts) leaves /t/
// alone. The logic is in src/server/publish/table-token.ts.
import { badCodes, clientNetwork } from '@/server/guard/bad-codes'
import { getTokenSource, tableTokenResponse } from '@/server/publish/table-token'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params
  return tableTokenResponse(token, await getTokenSource(), {
    limiter: badCodes,
    network: clientNetwork(request.headers),
  })
}
