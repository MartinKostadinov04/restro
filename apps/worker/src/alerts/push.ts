// Web Push to an installed staff device (#83; D120, D122 §7), with the `web-push` package, which
// does the RFC 8291 payload encryption and the VAPID signature (RFC 8292). Staff devices only: a
// guest's push identifier is never stored (D122 §7). The payload is a title and a short line (the
// alert's words, which carry no note and no guest data) and a path the tap opens.

import webpush from 'web-push'

import type { VapidKeys } from '../config'

/** What the sender needs of the `web-push` module; tests pass their own. */
export interface WebPushModule {
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: Record<string, unknown>,
  ): Promise<{ statusCode: number }>
}

/** A device as the table keeps it. */
export interface DeviceSubscription {
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
}

/** What the notification shows, and where a tap goes. */
export interface PushPayload {
  readonly title: string
  readonly body: string
  /** Collapses a newer push of the same venue and kind over an older one still on the device. */
  readonly tag: string
  /** The path a tap opens. */
  readonly url: string
}

/** How a push went: `gone` when the push service no longer knows the device (404 or 410). */
export type PushOutcome = 'sent' | 'gone' | 'failed'

/** What the delivery needs of the push side. */
export interface PushSender {
  send(device: DeviceSubscription, payload: PushPayload): Promise<PushOutcome>
}

/** How long the push service may hold a push for a device that is off: alerts go stale fast. */
const TTL_SECONDS = 600

/** A topic the push service may replace an older waiting push with: `[A-Za-z0-9_-]`, 32 at most. */
function topicOf(tag: string): string {
  return tag.replace(/[^A-Za-z0-9_-]/g, '_').slice(-32)
}

/** The sender for this Restro's VAPID identity. */
export function createPushSender(options: {
  readonly vapid: VapidKeys
  readonly module?: WebPushModule
}): PushSender {
  const module: WebPushModule = options.module ?? webpush
  const vapidDetails = {
    subject: options.vapid.subject,
    publicKey: options.vapid.publicKey,
    privateKey: options.vapid.privateKey,
  }
  return {
    async send(device, payload) {
      try {
        await module.sendNotification(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          JSON.stringify(payload),
          { vapidDetails, TTL: TTL_SECONDS, urgency: 'high', topic: topicOf(payload.tag) },
        )
        return 'sent'
      } catch (error) {
        const status = (error as { statusCode?: unknown }).statusCode
        return status === 404 || status === 410 ? 'gone' : 'failed'
      }
    },
  }
}
