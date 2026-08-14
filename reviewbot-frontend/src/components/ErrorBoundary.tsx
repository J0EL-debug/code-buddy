import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Use for a top-level boundary (wraps the whole app) - shows a full-page
   * message with a reload button, since "Try again" alone may not recover
   * from a crash that corrupted app-wide state. */
  fullPage?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time exceptions in its subtree and shows a recoverable
 * message instead of leaving the whole page blank. React itself doesn't
 * recover automatically from a thrown render error, so without this, any
 * unexpected data shape (e.g. from a zip upload with unusual content)
 * would blank the entire app instead of just failing gracefully.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const containerClass = this.props.fullPage
        ? 'flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center'
        : 'mx-auto max-w-2xl px-4 py-16 text-center';

      return (
        <div className={containerClass}>
          <p className="font-display text-lg font-semibold text-foreground">
            {this.props.fullPage ? 'Something went wrong' : 'Something went wrong displaying this'}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{this.state.error.message}</p>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => this.setState({ error: null })}
              className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              Try again
            </button>
            {this.props.fullPage && (
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-secondary/40"
              >
                Reload page
              </button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
