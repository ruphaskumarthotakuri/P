import Brand from '../components/Brand.jsx'
import FormField from '../components/FormField.jsx'

export default function AdminLoginPage({ app }) {
  const { adminEmail, setAdminEmail, adminPassword, setAdminPassword, adminNotice, adminBusy, handleAdminLogin, setAdminView, setAdminNotice } = app
  return (
    <main className="page">
      <section className="form-panel">
        <Brand full />
        <h1>Admin sign in</h1>
        <p className="subtitle">Sign in to view user profiles.</p>
        <form onSubmit={handleAdminLogin}>
          <FormField label="Admin email" autoComplete="username" value={adminEmail} onChange={event => setAdminEmail(event.target.value)} required />
          <FormField label="Password" type="password" autoComplete="current-password" value={adminPassword} onChange={event => setAdminPassword(event.target.value)} required />
          {adminNotice && <p className={`notice ${adminNotice.kind}`} role="status">{adminNotice.text}</p>}
          <button className="primary-button" type="submit" disabled={adminBusy}>{adminBusy ? 'Please wait…' : 'Sign in'}</button>
        </form>
        <button className="link-button" type="button" onClick={() => { setAdminView(false); setAdminNotice(null) }}>Back to user sign in</button>
      </section>
    </main>
  )
}
