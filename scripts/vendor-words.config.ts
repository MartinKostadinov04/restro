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

/** Registered connector kinds, POS and payment provider alike. A new kind adds its words to the
 * wall around everything else. A kind's web folder (`apps/web/src/connectors/<kind>`) is one of
 * its dirs, so it may use its own words and no other kind's (#104). */
export const CONNECTORS: ConnectorKind[] = [
  // The barsy package sits at packages/barsy today and moves under packages/connectors later.
  {
    kind: 'barsy',
    words: ['barsy', 'lukanet'],
    dirs: ['packages/barsy/src', 'packages/connectors/barsy/src', 'apps/web/src/connectors/barsy'],
  },
  // Mistral Software (Zamboo) is only a research item (T69); no package exists.
  { kind: 'mistral', words: ['mistral', 'zamboo'], dirs: ['packages/connectors/mistral/src'] },
  // The simulated POS (D124; ticket #66) is POS-neutral by design: it owns no words, so its
  // package is a wall for every vendor's. Its switches cite questions by number, never the POS.
  // Its web folder stays in the shared zone below: it calls a core helper named for barsy.
  { kind: 'sim', words: [], dirs: ['packages/connectors/sim-pos/src'] },
  // The first payment provider (D126, D127): its name only in its own package and web folder.
  {
    kind: 'stripe',
    words: ['stripe'],
    dirs: ['packages/payments/stripe/src', 'apps/web/src/connectors/stripe'],
  },
  // The simulated payment provider (#103) owns no words, like the simulated POS.
  {
    kind: 'sim-pay',
    words: [],
    dirs: ['packages/payments/sim-pay/src', 'apps/web/src/connectors/sim-pay'],
  },
]

/** Every word that names a connector or its vendor. */
export const WORDS: string[] = CONNECTORS.flatMap((connector) => connector.words)

/** A connector's own folders: its own words are fine, another kind's words fail (cross-kind).
 * First in ZONES, so a kind's web folder is its zone and not the web zone's allowed folder. */
const CONNECTOR_ZONES: Zone[] = CONNECTORS.map(
  (connector): Zone => ({
    name: `connector:${connector.kind}`,
    mode: 'wall',
    include: connector.dirs,
    ownWords: connector.words,
  }),
)

/** The payment providers' kinds (D127): their words stay out of the POS connectors' files. */
const PAYMENT_KINDS = ['stripe', 'sim-pay']

/** Zones, most specific first: a file belongs to the first zone that includes it. */
export const ZONES: Zone[] = [
  ...CONNECTOR_ZONES,
  // The POS connectors' shared web files (the till's settings, sync reads, D75's name fallback)
  // predate the per-kind folders: any POS's words, never a payment provider's (#104).
  {
    name: 'web-connectors',
    mode: 'wall',
    include: ['apps/web/src/connectors'],
    ownWords: CONNECTORS.filter((connector) => !PAYMENT_KINDS.includes(connector.kind)).flatMap(
      (connector) => connector.words,
    ),
  },
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
  include: ['packages/barsy/src', 'packages/connectors/*/src', 'packages/payments/*/src'],
  patterns: ['parseFloat(', '.toFixed(', '* 100'] as const,
}
