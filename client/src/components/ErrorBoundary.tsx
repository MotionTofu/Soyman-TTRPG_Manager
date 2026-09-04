import { Component, type ReactNode } from "react";
import { SoyMan } from "./SoyMan";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{ padding: 32, maxWidth: 600, margin: "0 auto" }}>
          {/* decorative: заголовок ниже говорит то же самое. */}
          <SoyMan state="error" size="md" decorative />
          <h2 style={{ marginBottom: 12, marginTop: 12 }}>Что-то пошло не так</h2>
          <p className="muted" style={{ marginBottom: 16 }}>
            Произошла ошибка при отрисовке. Попробуйте перезагрузить страницу.
          </p>
          <pre style={{ fontSize: "var(--fs-meta)", color: "var(--muted)", whiteSpace: "pre-wrap", marginBottom: 16 }}>
            {this.state.error?.message}
          </pre>
          <button className="primary" onClick={() => window.location.reload()}>
            Перезагрузить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
