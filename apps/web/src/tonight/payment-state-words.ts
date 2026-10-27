// Part 2's slot in the Log (#115; Log plan §8): the words of a payment's state ("held", "captured",
// "released", …), by the state code the Log keeps. Part 2 sends its own words with #115 and fills
// this table; until then a payment step is worded without a state (`lg_pay_plain`), never with a
// raw code.
export const PAYMENT_STATE_WORDS: Readonly<Record<string, string>> = {}
