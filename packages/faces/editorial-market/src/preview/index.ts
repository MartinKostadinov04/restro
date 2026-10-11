// `@restro/editorial-market/preview`: the demo host for the admin's preview. The guest page must
// never import this (a dependency rule forbids it): a real host binds its own services.

export { DEMO_DELAYS, useDemoServices } from './demo-services'
