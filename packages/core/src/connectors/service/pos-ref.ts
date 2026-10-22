// The backend-only POS reference (rule 3). Every POS id a connector reads (a table, a bar, a POS
// bill, a line, an item) travels inside a `PosRef` and nowhere else, so the conformance kit can
// prove no POS id leaks into a name or another field. A `PosRef` never reaches a snapshot, the
// shell, a face, a URL or a guest answer: the platform maps it to our own prefixed ids
// (`tb_`, `nd_`, …) through its source links before anything leaves the backend.

import { z } from 'zod'

/** Zod schema of a POS reference: the POS's own id as text, opaque to the platform. */
export const PosRefSchema = z.strictObject({ pos: z.string().min(1).max(200) }).brand<'PosRef'>()

/** A POS reference. Compare with `samePosRef`, never by object identity. */
export type PosRef = z.output<typeof PosRefSchema>

/** Wraps a POS id. Only a connector calls this, on what its POS sent. */
export function posRef(id: string | number): PosRef {
  return PosRefSchema.parse({ pos: String(id) })
}

/** True when both name the same POS object. */
export function samePosRef(a: PosRef, b: PosRef): boolean {
  return a.pos === b.pos
}
