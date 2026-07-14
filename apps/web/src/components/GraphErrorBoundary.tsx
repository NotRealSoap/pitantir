"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/** Keeps account page usable if the canvas graph fails to load. */
export class GraphErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Ownership graph failed", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <p className="alert" role="status">
            Graph failed to render. The list and timeline below still work — try a hard refresh
            after <code>rm -rf apps/web/.next</code>.
          </p>
        )
      );
    }
    return this.props.children;
  }
}
