import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ScreenView } from "./ScreenView";
import { NavIcon } from "../NavIcons";
import { cameraOf, loadLastScreenId, loadScreenMemory, saveScreenMemory, type ScreenCamera } from "./screens";
import type { ShowDisplay, ShowState } from "../../types";

const PREVIEW_MAX_H = 320;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Экранный вектор → оси кадра, повёрнутого на `rotation` по часовой. */
function unrotate(dx: number, dy: number, rotation: number) {
  const t = (rotation * Math.PI) / 180;
  const c = Math.round(Math.cos(t));
  const s = Math.round(Math.sin(t));
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/** Превью экрана игроков в его настоящих пропорциях и управление
 * отображением (гриллинг 2026-10-23): ⟲ ⟳ и «Вписать | Заполнить» — всегда,
 * это настройка монитора (Q10); колесо — масштаб у курсора, перетаскивание —
 * сдвиг, двойной щелчок и «Сброс» — назад (Q4, Q7), только во время показа
 * и не для карты (Q6). Пока жест идёт, камера рисуется из черновика, а на
 * сервер уходит не чаще раза в 80 мс. */
export function ScreenPreview({
  show,
  adjustable,
  fill,
  onDisplay,
  toolsTarget,
  children,
}: {
  show: ShowState | null;
  /** Масштаб и сдвиг доступны: идёт показ кадра сцены. */
  adjustable: boolean;
  /** Карта: вписывается сама, только поворот. */
  fill: boolean;
  onDisplay: (patch: Partial<ShowDisplay>) => Promise<void>;
  /** Куда вынести ⟲ ⟳ и «Вписать | Заполнить» (строка монитора Пульта). */
  toolsTarget?: HTMLElement | null;
  children: ReactNode;
}) {
  const [draft, setDraft] = useState<Partial<ScreenCamera> | null>(null);
  const camera = { ...cameraOf(show?.display), ...draft };
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const boxRef = useRef<HTMLDivElement>(null);
  const pending = useRef<Partial<ScreenCamera> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef(0);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onDisplayRef = useRef(onDisplay);
  onDisplayRef.current = onDisplay;

  async function flush() {
    timer.current = undefined;
    const patch = pending.current;
    pending.current = null;
    if (!patch) return;
    inflight.current += 1;
    await onDisplayRef.current(patch);
    inflight.current -= 1;
    // Черновик уходит, когда всё записано: дальше камера — из ответа сервера.
    if (!pending.current && timer.current === undefined && inflight.current === 0 && !drag.current) setDraft(null);
  }
  function adjust(patch: Partial<ScreenCamera>) {
    setDraft((d) => ({ ...d, ...patch }));
    pending.current = { ...pending.current, ...patch };
    if (timer.current === undefined) timer.current = window.setTimeout(() => void flush(), 80);
  }
  const adjustRef = useRef(adjust);
  adjustRef.current = adjust;

  // Новая сессия — поворот ещё не задан: подставить память монитора (Q2).
  const memoryApplied = useRef(false);
  useEffect(() => {
    if (!show || memoryApplied.current) return;
    memoryApplied.current = true;
    if (show.display.rotation != null) return;
    const mem = loadScreenMemory(loadLastScreenId());
    if (mem?.rotation != null || mem?.fit != null) void onDisplayRef.current({ rotation: mem.rotation ?? 0, fit: mem.fit ?? "contain" });
  }, [show]);

  // Размер, который сообщило окно показа, — в память монитора: превью знает
  // форму экрана и до следующего открытия окна (Q3).
  const screenW = show?.display.screen_w ?? null;
  const screenH = show?.display.screen_h ?? null;
  useEffect(() => {
    if (screenW && screenH) saveScreenMemory(loadLastScreenId(), { w: screenW, h: screenH });
  }, [screenW, screenH]);

  // Колесо — нативным слушателем: React вешает wheel пассивным, и страница
  // прокручивалась бы вместе с масштабом.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !adjustable) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = cameraRef.current;
      const rect = el.getBoundingClientRect();
      const u = unrotate(e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2, c.rotation);
      const side = c.rotation % 180 !== 0;
      const f = { x: u.x / (side ? rect.height : rect.width), y: u.y / (side ? rect.width : rect.height) };
      const zoom = clamp(c.zoom * Math.exp(-e.deltaY * 0.0015), 0.25, 8);
      const k = zoom / c.zoom;
      // Точка под курсором остаётся на месте.
      adjustRef.current({
        zoom,
        pan_x: clamp(f.x + (c.pan_x - f.x) * k, -2, 2),
        pan_y: clamp(f.y + (c.pan_y - f.y) * k, -2, 2),
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [adjustable]);

  const mem = loadScreenMemory(loadLastScreenId());
  const w = screenW ?? mem?.w ?? 16;
  const h = screenH ?? mem?.h ?? 9;
  const moved = camera.zoom !== 1 || camera.pan_x !== 0 || camera.pan_y !== 0;

  function setMonitor(patch: Partial<Pick<ScreenCamera, "rotation" | "fit">>) {
    saveScreenMemory(loadLastScreenId(), patch);
    void onDisplay(patch);
  }
  const turn = (by: number) => setMonitor({ rotation: (((camera.rotation + by) % 360) + 360) % 360 as ScreenCamera["rotation"] });
  const reset = () => adjust({ zoom: 1, pan_x: 0, pan_y: 0 });

  const tools = (
    <span className="pres-tools">
      <span className="d-seg pres-turn" role="group" aria-label="Поворот экрана">
        <button type="button" title="Повернуть против часовой" aria-label="Повернуть против часовой" onClick={() => turn(-90)}>
          <NavIcon name="rotateLeft" />
        </button>
        <button type="button" title="Повернуть по часовой" aria-label="Повернуть по часовой" onClick={() => turn(90)}>
          <NavIcon name="rotateRight" />
        </button>
      </span>
      <span className="d-seg" role="group" aria-label="Кадр на экране" title={fill ? "Карта вписывается сама" : undefined}>
        <button type="button" disabled={fill} className={camera.fit === "contain" ? "active" : undefined} onClick={() => setMonitor({ fit: "contain" })}>
          Вписать
        </button>
        <button type="button" disabled={fill} className={camera.fit === "cover" ? "active" : undefined} onClick={() => setMonitor({ fit: "cover" })}>
          Заполнить
        </button>
      </span>
      {adjustable && moved && (
        <button type="button" className="d-btn d-btn--sm" onClick={reset}>
          Сброс
        </button>
      )}
    </span>
  );

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div
        ref={boxRef}
        title={adjustable ? "Колесо — масштаб, тащить — сдвиг, двойной щелчок — сброс" : undefined}
        style={{
          aspectRatio: `${w} / ${h}`,
          width: `${Math.round((PREVIEW_MAX_H * w) / h)}px`,
          maxWidth: "100%",
          cursor: adjustable ? (drag.current ? "grabbing" : "grab") : undefined,
          touchAction: adjustable ? "none" : undefined,
          // Двойной щелчок — сброс, а не выделение кадра (выделенная картинка темнеет).
          userSelect: "none",
        }}
        onPointerDown={(e) => {
          if (!adjustable || e.button !== 0) return;
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          const el = boxRef.current;
          if (!d || !el) return;
          const c = cameraRef.current;
          const u = unrotate(e.clientX - d.x, e.clientY - d.y, c.rotation);
          const side = c.rotation % 180 !== 0;
          drag.current = { x: e.clientX, y: e.clientY };
          adjust({
            pan_x: clamp(c.pan_x + u.x / (side ? el.clientHeight : el.clientWidth), -2, 2),
            pan_y: clamp(c.pan_y + u.y / (side ? el.clientWidth : el.clientHeight), -2, 2),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
          if (timer.current === undefined) void flush();
        }}
        onDoubleClick={() => adjustable && reset()}
      >
        <ScreenView
          camera={camera}
          fill={fill}
          style={{ width: "100%", height: "100%" }}
          overlay={
            camera.rotation !== 0 ? (
              <span className="pres-frame-bottom">▼ низ кадра</span>
            ) : null
          }
        >
          {children}
        </ScreenView>
      </div>
      {toolsTarget ? createPortal(tools, toolsTarget) : tools}
    </div>
  );
}
