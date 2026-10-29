// The guest page's address after a provider's card form (#114; D127 "A redirect's address is
// cleaned before any request"; design §11). With cards only the bank's check opens inside the page
// and nothing redirects. If a redirect ever happens, the provider sends the guest back to the
// `return_url` and adds values of the payment to the query, among them a client secret. The page
// takes those out of the address with `history.replaceState` before it makes any request or loads
// anything else, and keeps only a marker in the tab that the guest came back.
//
// The keys are the providers' (`CardFormConnector.returnKeys`); this file names none.

/** The result of cleaning an address. */
export interface CleanedReturn {
  /** The address without the provider's values, or null when it carried none. */
  readonly href: string | null
  /** True when the address carried them: the guest came back from a redirect. */
  readonly returned: boolean
}

/** Takes `keys` out of an address's query. The fragment (the table's code) and other keys stay. */
export function cleanReturnAddress(href: string, keys: readonly string[]): CleanedReturn {
  const url = new URL(href)
  let returned = false
  for (const key of keys) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      returned = true
    }
  }
  return { href: returned ? url.toString() : null, returned }
}

/**
 * The `return_url` given to a provider: this page's address without a query or a fragment, so
 * neither the table's code nor anything else of the guest travels to it. The tab remembers the
 * table (`rememberTable`), so the page finds it again on the way back.
 */
export function cardReturnUrl(href: string): string {
  const url = new URL(href)
  return `${url.origin}${url.pathname}`
}

/**
 * Cleans the address bar. It runs first when the guest page loads, before the page asks for
 * anything, and answers whether the guest came back from a redirect.
 */
export function cleanAddressBarOf(
  keys: readonly string[],
  location: Pick<Location, 'href'>,
  history: Pick<History, 'replaceState'>,
): boolean {
  const cleaned = cleanReturnAddress(location.href, keys)
  if (cleaned.href !== null) history.replaceState(null, '', cleaned.href)
  return cleaned.returned
}
