// The contract-test harness for faces (brief S3-02): fixture snapshots that pass the snapshot
// schema, a small HTML reader, and `runFaceContract`. S3-03 runs it against the `qr-phone` face.

export {
  assertFaceContract,
  type ContractFailure,
  type ContractOptions,
  type ContractReport,
  ITEM_ATTRIBUTE,
  type RenderFn,
  runFaceContract,
  SLOT_ATTRIBUTE,
  STATE_ATTRIBUTE,
} from './contract'
export {
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
