// The written guides of docs/guides, read from the project for the admin to show (brief S3-07).
// Only the guides named here can be read: a name is looked up in this list, never joined into a
// path. The files are searched from where the server runs (`apps/web` in development and with
// `next start`; the project root is two folders up) so that no copy has to be kept in the app;
// a deployment that does not ship `docs/` gets `null` and the page says so.
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** The guides the admin can show. */
const GUIDES = { 'qr-links': 'qr-links.md' } as const

export type GuideName = keyof typeof GUIDES

export function isGuideName(value: string): value is GuideName {
  return Object.hasOwn(GUIDES, value)
}

/** The text of a guide, or null when the file is not on this server. */
export async function loadGuide(
  name: GuideName,
  cwd: string = process.cwd(),
): Promise<string | null> {
  const file = GUIDES[name]
  // The folder is looked for at run time, next to where the server runs; the bundler must not try
  // to trace it into the build (`turbopackIgnore`).
  const folders = [
    path.resolve(/*turbopackIgnore: true*/ cwd, '../../docs/guides'),
    path.resolve(/*turbopackIgnore: true*/ cwd, 'docs/guides'),
  ]
  for (const base of folders) {
    try {
      return await readFile(path.join(/*turbopackIgnore: true*/ base, file), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return null
}
