// Test helpers for the simulated POS: `import { ... } from '@restro/sim-pos/testing'`. Tests
// only: it pulls in msw, so nothing in production imports it.

export {
  READ_TABLE,
  READ_TABLE_CHARGE,
  type SimHarnessOptions,
  STEP_MS,
  simPosHarness,
} from './test-harness'
export { createSimPosMockServer, inProcessTransport, simPosHandlers } from './transports'
