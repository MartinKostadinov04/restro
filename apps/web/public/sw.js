// Restro's service worker: Web Push for staff devices, and nothing else (D120, D122 §7; RR-86).
//
// It has no `fetch` handler and caches nothing: guest pages read only published files (rule 4, D121)
// and it never touches a request. Tonight registers it for `/venues/` only, so a guest page is never
// in its scope. The worker's payload is `{ title, body, tag, url }` (apps/worker/src/alerts/deliver.ts).

/** Where a tap goes when the payload names nowhere it may go. */
const PANEL = '/venues'
/** Shown when a push can't be read: a push must always show something (`userVisibleOnly`). */
const UNREADABLE = { title: 'Restro', body: '', tag: 'restro-alert', url: PANEL }

function payloadOf(data) {
  try {
    const read = data.json()
    if (typeof read.title !== 'string' || read.title === '') return UNREADABLE
    return {
      title: read.title,
      body: typeof read.body === 'string' ? read.body : '',
      // `renotify` is refused on a notification with no tag.
      tag: typeof read.tag === 'string' && read.tag !== '' ? read.tag : UNREADABLE.tag,
      url: read.url,
    }
  } catch {
    return UNREADABLE
  }
}

/** A path of this origin to open, or the panel: a foreign address never opens from an alert. */
function samePath(url) {
  if (typeof url !== 'string') return PANEL
  try {
    const parsed = new URL(url, self.location.origin)
    if (parsed.origin !== self.location.origin) return PANEL
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return PANEL
  }
}

async function openPath(path) {
  // Only windows this worker controls: staff pages, never a guest's tab.
  const windows = await self.clients.matchAll({ type: 'window' })
  const same = windows.find((client) => client.url === `${self.location.origin}${path}`)
  if (same !== undefined) return same.focus()
  const first = windows[0]
  if (first !== undefined) {
    try {
      const focused = await first.focus()
      return await focused.navigate(path)
    } catch {
      // A window that can't be moved: open a new one below.
    }
  }
  return self.clients.openWindow(path)
}

// The new version takes over at once, and an open Tonight is controlled without a reload, so a tap
// finds that window.
self.addEventListener('install', () => {
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  const payload = payloadOf(event.data)
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      // An alert's 5-minute repeat shares its tag and must still buzz (RR-O29).
      renotify: true,
      icon: '/icons/icon-192.png',
      data: { url: samePath(payload.url) },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openPath(samePath(event.notification.data?.url)))
})
