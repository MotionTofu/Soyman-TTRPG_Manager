import { useEffect, useMemo, useRef, useState } from "react";
import type { PresentationLayer } from "../../types";
import { isSafeImageUrl } from "../../utils/safeUrl";
import "./presentation.css";

// Единственный рендер кадра показа: окно игроков, превью пульта и холст
// редактора — один компонент, разный только масштаб. Поэтому же превью
// показывает ровно то, что увидят игроки, включая фейды и титр.
//
// Подписи /files ротируются (HMAC 60с): каждый опрос show-state привозит тот
// же файл с новой query-строкой. useStableFileUrl держит первый увиденный URL
// на базовый путь: смена src перезагрузила бы картинку (и перезапустила бы
// GIF), а протухшая подпись уже загруженному <img> не страшна — подпись
// проверяется только в момент загрузки.

function basePathOf(url: string): string {
  return url.split("?")[0];
}

function useStableFileUrl(url: string | null): string {
  const seen = useRef(new Map<string, string>());
  if (!url) return "";
  if (!isSafeImageUrl(url)) return "";
  const base = basePathOf(url);
  const prev = seen.current.get(base);
  if (prev) return prev;
  seen.current.set(base, url);
  if (seen.current.size > 60) {
    const first = seen.current.keys().next().value as string;
    seen.current.delete(first);
  }
  return url;
}

function StageImg({ src, alt }: { src: string; alt: string }) {
  const stable = useStableFileUrl(src);
  if (!stable) return null;
  return <img src={stable} alt={alt} className="pres-img" draggable={false} />;
}

export interface LayerGeom {
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
}

export interface StageEdit {
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** commit=false — тянут, commit=true — отпустили (писать на сервер). */
  onGeometry: (id: number, geom: LayerGeom, commit: boolean) => void;
  /** Показать и скрытые слои приглушёнными, чтобы их можно было двигать. */
  showHidden?: boolean;
}

export interface PresentationStageProps {
  backgroundUrl: string | null;
  layers: PresentationLayer[];
  /** Слои с кнопками, видимые прямо сейчас. Слои без кнопки видны всегда. */
  visibleIds: number[] | Set<number>;
  fadeMs: number;
  /** Вход: cut | fade | black. */
  transition: string;
  transitionMs: number;
  /** Текст титра; "" — без титра. */
  title: string;
  titleSecs: number;
  /** Смена ключа = новый запуск: проиграть переход и титр заново. */
  playKey: string | number;
  /** Клик/Esc пропускают титр. Включает только окно игроков (у превью и редактора свои клавиатуры). */
  interactive?: boolean;
  onTitleDone?: () => void;
  /** Подпись чёрного экрана, показывать нечего (до первого показа). */
  waitingLabel?: string;
  /** Режим редактора: выбор, drag и ручки масштаба. Вход и титр не играются. */
  edit?: StageEdit;
  /** Внешний пропуск титра: смена значения = пропустить (пульт, Esc). */
  skipTitleSignal?: number;
  /** Видимость титра наружу — пульту нужно знать, обрабатывать ли Esc. */
  onTitleVisibility?: (visible: boolean) => void;
}

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

interface DragState {
  id: number;
  mode: DragMode;
  startClientX: number;
  startClientY: number;
  orig: LayerGeom;
  ratio: number;
  free: boolean;
  last: LayerGeom;
}

const HANDLES: { pos: DragMode; label: string }[] = [
  { pos: "nw", label: "Северо-запад" },
  { pos: "ne", label: "Северо-восток" },
  { pos: "sw", label: "Юго-запад" },
  { pos: "se", label: "Юго-восток" },
];

function clampGeom(g: LayerGeom): LayerGeom {
  return {
    x_pct: Math.min(100, Math.max(0, g.x_pct)),
    y_pct: Math.min(100, Math.max(0, g.y_pct)),
    w_pct: Math.min(300, Math.max(1, g.w_pct)),
    h_pct: Math.min(300, Math.max(1, g.h_pct)),
  };
}

