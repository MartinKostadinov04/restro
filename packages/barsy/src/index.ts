// @restro/barsy: the typed, read-only barsy client (CLAUDE.md rule 7: sync never writes into barsy).
// Only apps/worker imports this package. Test helpers live in `@restro/barsy/testing`; the fixture
// recorder behind `pnpm barsy:record` is a script. Neither is exported from here.

export type {
  BarsyBid,
  BarsyCallMap,
  BarsyCallOptions,
  BarsyCallSpec,
  BarsyClient,
  BarsyClientOptions,
  BarsyManyData,
  BarsyParams,
  BarsyRawResponse,
  BarsyResult,
  JsonValue,
} from './client.ts'
export { createBarsyClient } from './client.ts'
export type { BarsyClientConfig, BarsyClientConfigInput } from './config.ts'
export {
  BARSY_TIMEOUT_MS,
  barsyClientConfigSchema,
  loadBarsyConfig,
  parseClientConfig,
} from './config.ts'
export type { BarsyCallContext, BarsyIssue } from './errors.ts'
export {
  BarsyAuthError,
  BarsyCallError,
  BarsyConfigError,
  BarsyError,
  BarsyHostNotAllowedError,
  BarsyHttpError,
  BarsyMethodNotAllowedError,
  BarsyNetworkError,
  BarsyResponseError,
  BarsyTimeoutError,
} from './errors.ts'
export type { BarsyEnv } from './hosts.ts'
export {
  assertHostAllowed,
  BARSY_DEMO_HOST,
  BARSY_ENVS,
  barsyEnvSchema,
  normaliseHost,
  parseAllowedHosts,
} from './hosts.ts'
export type { DecimalString } from './json.ts'
export { asDecimalString, hasJsonSourceAccess, isDecimalText, parseBarsyJson } from './json.ts'
export type { BarsyReadMethod } from './read-methods.ts'
export {
  BARSY_READ_METHOD_NAMES,
  BARSY_READ_METHODS,
  barsyMethodAuth,
  isBarsyReadMethod,
} from './read-methods.ts'
