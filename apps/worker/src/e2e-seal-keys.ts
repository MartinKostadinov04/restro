// The sealing keys of one end-to-end run (apps/web/playwright.config.ts, #70): a throwaway X25519
// pair, as `pnpm keys:seal` writes one (base64url DER: public SPKI, private PKCS8). The web
// servers get the public half only; the worker beside them gets both, so it can reveal and seal
// table codes. The private half is named here, on the worker's side: no file of the web app
// names it (apps/web/src/server/env.test.ts, D55).
import { generateKeyPairSync } from 'node:crypto'

/** The settings each process of the run gets. */
export interface E2eSealEnvironment {
  readonly web: { readonly SEAL_PUBLIC_KEY: string }
  readonly worker: { readonly SEAL_PUBLIC_KEY: string; readonly SEAL_PRIVATE_KEY: string }
}

export function e2eSealEnvironment(): E2eSealEnvironment {
  const pair = generateKeyPairSync('x25519')
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url')
  return {
    web: { SEAL_PUBLIC_KEY: publicKey },
    worker: { SEAL_PUBLIC_KEY: publicKey, SEAL_PRIVATE_KEY: privateKey },
  }
}
