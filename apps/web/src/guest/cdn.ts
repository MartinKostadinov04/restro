// Where the guest page reads the published files from. Locally that is this app's own `/cdn` route
// (the local publish store); in staging and production it is the CDN's address, set once with
// NEXT_PUBLIC_CDN_BASE_URL (inlined at build time, so the phone needs no other setting). The same
// address prefixes the photo paths in the snapshot.

/** The base address without a trailing slash: `/cdn`, or `https://cdn.example.com`. */
export function cdnBase(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const configured = env.NEXT_PUBLIC_CDN_BASE_URL?.trim()
  return (configured && configured !== '' ? configured : '/cdn').replace(/\/+$/, '')
}

/** The base address of this build. `process.env.NEXT_PUBLIC_…` is replaced at build time. */
export const CDN_BASE = cdnBase({ NEXT_PUBLIC_CDN_BASE_URL: process.env.NEXT_PUBLIC_CDN_BASE_URL })
