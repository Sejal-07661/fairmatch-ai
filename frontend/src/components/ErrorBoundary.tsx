import { Component, type ReactNode } from "react";

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    console.error("[ErrorBoundary]", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm">An unexpected error occurred. Reloading the page may help.</p>
        <button
          type="button"
          className="mt-4 rounded bg-slate-900 px-3 py-2 text-white"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}
