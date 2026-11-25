// The simulated payment provider (#103; D127 §Interfaces): an in-memory engine with cautious
// switches and scripted faults, and the `PaymentProvider` of `@restro/core` over it. It claims
// nothing about any real provider. Only apps/worker and tests import it (dependency-cruiser,
// `payments-only-from-worker`); it refuses to start in production.

export { type Clock, ManualClock } from './clock'
export {
  CAUTIOUS_SWITCHES,
  SimPayEngine,
  type SimPayFault,
  type SimPayStep,
  type SimPaySwitches,
} from './engine'
export { checkSimPayEnv, SIM_PAY_ENVS, type SimPayEnv, SimPayNotAllowedError } from './env'
export {
  SIM_PAY_SIGNATURE_HEADER,
  type SimPayEvent,
  type SimPayWireNotice,
  signSimPayNotice,
  simPayNotice,
  simPayNoticeKind,
} from './notices'
export { createSimPayProvider, SIM_PAY_KIND, type SimPayProviderOptions } from './provider'
