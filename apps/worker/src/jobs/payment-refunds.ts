// The refund job (the 11-18 refund decision, 148; D110 and D125): the only place in Restro that
// calls the payment provider's refund step, `refundLine`, and only for a refund row a person's
// "Not served" tap wrote first through `applyService` (`payment.refund_line`).
//
//   payment-refund-tick  every minute: for each refund of ours that is not final,
//     1. not yet asked of the provider: check Restro's own bounds once more (`refundBoundsProblem`:
//        a payment Restro captured, at most what the POS closed the line for, once per line), call
//        `refundLine` with the refund row's id as the idempotency key, and record the answer
//        (`payment.refund_sent`): the provider's id of the refund, or "did not go through". A
//        timeout is `unknown`: nothing is recorded and the next run asks again with the same key,
//        so a retry can never pay twice;
//     2. asked: read the payment and its refunds back from the provider and record them
//        (`payment.observe`), which is the only thing that makes the refund "refunded" (D72: no
//        local success).
//
// It never blocks a refund staff confirmed. The nightly alarm (`refund-tripwire.ts`) blocks
// nothing at all. What stops new taps is the route being switched off, and only a stray refund (one
// made with Restro's key that has no row of ours) does that; a row already written is sent even
// then. Nothing here logs an amount, a provider id or a key.
//
// One run at a time per worker (`retryLimit: 0`, ticks do not overlap for long): two runs asking
// for one row use the same key, and the provider refunds once.

import {
  idSchema,
  JOB_NAMES,
  PaymentIdSchema,
  type PaymentProvider,
  providerRef,
} from '@restro/core'
import {
  applyService,
  type PendingRefund,
  pendingRefunds,
  refundBoundsProblem,
} from '@restro/core/service'
import type { DbPool } from '@restro/db'

import { describeError } from '../errors'
import type { Logger } from '../logger'
import { defineJob, type JobDefinition } from './types'

export interface PaymentRefundDeps {
  readonly providers: ReadonlyMap<string, PaymentProvider>
}

/** What one run did, for the log. */
export interface RefundRunResult {
  readonly sent: number
  readonly failed: number
  readonly readBack: number
  readonly waiting: number
}

interface Env {
  readonly pool: DbPool
  readonly log: Logger
  readonly jobId: string
}

const as = (row: PendingRefund, env: Env) => ({
  tenantId: row.tenantId,
  venueId: row.venueId,
  origin: 'worker' as const,
  actor: { kind: 'system' as const },
  jobId: env.jobId,
  via: 'worker' as const,
})

/** Records a refund the provider did not make: the code is a word, never the provider's message. */
async function recordFailed(env: Env, row: PendingRefund, code: string): Promise<boolean> {
  const { result } = await applyService(
    env.pool,
    { type: 'payment.refund_sent', refundId: row.refundId, outcome: 'failed', code },
    as(row, env),
  )
  return result.status === 'accepted'
}

/** Reads the payment and its refunds back and records them: the refund is "refunded" only from here. */
async function readBack(
  env: Env,
  provider: PaymentProvider,
  row: PendingRefund,
): Promise<'recorded' | 'waiting'> {
  const account = providerRef(row.accountRef)
  const paymentRef = providerRef(row.providerPaymentRef)
  const payment = await provider.readPayment(account, paymentRef)
  if (!payment.complete) {
    env.log.warn({ refundId: row.refundId }, 'a refund could not be read back: payment unread')
    return 'waiting'
  }
  const refunds = await provider.readRefunds(account, paymentRef)
  if (!refunds.complete) {
    env.log.warn({ refundId: row.refundId }, 'a refund could not be read back: refunds unread')
    return 'waiting'
  }
  const { result } = await applyService(
    env.pool,
    {
      type: 'payment.observe',
      paymentId: row.paymentId,
      providerKind: row.providerKind,
      providerPaymentRef: row.providerPaymentRef,
      capturedMinor: payment.value.capturedMinor,
      refunds: refunds.value.map((refund) => ({
        ref: refund.ref.provider,
        amountMinor: refund.amountMinor,
        failed: refund.failed,
        ...(refund.restroRefundId === undefined ? {} : { restroRefundId: refund.restroRefundId }),
      })),
      dispute: payment.value.dispute,
      disputeDueAt: payment.value.disputeDueAt,
    },
    as(row, env),
  )
  return result.status === 'accepted' ? 'recorded' : 'waiting'
}

