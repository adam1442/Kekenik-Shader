import { TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";
import { EmptyState } from "./Layout";

export interface ErrorBoundaryProps {
  /** Shown in the fallback ("<name> crashed"). */
  name: string;
  children: ReactNode;
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
}

/** Isolates a crashing subtree so the rest of the app keeps working. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[Kekenik Shader] "${this.props.name}" crashed`, error, info.componentStack);
    this.props.onError?.(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div data-kk="error-boundary-fallback" className="kk-selectable" style={{ height: "100%" }}>
        <EmptyState
          icon={TriangleAlert}
          title={`${this.props.name} crashed`}
          description={this.state.error.message}
          actions={
            <Button size="sm" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }
}
