import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * App-level error boundary. A render-time crash anywhere in the tree shows a
 * warm, recoverable fallback instead of a blank white screen — important for a
 * PWA people open on their phones. Resetting reloads the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface in the console for debugging; no third-party tracking by design.
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.assign('/');
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-dvh flex items-center justify-center bg-parchment px-6 pt-safe pb-safe">
          <div className="max-w-md text-center">
            <p className="eyebrow mb-4">Something slipped</p>
            <h1 className="font-display italic text-ink-900 text-3xl leading-tight mb-4">
              We lost the thread for a moment.
            </h1>
            <p className="text-ink-600 leading-relaxed mb-8">
              The app hit an unexpected snag. Your data is safe — reloading
              usually sets things right.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center justify-center rounded-full bg-terracotta-600 text-cream px-6 py-3 font-medium shadow-paper hover:shadow-letter transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            >
              Reload Pod Life
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
