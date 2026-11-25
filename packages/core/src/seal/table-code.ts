// A table's code as a sealed envelope (`tables.qr_code_sealed`; D122 §9, ticket #70). The code is
// looked up by its hash and never stored in plain; the sealed copy lets the venue print its
// stickers again. core/apply seals a new code with the worker's public key; only the worker opens
// one (`openTableCode`), for the reveal endpoint.

import type { KeyObject } from 'node:crypto'

import { TABLE_TOKEN_PATTERN } from '../guest-files'
import { SealError } from './errors'
import { sealSecret } from './seal'

/** Seals a table's code for the worker, bound to its tenant and table. */
export function sealTableCode(
  publicKey: KeyObject | string,
  code: string,
  context: { readonly tenantId: string; readonly tableId: string },
): string {
  if (!TABLE_TOKEN_PATTERN.test(code)) {
    throw new SealError('invalid_payload', 'not a table code')
  }
  return sealSecret(publicKey, code, { purpose: 'table_code', ...context })
}
