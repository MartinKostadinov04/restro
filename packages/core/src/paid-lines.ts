// The most lines "Paid in the app" carries on the bill (#197): a sitting's captured payments'
// lines, capped where the read is made (service/read.ts) and where a phone's answer is checked
// (the shell's guest API schema), so the two cannot drift.

/** The most paid lines one table state carries. */
export const PAID_LINES_MAX = 500
