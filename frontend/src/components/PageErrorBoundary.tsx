import { Component, type ReactNode } from 'react'
import { Button } from './ui/button'

/** Only the failed page is replaced. The shell keeps navigation and the Plays session. */
export class PageErrorBoundary extends Component<{ children: ReactNode; resetKey?: string; onError?: () => void }, { failed: boolean; resetKey: string | undefined }> {
  state = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError() { return { failed: true } }
  static getDerivedStateFromProps(props: { resetKey?: string }, state: { resetKey: string | undefined }) {
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null
  }

  componentDidCatch() { this.props.onError?.() }

  render() {
    if (!this.state.failed) return this.props.children
    return <section className="workspace-alert" role="alert">
      <div><h2>This page could not be displayed.</h2>
        <p>Try again or choose another page. Some browser module errors require a reload. Reloading the browser discards unsaved work.</p>
        <Button variant="outline" onClick={() => this.setState({ failed: false })}>Try again</Button>
        <Button variant="ghost" onClick={() => window.location.reload()}>Reload browser</Button>
      </div>
    </section>
  }
}
