// The vendor-word scanner behind scripts/vendor-words.test.ts and `pnpm vendor-words:baseline`
// (A6 section 5.4, D67). It counts how often a vendor word (barsy, lukanet, mistral, zamboo)
// appears in code that is meant to be neutral, per zone (see vendor-words.config.ts).
//
// What counts: identifiers, string literals, template literal parts and JSX text in .ts/.tsx
// files, and every key and string value of apps/web/messages/*.json. Comments never count.
// Case-insensitive, also inside identifiers (`linkedToBarsy` is one hit).
//
// This module only reads files. The one place that writes the baseline is
// scripts/vendor-words-baseline.ts; the test never writes it (D67: baselines only shrink).
//
// Imported by Node itself (native TypeScript), so: explicit ".ts" extensions, erasable syntax only.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'

import {
  BANNED,
  BASELINE_FILE,
  SKIPPED_FILE,
  SKIPPED_FOLDERS,
  WORDS,
  ZONES,
  type Zone,
} from './vendor-words.config.ts'

export type Config = {
  zones: Zone[]
  words: string[]
  skippedFolders: string[]
  skippedFile: RegExp
  banned: { include: string[]; patterns: readonly string[] }
  baselineFile: string
}

export const defaultConfig: Config = {
  zones: ZONES,
  words: WORDS,
  skippedFolders: SKIPPED_FOLDERS,
  skippedFile: SKIPPED_FILE,
  banned: BANNED,
  baselineFile: BASELINE_FILE,
}

/** The sentence that closes every failure message. */
export const RULE_SENTENCE =
  "Vendor words belong only in a connector's own package or `core/src/connectors/`; see D67."

export type Hit = { line: number; word: string }
export type ScannedFile = { file: string; zone: Zone; hits: Hit[] }
export type Violation = { file: string; zone: string; line?: number; message: string }
/** `{ "<file path>": <number of vendor words> }`, ratchet zones only, files with hits only. */
export type Baseline = Record<string, number>

const SOURCE_FILE = /\.tsx?$/
const MESSAGES_FILE = /(^|\/)messages\/[^/]+\.json$/

// ---------------------------------------------------------------- paths and zones

function startsWithSegments(segments: readonly string[], pattern: readonly string[]): boolean {
  return (
    pattern.length <= segments.length &&
    pattern.every((part, index) => part === '*' || part === segments[index])
  )
}

/** Is `path` the folder `pattern` or inside it? `*` in the pattern is exactly one folder name. */
export function isUnder(path: string, pattern: string): boolean {
  return startsWithSegments(path.split('/'), pattern.split('/'))
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Every scannable file under apps/ and packages/ (relative, with "/"), in a fixed order. */
export function listSourceFiles(root: string, config: Config = defaultConfig): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    const path = join(root, dir)
    if (!existsSync(path)) return
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (!config.skippedFolders.includes(entry.name)) walk(relative)
      } else if (
        entry.isFile() &&
        (SOURCE_FILE.test(entry.name) || MESSAGES_FILE.test(relative)) &&
        !config.skippedFile.test(entry.name)
      ) {
        found.push(relative)
      }
    }
  }
  for (const top of ['apps', 'packages']) walk(top)
  return found.sort(byCodeUnit)
}

/** The first zone that includes the file, or nothing when it is outside every zone or allowed. */
export function zoneOf(file: string, config: Config = defaultConfig): Zone | undefined {
  for (const zone of config.zones) {
    if (!zone.include.some((folder) => isUnder(file, folder))) continue
    if (zone.allow?.some((folder) => isUnder(file, folder))) return undefined
    return zone
  }
  return undefined
}

// ---------------------------------------------------------------- finding words

function wordPattern(words: readonly string[]): RegExp {
  return new RegExp(
    words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'gi',
  )
}

/** Collects the vendor words in pieces of text, with the line each one is on. */
function hitCollector(sourceFile: ts.SourceFile, words: readonly string[]) {
  const pattern = wordPattern(words)
  const hits: Hit[] = []
  return {
    hits,
    /** `text` starts at source position `start`; a word after a newline is on a later line. */
    add(text: string, start: number) {
      const baseLine = sourceFile.getLineAndCharacterOfPosition(start).line + 1
      for (const match of text.matchAll(pattern)) {
        const newlines = text.slice(0, match.index).split('\n').length - 1
        hits.push({ line: baseLine + newlines, word: match[0].toLowerCase() })
      }
    },
  }
}

