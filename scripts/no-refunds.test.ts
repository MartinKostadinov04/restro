import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// The no-refund guard (D125 3.5, D122 §8; ticket #104). Restro refunds nothing but one thing: a
// line staff mark "Not served" on a payment Restro captured (the 11-18 refund decision, 148;
// ticket #435). Everything else is the venue's, in its own provider dashboard, and the platform's
// restricted key has no refund permission. This test fails when non-test source under `apps/` or
// `packages/` calls a refund through a provider's SDK, its HTTP API, the `refundLine` step or a
// helper named for one, anywhere but the two places below.
//
// Martin approved narrowing this guard on 11-18, in exactly this shape and no other (D67 otherwise
// only lets a guard tighten): the reach shrinks to ONE named step in the provider package, called
// from ONE named file in `apps/worker`; nothing about its force does. Every pattern stays, every
// other file (`apps/web` included) is still refused, and the allowance below is pinned by its own
// tests: exactly these two paths, each must really hold its call, and a call of any other kind in
// either file is still refused. A pattern is never removed and a path is never added to let code
// through.

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const SKIPPED_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.turbo'])

/** The SDK call that makes a refund: `stripe.refunds.create(…)`. Only the step's own file has it. */
const SDK_REFUND = /\brefunds\s*\??\.\s*(?:create|update|cancel)\s*\(/i

/** A call of the provider's one refund step: `provider.refundLine(…)`, `provider?.refundLine?.(…)`. */
const STEP_CALL = /\.\s*refundLine\s*(?:\?\.\s*)?\(/

/** A call that makes a refund. Prose saying "no refund" matches none of them. */
const REFUND_CALLS: readonly RegExp[] = [
  // An SDK resource: `stripe.refunds.create(…)`, `client.refunds.update(…)`.
  SDK_REFUND,
  // The HTTP API, any provider: `/v1/refunds`, `/payments/<id>/refund`. Not a module path such as
  // './refunds': observing refund notices is allowed (D127 4.4).
  /['"`][^'"`\n]*\/v\d+\/refunds?\b/i,
  /['"`][^'"`\n]*\/(?:payments?|charges?|transactions?)\/[^'"`\n]*\/refunds?\b/i,
  // A method or helper: `.refund(…)`, `createRefund(…)`, `issue_refund(…)`.
  /\.\s*refund\s*\(/i,
  /\b(?:create|issue|make|send|start|do)_?refund\s*\(/i,
  // The provider's one refund step, called (148): a member call, a string key, or a destructuring
  // that would let it be called bare. Its definition (`refundLine(request) {`) is not a call.
  STEP_CALL,
  /\[\s*['"`]refundLine['"`]\s*\]/,
  /\{[^{}]*\brefundLine\b[^{}]*\}\s*=\s*[\w$.]/,
]

/**
 * The only two places that may hold a refund call, and the one kind of call each may hold, by
 * pattern source. Nothing else is allowed anywhere, whatever it is called.
 */
const ALLOWED_REFUND_CALLS: ReadonlyMap<string, readonly RegExp[]> = new Map([
  // The step itself: the one place the provider's SDK makes a refund, with the refund-only key.
  ['packages/payments/stripe/src/refund-line.ts', [SDK_REFUND]],
  // The caller: the worker's refund job, the only file that may call the step.
  ['apps/worker/src/jobs/payment-refunds.ts', [STEP_CALL]],
])

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(path)
    if (!/\.(?:[cm]?[jt]s|tsx|jsx)$/.test(entry.name)) return []
    return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name) ? [] : [path]
  })
}

/** The patterns a text breaks at `path`, leaving out the one kind of call that path may hold. */
function refundCalls(text: string, path = ''): string[] {
  const allowed = ALLOWED_REFUND_CALLS.get(path) ?? []
  return REFUND_CALLS.filter((pattern) => pattern.test(text) && !allowed.includes(pattern)).map(
    String,
  )
}

const posix = (file: string) => relative(repoRoot, file).replaceAll(sep, '/')

describe('the no-refund guard', () => {
  it('no code in apps/ or packages/ calls a refund but the one step, from the one place', () => {
    const files = ['apps', 'packages'].flatMap((top) => sourceFiles(join(repoRoot, top)))
    expect(files.length).toBeGreaterThan(100)
    const found = files.flatMap((file) =>
      refundCalls(readFileSync(file, 'utf8'), posix(file)).map(
        (pattern) => `${posix(file)}: ${pattern}`,
      ),
    )
    expect(found).toEqual([])
  })

  it('allows exactly two paths, one kind of call each (the 11-18 narrowing, no wider)', () => {
    expect([...ALLOWED_REFUND_CALLS.keys()].sort()).toEqual([
      'apps/worker/src/jobs/payment-refunds.ts',
      'packages/payments/stripe/src/refund-line.ts',
    ])
    for (const patterns of ALLOWED_REFUND_CALLS.values()) expect(patterns).toHaveLength(1)
  })

  it('each allowed path really holds its call, so the allowance cannot outlive the code', () => {
    for (const [path, patterns] of ALLOWED_REFUND_CALLS) {
      const text = readFileSync(join(repoRoot, path), 'utf8')
      for (const pattern of patterns) expect(pattern.test(text), `${path} ${pattern}`).toBe(true)
    }
  })

  it('only the worker job calls the step: nothing in apps/web or elsewhere may', () => {
    const files = ['apps', 'packages'].flatMap((top) => sourceFiles(join(repoRoot, top)))
    const callers = files.filter((file) => STEP_CALL.test(readFileSync(file, 'utf8'))).map(posix)
    expect(callers).toEqual(['apps/worker/src/jobs/payment-refunds.ts'])
    const sdk = files.filter((file) => SDK_REFUND.test(readFileSync(file, 'utf8'))).map(posix)
    expect(sdk).toEqual(['packages/payments/stripe/src/refund-line.ts'])
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
      'await provider.refundLine(request)',
      'await provider?.refundLine?.(request)',
      "await provider['refundLine'](request)",
      'const { refundLine } = provider',
    ]) {
      expect(refundCalls(planted), planted).not.toEqual([])
    }
    for (const prose of [
      '// Restro never refunds; the venue refunds in its own dashboard.',
      "const reason = 'no refund from the app'",
      'refundable: false',
      "import { recordRefundNotice } from './refunds'",
      "const help = '/refund-policy'",
      'refundLine(request: RefundLineRequest): Promise<PaymentWriteOutcome<ProviderRefund>>',
      'async refundLine(request) {',
      "import { refundLine as refundLineStep } from './refund-line'",
    ]) {
      expect(refundCalls(prose), prose).toEqual([])
    }
  })

  it('refuses a refund call at any path but the two, and any other call at those two', () => {
    const step = 'await provider.refundLine(request)'
    const sdk = 'await client.refunds.create({ payment_intent: id })'
    // The step called from the web app, from core, from a provider package: refused.
    for (const path of [
      'apps/web/src/server/tonight/actions.ts',
      'packages/core/src/service/refund-line.ts',
      'packages/payments/stripe/src/provider.ts',
      'packages/payments/sim-pay/src/provider.ts',
      'apps/worker/src/jobs/payments.ts',
    ]) {
      expect(refundCalls(step, path), `${path} step`).not.toEqual([])
      expect(refundCalls(sdk, path), `${path} sdk`).not.toEqual([])
    }
    // The allowed files hold only their own kind of call.
    expect(refundCalls(step, 'apps/worker/src/jobs/payment-refunds.ts')).toEqual([])
    expect(refundCalls(sdk, 'apps/worker/src/jobs/payment-refunds.ts')).not.toEqual([])
    expect(refundCalls(sdk, 'packages/payments/stripe/src/refund-line.ts')).toEqual([])
    expect(refundCalls(step, 'packages/payments/stripe/src/refund-line.ts')).not.toEqual([])
    for (const path of [
      'apps/worker/src/jobs/payment-refunds.ts',
      'packages/payments/stripe/src/refund-line.ts',
    ]) {
      expect(refundCalls('await provider.refund(x)', path), `${path} .refund(`).not.toEqual([])
      expect(refundCalls("await fetch('https://x/v1/refunds')", path), `${path} http`).not.toEqual(
        [],
      )
      expect(refundCalls('createRefund(x)', path), `${path} helper`).not.toEqual([])
    }
  })
})
