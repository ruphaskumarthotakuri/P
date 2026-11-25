import { timingSafeEqual } from 'node:crypto'
import { sendNotification } from 'web-push'

const pushHosts = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/
const validId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function registerBrowserPush(app, database, getMember) {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_WEBHOOK_SECRET } = process.env
  const configured = Boolean(database && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT && PUSH_WEBHOOK_SECRET)
  const vapidDetails = { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY }

  app.get('/api/push/config', (_req, res) => res.json({ publicKey: configured ? VAPID_PUBLIC_KEY : null }))

  for (const method of ['put', 'delete']) {
    app[method]('/api/push/subscription', async (req, res) => {
      if (!configured) return res.status(503).json({ error: 'Browser notifications are unavailable.' })
      try {
        const user = await getMember(req)
        if (!user) return res.status(401).json({ error: 'Sign in to manage notifications.' })
        const { endpoint, keys } = req.body || {}
        if (typeof endpoint !== 'string' || endpoint.length > 2048 || !URL.canParse(endpoint)) {
          return res.status(400).json({ error: 'Invalid push subscription.' })
        }
        const url = new URL(endpoint)
        if (url.protocol !== 'https:' || url.port || url.username || url.password || !pushHosts.test(url.hostname)) {
          return res.status(400).json({ error: 'This browser push provider is unsupported.' })
        }
        if (method === 'put' && (!/^[\w-]{87}$/.test(keys?.p256dh) || !/^[\w-]{22}$/.test(keys?.auth))) {
          return res.status(400).json({ error: 'Invalid push subscription keys.' })
        }
        const table = database.from('browser_push_subscriptions')
        const { error } = await (method === 'put'
          ? table.upsert({ endpoint, user_id: user.id, keys: { p256dh: keys.p256dh, auth: keys.auth } })
          : table.delete().eq('endpoint', endpoint).eq('user_id', user.id))
        if (error) throw error
        return res.sendStatus(204)
      } catch {
        return res.status(503).json({ error: 'Could not save browser notification settings.' })
      }
    })
  }

  app.post('/api/push/deliver', async (req, res) => {
    if (!configured) return res.sendStatus(503)
    const expected = Buffer.from(PUSH_WEBHOOK_SECRET)
    const supplied = Buffer.from(req.get('x-push-secret') || '')
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return res.sendStatus(401)
    const id = req.body?.record?.id
    if (typeof id !== 'string' || !validId.test(id)) return res.sendStatus(400)
    try {
      const { data: item, error } = await database.from('notifications').select('recipient_id, actor_id, kind, read_at').eq('id', id).maybeSingle()
      if (error) throw error
      if (!item || item.read_at || !['follow', 'like', 'comment'].includes(item.kind)) return res.sendStatus(204)
      if (item.actor_id) {
        const blocked = await database.rpc('members_blocked', { first_id: item.recipient_id, second_id: item.actor_id })
        if (blocked.error) throw blocked.error
        if (blocked.data) return res.sendStatus(204)
      }
      const subscriptions = await database.from('browser_push_subscriptions').select('endpoint, keys').eq('user_id', item.recipient_id).limit(50)
      if (subscriptions.error) throw subscriptions.error
      const payload = JSON.stringify({ id, kind: item.kind })
      const deliveries = await Promise.allSettled(subscriptions.data.map(async subscription => {
        try {
          await sendNotification(subscription, payload, { vapidDetails, TTL: 300, timeout: 8000 })
        } catch (error) {
          if (![404, 410].includes(error.statusCode)) throw error
          const removed = await database.from('browser_push_subscriptions').delete().eq('endpoint', subscription.endpoint).eq('user_id', item.recipient_id)
          if (removed.error) throw removed.error
        }
      }))
      return res.sendStatus(deliveries.some(result => result.status === 'rejected') ? 502 : 204)
    } catch {
      return res.sendStatus(503)
    }
  })
}
