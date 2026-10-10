// GET /t/<token>: the address on a table's QR sticker (brief S3-03, D61). It reads the token's file
// from the publish store, never the database, and redirects to /m/<venue>?t=<token> or shows
// the "this table code is not active" page. Public by design: the sign-in gate (proxy.ts) leaves
// /t/ alone. The logic is in src/server/publish/table-token.ts.
import { getTokenSource, tableTokenResponse } from '@/server/publish/table-token'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params
  return tableTokenResponse(token, await getTokenSource())
}
