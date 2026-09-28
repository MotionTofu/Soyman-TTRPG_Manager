import { useEffect, useRef } from "react";
import type { PaintTool } from "../editorTypes";

// Хоткеи редактора карт (Фаза 1, Этап Hotkeys): keyboard router, раньше живший
// инлайном в MapEditorPage. Поведение 1:1 — тот же mapping кодов, те же гарды
// полей ввода, те же preventDefault, тот же порядок проверок. Хук знает только
// команды-колбэки, а не MapCells и не внутренности страницы.
// Понятие инструмента принадлежит редактору (editorTypes, будущий Tool
// Controller) — хук его только использует для выбора.

export const MAP_HOTKEY_TOOLS: Record<string, PaintTool> = {
  KeyV: "select",
  KeyB: "brush",
  KeyG: "fill",
  KeyE: "eraser",
  KeyI: "picker",
  KeyR: "road",
  KeyN: "river",
  KeyW: "wall",
  KeyU: "shape",
  KeyD: "door",
  KeyL: "trap",
  KeyC: "chest",
  KeyA: "altar",
  KeyK: "marker",
  KeyS: "start",
  KeyF: "finish",
  KeyM: "ruler",
  KeyT: "label",
};

interface UseMapHotkeysArgs {
  canEdit: boolean;
  onSelectTool: (tool: PaintTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  hasSelection: boolean;
  onDeleteSelected: () => void;
  onCancel: () => void;
  canFinishWall: boolean;
  onFinishWall: () => void;
  isGenOpen: boolean;
  onGenerate: () => void;
  onToggleGen: () => void;
  onTogglePng: () => void;
}

export function useMapHotkeys(args: UseMapHotkeysArgs) {
  const argsRef = useRef(args);
  argsRef.current = args;
  const { canEdit } = args;

  // Хоткеи: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — история, B/G/E/I/R/M/T/V — инструмент,
  // +/−/0 — зум/вписать, Esc — сбросить замер (P0-4, P2-1; камера и Esc общие).
  // Независимы от раскладки (code), в полях ввода молчат.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = argsRef.current;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const ae = document.activeElement as HTMLElement | null;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ae?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
          // code, а не key: физическая клавиша,Z — та же и на русской раскладке.
          if (!a.canEdit) return;
          if (e.code === "KeyZ" && !e.shiftKey) {
            e.preventDefault();
            a.onUndo();
          } else if ((e.code === "KeyZ" && e.shiftKey) || e.code === "KeyY") {
            e.preventDefault();
            a.onRedo();
          } else if (e.code === "Enter" && a.isGenOpen) {
            // Ctrl+Enter — сгенерировать, когда панель генератора открыта (U7).
            e.preventDefault();
            a.onGenerate();
          }
        } else if (e.altKey && !e.ctrlKey && !e.metaKey) {
          // U7: Alt+G/P — панели (одиночные G/E заняты инструментами,
          // а Ctrl+G — «найти далее» в браузере, его не трогаем).
          if (!a.canEdit) return;
          if (e.code === "KeyG") {
            e.preventDefault();
            a.onToggleGen();
          } else if (e.code === "KeyP") {
            e.preventDefault();
            a.onTogglePng();
          }
        }
        return;
      }
      if (e.code === "Equal" || e.code === "NumpadAdd") {
        e.preventDefault();
        a.onZoomIn();
        return;
      }
      if (e.code === "Minus" || e.code === "NumpadSubtract") {
        e.preventDefault();
        a.onZoomOut();
        return;
      }
      if (e.code === "Digit0" || e.code === "Numpad0") {
        e.preventDefault();
        a.onFit();
        return;
      }
      if (e.code === "Escape") {
        a.onCancel();
        return;
      }
      // Enter без модификаторов — финиш полилинии стен с живым концом (Этап E).
      if (e.code === "Enter" && a.canEdit && a.canFinishWall) {
        e.preventDefault();
        a.onFinishWall();
        return;
      }
      if (!a.canEdit) return;
      const t = MAP_HOTKEY_TOOLS[e.code];
      if (t) {
        // Уход с выбора закрывает панели объектов (черновики бы врали).
        a.onSelectTool(t);
        return;
      }
      // Delete — удалить выбранный объект (пару дверей — целиком).
      if (e.code === "Delete" && a.hasSelection) {
        e.preventDefault();
        a.onDeleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);
}
