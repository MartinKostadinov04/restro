// The payment providers whose notices the web app takes (#108): every `./<kind>/notices.ts`
// exporting a `noticeConnector`, found by a glob so that this shared file names no provider (the
// vendor-word wall) and a new provider's folder is all it takes. Its folder must be its kind.
import { type NoticeConnector, PAYMENTS_ENVS, type PaymentsEnv } from './notice-types'

const FOUND = import.meta.glob<NoticeConnector>('./*/notices.ts', {
  eager: true,
  import: 'noticeConnector',
})

const BY_KIND: ReadonlyMap<string, NoticeConnector> = new Map(
  Object.entries(FOUND).map(([path, connector]) => {
    const folder = /^\.\/([^/]+)\/notices\.ts$/.exec(path)?.[1]
    if (folder !== connector.kind) {
      throw new Error(`the notice connector in ${path} names another kind (${connector.kind})`)
    }
    return [connector.kind, connector]
  }),
)

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
