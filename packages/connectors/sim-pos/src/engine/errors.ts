// What the engine throws. `UndefinedBehaviour` is the loud failure of #51 design §2.3: anything
// neither D122 §1 nor a switch defines throws it (HTTP 501 on the wire), so no test can pass on a
// friendly guess. `PosRefusal` is a definite "no" the engine does define; the wire turns it into
// an error answer with its status.

/** Thrown for any behaviour the simulator does not define. Names the open question where one fits. */
export class UndefinedBehaviour extends Error {
  override name = 'UndefinedBehaviour'
  readonly code = 'undefined_behaviour'
  constructor(
    what: string,
    /** The open POS question this would need answered ("Q37"), or null. */
    readonly question: string | null = null,
  ) {
    super(
      question === null
        ? `undefined behaviour: ${what}`
        : `undefined behaviour (${question}): ${what}`,
    )
  }
}

/** The engine's definite refusals, as the wire names them. */
export const POS_ERRORS = {
  bad_request: 400,
  credentials: 401,
  no_rights: 403,
  staff_bill: 403,
  bill_closed: 409,
  bill_locked: 409,
  needs_first_item: 409,
  article_unknown: 422,
  sold_out: 422,
  amount_mismatch: 422,
  fiscal_device: 422,
  busy: 429,
  failed: 500,
  login_offline: 503,
} as const

export type PosErrorCode = keyof typeof POS_ERRORS

/** A definite refusal; `line` is the index of the refused row where one row is refused. */
export class PosRefusal extends Error {
  override name = 'PosRefusal'
  constructor(
    readonly code: PosErrorCode,
    detail: string,
    readonly line: number | null = null,
  ) {
    super(detail)
  }

  get status(): number {
    return POS_ERRORS[this.code]
  }
}

/** Misuse of the engine by a test or scenario (not a POS answer): a plain programming error. */
export class SimSetupError extends Error {
  override name = 'SimSetupError'
}
