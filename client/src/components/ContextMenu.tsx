import { useEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  /** Groups related actions under one expandable row instead of listing them
   *  flat (keeps a menu at or under the ~4-choice guideline — see design
   *  critique P2 on the calendar event menu). A parent item with children
   *  ignores its own onClick and toggles the sublist in place instead. */
  children?: ContextMenuItem[];
}

interface Props {
  x: number;
  y: number;
  /** Первая строка меню — не пункт, а подпись: чему именно принадлежат
   *  действия ниже. Нужна там, где по самой цели щелчка этого не видно —
   *  например, клетка мини-календаря показывает только число. */
  title?: string;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, title, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  // Меню открывается там, где щёлкнули, и у правого-нижнего края уезжало за
  // экран: на 375 px меню плитки доски (180 px) от кнопки «⋯» на 304 px просто
  // обрезалось. Замер после монтирования, а не расчёт по числу пунктов: высота
  // меняется и от раскрытого подменю тоже.
  const [at, setAt] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const nx = Math.max(pad, Math.min(x, window.innerWidth - r.width - pad));
    const ny = Math.max(pad, Math.min(y, window.innerHeight - r.height - pad));
    setAt((prev) => (prev.x === nx && prev.y === ny ? prev : { x: nx, y: ny }));
  }, [x, y, expanded, items]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ position: "fixed", left: at.x, top: at.y }}
    >
      {title && <div className="context-menu-title">{title}</div>}
      {items.map((item, i) =>
        item.children ? (
          <div key={i} className="context-menu-group">
            <button
              className={`context-menu-group-toggle${expanded === i ? " open" : ""}`}
              onClick={() => setExpanded(expanded === i ? null : i)}
            >
              {item.label} {expanded === i ? "▾" : "▸"}
            </button>
            {expanded === i && (
              <div className="context-menu-submenu">
                {item.children.map((child, j) => (
                  <button
                    key={j}
                    className={child.danger ? "danger" : ""}
                    onClick={() => {
                      child.onClick?.();
                      onClose();
                    }}
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            key={i}
            className={item.danger ? "danger" : ""}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
