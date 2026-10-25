// The payment conformance suite: `import { ... } from '@restro/core/connectors/payment-testing'`.
// Tests only: it registers Vitest tests, so nothing in production imports it (dependency-cruiser,
// `payment-kit-only-from-tests`). A provider package runs it in its own test, never the other way
// round: core never imports a provider package.

export * from './checks'
export { providerOperationProblems } from './guard'
export * from './harness'
export { paymentProviderSuite } from './suite'
