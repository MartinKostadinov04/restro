// What the notice route asks of a payment provider's folder (#108): its verifier (core's
// `ProviderNoticeVerifier`), whether this deployment takes its notices, and the endpoint's secret.
// Each `./<kind>/notices.ts` exports one as `noticeConnector`; `./notices.ts` finds them.
import type { ProviderNoticeVerifier } from '@restro/core'

/** The deployment environments a payment provider may run in (`PAYMENTS_ENV`). */
export const PAYMENTS_ENVS = ['development', 'test', 'staging', 'production'] as const

/** One deployment environment. */
export type PaymentsEnv = (typeof PAYMENTS_ENVS)[number]

/** The settings a provider's folder may read: the process's environment. */
export type NoticeEnv = Readonly<Record<string, string | undefined>>

/** A payment provider's notice side in the web app. */
export interface NoticeConnector extends ProviderNoticeVerifier {
  /** The provider's name as staff read it in a sentence ("…through Stripe"), for `{provider}`. */
  readonly displayName?: string
  /** False where this deployment must not take the provider's notices (the simulator in production). */
  offered(env: PaymentsEnv): boolean
  /** The endpoint's signing secret here, or null when none is set. Never logged. */
  secret(env: NoticeEnv): string | null
}

/** A setting's value, trimmed; empty counts as missing. */
export function setting(env: NoticeEnv, name: string): string | null {
  const value = env[name]?.trim()
  return value === undefined || value === '' ? null : value
}
