self.addEventListener('push', event => {
  if (!event.data) return
  const { id, kind } = event.data.json()
  const messages = {
    follow: 'You have a new follower.',
    like: 'Someone liked your post.',
    comment: 'Someone commented on your post.',
  }
  if (!messages[kind]) return
  event.waitUntil(self.registration.showNotification('MinstryConnect', {
    body: messages[kind], tag: id, icon: '/minstryconnect-icon.svg', data: { id },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = new URL('/', self.location.origin)
  url.searchParams.set('notification', event.notification.data.id)
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => new URL(client.url).origin === url.origin)
    if (existing) {
      await existing.focus()
      existing.postMessage({ notificationId: event.notification.data.id })
    } else {
      await self.clients.openWindow(url.href)
    }
  })())
})
