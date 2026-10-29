// The payment providers the Paying settings know by name (#116): every `./<kind>/provider.ts`
// exporting a `providerInfo`, found by a glob so that this shared file names no provider (the
// vendor-word wall). Same shape as `./notices.ts`, which explains the glob's whole-module form.
import type { ProviderInfo } from './provider-types'

const FOUND: Readonly<Record<string, unknown>> = import.meta.glob('./*/provider.ts', {
  eager: true,
})

function isInfo(value: unknown): value is ProviderInfo {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Record<keyof ProviderInfo, unknown>>
  return (
    typeof candidate.kind === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.simulated === 'boolean' &&
    typeof candidate.minimumMinor === 'function'
  )
}

/** The providers by kind, from the glob's modules by path. Throws, naming the path, for a bad one. */
export function providersByKind(
  modules: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, ProviderInfo> {
  const byKind = new Map<string, ProviderInfo>()
  for (const [path, module] of Object.entries(modules)) {
    const info =
      typeof module === 'object' && module !== null
        ? (module as { readonly providerInfo?: unknown }).providerInfo
        : undefined
    if (!isInfo(info)) throw new Error(`${path} exports no providerInfo`)
    const folder = /^\.\/([^/]+)\/provider\.ts$/.exec(path)?.[1]
    if (folder !== info.kind) throw new Error(`the provider in ${path} names another kind`)
    byKind.set(info.kind, info)
  }
  return byKind
}

const BY_KIND = providersByKind(FOUND)

/**
 * The provider a venue pays through: the one its account names; for a venue that never connected,
 * the one this deployment is set to (`PAYMENTS_PROVIDER`), else the only real (not simulated) one.
 * Null when there is none to name.
 */
export function providerOf(
  kind: string | null,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProviderInfo | null {
  if (kind !== null) return BY_KIND.get(kind) ?? null
  const chosen = env.PAYMENTS_PROVIDER?.trim()
  if (chosen !== undefined && chosen !== '') return BY_KIND.get(chosen) ?? null
  const real = [...BY_KIND.values()].filter((info) => !info.simulated)
  return real.length === 1 ? (real[0] ?? null) : null
}
