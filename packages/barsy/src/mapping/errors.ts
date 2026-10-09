// Errors of the mapping. Only configuration and structure problems throw; anything about one
// barsy object (a missing name, an unreadable price) is a warning on the result, never an error,
// so one bad article cannot stop a pull.

import { BarsyError } from '../errors.ts'

export type BarsyMappingErrorCode = 'invalid_input' | 'catalogue_root_not_found'

export class BarsyMappingError extends BarsyError {
  override readonly name: string = 'BarsyMappingError'
  readonly code: BarsyMappingErrorCode

  constructor(code: BarsyMappingErrorCode, message: string) {
    super(message)
    this.code = code
  }
}
