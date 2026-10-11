// The face a venue's guest features are read against, on the server. The template registry
// (`@/faces/registry`) is not imported here: it loads the faces' components with `import()`, and
// those are client components, which a server component cannot bundle (the build fails). This file
// names the same manifests, which are plain data; `feature-face.test.ts` checks that it names every
// face of the registry, so a face added there is added here too.
import { EDITORIAL_MARKET_MANIFEST } from '@restro/editorial-market/manifest'
import { QR_PHONE_MANIFEST } from '@restro/qr-phone/manifest'
import type { FaceManifest } from '@restro/shell'

const MANIFESTS: ReadonlyMap<string, FaceManifest> = new Map([
  [EDITORIAL_MARKET_MANIFEST.face, EDITORIAL_MARKET_MANIFEST],
  [QR_PHONE_MANIFEST.face, QR_PHONE_MANIFEST],
])

/**
 * The manifest a venue's template is read with: the venue's own face, or the default face (the
 * registry's) for a venue that chose none or a name this list does not have, as the guest page
 * draws it.
 */
export function featureManifestOf(face: string | null | undefined): FaceManifest {
  const found = face === null || face === undefined ? undefined : MANIFESTS.get(face)
  return found ?? EDITORIAL_MARKET_MANIFEST
}