/** Vendor words in the code of a .ts/.tsx file: comments are not part of the syntax tree. */
export function sourceHits(file: string, text: string, words: readonly string[]): Hit[] {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false)
  const collector = hitCollector(sourceFile, words)
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      collector.add(node.text, node.getStart(sourceFile))
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      collector.add(node.text, node.getStart(sourceFile))
    } else if (ts.isJsxText(node)) {
      // JSX text is not a token with trivia: its text starts at `pos`.
      collector.add(node.text, node.pos)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return collector.hits
}

/** Vendor words in a messages file: every key and every string value, except allowed keys. */
export function messageHits(
  file: string,
  text: string,
  words: readonly string[],
  allowKeys: readonly string[] = [],
): Hit[] {
  JSON.parse(text) // fails loudly on invalid JSON instead of scanning half a file
  const sourceFile = ts.parseJsonText(file, text)
  const collector = hitCollector(sourceFile, words)
  const allowed = allowKeys.map((pattern) => pattern.split('.'))
  const walk = (node: ts.Node, path: string[]) => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue
        const key = ts.isStringLiteral(property.name)
          ? property.name.text
          : property.name.getText(sourceFile)
        const keyPath = [...path, key]
        if (allowed.some((pattern) => startsWithSegments(keyPath, pattern))) continue
        collector.add(key, property.name.getStart(sourceFile))
        walk(property.initializer, keyPath)
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const [index, element] of node.elements.entries()) {
        walk(element, [...path, String(index)])
      }
    } else if (ts.isStringLiteral(node)) {
      collector.add(node.text, node.getStart(sourceFile))
    }
  }
  const root = sourceFile.statements[0]
  if (root && ts.isExpressionStatement(root)) walk(root.expression, [])
  return collector.hits
}

/** Scans every file that belongs to a zone. The hits of a connector zone exclude its own words. */
export function scanVendorWords(root: string, config: Config = defaultConfig): ScannedFile[] {
  const scanned: ScannedFile[] = []
  for (const file of listSourceFiles(root, config)) {
    const zone = zoneOf(file, config)
    if (!zone) continue
    const text = readFileSync(join(root, file), 'utf8')
    const hits = MESSAGES_FILE.test(file)
      ? messageHits(file, text, config.words, zone.allowKeys)
      : sourceHits(file, text, config.words)
    scanned.push({ file, zone, hits: hits.filter((hit) => !zone.ownWords?.includes(hit.word)) })
  }
  return scanned
}

// ---------------------------------------------------------------- banned patterns

export type BannedHit = { line: number; pattern: string }

/** Float and rounding code that money must never use (rule 8): found in the syntax tree, so a
 * comment that explains the rule does not count. */
export function bannedHits(file: string, text: string): BannedHit[] {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false)
  const hits: BannedHit[] = []
  const add = (node: ts.Node, pattern: string) => {
    hits.push({
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      pattern,
    })
  }
  const isHundred = (node: ts.Node) => ts.isNumericLiteral(node) && node.text === '100'
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === 'parseFloat') add(node, 'parseFloat(')
    else if (ts.isPropertyAccessExpression(node) && node.name.text === 'toFixed')
      add(node, '.toFixed(')
    else if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken ||
        node.operatorToken.kind === ts.SyntaxKind.AsteriskEqualsToken) &&
      (isHundred(node.left) || isHundred(node.right))
    ) {
      add(node, '* 100')
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return hits
}

/** Banned patterns in the non-test code of the folders named in the config. */
export function findBannedPatterns(root: string, config: Config = defaultConfig): Violation[] {
  const violations: Violation[] = []
  for (const file of listSourceFiles(root, config)) {
    if (!SOURCE_FILE.test(file)) continue
    if (!config.banned.include.some((folder) => isUnder(file, folder))) continue
    for (const hit of bannedHits(file, readFileSync(join(root, file), 'utf8'))) {
      if (!config.banned.patterns.includes(hit.pattern)) continue
      violations.push({
        file,
        zone: 'banned',
        line: hit.line,
        message: `${file}:${hit.line} banned pattern \`${hit.pattern}\` (zone banned; money goes through the money module, rule 8)`,
      })
    }
  }
  return violations
}

// ---------------------------------------------------------------- checking against the baseline

function linesOf(hits: Hit[]): string {
  const shown = hits.slice(0, 8).map((hit) => `${hit.line} "${hit.word}"`)
  return `line ${shown.join(', ')}${hits.length > 8 ? ', ...' : ''}`
}

