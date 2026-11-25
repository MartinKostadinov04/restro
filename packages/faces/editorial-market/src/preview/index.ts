// `@restro/editorial-market/preview`: the admin's preview only. The guest page must never import this
// (a dependency rule forbids it): a real host binds its own services, and draws the whole face.
//   - the demo host for the service screens (`useDemoServices`);
//   - the specimen view, one part of the page alone, for a tile of the Design panel (`EditorialSpecimen`);
//   - the sheets' addresses, for the frames that open and close them (`SHEETS`).

// The sheets the face opens by the page's address (`#bag`, `#tab`, `#call`, `#pay`): the Design
// page's frames close the one a stage opened.
export { SHEETS } from '../services/provider'
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
