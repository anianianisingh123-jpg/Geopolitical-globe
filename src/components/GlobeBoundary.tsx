import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { onError: (err: Error) => void; children: ReactNode };
type State = { failed: boolean };

/** Any throw inside the lazy globe (chunk load, WebGL context) drops to the table fallback. */
export class GlobeBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
