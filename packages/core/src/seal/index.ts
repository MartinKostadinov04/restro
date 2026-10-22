// @restro/core/seal: the sealing half (D55). The web app seals barsy credentials, and core/apply
// table codes (D122 §9), with the worker's public key (`SEAL_PUBLIC_KEY`); neither can read them
// back. Opening lives in `@restro/core/seal-open`, which only apps/worker may import
// (.dependency-cruiser.cjs).
//
// A separate entry point, not part of `@restro/core`: it uses `node:crypto`, and the main entry
// also runs in the browser.

export {
  type BarsyCredentials,
  BarsyCredentialsSchema,
  sealBarsyCredentials,
} from './credentials'
export {
  type IntegrationSealContext,
  MAX_PLAINTEXT_BYTES,
  SEAL_INFO,
  SEAL_VERSION,
  type SealContext,
  sealAad,
  type TableCodeSealContext,
} from './envelope'
export { SealError, type SealErrorCode } from './errors'
export { parseSealPublicKey, sealKeyId, sealSecret } from './seal'
export { sealTableCode } from './table-code'
