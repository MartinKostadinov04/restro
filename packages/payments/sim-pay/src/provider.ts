// The payment provider over the simulated engine (#103; D127 §Interfaces): the first
// implementation of the seam, so the platform's paying route can be built and tested before a
// real provider is wired. Every request is parsed with the seam's schemas first: a malformed
// request is a bug in the platform and throws, never a guess.

import {
  CaptureRequestSchema,
  CreateHoldRequestSchema,
  PaymentIdSchema,
  type PaymentProvider,
  PrepareDomainRequestSchema,
  ProviderNoticeSchema,
  ProviderRefSchema,
  ReleaseRequestSchema,
  StartConnectionRequestSchema,
} from '@restro/core'
import type { SimPayEngine } from './engine'
import { checkSimPayEnv } from './env'

/** The provider kind (`payments.provider_kind`, `apps/web/src/connectors/sim-pay/`). */
export const SIM_PAY_KIND = 'sim-pay'

export interface SimPayProviderOptions {
  /** The deployment's environment: production is refused (`SimPayNotAllowedError`). */
  readonly env: string
  readonly engine: SimPayEngine
}

/** The simulated provider. Throws `SimPayNotAllowedError` in production. */
export function createSimPayProvider(options: SimPayProviderOptions): PaymentProvider {
  checkSimPayEnv(options.env)
  const { engine } = options
  const { switches } = engine
  return {
    kind: SIM_PAY_KIND,
    capabilities: {
      holdDays: switches.holdDays,
      partialCapture: switches.partialCapture,
      wallets: switches.wallets,
      refundNotices: switches.refundNotices,
      minimumMinor: (currency) => switches.minimumMinor[currency],
    },
    startConnection: async (request) =>
      engine.startConnection(StartConnectionRequestSchema.parse(request)),
    readConnection: async (accountRef) =>
      engine.readConnection(ProviderRefSchema.parse(accountRef)),
    prepareDomain: async (request) =>
      engine.prepareDomain(PrepareDomainRequestSchema.parse(request)),
    createHold: async (request) => engine.createHold(CreateHoldRequestSchema.parse(request)),
    findByPaymentId: async (accountRef, paymentId) =>
      engine.findByPaymentId(ProviderRefSchema.parse(accountRef), PaymentIdSchema.parse(paymentId)),
    readPayment: async (accountRef, paymentRef) =>
      engine.readPayment(ProviderRefSchema.parse(accountRef), ProviderRefSchema.parse(paymentRef)),
    readNoticeSubject: async (accountRef, notice) =>
      engine.readNoticeSubject(
        ProviderRefSchema.parse(accountRef),
        ProviderNoticeSchema.parse(notice),
      ),
    readRefunds: async (accountRef, paymentRef) =>
      engine.readRefunds(ProviderRefSchema.parse(accountRef), ProviderRefSchema.parse(paymentRef)),
    capture: async (request) => engine.capture(CaptureRequestSchema.parse(request)),
    release: async (request) => engine.release(ReleaseRequestSchema.parse(request)),
  }
}
