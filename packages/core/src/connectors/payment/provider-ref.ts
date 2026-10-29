// The backend-only provider reference (rule 3, as `PosRef` is for a POS). Every id a payment
// provider gives (a venue's account, a payment, an event) travels inside a `ProviderRef` and is
// stored only in backend columns (`payments.provider_payment_ref`, `payment_accounts.account_ref`).
// It never reaches a snapshot, the shell, a face, a URL or a guest answer: the guest page knows
// our `py_` id and the opaque form values, nothing else.

import { z } from 'zod'

/**
 * The provider's own id as text, opaque to the platform. The pattern is the database's
 * (`PROVIDER_REF_PATTERN` in `@restro/db`'s schema), so every ref the seam accepts can be stored.
 */
export const ProviderRefSchema = z
  .strictObject({ provider: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/) })
  .brand<'ProviderRef'>()

/** A provider reference. Compare with `sameProviderRef`, never by object identity. */
export type ProviderRef = z.output<typeof ProviderRefSchema>

/** Wraps a provider's id. Only a provider package calls this, on what its provider sent. */
export function providerRef(id: string): ProviderRef {
  return ProviderRefSchema.parse({ provider: id })
}

/** True when both name the same provider object. */
export function sameProviderRef(a: ProviderRef, b: ProviderRef): boolean {
  return a.provider === b.provider
}