/** What is wrong: any word in a wall zone, any file above or below its baseline, any stale entry. */
export function checkVendorWords(scanned: ScannedFile[], baseline: Baseline): Violation[] {
  const violations: Violation[] = []
  const byFile = new Map(scanned.map((entry) => [entry.file, entry]))

  for (const { file, zone, hits } of scanned) {
    if (hits.length === 0) continue
    if (zone.mode === 'wall') {
      const why = zone.ownWords ? "another connector's word" : 'no vendor word allowed'
      for (const hit of hits) {
        violations.push({
          file,
          zone: zone.name,
          line: hit.line,
          message: `${file}:${hit.line} "${hit.word}" in zone ${zone.name} (wall: ${why})`,
        })
      }
      continue
    }
    const allowed = baseline[file]
    const where = `(zone ${zone.name}, ratchet)`
    if (allowed === undefined) {
      violations.push({
        file,
        zone: zone.name,
        line: hits[0]?.line,
        message: `${file}:${hits[0]?.line} "${hits[0]?.word}" ${where}: ${hits.length} vendor word(s) and no baseline entry (${linesOf(hits)})`,
      })
    } else if (hits.length > allowed) {
      violations.push({
        file,
        zone: zone.name,
        line: hits[0]?.line,
        message: `${file}: ${hits.length} vendor words, the baseline allows ${allowed} ${where} (${linesOf(hits)})`,
      })
    } else if (hits.length < allowed) {
      violations.push({
        file,
        zone: zone.name,
        message: `${file}: ${hits.length} vendor words, the baseline says ${allowed} ${where}; stale entry: lower it with pnpm vendor-words:baseline`,
      })
    }
  }

  for (const [file, allowed] of Object.entries(baseline)) {
    const entry = byFile.get(file)
    if (entry && entry.zone.mode === 'ratchet' && entry.hits.length > 0) continue
    const why = !entry
      ? 'is not scanned (deleted, moved, skipped, allowed or outside a ratchet zone)'
      : entry.zone.mode !== 'ratchet'
        ? `is in the ${entry.zone.name} zone, which allows none`
        : 'has no vendor words now'
    violations.push({
      file,
      zone: entry?.zone.name ?? 'baseline',
      message: `${file}: baseline entry (${allowed}) but the file ${why}; stale entry: remove it with pnpm vendor-words:baseline`,
    })
  }
  return violations
}

/** One message for a test failure: every violation, then the rule in one sentence. */
export function formatReport(violations: Violation[]): string {
  const lines = violations.map((violation) => `  ${violation.message}`).join('\n')
  // A banned pattern carries its own explanation (rule 8); the sentence is about vendor words.
  const closing = violations.every((violation) => violation.zone === 'banned') ? '' : RULE_SENTENCE
  return closing ? `${lines}\n\n${closing}` : lines
}

// ---------------------------------------------------------------- the baseline file

/** Reads the baseline, or `null` when the file does not exist. Throws on a malformed file. */
export function readBaseline(root: string, config: Config = defaultConfig): Baseline | null {
  const path = join(root, config.baselineFile)
  if (!existsSync(path)) return null
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${config.baselineFile} must be an object of { "<file>": <count> }`)
  }
  for (const [file, count] of Object.entries(parsed)) {
    if (!Number.isInteger(count) || (count as number) < 1) {
      throw new Error(`${config.baselineFile}: "${file}" must be a whole number of 1 or more`)
    }
  }
  return parsed as Baseline
}

/** The baseline the current tree would produce: files with hits in ratchet zones. */
export function computeBaseline(scanned: ScannedFile[]): Baseline {
  const baseline: Baseline = {}
  for (const { file, zone, hits } of scanned) {
    if (zone.mode === 'ratchet' && hits.length > 0) baseline[file] = hits.length
  }
  return baseline
}

/** Entries of `next` that are new or higher than in `previous`: the numbers a rewrite would raise. */
export function raisedEntries(next: Baseline, previous: Baseline) {
  return Object.entries(next)
    .filter(([file, count]) => count > (previous[file] ?? 0))
    .map(([file, count]) => ({ file, from: previous[file] ?? 0, to: count }))
}

/** The text of the baseline file: sorted by path (code units, no locale), two spaces, newline. */
export function formatBaseline(baseline: Baseline): string {
  const sorted = Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => byCodeUnit(a, b)))
  return `${JSON.stringify(sorted, null, 2)}\n`
}

/** Files and words per zone, for a report. */
export function zoneTotals(baseline: Baseline, config: Config = defaultConfig) {
  const totals: Record<string, { files: number; words: number }> = {}
  for (const [file, count] of Object.entries(baseline)) {
    const name = zoneOf(file, config)?.name ?? '(outside every zone)'
    const total = totals[name] ?? { files: 0, words: 0 }
    total.files += 1
    total.words += count
    totals[name] = total
  }
  return totals
}
