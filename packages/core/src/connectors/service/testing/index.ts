// The connector conformance kit: `import { ... } from '@restro/core/connectors/testing'`. Tests
// only: it registers Vitest tests and uses Node's util, so nothing in production imports it.

export * from './checks-read'
export * from './checks-write'
export { posIdLeaks, waiterActionProblems } from './guard'
export * from './harness'
export { serviceConnectorSuite, serviceReadSuite } from './suite'
