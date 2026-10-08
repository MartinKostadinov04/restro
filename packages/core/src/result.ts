// Verdicts returned by validators. Validators never throw for bad data: a rejected write is
// kept with its reason (doc "One write path", step 1), so the reason is part of the result.

/** Machine-readable reason a check failed; the V-codes are the doc's validation checks. */
export type RejectionCode =
  | 'V1'
  | 'V2'
  | 'unknown_node_type'
  | 'unknown_field'
  | 'layer_not_allowed'
  | 'less_cautious'
  | 'invalid_template'
  | 'invalid_change_set'

/** A check that passed. */
export interface Ok {
  readonly ok: true
}

/** A check that failed: a code for programs and a reason for people (Data issues panel). */
export interface Rejected {
  readonly ok: false
  readonly code: RejectionCode
  readonly reason: string
}

/** The outcome of a check: `Ok` or `Rejected(reason)`. */
export type Verdict = Ok | Rejected

/** The outcome of parsing: the parsed value, or `Rejected(reason)`. */
export type Parsed<T> = { readonly ok: true; readonly value: T } | Rejected

/** The single shared `Ok` verdict. */
export const OK: Ok = Object.freeze({ ok: true })

/** Builds a `Rejected` verdict. */
export function reject(code: RejectionCode, reason: string): Rejected {
  return { ok: false, code, reason }
}
