// Liveness only. The deep health checks (outbox age, snapshot age, ...) belong to the worker.
export function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
}