/** One run over every refund of ours that is not final. Never throws for what a provider causes. */
export async function runPaymentRefunds(
  env: Env,
  deps: PaymentRefundDeps,
): Promise<RefundRunResult> {
  let sent = 0
  let failed = 0
  let readBackCount = 0
  let waiting = 0
  for (const row of await pendingRefunds(env.pool)) {
    const provider = deps.providers.get(row.providerKind)
    if (provider === undefined) {
      waiting += 1
      continue
    }
    try {
      let current = row
      if (row.providerRefundRef === null) {
        // Restro's own bounds, once more, in one place. The row's own amount is in the unsent total.
        const problem = refundBoundsProblem({
          payment: {
            state: row.state,
            providerPaymentRef: row.providerPaymentRef,
            capturedMinor: row.capturedMinor,
            refundedMinor: row.refundedMinor,
            serviceDate: row.serviceDate,
          },
          line: { closedMinor: row.closedMinor, closedQuantity: row.closedQuantity },
          amountMinor: row.amountMinor,
          unsentMinor: Math.max(0, row.unsentMinor - row.amountMinor),
          // The day the staff tapped: a refund confirmed is never held back by the clock.
          serviceDate: row.refundServiceDate,
        })
        if (problem !== null) {
          env.log.warn({ refundId: row.refundId, problem }, 'a refund is outside its bounds')
          if (await recordFailed(env, row, problem)) failed += 1
          continue
        }
        if (!provider.capabilities.lineRefund) {
          if (await recordFailed(env, row, 'not_supported')) failed += 1
          continue
        }
        const answer = await provider.refundLine({
          accountRef: providerRef(row.accountRef),
          paymentRef: providerRef(row.providerPaymentRef),
          paymentId: PaymentIdSchema.parse(row.paymentId),
          refundId: idSchema('rf').parse(row.refundId),
          amountMinor: row.amountMinor,
          idempotencyKey: row.refundId,
        })
        if (answer.kind === 'unknown') {
          // No answer is not "no": the same key asks again next run, and the provider refunds once.
          env.log.warn(
            { refundId: row.refundId },
            'a refund got no final answer; asked again next run',
          )
          waiting += 1
          continue
        }
        if (answer.kind === 'refused') {
          env.log.warn(
            { refundId: row.refundId, code: answer.refusal.code, scope: answer.refusal.scope },
            'the provider refused a refund',
          )
          if (await recordFailed(env, row, answer.refusal.code)) failed += 1
          continue
        }
        const { result } = await applyService(
          env.pool,
          {
            type: 'payment.refund_sent',
            refundId: row.refundId,
            outcome: 'sent',
            providerRefundRef: answer.result.ref.provider,
          },
          as(row, env),
        )
        if (result.status !== 'accepted') {
          waiting += 1
          continue
        }
        sent += 1
        current = { ...row, providerRefundRef: answer.result.ref.provider }
      }
      if ((await readBack(env, provider, current)) === 'recorded') readBackCount += 1
      else waiting += 1
    } catch (error) {
      env.log.warn({ refundId: row.refundId, err: describeError(error) }, 'a refund step failed')
      waiting += 1
    }
  }
  return { sent, failed, readBack: readBackCount, waiting }
}

/** `payment-refund-tick`: sends and reads back Restro's own refunds, every minute. */
export function createPaymentRefundJob(deps: PaymentRefundDeps): JobDefinition {
  return defineJob({
    name: JOB_NAMES.paymentRefundTick,
    schedule: { cron: '* * * * *', tz: 'Europe/Sofia' },
    options: {
      queue: {
        retryLimit: 0,
        expireInSeconds: 120,
        retentionSeconds: 10 * 60,
        deleteAfterSeconds: 60 * 60,
      },
    },
    async handler(jobs, context) {
      const jobId = `payment-refund-${jobs[0]?.id ?? context.workerId}`
      const result = await runPaymentRefunds({ pool: context.pool, log: context.log, jobId }, deps)
      context.log.debug({ ...result }, JOB_NAMES.paymentRefundTick)
    },
  })
}
