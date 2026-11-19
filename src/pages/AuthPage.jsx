import Brand from '../components/Brand.jsx'
import FormField from '../components/FormField.jsx'

export default function AuthPage({ app }) {
  const { isSignup, setMode, setNotice, name, setName, email, setEmail, signupPhone, setSignupPhone, password, setPassword, handleSubmit, sendPasswordReset, notice, busy, isSupabaseConfigured, setAdminView, setAdminNotice } = app
  return (
    <main className="page">
      <section className="form-panel">
        <Brand full />
        <h1>{isSignup ? 'Create an account' : 'Sign in'}</h1>
        <p className="subtitle">{isSignup ? 'Enter your details to get started.' : 'Enter your email and password.'}</p>
        <div className="mode-switch">
          <button className={!isSignup ? 'selected' : ''} type="button" onClick={() => { setMode('login'); setNotice(null) }}>Sign in</button>
          <button className={isSignup ? 'selected' : ''} type="button" onClick={() => { setMode('signup'); setNotice(null) }}>Sign up</button>
        </div>
        <form onSubmit={handleSubmit}>
          {isSignup && <FormField label="Name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={120} required />}
          <FormField label="Email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required />
          {isSignup && <FormField label="Phone number" type="tel" autoComplete="tel" value={signupPhone} onChange={event => setSignupPhone(event.target.value)} maxLength={20} placeholder="+91 98765 43210" required />}
          <FormField label="Password" type="password" autoComplete={isSignup ? 'new-password' : 'current-password'} minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required />
          {!isSignup && <button className="link-button" type="button" onClick={sendPasswordReset}>Forgot password?</button>}
          {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}</button>
        </form>
        {!isSupabaseConfigured && <p className="setup-hint">Add your Supabase URL and publishable key to .env.</p>}
        <button className="link-button admin-link" type="button" onClick={() => { setAdminView(true); setAdminNotice(null) }}>Admin sign in</button>
      </section>
    </main>
  )
}
