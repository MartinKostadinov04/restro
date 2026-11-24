// `@restro/editorial-market/preview`: the admin's preview only. The guest page must never import this
// (a dependency rule forbids it): a real host binds its own services, and draws the whole face.
//   - the demo host for the service screens (`useDemoServices`);
//   - the specimen view, one part of the page alone, for a tile of the Design panel (`EditorialSpecimen`).

export { DEMO_DELAYS, useDemoServices } from './demo-services'
export {
  EditorialSpecimen,
  type EditorialSpecimenProps,
  SPECIMEN_FIXED_PARTS,
  SPECIMEN_PARTS,
  SPECIMEN_PHONE_HEIGHT,
  type SpecimenPart,
  specimenNeedsHost,
  specimenNeedsServices,
} from './specimen'
