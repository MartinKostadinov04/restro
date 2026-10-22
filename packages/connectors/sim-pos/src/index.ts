// The simulated POS (#68; #51 design §2): a pure engine with switches and fault plans, its
// POS-shaped wire, and the service connector over that wire. POS-neutral: it claims nothing
// about any real POS. Only apps/worker and tests import it (dependency-cruiser).

export {
  fetchTransport,
  type SimTransport,
  type TransportRequest,
  type TransportResponse,
} from './client'
export type { SimPosConnectorOptions } from './connector'
export { createSimPosConnector, SIM_KIND, SimPosConnectorError } from './connector'
export { parseFlags } from './control/flags'
export { runWaiterOp, WAITER_OP_NAMES, WAITER_OPS, WaiterOpError } from './control/ops'
export {
  createSimServer,
  DEFAULT_PORT,
  SimHost,
  type SimServer,
  type SimServerOptions,
  TOKEN_HEADER,
} from './control/server'
export type { PaymentIn, RowIn, SimCall, SimMethod } from './engine/calls'
export { READ_METHODS } from './engine/calls'
export { type Clock, ManualClock } from './engine/clock'
export {
  billTotal,
  type Credentials,
  type SimAnswer,
  type SimCallRecord,
  SimEngine,
  type SimEngineOptions,
  type SimPlan,
  SimWaiter,
} from './engine/engine'
export { PosRefusal, SimSetupError, UndefinedBehaviour } from './engine/errors'
export { type ChaosOptions, FaultPlan, type FaultRule, type SimFault } from './engine/faults'
export { idShape } from './engine/ids'
export { DEFAULT_SCENARIO, SIM_PASSWORD, type SimScenario } from './engine/scenario'
export type { SimState } from './engine/state'
export { checkSimHost, SIM_ENVS, type SimEnv, SimHostNotAllowedError } from './hosts'
export {
  buildEngine,
  DEFAULT_SCENARIO_NAME,
  listScenarioNames,
  loadScenarioFile,
  type ResolvedScenario,
  readingLogin,
  type ScenarioFile,
  ScenarioFileError,
  type ScenarioMenu,
  ScenarioMenuSchema,
} from './scenario-file'
export {
  CAUTIOUS,
  capabilitiesOf,
  PROFILE_NAMES,
  PROFILES,
  type ProfileName,
  type SimSwitches,
  switchesOf,
} from './switches'
export { SIM_WAITER_ACTIONS } from './waiter-actions'
export { serveWire, type WireRequest, type WireResponse } from './wire/serve'
