import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Last-resort UI error boundary so a UI exception never leaves a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="fatal">
          <h1>Freeski crashed (the app, not you)</h1>
          <p>{this.state.error.message}</p>
          <button className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
