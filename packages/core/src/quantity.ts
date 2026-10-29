// A quantity as decimal text (rule 8): what a POS sends for a line and what the service path
// keeps of it. Shared by the connector seam (`connectors/service/schemas.ts`) and the table's
// bill (`service/bill.ts`), which may not import the connector side. Pure: no I/O.

import { z } from 'zod'

/**
 * A quantity as the POS sent it, as decimal text ("2", "0.5", "-1"): never a float (rule 8). A
 * line total is never recomputed from quantity × price; the POS's own line amount is carried.
 */
export const DecimalQuantitySchema = z
  .string()
  .regex(/^-?(0|[1-9]\d{0,14})(\.\d{1,6})?$/, 'a decimal quantity as text, such as "2" or "0.5"')
