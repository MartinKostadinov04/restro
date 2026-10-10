// The read allowlist (CLAUDE.md rule 7: sync never writes into barsy). The client and the fixture
// recorder both refuse any method that is not listed here, so adding a method to this list is the
// single, reviewable act that lets it be sent. Each entry carries the official doc URL it was
// checked against ("barsy calls" in CLAUDE.md).
//
// The Stage 2 read methods (Collection path C) were checked against their doc pages by the lead
// on 2026-10-09 and recorded from the demo installation (fixtures/demo/). Typed wrappers and
// response schemas arrive with brief S2-02.

export const BARSY_READ_METHODS = {
  // https://docs.lukanet.com/barsy.api/methods/misc/ping.html
  // Anonymous heartbeat: "no authorisation needed", so no Authorization header is sent.
  Misc_ping: { auth: 'none' },
  // https://docs.lukanet.com/barsy.api/methods/misc/ping_user.html
  // Checks that the API is reachable and the user's credentials are valid.
  Misc_ping_user: { auth: 'basic' },
  // https://docs.lukanet.com/barsy.api/methods/barsys/getlist.html
  // Venues of the installation; `mode` 'restrict' (default) = only those the user may access.
  Barsys_getlist: { auth: 'basic' },
  // https://docs.lukanet.com/barsy.api/methods/languages/getlist.html
  // [{lang_id, lang_name}]; the demo returns `sr_RS@latin` (normalise to sr_RS).
  Languages_getlist: { auth: 'basic' },
  // https://docs.lukanet.com/barsy.api/methods/currencies/getlist.html
  Currencies_getlist: { auth: 'basic' },
  // https://docs.lukanet.com/barsy.api/methods/categories/getalltree.html
  // Always `only_public: 1`: with 0 the demo demands a registered till (a write we never do, D56).
  Categories_getalltree: { auth: 'basic' },
  // https://docs.lukanet.com/barsy.api/methods/articles/getlist.html
  // `filters` is required (send {} at least); page with `order_by: {article_id: 'asc'}`;
  // `limits_by_barsys` for per-venue for-sale exceptions; `delete_flag` filter defaults to 0.
  Articles_getlist: { auth: 'basic' },
  // https://docs.lukanet.com/barsy.api/methods/articlesupplements/get.html
  // Option groups of one combo article (required, min/max, options with current price).
  Articlesupplements_get: { auth: 'basic' },
  // https://docs.lukanet.com/barsy.api/methods/modificators/getlist.html
  // Default `length` 50 (page it); `delete_flag` filter defaults to 0.
  Modificators_getlist: { auth: 'basic' },
  // https://docs.lukanet.com/barsy.api/methods/articledetails/gettree.html
  // Characteristic keys (e.g. "Алергени"), used to map allergens.
  Articledetails_gettree: { auth: 'basic' },
  // https://docs.lukanet.com/barsy.api/methods/places/getlist.html
  // Tables/places; `place_num` documented as int but the demo returns text — store as text.
  Places_getlist: { auth: 'basic' },
} as const satisfies Record<string, { auth: 'none' | 'basic' }>

export type BarsyReadMethod = keyof typeof BARSY_READ_METHODS

/** Names of the read-allowlisted methods, in declaration order. */
export const BARSY_READ_METHOD_NAMES = Object.keys(BARSY_READ_METHODS) as BarsyReadMethod[]

/** Own-property check, so "constructor" and "__proto__" are never mistaken for methods. */
export function isBarsyReadMethod(name: string): name is BarsyReadMethod {
  return Object.hasOwn(BARSY_READ_METHODS, name)
}

/** Whether the method needs the user's credentials (HTTP Basic). */
export function barsyMethodAuth(method: BarsyReadMethod): 'none' | 'basic' {
  return BARSY_READ_METHODS[method].auth
}
