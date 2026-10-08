// The read allowlist (CLAUDE.md rule 7: sync never writes into barsy). The client and the fixture
// recorder both refuse any method that is not listed here, so adding a method to this list is the
// single, reviewable act that lets it be sent. Each entry carries the official doc URL it was
// checked against ("barsy calls" in CLAUDE.md).
//
// Later entries: the read methods of Collection path C in docs/architecture/data-architecture.md
// (Barsys_getlist, Languages_getlist, Currencies_getlist, Categories_getalltree, Articles_getlist,
// ...). None of them is added until it has its own task, doc check and typed wrapper.

export const BARSY_READ_METHODS = {
  // https://docs.lukanet.com/barsy.api/methods/misc/ping.html
  // Anonymous heartbeat: "no authorisation needed", so no Authorization header is sent.
  Misc_ping: { auth: 'none' },
  // https://docs.lukanet.com/barsy.api/methods/misc/ping_user.html
  // Checks that the API is reachable and the user's credentials are valid.
  Misc_ping_user: { auth: 'basic' },
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
