import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../design/ui';

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] screen render failed', error.message, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="center-screen" role="alert">
        <div className="onboard" style={{ maxWidth: 440 }}>
          <h1 className="onboard__title">Watai couldn’t load this screen</h1>
          <p className="onboard__sub">Your saved drafts and active work are still preserved. Reload to try the screen again.</p>
          <div className="onboard__actions">
            <Button variant="primary" full onClick={() => window.location.reload()}>Reload Watai</Button>
          </div>
        </div>
      </main>
    );
  }
}