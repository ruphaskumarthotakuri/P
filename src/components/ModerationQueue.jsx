import { useEffect, useState } from 'react'

export default function ModerationQueue({ users, deleteUser }) {
  const [reports, setReports] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function load() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/admin/reports')
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load reports.')
      setReports(result.reports)
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  useEffect(() => { load() }, [])
  async function review(id, status) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/reports/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not update report.')
      setReports(current => current.map(report => report.id === id ? { ...report, status: result.report.status } : report))
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <section className="moderation-queue"><header><h2>Member reports</h2><button type="button" onClick={load} disabled={busy}>Reload reports</button></header>
    {error && <p role="alert">{error}</p>}
    {!reports.length && <p>{busy ? 'Loading reports…' : 'No reports.'}</p>}
    {reports.map(report => <article key={report.id}><header><strong>{report.member_name}</strong><span>{report.status}</span></header>
      <p>{report.reason}</p><small>Reported by {report.reporter_name} · {new Date(report.created_at).toLocaleString()}</small>
      {report.status === 'open' && <div className="member-tools">
        <button type="button" disabled={busy} onClick={() => review(report.id, 'resolved')}>Resolve</button>
        <button type="button" disabled={busy} onClick={() => review(report.id, 'dismissed')}>Dismiss</button>
        {users.some(user => user.id === report.member_id) && <button type="button" disabled={busy} onClick={() => deleteUser(users.find(user => user.id === report.member_id))}>Delete reported account</button>}
      </div>}
    </article>)}
  </section>
}