export function PresentationStage({
  backgroundUrl,
  layers,
  visibleIds,
  fadeMs,
  transition,
  transitionMs,
  title,
  titleSecs,
  playKey,
  interactive = false,
  onTitleDone,
  waitingLabel,
  edit,
  skipTitleSignal,
  onTitleVisibility,
}: PresentationStageProps) {
  const visible = useMemo(
    () => (visibleIds instanceof Set ? visibleIds : new Set(visibleIds)),
    [visibleIds]
  );
  const ordered = useMemo(() => [...layers].sort((a, b) => a.position - b.position || a.id - b.id), [layers]);

  // Вход: black-флеш поверх кадра + титр. Титр идёт при любом переходе,
  // если текст задан (решение Q15); cut отличается только отсутствием флеша.
  // В режиме редактора вход не играется — титр мешал бы двигать слои.
  const [titleOn, setTitleOn] = useState(false);
  const [flash, setFlash] = useState(false);
  const titleOnRef = useRef(false);
  function setTitleVisible(on: boolean) {
    titleOnRef.current = on;
    setTitleOn(on);
    onTitleVisibility?.(on);
  }
  useEffect(() => {
    if (edit) {
      setFlash(false);
      setTitleVisible(false);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (transition === "cut") {
      setFlash(false);
    } else {
      setFlash(true);
      timers.push(setTimeout(() => setFlash(false), Math.max(0, transitionMs)));
    }
    if (title && titleSecs > 0) {
      setTitleVisible(true);
      timers.push(
        setTimeout(() => {
          setTitleVisible(false);
          onTitleDone?.();
        }, titleSecs * 1000)
      );
    } else {
      setTitleVisible(false);
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, !!edit]);

  function skipTitle() {
    if (!titleOnRef.current) return;
    setTitleVisible(false);
    onTitleDone?.();
  }

  // Внешний пропуск (пульт): первое значение при монтировании не трогаем.
  const prevSkip = useRef(skipTitleSignal);
  useEffect(() => {
    if (prevSkip.current !== skipTitleSignal) {
      prevSkip.current = skipTitleSignal;
      skipTitle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipTitleSignal]);

  useEffect(() => {
    if (!interactive || !titleOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        skipTitle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, titleOn]);

  // Предзагрузка фона и видимых слоёв — кадр не должен доезжать по частям.
  useEffect(() => {
    const urls = [backgroundUrl, ...ordered.filter((l) => l.has_button === 0 || visible.has(l.id)).map((l) => l.image_url)];
    for (const u of urls) {
      if (!u || !isSafeImageUrl(u)) continue;
      const img = new Image();
      img.src = u;
    }
  }, [backgroundUrl, ordered, visible]);

  // --- Режим редактора: drag слоя и ручки масштаба ---
  const frameRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  function geomOf(layer: PresentationLayer): LayerGeom {
    return { x_pct: layer.x_pct, y_pct: layer.y_pct, w_pct: layer.w_pct, h_pct: layer.h_pct };
  }

  function startDrag(e: React.PointerEvent, layer: PresentationLayer, mode: DragMode) {
    if (!edit || !frameRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    edit.onSelect(layer.id);
    drag.current = {
      id: layer.id,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      orig: geomOf(layer),
      ratio: layer.h_pct > 0 ? layer.w_pct / layer.h_pct : 1,
      free: e.shiftKey,
      last: geomOf(layer),
    };
    setDraggingId(layer.id);
    try {
      frameRef.current.setPointerCapture(e.pointerId);
    } catch {
      /* старые браузеры — движение всё равно отследим */
    }
  }

  function moveDrag(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !edit || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const dx = ((e.clientX - d.startClientX) / rect.width) * 100;
    const dy = ((e.clientY - d.startClientY) / rect.height) * 100;
    const o = d.orig;
    let next: LayerGeom;
    if (d.mode === "move") {
      next = { ...o, x_pct: o.x_pct + dx, y_pct: o.y_pct + dy };
    } else {
      // Ручки: пропорции locked, Shift — свободное растягивание (решение Q11).
      let w = o.w_pct;
      let h = o.h_pct;
      let x = o.x_pct;
      let y = o.y_pct;
      const dwBase = d.mode.includes("e") ? dx : -dx;
      const dhBase = d.mode.includes("s") ? dy : -dy;
      if (d.free) {
        w = o.w_pct + dwBase;
        h = o.h_pct + dhBase;
      } else {
        // Ведущая ось — та, что сильнее потянули (в % кадра).
        if (Math.abs(dwBase) >= Math.abs(dhBase)) {
          w = o.w_pct + dwBase;
          h = w / (d.ratio || 1);
        } else {
          h = o.h_pct + dhBase;
          w = h * (d.ratio || 1);
        }
      }
      const dw = w - o.w_pct;
      const dh = h - o.h_pct;
      if (d.mode.includes("w")) x = o.x_pct - dw;
      if (d.mode.includes("n")) y = o.y_pct - dh;
      next = { x_pct: x, y_pct: y, w_pct: w, h_pct: h };
    }
    d.last = clampGeom(next);
    edit.onGeometry(d.id, d.last, false);
  }

  function endDrag(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !edit) return;
    e.stopPropagation();
    // Сравниваем со стартом драга из ref, а не с пропсов: к pointerup стейт
    // уже содержит движение (замкнутый data совпал бы всегда и PUT не ушёл бы).
    const moved =
      Math.abs(d.last.x_pct - d.orig.x_pct) > 0.001 ||
      Math.abs(d.last.y_pct - d.orig.y_pct) > 0.001 ||
      Math.abs(d.last.w_pct - d.orig.w_pct) > 0.001 ||
      Math.abs(d.last.h_pct - d.orig.h_pct) > 0.001;
    drag.current = null;
    setDraggingId(null);
    if (moved) edit.onGeometry(d.id, d.last, true);
  }

  const nothingToShow = !backgroundUrl && !ordered.some((l) => l.has_button === 0 || visible.has(l.id));

  return (
    <div className="pres-stage" data-testid="presentation-stage">
      <div
        ref={frameRef}
        className={`pres-frame${edit ? " is-editing" : ""}`}
        onPointerMove={edit ? moveDrag : undefined}
        onPointerUp={edit ? endDrag : undefined}
        onPointerCancel={edit ? endDrag : undefined}
        onPointerDown={edit ? () => edit.onSelect(null) : undefined}
      >
        {backgroundUrl ? (
          <div className="pres-bg">
            <StageImg src={backgroundUrl} alt="" />
          </div>
        ) : null}
        {ordered.map((l) => {
          const on = l.has_button === 0 || visible.has(l.id);
          const dimmed = !!edit?.showHidden && !on;
          const selected = edit?.selectedId === l.id;
          if (!on && !dimmed) return null;
          return (
            <div
              key={l.id}
              className={`pres-layer${on ? " is-on" : " is-off"}${dimmed ? " is-dim" : ""}${selected ? " is-selected" : ""}`}
              style={{
                left: `${l.x_pct}%`,
                top: `${l.y_pct}%`,
                width: `${l.w_pct}%`,
                height: `${l.h_pct}%`,
                transitionDuration: draggingId === l.id ? "0ms" : `${Math.max(0, fadeMs)}ms`,
              }}
              onPointerDown={edit ? (e) => startDrag(e, l, "move") : undefined}
              title={edit ? l.name : undefined}
            >
              <StageImg src={l.image_url} alt={l.name} />
              {edit && selected
                ? HANDLES.map((h) => (
                    <span
                      key={h.pos}
                      className={`pres-handle is-${h.pos}`}
                      role="button"
                      aria-label={`Масштаб: ${h.label} (Shift — свободно)`}
                      onPointerDown={(e) => startDrag(e, l, h.pos)}
                    />
                  ))
                : null}
            </div>
          );
        })}
        {flash && transition !== "cut" ? (
          <div
            className={`pres-flash${transition === "black" ? " is-through" : ""}`}
            style={{ animationDuration: `${Math.max(0, transitionMs)}ms` }}
          />
        ) : null}
        {titleOn && title ? (
          interactive ? (
            <button type="button" className="pres-title" onClick={skipTitle} aria-label="Пропустить титр">
              {title}
            </button>
          ) : (
            <div className="pres-title" aria-live="polite">
              {title}
            </div>
          )
        ) : null}
        {nothingToShow ? (
          <div className="pres-waiting">{waitingLabel ?? "Показ не запущен"}</div>
        ) : null}
      </div>
    </div>
  );
}
