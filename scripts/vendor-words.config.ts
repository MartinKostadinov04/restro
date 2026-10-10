// Configuration of the vendor-word test (A6 section 5.4, D67). Read by scripts/vendor-words.ts
// (the scanner), scripts/vendor-words.test.ts and `pnpm vendor-words:baseline`.
//
// Loosening anything here (a zone, an allow entry, a word, a skip rule) is a guardrail change:
// it needs the lead's or Martin's explicit OK (D67). Agents never do it to pass a task.
//
// Imported by Node itself (native TypeScript), so: explicit ".ts" extensions, erasable syntax only.

/** A zone is a set of folders. In a "wall" zone no vendor word is allowed. In a "ratchet" zone
 * the words that exist today are listed per file in vendor-words.baseline.json and may only
 * shrink. A folder name may contain `*`, which stands for exactly one folder name. */
export type Zone = {
  name: string
  mode: 'wall' | 'ratchet'
  /** Folders (or files) in the zone, relative to the repository root. */
  include: string[]
  /** Folders or files inside the zone where vendor words are allowed (not scanned at all). */
  allow?: string[]
  /** Message key paths (segments joined by ".", `*` = one segment) whose whole subtree may name
   * a vendor. Only for `messages/*.json`. */
  allowKeys?: string[]
  /** Words this zone may use without limit (a connector's own words); every other word fails. */
  ownWords?: string[]
}

/** One connector kind: the words that name it and the folders of its own package. */
export type ConnectorKind = {
  kind: string
  /** The kind itself and its vendor's names. Case-insensitive, also inside identifiers. */
  words: string[]
  /** Source folders of the package. Folders that do not exist (yet) are fine. */
  dirs: string[]
}

/** Registered connector kinds. A new kind adds its words to the wall around everything else. */
export const CONNECTORS: ConnectorKind[] = [
  // The barsy package sits at packages/barsy today and moves under packages/connectors later.
  {
    kind: 'barsy',
    words: ['barsy', 'lukanet'],
    dirs: ['packages/barsy/src', 'packages/connectors/barsy/src'],
  },
  // Mistral Software (Zamboo) is only a research item (T69); no package exists.
  { kind: 'mistral', words: ['mistral', 'zamboo'], dirs: ['packages/connectors/mistral/src'] },
]

/** Every word that names a connector or its vendor. */
export const WORDS: string[] = CONNECTORS.flatMap((connector) => connector.words)

/** Zones, most specific first: a file belongs to the first zone that includes it. */
export const ZONES: Zone[] = [
  // What guests and the public CDN see. Not one vendor word, ever.
  {
    name: 'published',
    mode: 'wall',
    include: [
      'packages/shell/src',
      'packages/faces/*/src',
      'packages/core/src/snapshot',
      'apps/web/src/guest',
      'apps/web/app/m',
      'apps/web/app/t',
      'apps/web/app/cdn',
      'packages/assets/src',
    ],
  },
  {
    name: 'core',
    mode: 'ratchet',
    include: ['packages/core/src'],
    allow: ['packages/core/src/connectors'],
  },
  { name: 'db', mode: 'ratchet', include: ['packages/db/src'] },
  {
    name: 'web',
    mode: 'ratchet',
    include: ['apps/web/src', 'apps/web/app', 'apps/web/messages'],
    allow: ['apps/web/src/connectors'],
    allowKeys: ['connectors.*'],
  },
  {
    name: 'worker',
    mode: 'ratchet',
    include: ['apps/worker/src'],
    allow: ['apps/worker/src/connectors.ts'],
  },
  // A connector's own package: its own words are fine, another kind's words fail (cross-kind).
  ...CONNECTORS.map(
    (connector): Zone => ({
      name: `connector:${connector.kind}`,
      mode: 'wall',
      include: connector.dirs,
      ownWords: connector.words,
    }),
  ),
]

/** Not application code: files in a folder with one of these names, anywhere, are not scanned. */
export const SKIPPED_FOLDERS = [
  'tests',
  'testing',
  'e2e',
  'scripts',
  'fixtures',
  'migrations',
  'node_modules',
  '.next',
]

/** Test files are not scanned either: `*.test.*` and `*.spec.*`. */
export const SKIPPED_FILE = /\.(test|spec)\.[^/]*$/

/** Where the per-file counts of the ratchet zones are kept. */
export const BASELINE_FILE = 'scripts/vendor-words.baseline.json'

/** Float and rounding code that must not appear next to the money rules (rule 8). Money goes
 * through the money module only. A legitimate use is never allow-listed here by an agent. */
export const BANNED = {
  /** Folders (non-test code) where the patterns are checked. */
  include: ['packages/barsy/src', 'packages/connectors/*/src'],
  patterns: ['parseFloat(', '.toFixed(', '* 100'] as const,
}
