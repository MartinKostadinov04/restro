// @restro/core/seal-open: the opening half of sealing (D55). Holds every use of the worker's
// private key. Only apps/worker may import it: the dependency-cruiser rule
// `seal-open-only-from-worker` fails the build for any other importer, the web app included.

export {
  generateSealKeyPair,
  isSealKeyPair,
  openBarsyCredentials,
  openSecret,
  parseSealPrivateKey,
} from './open'
