import { describe, expect, it } from 'vitest'

import { createPushSender, type WebPushModule } from './push'

const VAPID = {
  publicKey: `B${'p'.repeat(86)}`,
  privateKey: 'q'.repeat(43),
  subject: 'mailto:ops@restro.example',
}
const SUBSCRIPTION = {
  endpoint: 'https://push.example.test/send/abc',
  p256dh: 'B'.repeat(87),
  auth: 'a'.repeat(22),
}
const PAYLOAD = {
  title: 'Ordering is paused at Club Nova',
  body: '',
  tag: 'vn_1:ordering_paused',
  url: '/',
}

function fakeModule(outcome: () => Promise<unknown>) {
  const sent: { subscription: unknown; payload: string; options: Record<string, unknown> }[] = []
  const module: WebPushModule = {
    async sendNotification(subscription, payload, options) {
      sent.push({ subscription, payload, options: options as Record<string, unknown> })
      await outcome()
      return { statusCode: 201 }
    },
  }
  return { module, sent }
}

describe('the Web Push sender', () => {
  it('encrypts and sends a JSON payload under Restro’s own VAPID identity', async () => {
    const { module, sent } = fakeModule(async () => undefined)
    const sender = createPushSender({ vapid: VAPID, module })
    expect(await sender.send(SUBSCRIPTION, PAYLOAD)).toBe('sent')
    expect(sent[0]?.subscription).toEqual({
      endpoint: SUBSCRIPTION.endpoint,
      keys: { p256dh: SUBSCRIPTION.p256dh, auth: SUBSCRIPTION.auth },
    })
    expect(JSON.parse(sent[0]?.payload as string)).toEqual(PAYLOAD)
    expect(sent[0]?.options).toMatchObject({
      vapidDetails: {
        subject: VAPID.subject,
        publicKey: VAPID.publicKey,
        privateKey: VAPID.privateKey,
      },
      urgency: 'high',
      TTL: 600,
      topic: expect.stringMatching(/^[A-Za-z0-9_-]{1,32}$/),
    })
  })

  it.each([404, 410])(
    'says a device is gone when the push service answers %i',
    async (statusCode) => {
      const { module } = fakeModule(async () => {
        throw Object.assign(new Error('gone'), { statusCode })
      })
      expect(await createPushSender({ vapid: VAPID, module }).send(SUBSCRIPTION, PAYLOAD)).toBe(
        'gone',
      )
    },
  )

  it('says failed for any other trouble, and keeps the endpoint out of the error', async () => {
    const { module } = fakeModule(async () => {
      throw Object.assign(new Error(`boom ${SUBSCRIPTION.endpoint}`), { statusCode: 500 })
    })
    const sender = createPushSender({ vapid: VAPID, module })
    expect(await sender.send(SUBSCRIPTION, PAYLOAD)).toBe('failed')
  })
})
