import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// The no-refund guard (D125 3.5, D122 §8; ticket #104). Restro never refunds a payment: a refund
// is the venue's, in its own provider dashboard, and the restricted key has no refund permission.
// This test fails when non-test source under `apps/` or `packages/` calls a refund through a
// provider's SDK, its HTTP API or a helper named for it. Only tightens (D67): a pattern is never
// removed to let code through.

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const SKIPPED_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.turbo'])

/** A call that makes a refund. Prose saying "no refund" matches none of them. */
const REFUND_CALLS: readonly RegExp[] = [
  // An SDK resource: `stripe.refunds.create(…)`, `client.refunds.update(…)`.
  /\brefunds\s*\??\.\s*(?:create|update|cancel)\s*\(/i,
  // The HTTP API, any provider: `/v1/refunds`, `/payments/<id>/refund`. Not a module path such as
  // './refunds': observing refund notices is allowed (D127 4.4).
  /['"`][^'"`\n]*\/v\d+\/refunds?\b/i,
  /['"`][^'"`\n]*\/(?:payments?|charges?|transactions?)\/[^'"`\n]*\/refunds?\b/i,
  // A method or helper: `.refund(…)`, `createRefund(…)`, `issue_refund(…)`.
  /\.\s*refund\s*\(/i,
  /\b(?:create|issue|make|send|start|do)_?refund\s*\(/i,
]

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(path)
    if (!/\.(?:[cm]?[jt]s|tsx|jsx)$/.test(entry.name)) return []
    return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name) ? [] : [path]
  })
}

/** The patterns a text breaks. */
function refundCalls(text: string): string[] {
  return REFUND_CALLS.filter((pattern) => pattern.test(text)).map(String)
}

describe('the no-refund guard', () => {
  it('no code in apps/ or packages/ calls a refund', () => {
    const files = ['apps', 'packages'].flatMap((top) => sourceFiles(join(repoRoot, top)))
    expect(files.length).toBeGreaterThan(100)
    const found = files.flatMap((file) =>
      refundCalls(readFileSync(file, 'utf8')).map(
        (pattern) => `${relative(repoRoot, file).replaceAll(sep, '/')}: ${pattern}`,
      ),
    )
    expect(found).toEqual([])
  })

  it('catches a planted refund (self-test on text)', () => {
    for (const planted of [
      'await stripe.refunds.create({ payment_intent: id })',
      'await client.refunds?.create(params)',
      "await fetch('https://api.stripe.com/v1/refunds', init)",
      "await post('/payments/py_1/refund')",
      'await provider.refund(paymentRef)',
      'await createRefund(payment)',
      'issue_refund(id)',
    ]) {
      expect(refundCalls(planted), planted).not.toEqual([])
    }
    for (const prose of [
      '// Restro never refunds; the venue refunds in its own dashboard.',
      "const reason = 'no refund from the app'",
      'refundable: false',
      "import { recordRefundNotice } from './refunds'",
      "const help = '/refund-policy'",
    ]) {
      expect(refundCalls(prose), prose).toEqual([])
    }
  })
})
