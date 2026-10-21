// The barsy address a manager types, reduced to the bare host name the integration stores
// (`demo.barsyonline.com`). The web checks the FORMAT only (brief S2-05): an https address with
// nothing but a host name in it. Which hosts are allowed is the worker's call (its allowlist and
// the rule that staging never reaches a production host, CLAUDE.md rule 9).
//
// Pure: no I/O, so the form, the server action and the tests share it.

/** A host name with at least one dot; labels of letters, digits and hyphens (IDNs arrive as punycode). */
const HOST_NAME =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

/** Why an address was refused (the form shows one message for all of them). */
export type HostProblem = 'empty' | 'not_https' | 'not_a_bare_host' | 'not_a_host_name'

export type ParsedHost =
  | { readonly ok: true; readonly host: string }
  | { readonly ok: false; readonly problem: HostProblem }

/**
 * Accepts `https://club.barsyonline.com`, `https://club.barsyonline.com/` and a bare
 * `club.barsyonline.com`. Refuses other schemes, user info, a port, a path, a query, a fragment,
 * whitespace and anything that is not a host name. Returns the host in lower case.
 */
export function parseBarsyHost(input: string): ParsedHost {
  const text = typeof input === 'string' ? input.trim() : ''
  if (text === '') return { ok: false, problem: 'empty' }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\s\\\u0000-\u001f\u007f]/.test(text)) return { ok: false, problem: 'not_a_bare_host' }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text)
  if (scheme && scheme[1]?.toLowerCase() !== 'https') return { ok: false, problem: 'not_https' }
  let url: URL
  try {
    url = new URL(scheme ? text : `https://${text}`)
  } catch {
    return { ok: false, problem: 'not_a_host_name' }
  }
  if (
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname !== '/' ||
    text.endsWith('?') ||
    text.endsWith('#')
  ) {
    return { ok: false, problem: 'not_a_bare_host' }
  }
  const host = url.hostname.toLowerCase()
  if (host.length > 253 || !HOST_NAME.test(host)) return { ok: false, problem: 'not_a_host_name' }
  return { ok: true, host }
}
