import { Component } from 'react'

export default class AppErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Northstar page render failed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="page error-page">
        <section className="error-card" role="alert">
          <h1>This page could not load</h1>
          <p>{this.state.error.message || 'An unexpected error occurred.'}</p>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>Reload page</button>
        </section>
      </main>
    )
  }
}
