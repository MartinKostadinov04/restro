// The contract-test harness for faces (briefs S3-02 and SH-03): fixture snapshots that pass the
// snapshot schema, a small HTML reader, `runFaceContract`, the theme-only stylesheet check and
// `faceContractSuite`, which every face's test calls.

export {
  assertFaceContract,
  type ContractFailure,
  type ContractOptions,
  type ContractReport,
  FEATURE_SLOTS,
  ITEM_ATTRIBUTE,
  type RenderFn,
  runFaceContract,
  SLOT_ATTRIBUTE,
  STATE_ATTRIBUTE,
} from './contract'
export { assertFaceScopedCss, assertThemeOnlyCss, NAMED_COLOURS } from './css'
export {
  CUSTOM_ROLES,
  type Fixture,
  fixture,
  fixtureId,
  fixtures,
  type GroupSpec,
  type ItemSpec,
  type SectionSpec,
  type SnapshotSpec,
  snapshotFromSpec,
} from './fixtures'
export { type HtmlElement, parseHtml, textOf, withAttribute } from './html'
export { type FaceContractSuiteOptions, faceContractSuite } from './suite'
