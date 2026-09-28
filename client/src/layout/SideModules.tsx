import { Fragment, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import "./SideModules.css";
import { saveSideLayout, type SideLayout } from "./sideLayout";

// Модули правой панели (гриллинг 2026-09-28, Q41, Q48): поиск, трекер или
// мешок, лента идущей сессии, закреплённые страницы. Порядок задан, таскать
// модули нельзя. Щелчок по названию сворачивает модуль в плашку — плашки
// стопкой внизу, как у левого дока. Между развёрнутыми — ползунок высоты;
// двойной щелчок по нему возвращает высоты по умолчанию.
//
// Один модуль «резиновый»: забирает остаток высоты (лента, пока сессия
// идёт). Остальные — по содержимому, пока их не потянули ползунком.

export type SideModuleId = "search" | "tracker" | "bag" | "chat" | "pins";

export interface SideModule {
  id: SideModuleId;
  title: string;
  node: ReactNode;
  /** Ниже не сжимается: у ленты поле ввода не должно уезжать. */
  minHeight?: number;
}

const MIN_HEIGHT = 60;

export function SideModules({
  modules,
  layout,
  setLayout,
  flexId,
}: {
  modules: SideModule[];
  layout: SideLayout;
  setLayout: (update: (prev: SideLayout) => SideLayout) => void;
  flexId: SideModuleId | null;
}) {
  const refs = useRef(new Map<SideModuleId, HTMLDivElement>());
  const expanded = modules.filter((m) => !layout.collapsed.includes(m.id));
  const collapsed = modules.filter((m) => layout.collapsed.includes(m.id));
  // Резиновый — только лента: пустой поиск, растянутый на всю высоту, —
  // дыра посреди панели. Без ленты модули по содержимому, плашки — внизу.
  const flex = flexId != null && expanded.some((m) => m.id === flexId) ? flexId : null;

  function expand(id: SideModuleId) {
    setLayout((prev) => {
      const next = { ...prev, collapsed: prev.collapsed.filter((c) => c !== id) };
      saveSideLayout(next);
      return next;
    });
  }

  // Тянется тот из пары, что не резиновый: у резинового высоты нет, он — остаток.
  function startDrag(e: ReactPointerEvent<HTMLDivElement>, above: SideModuleId, below: SideModuleId) {
    const target = above !== flex ? above : below;
    const sign = target === above ? 1 : -1;
    const el = refs.current.get(target);
    if (!el) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = el.getBoundingClientRect().height;
    let last: SideLayout | null = null;
    const move = (ev: PointerEvent) => {
      const h = Math.max(MIN_HEIGHT, Math.round(startH + sign * (ev.clientY - startY)));
      setLayout((prev) => (last = { ...prev, heights: { ...prev.heights, [target]: h } }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (last) saveSideLayout(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function resetHeights() {
    setLayout((prev) => {
      const next = { ...prev, heights: {} };
      saveSideLayout(next);
      return next;
    });
  }

  return (
    <div className="search-panel side-modules">
      {expanded.map((m, i) => {
        const h = layout.heights[m.id];
        const style =
          m.id === flex
            ? { flex: "1 1 0", minHeight: m.minHeight ?? MIN_HEIGHT }
            : h != null
              ? { flex: `0 0 ${h}px`, minHeight: m.minHeight }
              : { flex: "0 1 auto", minHeight: m.minHeight };
        const prev = expanded[i - 1];
        return (
          <Fragment key={m.id}>
            {prev && (
              <div
                className="side-module-splitter"
                role="separator"
                aria-orientation="horizontal"
                title="Потяните, чтобы поменять высоту. Двойной щелчок — как было."
                onPointerDown={(e) => startDrag(e, prev.id, m.id)}
                onDoubleClick={resetHeights}
              />
            )}
            <div
              className={`side-module side-module--${m.id}`}
              style={style}
              ref={(el) => {
                if (el) refs.current.set(m.id, el);
                else refs.current.delete(m.id);
              }}
            >
              {m.node}
            </div>
          </Fragment>
        );
      })}
      {collapsed.length > 0 && (
        <div className="side-module-planks">
          {collapsed.map((m) => (
            <button key={m.id} type="button" className="side-module-plank" aria-expanded={false} onClick={() => expand(m.id)}>
              {m.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
