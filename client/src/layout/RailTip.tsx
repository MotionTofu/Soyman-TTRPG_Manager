import { useState, type FocusEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";

// Подпись-«язычок» у значка узкой панели (гриллинг 2026-10-23, Q14): выезжает
// сразу, без секундной задержки браузерного title. Одна на панель, по
// делегированию: текст берётся из data-tip, иначе из aria-label или самой
// подписи пункта — у узкого меню она в разметке осталась, её только не видно.
// Рисуется в body: колонка панели режет всё, что за неё выступает.
const TARGET = "a, button, [data-tip]";

export function useRailTip(enabled: boolean, side: "right" | "left") {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  function show(e: MouseEvent | FocusEvent) {
    const el = (e.target as Element).closest?.<HTMLElement>(TARGET);
    if (!el || !e.currentTarget.contains(el)) return setTip(null);
    const text = (el.dataset.tip ?? el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
    if (!text) return setTip(null);
    const r = el.getBoundingClientRect();
    setTip({ text, x: side === "right" ? r.right + 8 : r.left - 8, y: r.top + r.height / 2 });
  }
  const hide = () => setTip(null);

  const handlers = enabled
    ? { onMouseOver: show, onMouseLeave: hide, onFocus: show, onBlur: hide, onClick: hide }
    : {};
  const node =
    enabled && tip
      ? createPortal(
          <div className={`rail-tip rail-tip--${side}`} style={{ left: tip.x, top: tip.y }} role="presentation">
            {tip.text}
          </div>,
          document.body,
        )
      : null;
  return { handlers, node };
}
