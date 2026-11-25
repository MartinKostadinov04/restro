// Large text (a root font at 200%) must wrap inside a phone, never run off its side (RR-79,
// WCAG 1.4.4 and 1.4.10). The shared Button keeps its words on one line at a fixed height; a button
// with words that can be long takes this instead: the height follows the words, the touch floor stays
// (D123), and the button never grows wider than the line it is on.
export const WRAPS = 'h-auto min-h-12 max-w-full whitespace-normal phone:h-auto phone:min-h-11'

/** `WRAPS` for buttons that also keep a minimum width: the minimum gives way to a narrow line. */
export const WRAPS_WIDE = `${WRAPS} min-w-[min(8rem,100%)]`

/** The same for a form's own buttons (default and small sizes), which keep their usual height. */
export const WRAPS_FORM =
  'h-auto min-h-9 max-w-full whitespace-normal py-1.5 phone:h-auto phone:min-h-11'
