import { unsubscribeBrowserPush } from './BrowserPush.jsx'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function ScrollMore({ hasMore, busy, loadMore }) {
  const target = useRef(null)
  useEffect(() => {
    if (!hasMore || busy || !target.current) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore()
    }, { rootMargin: '120px' })
    observer.observe(target.current)
    return () => observer.disconnect()
  }, [hasMore, busy, loadMore])
  return hasMore ? <div ref={target} role="status" className="feed-scroll-sentinel">{busy ? 'Loading…' : ''}</div> : null
}

export function EditActions({ item, kind, onSave, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(action) {
    setBusy(true)
    setError('')
    try { await action(); setEditing(false) } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <div className="member-tools">
    {editing ? <form onSubmit={event => { event.preventDefault(); run(() => onSave(item, kind, value)) }}>
      <textarea aria-label={kind === 'post' ? 'Edit caption' : 'Edit comment'} value={value} maxLength={kind === 'post' ? 2000 : 1000} required={kind === 'comment'} onChange={event => setValue(event.target.value)} />
      <button disabled={busy}>Save</button><button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
    </form> : <><button type="button" disabled={busy} onClick={() => { setValue(kind === 'post' ? item.caption : item.content); setEditing(true) }}>Edit</button>
      <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete this ${kind} permanently?`)) run(() => onDelete(item, kind)) }}>Delete</button></>}
    {error && <p role="alert">{error}</p>}
  </div>
}

export function MemberSearch({ api, openProfile }) {
  const [query, setQuery] = useState('')
  const [members, setMembers] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    setMembers([])
    setError('')
    if (query.trim().length < 2) { setBusy(false); return }
    setBusy(true)
    const timer = setTimeout(async () => {
      try {
        const result = await api(`/api/members/search?q=${encodeURIComponent(query.trim())}`)
        if (active) setMembers(result.members)
      } catch (failure) { if (active) setError(failure.message) }
      finally { if (active) setBusy(false) }
    }, 300)
    return () => { active = false; clearTimeout(timer) }
  }, [query, api])
  return <section className="member-search-panel"><label className="member-search-input"><span className="sr-only">Find members</span><Search size={17} aria-hidden="true" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search members" /></label>
    {query.trim().length >= 2 && <div className="member-search-results" aria-label="Member search results">
    {busy && <p role="status">Searching…</p>}{error && <p role="alert">{error}</p>}
    {!busy && query.trim().length >= 2 && !members.length && !error && <p>No members found.</p>}
    {members.map(member => <button type="button" key={member.user_id} onClick={() => { setQuery(''); openProfile(member.user_id) }}><strong>{member.full_name || 'Member'}</strong><span>{member.location}</span></button>)}
    </div>}
  </section>
}

export function AccountSettings({ api, supabase, user, notify }) {
  const [password, setPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [blocks, setBlocks] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api('/api/members/blocks').then(result => { if (active) setBlocks(result.members) })
      .catch(failure => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [api])
  async function run(action, message) {
    setBusy(true)
    setError('')
    try { await action(); if (message) notify({ kind: 'success', text: message }) }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <section className="account-settings"><h2>Account and privacy</h2>
    <form onSubmit={event => { event.preventDefault(); run(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })
      if (error) throw error
      const updated = await supabase.auth.updateUser({ password })
      if (updated.error) throw updated.error
      setPassword(''); setCurrentPassword('')
    }, 'Password updated.') }}>
      <label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label>
      <label>New password<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required /></label>
      <button disabled={busy}>Change password</button>
    </form>
    <h3>Sessions</h3><p>Signed in as {user.email} on this browser.</p>
    <button type="button" disabled={busy} onClick={() => run(async () => { const { error } = await supabase.auth.signOut({ scope: 'others' }); if (error) throw error }, 'Other sessions signed out.')}>Sign out other sessions</button>
    <button type="button" disabled={busy} onClick={() => run(async () => { await unsubscribeBrowserPush(api).catch(() => {}); const { error } = await supabase.auth.signOut({ scope: 'global' }); if (error) throw error })}>Sign out all sessions</button>
    <h3>Blocked members</h3>{!blocks.length && <p>No blocked members.</p>}
    {blocks.map(member => <div key={member.user_id}>{member.full_name || 'Member'} <button type="button" disabled={busy} onClick={() => run(async () => {
      await api(`/api/members/${member.user_id}/block`, { method: 'DELETE' })
      setBlocks(current => current.filter(item => item.user_id !== member.user_id))
    }, 'Member unblocked.')}>Unblock</button></div>)}
    <h3>Delete account</h3><p>This permanently removes your account, posts, comments, and photos.</p>
    <form onSubmit={event => { event.preventDefault(); if (window.confirm('Permanently delete your account and photos?')) run(async () => {
      await api('/api/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation, password: currentPassword }) })
      await supabase.auth.signOut({ scope: 'local' })
      window.location.reload()
    }) }}>
      <label>Confirm your password<input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label>
      <label>Type DELETE<input value={confirmation} onChange={event => setConfirmation(event.target.value)} pattern="DELETE" required /></label>
      <button disabled={busy || confirmation !== 'DELETE'}>Delete my account</button>
    </form>{error && <p role="alert">{error}</p>}
  </section>
}
