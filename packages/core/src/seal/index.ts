// @restro/core/seal: the sealing half (D55). The web app seals barsy credentials with the
// worker's public key (`SEAL_PUBLIC_KEY`) and can never read them back. Opening lives in
// `@restro/core/seal-open`, which only apps/worker may import (.dependency-cruiser.cjs).
//
// A separate entry point, not part of `@restro/core`: it uses `node:crypto`, and the main entry
// also runs in the browser.

export {
  type BarsyCredentials,
  BarsyCredentialsSchema,
  sealBarsyCredentials,
} from './credentials'
export { MAX_PLAINTEXT_BYTES, SEAL_INFO, SEAL_VERSION, type SealContext, sealAad } from './envelope'
export { SealError, type SealErrorCode } from './errors'
export { parseSealPublicKey, sealKeyId, sealSecret } from './seal'
