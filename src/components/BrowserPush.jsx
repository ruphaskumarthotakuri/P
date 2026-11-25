import { useEffect, useRef, useState } from 'react'

const supported = () => window.isSecureContext && 'PushManager' in window && 'Notification' in window && 'serviceWorker' in navigator

export async function unsubscribeBrowserPush(api) {
  if (!supported()) return
  const registration = await navigator.serviceWorker.getRegistration('/')
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  try {
    await api('/api/push/subscription', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }),
    })
  } finally {
    await subscription.unsubscribe()
  }
}

export default function BrowserPush({ api }) {
  const [publicKey, setPublicKey] = useState(null)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const registration = useRef(null)
  useEffect(() => {
    if (!supported()) return
    let active = true
    fetch('/api/push/config').then(response => response.json()).then(async config => {
      if (!active || !config.publicKey) return
      await navigator.serviceWorker.register('/push-worker.js')
      const worker = await navigator.serviceWorker.ready
      const subscription = await worker.pushManager.getSubscription()
      if (!active) return
      registration.current = worker
      setEnabled(Boolean(subscription))
      setPublicKey(config.publicKey)
    }).catch(() => { if (active) setError('Could not initialize browser notifications.') })
    return () => { active = false }
  }, [])

  async function toggle() {
    setBusy(true)
    setError('')
    let subscription
    try {
      if (enabled) {
        await unsubscribeBrowserPush(api)
        setEnabled(false)
      } else {
        if (await Notification.requestPermission() !== 'granted') throw new Error('Allow notifications in your browser settings to enable alerts.')
        subscription = await registration.current.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey })
        await api('/api/push/subscription', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription.toJSON()),
        })
        setEnabled(true)
      }
    } catch (failure) {
      if (subscription) await subscription.unsubscribe().catch(() => {})
      setError(failure.message)
      const current = await registration.current?.pushManager.getSubscription().catch(() => null)
      setEnabled(Boolean(current))
    } finally { setBusy(false) }
  }

  return <div className="browser-push-controls">
    <button className="empty-post-button" type="button" disabled={!publicKey || busy} onClick={toggle}>
      {enabled ? 'Turn off browser alerts' : 'Enable browser alerts'}
    </button>
    {!publicKey && !error && <small>Browser alerts are unavailable here.</small>}
    {error && <p role="alert">{error}</p>}
  </div>
}
