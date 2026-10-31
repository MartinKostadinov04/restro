import { createECDH, randomBytes } from 'node:crypto'
import { PushSubscribeSchema } from '@restro/core/service'
import type { DbPool } from '@restro/db'
import { describe, expect, it } from 'vitest'
import webpush from 'web-push'

import { deliverAlerts } from './deliver'
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

describe('a real browser subscription (RR-86)', () => {
  // What `web-push` builds before it sends: it encrypts and signs, with no network. Not in the
  // worker's own typing, which names only what the worker calls.
  const real = webpush as unknown as {
    generateVAPIDKeys(): { publicKey: string; privateKey: string }
    generateRequestDetails(
      subscription: unknown,
      payload: string,
      options: Record<string, unknown>,
    ): { method: string; headers: Record<string, unknown>; endpoint: string; body: Buffer }
  }

  /** The shape of `subscription.toJSON()`, with real keys: a P-256 point and 16 random bytes. */
  function browserSubscription() {
    const ecdh = createECDH('prime256v1')
    return {
      endpoint: 'https://fcm.googleapis.com/fcm/send/dGVzdC1lbmRwb2ludA:APA91bH-test',
      expirationTime: null,
      keys: {
        p256dh: ecdh.generateKeys().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
    }
  }

  it('passes the server action’s schema and the worker’s real `web-push` call', async () => {
    const json = browserSubscription()
    const stored = PushSubscribeSchema.parse({
      type: 'push.subscribe',
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    })
    const vapid = { ...real.generateVAPIDKeys(), subject: 'mailto:ops@restro.example' }
    const built: { endpoint: string; headers: Record<string, unknown>; body: Buffer }[] = []
    const sender = createPushSender({
      vapid,
      module: {
        async sendNotification(subscription, payload, options) {
          built.push(real.generateRequestDetails(subscription, payload, options))
          return { statusCode: 201 }
        },
      },
    })
    expect(await sender.send(stored, PAYLOAD)).toBe('sent')
    expect(built[0]?.endpoint).toBe(json.endpoint)
    expect(built[0]?.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', Urgency: 'high' })
    expect(String(built[0]?.headers.Authorization)).toContain(`k=${vapid.publicKey}`)
    expect(built[0]?.body.length).toBeGreaterThan(JSON.stringify(PAYLOAD).length)
  })

  it('a key that is not a real point never reaches the push service: the send says failed', async () => {
    const sender = createPushSender({ vapid: realVapid(), module: builtOnly() })
    expect(await sender.send(SUBSCRIPTION, PAYLOAD)).toBe('failed')
  })

  function realVapid() {
    return { ...real.generateVAPIDKeys(), subject: 'mailto:ops@restro.example' }
  }
  function builtOnly(): WebPushModule {
    return {
      async sendNotification(subscription, payload, options) {
        real.generateRequestDetails(subscription, payload, options)
        return { statusCode: 201 }
      },
    }
  }
})

describe('the delivery with no VAPID keys and no bot token', () => {
  it('sends nothing and throws nothing, without even reading the database', async () => {
    const untouched = new Proxy(
      {},
      {
        get() {
          throw new Error('the pool was read')
        },
      },
    ) as DbPool
    const sent = await deliverAlerts({
      pool: untouched,
      log: { warn: () => undefined, error: () => undefined },
      now: () => new Date(),
      push: null,
      telegram: null,
      teamChatId: null,
    })
    expect(sent).toBe(0)
  })
})
