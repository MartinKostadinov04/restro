// The service connector seam (spec #64, Implementation Decisions 1): the interface, its Zod
// schemas, the capabilities, the waiter actions, the timings and the target-bill rule. Pure: no
// I/O. The conformance kit is `@restro/core/connectors/testing`, for tests only.

export * from './capabilities'
export {
  CAUTIOUS_CALLS_PER_SECOND,
  type ServiceConnector,
  type ServiceContext,
  type ServiceReader,
} from './connector'
export * from './landed'
export * from './pos-ref'
export * from './schemas'
export * from './target-bill'
export * from './timings'
export * from './waiter-actions'
