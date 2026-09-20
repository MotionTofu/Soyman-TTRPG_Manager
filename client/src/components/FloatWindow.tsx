import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./FloatWindow.css";

interface Size {
  w: number;
  h: number;
}

interface Props {
  /** Подпись на верхней плашке. */
  title: string;
  /** Ключ localStorage для геометрии (позиция + размер переживают перезагрузку). */
  storageKey: string;
  /** Стартовый размер, если сохранённого нет. */
  defaultSize: Size;
  /** Вернуть блок в сетку. */
  onDock: () => void;
  /** Убрать окно плашкой в док-станцию. */
  onToDockStation: () => void;
  children: ReactNode;
}

interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
}

function loadGeom(key: string): Geom | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Geom>;
    if (
      typeof v.x !== "number" ||
      typeof v.y !== "number" ||
      typeof v.w !== "number" ||
      typeof v.h !== "number" ||
      !Number.isFinite(v.x + v.y + v.w + v.h)
    )
      return null;
    return { x: v.x, y: v.y, w: v.w, h: v.h };
  } catch {
    return null;
  }
}

function saveGeom(key: string, geom: Geom) {
  try {
    localStorage.setItem(key, JSON.stringify(geom));
  } catch {
    /* приватный режим — окно просто не запомнится */
  }
}

// Плавающее окно поверх приложения: драг за верхнюю плашку, размер —
// нативной ручкой `resize: both` (см. CSS), даблклик по плашке сворачивает
// в неё же (как скрыть/раскрыть), возврат в сетку и в док — кнопками.
// Своё, а не react-rnd: одна открепляемая панель — не тот масштаб, ради
// которого тащат зависимость в офлайн-сборку, а драг на Pointer Events
// уже есть в PresentationStage.
//
// Размер ручкой меняет браузер прямо в инлайне — React его не контролирует
// (иначе ререндер от драга сбросил бы размер в стартовый): стартовый
// выставляется один раз, дальше читается для запоминания.
// z-index 45: выше дока и плеера, ниже модалок (50) — диалог поверх окна
// остаётся диалогом.
export function FloatWindow({ title, storageKey, defaultSize, onDock, onToDockStation, children }: Props) {
  const winRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  // Свёрнутость — только стейт (не запоминаем): читается и в persist-заглушке.
  const [minimized, setMinimized] = useState(false);
  const minimizedRef = useRef(minimized);
  minimizedRef.current = minimized;

  // Позиция — стейт (ререндер на каждый mousemove драга: окно одно, дёшево).
  const [pos, setPos] = useState(() => {
    const saved = loadGeom(storageKey);
    if (saved) return { x: saved.x, y: saved.y };
    return {
      x: Math.max(8, (window.innerWidth - defaultSize.w) / 2),
      y: Math.max(8, (window.innerHeight - defaultSize.h) / 3),
    };
  });
  const posRef = useRef(pos);
  posRef.current = pos;
  // Ленивый старт один раз (useRef функцию не вызывает — хранил бы её саму).
  const startSizeRef = useRef<Size | null>(null);
  if (startSizeRef.current === null) {
    const saved = loadGeom(storageKey);
    startSizeRef.current = saved ? { w: saved.w, h: saved.h } : defaultSize;
  }
  const startSize = startSizeRef.current;

  // Стартовый размер — один раз в DOM, дальше им владеет ручка браузера.
  useEffect(() => {
    const el = winRef.current;
    if (!el) return;
    el.style.width = `${startSize.w}px`;
    el.style.height = `${startSize.h}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persist() {
    const rect = winRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Свёрнутое окно живёт компактной геометрией плашки: запоминаем только
    // позицию, а размер — прежний целиком, иначе перезаход откроет щель
    // в ширину плашки.
    if (minimizedRef.current) {
      const prev = loadGeom(storageKey);
      saveGeom(storageKey, {
        ...posRef.current,
        w: prev?.w ?? Math.round(rect.width),
        h: prev?.h ?? Math.round(rect.height),
      });
      return;
    }
    saveGeom(storageKey, { ...posRef.current, w: Math.round(rect.width), h: Math.round(rect.height) });
  }

  // Ручка CSS не даёт событий: размер запоминаем по ResizeObserver с
  // задним фронтом — писать localStorage на каждый кадр незачем.
  useEffect(() => {
    const el = winRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(persist, 300);
    });
    ro.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Окно не должно потеряться за краем при смене разрешения.
  useEffect(() => {
    const onResize = () => {
      setPos((p) => {
        const rect = winRef.current?.getBoundingClientRect();
        const next = {
          x: Math.min(Math.max(p.x, 8 + Math.min(0, 80 - (rect?.width ?? defaultSize.w))), window.innerWidth - 80),
          y: Math.min(Math.max(p.y, 0), window.innerHeight - 40),
        };
        if (next.x !== p.x || next.y !== p.y) {
          posRef.current = next;
          persist();
          return next;
        }
        return p;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clamp(x: number, y: number) {
    const rect = winRef.current?.getBoundingClientRect();
    const w = rect?.width ?? defaultSize.w;
    return {
      // Край можно задвинуть за экран, но не целиком: 80px всегда торчат.
      x: Math.min(Math.max(x, 80 - w), window.innerWidth - 80),
      y: Math.min(Math.max(y, 0), window.innerHeight - 40),
    };
  }

  function onTitleDown(e: React.PointerEvent<HTMLDivElement>) {
    // Кнопки живут на той же плашке — драг начинается мимо них.
    if ((e.target as HTMLElement).closest("button")) return;
    if (e.button !== 0) return;
    drag.current = { startX: e.clientX, startY: e.clientY, origX: posRef.current.x, origY: posRef.current.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onTitleMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const next = clamp(d.origX + e.clientX - d.startX, d.origY + e.clientY - d.startY);
    setPos(next);
    posRef.current = next;
  }

  function onTitleUp() {
    if (!drag.current) return;
    drag.current = null;
    persist();
  }

  return createPortal(
    <div
      ref={winRef}
      className={`float-window${minimized ? " is-min" : ""}`}
      role="dialog"
      aria-label={title}
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="float-title"
        onPointerDown={onTitleDown}
        onPointerMove={onTitleMove}
        onPointerUp={onTitleUp}
        onPointerCancel={onTitleUp}
        onDoubleClick={() => setMinimized((v) => !v)}
        title="Дважды щёлкните, чтобы свернуть/развернуть"
      >
        <span className="float-title__label">{title}</span>
        <button
          type="button"
          className="comp-mini"
          onClick={onToDockStation}
          title="Убрать окно плашкой в док-станцию"
        >
          В док-станцию
        </button>
        <button
          type="button"
          className="comp-mini"
          onClick={onDock}
          title="Вернуть блок в сетку пульта"
        >
          В пульт
        </button>
      </div>
      <div className="float-body">{children}</div>
    </div>,
    document.body
  );
}
