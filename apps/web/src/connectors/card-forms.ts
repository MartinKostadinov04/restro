// The card forms the guest page has (#114, D127: the web app loads a provider's card form only
// through `apps/web/src/connectors/<kind>/`). Every `./<kind>/card-form.ts` exports a `cardForm`; a
// glob finds them, so this shared file names no provider (the vendor-word wall) and a new provider's
// folder is all it takes. A kind with no form gets none, and the face then shows the paying screen
// without one.
//
// The glob takes each file's whole module, not its `cardForm` alone (see notices.ts: Turbopack's
// production build dropped an export picked that way as unused).
import type { CardFormConnector } from './card-form-types'
import { cardReturnUrl, cleanAddressBarOf } from './return-address'

export type { CardFormConnector, CardFormContext } from './card-form-types'
export { cardReturnUrl }

const FOUND: Readonly<Record<string, unknown>> = import.meta.glob('./*/card-form.ts', {
  eager: true,
})

function isConnector(value: unknown): value is CardFormConnector {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Record<keyof CardFormConnector, unknown>>
  return (
    typeof candidate.kind === 'string' &&
    typeof candidate.processor === 'string' &&
    Array.isArray(candidate.returnKeys) &&
    typeof candidate.mount === 'function'
  )
}

/**
 * The card forms by kind, from the glob's modules by path. Throws, naming the path, for a module
 * with no `cardForm` or one under another folder than its kind.
 */
export function cardFormsByKind(
  modules: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, CardFormConnector> {
  const byKind = new Map<string, CardFormConnector>()
  for (const [path, module] of Object.entries(modules)) {
    const form =
      typeof module === 'object' && module !== null
        ? (module as { readonly cardForm?: unknown }).cardForm
        : undefined
    if (!isConnector(form)) {
      throw new Error(`${path} exports no cardForm (a kind, processor, returnKeys and mount)`)
    }
    const folder = /^\.\/([^/]+)\/card-form\.ts$/.exec(path)?.[1]
    if (folder !== form.kind) {
      throw new Error(`the card form in ${path} names another kind (${form.kind})`)
    }
    byKind.set(form.kind, form)
  }
  return byKind
}

const BY_KIND = cardFormsByKind(FOUND)

/** The card form of a provider's kind, or null when the page has none. */
export function cardFormFor(kind: string): CardFormConnector | null {
  return BY_KIND.get(kind) ?? null
}

/** How the provider is named to the guest, or null for a kind the page does not know. */
export function processorName(kind: string | null): string | null {
  return kind === null ? null : (BY_KIND.get(kind)?.processor ?? null)
}

/** Takes every provider's values out of the address bar; true when the guest came back from one. */
export function cleanAddressBar(
  location: Pick<Location, 'href'>,
  history: Pick<History, 'replaceState'>,
): boolean {
  const keys = [...BY_KIND.values()].flatMap((form) => form.returnKeys)
  return cleanAddressBarOf(keys, location, history)
}
