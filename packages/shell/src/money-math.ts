// Money arithmetic for the one place outside the shell that needs it: a face's preview adapter,
// which invents demo bills and quotes (`@restro/shell/money`). A face draws amounts the host
// gives it; it never adds them up (D72). The dependency rules keep it that way: nothing under
// packages/faces/ may import this file except a `preview/` folder and tests.
//
// Everything here is core's money module (rule 8): integer minor units, exact, half-up.

export {
  addMinor,
  multiplyMinor,
  percentOfMinor,
  ratioOfMinor,
  subtractMinor,
} from '@restro/core'
export { viewMinor } from './money'
