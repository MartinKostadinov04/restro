// What a linked group's bill on a phone carries at most (#319): capped where the core makes the
// bill (`groupBillOf`, service/guest.ts) and where a phone's answer is checked (the shell's guest
// API schema), so the two cannot drift and a big party never makes a phone reject its state.

/** The most member tables a group's bill carries: the first ones by name; the rest make it not final. */
export const GROUP_TABLES_MAX = 50

/** The longest table name a group's bill carries; a longer one is cut. */
export const GROUP_LABEL_MAX = 64
