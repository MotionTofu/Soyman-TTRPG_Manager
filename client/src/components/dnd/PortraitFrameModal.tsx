import { useRef, useState } from "react";
import { Modal } from "../Modal";
import { DEFAULT_PORTRAIT_FOCUS, type PortraitFocus } from "./portraitFrame";

// Кадрирование портрета карты (гриллинг 2026-09-25, Q3–Q5): окно — точная
// копия портретной зоны карты этого устройства, с затуханием и именем.
// Храним исходник + точку фокуса + масштаб: один кадр верен и на ПК, и на
// телефоне, где зона другой ширины.

export const PORTRAIT_ZOOM_MAX = 3;

/** Стиль картинки портрета: тот же на карте, в двойнике и в окне. Масштаб —
 *  вокруг точки фокуса, чтобы кадр держал лицо на любой ширине зоны. */
export function portraitImgStyle(focus: PortraitFocus | undefined, zoom: number | undefined) {
  const f = focus ?? DEFAULT_PORTRAIT_FOCUS;
  const pos = `${f.x * 100}% ${f.y * 100}%`;
  const z = zoom && zoom > 1 ? zoom : 1;
  return { objectPosition: pos, ...(z > 1 ? { transform: `scale(${z})`, transformOrigin: pos } : {}) };
}

/** Размер портретной зоны карты на этом устройстве: живая зона, если карта
 *  на экране, иначе — по той же геометрии (высота 300, ширина карты). */
function cardPortraitBox(): { w: number; h: number } {
  // Зона без портрета схлопнута по картушу — берём ширину карты минус поля
  // портрета (по 10 px), высота у зоны с портретом всегда 300.
  const face = document.querySelector(".dnd-card-face")?.getBoundingClientRect();
  if (face && face.width > 0) return { w: Math.round(face.width - 20), h: 300 };
  const phone = window.matchMedia("(max-width: 700px)").matches;
  return { w: phone ? window.innerWidth - 8 : 412, h: 300 };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function PortraitFrameModal({
  src,
  focus,
  zoom,
  name,
  subtitle,
  busy,
  onApply,
  onClose,
}: {
  src: string;
  focus?: PortraitFocus;
  zoom?: number;
  name: string;
  subtitle?: string;
  busy?: boolean;
  onApply: (focus: PortraitFocus, zoom: number) => void;
  onClose: () => void;
}) {
  const [box] = useState(cardPortraitBox);
  const [f, setF] = useState<PortraitFocus>(focus ?? DEFAULT_PORTRAIT_FOCUS);
  const [z, setZ] = useState(zoom && zoom > 1 ? zoom : 1);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const drag = useRef<{ x: number; y: number; f: PortraitFocus } | null>(null);

  // Сколько пикселей сдвига даёт единица фокуса: object-position двигает
  // избыток обложки, масштаб вокруг фокуса добавляет своё. Палец и картинка
  // идут вместе; где двигать некуда — ось стоит.
  function pxPerUnit(axis: "x" | "y") {
    if (!natural) return 0;
    const cover = Math.max(box.w / natural.w, box.h / natural.h);
    const size = axis === "x" ? box.w : box.h;
    const over = (axis === "x" ? natural.w : natural.h) * cover - size;
    return z * (over + size) - size;
  }
  function onPointerDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY, f };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const kx = pxPerUnit("x");
    const ky = pxPerUnit("y");
    setF({
      x: kx > 0 ? clamp01(d.f.x - (e.clientX - d.x) / kx) : d.f.x,
      y: ky > 0 ? clamp01(d.f.y - (e.clientY - d.y) / ky) : d.f.y,
    });
  }
  const setZoom = (v: number) => setZ(Math.min(PORTRAIT_ZOOM_MAX, Math.max(1, Math.round(v * 100) / 100)));

  return (
    <Modal className="dnd-frame-modal" ariaLabel="Кадр портрета" onClose={onClose}>
      <div className="dnd-frame-head">
        <h3>Кадр портрета</h3>
        <button type="button" className="dnd-conditions-close" aria-label="Закрыть" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="dnd-frame-hint">Так портрет ляжет на карту на этом устройстве. Тяните — сдвиг, колесо или ползунок — масштаб.</p>
      <div
        className="dnd-frame-stage"
        style={{ width: box.w, height: box.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => setZoom(z - e.deltaY / 500)}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          style={portraitImgStyle(f, z)}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
        <span className="dnd-card-portrait-fade" aria-hidden="true" />
        <span className="dnd-frame-caption" aria-hidden="true">
          <span className="dnd-card-cartouche-name">{name || "Без имени"}</span>
          {subtitle && <span className="dnd-card-cartouche-classline">{subtitle}</span>}
        </span>
      </div>
      <label className="dnd-frame-zoom">
        Масштаб
        <input type="range" min={1} max={PORTRAIT_ZOOM_MAX} step={0.01} value={z} onChange={(e) => setZoom(Number(e.target.value))} />
      </label>
      <div className="dnd-frame-actions">
        <button type="button" onClick={() => { setF({ ...DEFAULT_PORTRAIT_FOCUS }); setZ(1); }}>
          Сброс
        </button>
        <button type="button" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="primary" disabled={busy} onClick={() => onApply(f, z)}>
          {busy ? "Сохраняем…" : "Готово"}
        </button>
      </div>
    </Modal>
  );
}
