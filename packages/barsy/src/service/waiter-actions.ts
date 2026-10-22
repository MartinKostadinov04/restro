// barsy's waiter-action declaration (D110): each export of `../write/index.ts` and the waiter
// actions it performs. The write module is empty, so this is empty; the ticket that adds barsy's
// first write adds its line here in the same change, and the conformance kit's guard fails on any
// export without one.

import type { WaiterActionDeclaration } from '@restro/core'

export const BARSY_WAITER_ACTIONS: WaiterActionDeclaration = {}
