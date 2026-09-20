import { useState, type CSSProperties, type ReactNode } from "react";
import { usePultGridForceOpen } from "../pultForceOpen";

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
  // Класс-маркер на <summary> — ручка драга для сетки пульта.
  summaryClassName?: string;
}

// <details> doesn't unmount its children when collapsed — it just hides them
// via rendering, so a child's fetch-on-mount effect still fires immediately
// even if the user never opens the section. This wrapper delays rendering
// `children` until the section has been opened at least once (then keeps
// them mounted, so state/scroll position isn't lost on re-collapse).
export function LazyDetails({ title, children, className = "card stack", defaultOpen = false, style, actions, summaryClassName }: Props) {
  const forceOpen = usePultGridForceOpen();
  const [opened, setOpened] = useState(defaultOpen || forceOpen);
  return (
    <details
      className={`${className} lazy-details`}
      style={style}
      open={defaultOpen || forceOpen || undefined}
      onToggle={(e) => {
        if (e.currentTarget.open) setOpened(true);
      }}
    >
      <summary
        className={`row${summaryClassName ? ` ${summaryClassName}` : ""}`}
        style={{ justifyContent: "space-between", alignItems: "center" }}
        // В сетке раскрыто навсегда: клик по шапке схлопывал бы виджет,
        // который только что мерили. Кнопки внутри работают как раньше.
        onClick={forceOpen ? (e) => e.preventDefault() : undefined}
      >
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
