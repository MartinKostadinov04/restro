// What a payment provider declares it can do (D98, D127 §Interfaces, design §10). A guest feature
// that depends on one appears only where it is declared, and the conformance suite checks the
// declared behaviour, otherwise the declared fallback. Undeclared means "not claimed": the
// cautious answer.

import { z } from 'zod'

import { CURRENCIES, type Currency } from '../../money'

/** The wallets a provider's card form can show (D125 3.6). */
export const PAYMENT_WALLETS = ['apple_pay', 'google_pay'] as const
export type PaymentWallet = (typeof PAYMENT_WALLETS)[number]

/** A provider's declaration. */
export interface PaymentCapabilities {
  /**
   * The shortest hold window the provider promises, in whole days: a hold not captured by then
   * may be dropped by the provider (each payment's own `captureBefore` is the exact moment).
   */
  readonly holdDays: number
  /** A capture may take less than the hold; the rest is released with it. */
  readonly partialCapture: boolean
  /** The wallets the card form shows. */
  readonly wallets: readonly PaymentWallet[]
  /** The provider sends a notice when the venue refunds in its own dashboard (false: D122 §8's daily list). */
  readonly refundNotices: boolean
  /** The smallest amount the provider takes in `currency`, in minor units (D127: the venue's floor). */
  minimumMinor(currency: Currency): number
}

const DataSchema = z.strictObject({
  holdDays: z.int().positive().max(31),
  partialCapture: z.boolean(),
  wallets: z
    .array(z.enum(PAYMENT_WALLETS))
    .refine((wallets) => new Set(wallets).size === wallets.length, 'a wallet is listed twice'),
  refundNotices: z.boolean(),
})

/**
 * Why a declaration is malformed, empty when it is fine: the data parses, and `minimumMinor`
 * answers a positive whole number of minor units for every currency the platform knows.
 */
export function paymentCapabilitiesProblems(capabilities: PaymentCapabilities): string[] {
  const { minimumMinor, ...data } = capabilities
  const problems: string[] = []
  const parsed = DataSchema.safeParse(data)
  if (!parsed.success) {
    problems.push(...parsed.error.issues.map((issue) => `capabilities: ${issue.message}`))
  }
  if (typeof minimumMinor !== 'function') {
    problems.push('capabilities: minimumMinor is not a function')
    return problems
  }
  for (const currency of CURRENCIES) {
    const minimum = capabilities.minimumMinor(currency)
    if (!Number.isSafeInteger(minimum) || minimum <= 0) {
      problems.push(`capabilities: the minimum for ${currency} is not a positive whole amount`)
    }
  }
  return problems
}
