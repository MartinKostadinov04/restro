// This browser's side of Web Push (RR-86, D120): what it can do, its subscription and the keys the
// server needs. The only file that registers the service worker; only Tonight's control uses it,
// so a guest page never does. The scope is the staff pages alone.

const WORKER_URL = '/sw.js'
const WORKER_SCOPE = '/venues/'

/** What this browser can do about push before anyone asks it to. */
export type PushAvailability = 'ready' | 'install_first' | 'unsupported'

/** iPhone and iPad; an iPad's Safari says it is a Mac, and only its touch points tell. */
function isAppleMobile(nav: Navigator): boolean {
  return (
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  )
}

/** iOS gives push only to an app added to the Home Screen, and shows it no push API before that. */
export function pushAvailability(win: Window = window): PushAvailability {
  const nav = win.navigator
  const installed =
    (nav as Navigator & { standalone?: boolean }).standalone === true ||
    win.matchMedia('(display-mode: standalone)').matches
  if (isAppleMobile(nav) && !installed) return 'install_first'
  return 'serviceWorker' in nav && 'PushManager' in win && 'Notification' in win
    ? 'ready'
    : 'unsupported'
}

/** The bytes of a base64url key, as `pushManager.subscribe` takes them. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const binary = atob(
    `${key}${'='.repeat((4 - (key.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/'),
  )
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** False when the subscription was made with another key: pushes under this key would be refused. */
function madeWithKey(subscription: PushSubscription, key: string): boolean {
  const used = subscription.options?.applicationServerKey
  if (used === null || used === undefined) return true
  const a = new Uint8Array(used)
  const b = keyBytes(key)
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

async function subscribeWith(registration: ServiceWorkerRegistration, key: string) {
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(key),
  })
}

/**
 * The subscription this browser holds now, or null. One made under an older key is replaced, so a
 * new key pair doesn't silently stop a device.
 */
export async function currentSubscription(key: string): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(WORKER_SCOPE)
  const held = (await registration?.pushManager.getSubscription()) ?? null
  if (registration === undefined || held === null || madeWithKey(held, key)) return held
  await held.unsubscribe()
  return subscribeWith(registration, key)
}

/** Registers the worker and subscribes this browser; the permission was already granted. */
export async function subscribeDevice(key: string): Promise<PushSubscription> {
  await navigator.serviceWorker.register(WORKER_URL, { scope: WORKER_SCOPE })
  // `subscribe` needs an active worker, and a fresh one isn't yet.
  const registration = await navigator.serviceWorker.ready
  const held = await registration.pushManager.getSubscription()
  if (held !== null && madeWithKey(held, key)) return held
  await held?.unsubscribe()
  return subscribeWith(registration, key)
}

/** What `push.subscribe` stores, from what the browser's `toJSON()` gives; null if it gave less. */
export function deviceOf(subscription: PushSubscription) {
  const { endpoint, keys } = subscription.toJSON()
  const { p256dh, auth } = keys ?? {}
  if (endpoint === undefined || p256dh === undefined || auth === undefined) return null
  return { endpoint, p256dh, auth }
}
