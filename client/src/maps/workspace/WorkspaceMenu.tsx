import { useEffect, useRef, type ReactNode } from "react";

/** Native disclosure as a small menu: closes on an outside press, Escape and
 * any item marked `data-close`. */
export function WorkspaceMenu({ label, title, className, children }: { label: ReactNode; title: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { const menu = ref.current; if (menu?.open && !menu.contains(event.target as Node)) menu.open = false; };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const shut = () => { if (ref.current) ref.current.open = false; };
  return <details ref={ref} className={`workspace-menu ${className ?? ""}`}
    onKeyDown={(event) => { if (event.key === "Escape" && ref.current?.open) { event.stopPropagation(); shut(); ref.current.querySelector("summary")?.focus(); } }}
    onClick={(event) => { if ((event.target as HTMLElement).closest("[data-close]")) shut(); }}>
    <summary aria-label={title} title={title}>{label}</summary>
    <div className="workspace-menu-popup">{children}</div>
  </details>;
}
