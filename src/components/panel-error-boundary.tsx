"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

type Props = {
  children: ReactNode;
  section?: string;
};

type State = {
  hasError: boolean;
  error: Error | null;
  retryKey: number;
};

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[PanelErrorBoundary] ${this.props.section ?? "unknown"} crashed:`,
      error,
      info.componentStack,
    );
  }

  handleRetry = () => {
    this.setState((s) => ({
      hasError: false,
      error: null,
      retryKey: s.retryKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      const label = this.props.section ?? "This section";
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
            <AlertTriangle className="h-6 w-6 text-red-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f7fa]">
              Something went wrong
            </h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-[#a8b0ba]">
              {label} encountered an unexpected error.
            </p>
          </div>
          {this.state.error && (
            <pre className="max-h-32 max-w-md overflow-y-auto rounded-md bg-stone-100 px-4 py-2 text-left text-xs text-stone-600 dark:bg-[#1a1d21] dark:text-[#7a8591]">
              {this.state.error.message}
            </pre>
          )}
          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex items-center gap-2 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 dark:bg-[#2a2f36] dark:hover:bg-[#353b44]"
          >
            <RotateCcw className="h-4 w-4" />
            Retry
          </button>
        </div>
      );
    }

    return <div key={this.state.retryKey} className="flex min-h-0 flex-1 flex-col">{this.props.children}</div>;
  }
}
