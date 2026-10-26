// The payment providers whose notices the web app takes (#108): every `./<kind>/notices.ts`
// exporting a `noticeConnector`, found by a glob so that this shared file names no provider (the
// vendor-word wall) and a new provider's folder is all it takes. Its folder must be its kind.
//
// The glob takes each file's whole module, not its `noticeConnector` alone (`import:`): Turbopack's
// production build dropped the export picked that way as unused, and the registry then read
// `undefined` (PR #125's CI). A whole module escapes, so all its exports are kept.
import { type NoticeConnector, PAYMENTS_ENVS, type PaymentsEnv } from './notice-types'

const FOUND: Readonly<Record<string, unknown>> = import.meta.glob('./*/notices.ts', {
  eager: true,
})

function isConnector(value: unknown): value is NoticeConnector {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Record<keyof NoticeConnector, unknown>>
  return (
    typeof candidate.kind === 'string' &&
    typeof candidate.offered === 'function' &&
    typeof candidate.secret === 'function' &&
    typeof candidate.verify === 'function'
  )
}

/**
 * The notice connectors by kind, from the glob's modules by path. Throws, naming the path, for a
 * module with no `noticeConnector` or one under another folder than its kind.
 */
export function connectorsByKind(
  modules: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, NoticeConnector> {
  const byKind = new Map<string, NoticeConnector>()
  for (const [path, module] of Object.entries(modules)) {
    const connector =
      typeof module === 'object' && module !== null
        ? (module as { readonly noticeConnector?: unknown }).noticeConnector
        : undefined
    if (!isConnector(connector)) {
      throw new Error(`${path} exports no noticeConnector (a kind, offered, secret and verify)`)
    }
    const folder = /^\.\/([^/]+)\/notices\.ts$/.exec(path)?.[1]
    if (folder !== connector.kind) {
      throw new Error(`the notice connector in ${path} names another kind (${connector.kind})`)
    }
    byKind.set(connector.kind, connector)
  }
  return byKind
}

const BY_KIND = connectorsByKind(FOUND)

/** The kinds that have a notice connector, sorted. */
export function noticeKinds(): readonly string[] {
  return [...BY_KIND.keys()].sort()
}

/** The notice connector of a kind, or null for a kind with none or not offered here. */
export function noticeConnectorFor(kind: string, env: PaymentsEnv): NoticeConnector | null {
  const connector = BY_KIND.get(kind)
  return connector !== undefined && connector.offered(env) ? connector : null
}

/** The deployment's environment (`PAYMENTS_ENV`), or null when unset or unknown. */
export function paymentsEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PaymentsEnv | null {
  const value = (env.PAYMENTS_ENV ?? '').trim().toLowerCase()
  return (PAYMENTS_ENVS as readonly string[]).includes(value) ? (value as PaymentsEnv) : null
}
