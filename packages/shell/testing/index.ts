// The contract-test harness for faces (briefs S3-02, SH-03 and SH-06): fixture snapshots that pass
// the snapshot schema, a small HTML reader, `runFaceContract`, the theme-only stylesheet check,
// `faceContractSuite`, which every face's test calls, and `stubServices`, the empty services
// binding a face is rendered with.

export {
  ADD_SLOT,
  assertFaceContract,
  type ContractFailure,
  type ContractHost,
  type ContractOptions,
  type ContractReport,
  FEATURE_SLOTS,
  ITEM_ATTRIBUTE,
  LANGUAGE_FIXTURE,
  LANGUAGE_SLOT,
  LAYOUT_SWITCH_SLOT,
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
export {
  PAID_LINES,
  PAYING_LEGAL,
  type PayScenario,
  payingBill,
  payingState,
  payingView,
  payment as payScenarioPayment,
  payScenarios,
  RECEIPT_LOOK,
  recordSaving,
  type SaveRecord,
} from './paying'
export { stubServices } from './services'
export { type FaceContractSuiteOptions, faceContractSuite } from './suite'
