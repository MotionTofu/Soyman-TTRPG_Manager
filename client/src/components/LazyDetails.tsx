import { useState, type CSSProperties, type ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  style?: CSSProperties;
  // Extra controls (e.g. a pop-out button) shown next to the title, inside
  // <summary>. Wrapped with preventDefault so clicking them doesn't also
  // toggle the <details> open/closed — that's the native browser behavior
  // for any click landing inside a <summary>.
  actions?: ReactNode;
}

// <details> doesn't unmount its children when collapsed — it just hides them
// via rendering, so a child's fetch-on-mount effect still fires immediately
// even if the user never opens the section. This wrapper delays rendering
// `children` until the section has been opened at least once (then keeps
// them mounted, so state/scroll position isn't lost on re-collapse).
export function LazyDetails({ title, children, className = "card stack", defaultOpen = false, style, actions }: Props) {
  const [opened, setOpened] = useState(defaultOpen);
  return (
    <details
      className={className}
      style={style}
      open={defaultOpen || undefined}
      onToggle={(e) => {
        if (e.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <strong className="entry-title">{title}</strong>
        {actions && (
          <span onClick={(e) => e.preventDefault()} style={{ display: "inline-flex" }}>
            {actions}
          </span>
        )}
      </summary>
      {opened && children}
    </details>
  );
}
