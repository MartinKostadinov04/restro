// The payment providers whose hosted form is a page of this app (#398): every
// `./<kind>/onboarding.ts` exporting an `onboarding`, found by a glob so that this shared file
// names no provider (the vendor-word wall). Same shape as `./notices.ts`, which explains the glob's
// whole-module form. Today only the simulated provider has one; Stripe's form is Stripe's own site.
import type { PaymentsEnv } from './notice-types'
import type { OnboardingConnector, OnboardingContext } from './onboarding-types'

export type { OnboardingConnector, OnboardingContext } from './onboarding-types'

const FOUND: Readonly<Record<string, unknown>> = import.meta.glob('./*/onboarding.ts', {
  eager: true,
})

function isConnector(value: unknown): value is OnboardingConnector {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Record<keyof OnboardingConnector, unknown>>
  return (
    typeof candidate.kind === 'string' &&
    typeof candidate.offered === 'function' &&
    typeof candidate.address === 'function'
  )
}

/**
 * The onboarding connectors by kind, from the glob's modules by path. Throws, naming the path, for
 * a module with no `onboarding` or one under another folder than its kind.
 */
export function onboardingByKind(
  modules: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, OnboardingConnector> {
  const byKind = new Map<string, OnboardingConnector>()
  for (const [path, module] of Object.entries(modules)) {
    const connector =
      typeof module === 'object' && module !== null
        ? (module as { readonly onboarding?: unknown }).onboarding
        : undefined
    if (!isConnector(connector)) {
      throw new Error(`${path} exports no onboarding (a kind, offered and address)`)
    }
    const folder = /^\.\/([^/]+)\/onboarding\.ts$/.exec(path)?.[1]
    if (folder !== connector.kind) {
      throw new Error(`the onboarding connector in ${path} names another kind (${connector.kind})`)
    }
    byKind.set(connector.kind, connector)
  }
  return byKind
}

const BY_KIND = onboardingByKind(FOUND)

/**
 * Where the owner's browser goes for the provider's hosted address `url`: the app's own stand-in
 * page when a provider here stands for it and this deployment offers it, else `url` itself. A
 * null `env` (no known `PAYMENTS_ENV`) offers nothing.
 */
export function onboardingAddress(
  url: string,
  context: OnboardingContext,
  env: PaymentsEnv | null,
  connectors: ReadonlyMap<string, OnboardingConnector> = BY_KIND,
): string {
  if (env === null) return url
  for (const connector of connectors.values()) {
    if (!connector.offered(env)) continue
    const address = connector.address(url, context)
    if (address !== null) return address
  }
  return url
}
