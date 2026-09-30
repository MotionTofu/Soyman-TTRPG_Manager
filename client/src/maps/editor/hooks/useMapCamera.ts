import { useCallback, useEffect, useRef, useState } from "react";
import { worldBounds } from "../../grid";
import type { MapGrid } from "../../mapTypes";

// Камера карты (Фаза 1, Этап 1): тот же state и та же математика, что раньше
// жили инлайном в MapEditorPage. Пределы scale 4..240 — контракт, не менять.
export interface Camera {
  scale: number;
  ox: number;
  oy: number;
}

export const MAP_CAM_MIN_SCALE = 4;
export const MAP_CAM_MAX_SCALE = 240;
const MAP_CAM_WHEEL_BASE = 1.0015;
const MAP_CAM_PERSIST_DEBOUNCE_MS = 500;

export interface CameraMapGeometry {
  grid: MapGrid;
  width: number;
  height: number;
}

interface UseMapCameraArgs {
  mapId: number | null;
  geom: CameraMapGeometry | null;
  wrapRef: { current: HTMLDivElement | null };
  canvasRef: { current: HTMLCanvasElement | null };
}

export function useMapCamera({ mapId, geom, wrapRef, canvasRef }: UseMapCameraArgs) {
  const [cam, setCam] = useState<Camera>({ scale: 24, ox: 0, oy: 0 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const grid = geom?.grid;
  const width = geom?.width;
  const height = geom?.height;

  // Автомасштаб под окно при открытии карты. Д-16: позиция камеры — по карте
  // (localStorage `maps.cam.<id>`): за столом зумнул на B12 — после перезахода
  // вернёшься туда же; «Вписать» (force) сбрасывает в общий вид и стирает память.
  const fitCamera = useCallback(
    (force = false) => {
      const wrap = wrapRef.current;
      if (!wrap || mapId === null || grid === undefined || width === undefined || height === undefined) return;
      if (!force) {
        try {
          const raw = localStorage.getItem(`maps.cam.${mapId}`);
          if (raw) {
            const c = JSON.parse(raw) as { scale?: unknown; ox?: unknown; oy?: unknown };
            if (
              typeof c.scale === "number" && Number.isFinite(c.scale) && c.scale >= 4 && c.scale <= 240 &&
              typeof c.ox === "number" && Number.isFinite(c.ox) &&
              typeof c.oy === "number" && Number.isFinite(c.oy)
            ) {
              setCam({ scale: c.scale, ox: c.ox, oy: c.oy });
              return;
            }
          }
        } catch {
          // нет памяти — вписываем как раньше
        }
      } else {
        try {
          localStorage.removeItem(`maps.cam.${mapId}`);
        } catch {
          // приватный режим — не страшно
        }
      }
      const rect = wrap.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      const b = worldBounds(grid, width, height);
      const pad = 24;
      const scale = Math.max(
        4,
        Math.min((rect.width - pad * 2) / (b.maxX - b.minX), (rect.height - pad * 2) / (b.maxY - b.minY))
      );
      setCam({
        scale,
        ox: pad + (rect.width - pad * 2 - (b.maxX - b.minX) * scale) / 2 - b.minX * scale,
        oy: pad + (rect.height - pad * 2 - (b.maxY - b.minY) * scale) / 2 - b.minY * scale,
      });
    },
    [mapId, grid, width, height]
  );

  useEffect(() => {
    fitCamera();
  }, [fitCamera]);

  useEffect(() => {
    const onResize = () => fitCamera();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitCamera]);

  // Д-16: запоминаем камеру (debounce — не пишем на каждый пиксель панорамы).
  useEffect(() => {
    if (mapId === null) return;
    const key = `maps.cam.${mapId}`;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(cam));
      } catch {
        // приватный режим — просто не запоминаем
      }
    }, MAP_CAM_PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [cam, mapId]);

  // Зум кнопками/хоткеями (P0-4): к центру видимого поля, те же пределы,
  // что у зума колесом (4..240).
  function zoomBy(factor: number) {
    const el = canvasRef.current ?? wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setCam((c) => {
      const scale = Math.min(240, Math.max(4, c.scale * factor));
      const k = scale / c.scale;
      return { scale, ox: cx - (cx - c.ox) * k, oy: cy - (cy - c.oy) * k };
    });
  }

  // Зум к точке вьюпорта (wheel/pinch): та же математика clamp 4..240,
  // что раньше была инлайном в обработчиках.
  const zoomAt = useCallback(
    (rx: number, ry: number, factor: number) => {
      setCam((c) => {
        const scale = Math.min(
          MAP_CAM_MAX_SCALE,
          Math.max(MAP_CAM_MIN_SCALE, c.scale * factor)
        );
        const k = scale / c.scale;
        return { scale, ox: rx - (rx - c.ox) * k, oy: ry - (ry - c.oy) * k };
      });
    },
    []
  );

  // screen → world для мыши/пера.
  function toWorld(e: { clientX: number; clientY: number }): {
    wx: number;
    wy: number;
    rx: number;
    ry: number;
  } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;
    const c = camRef.current;
    return { wx: (rx - c.ox) / c.scale, wy: (ry - c.oy) / c.scale, rx, ry };
  }

  // screen → world для тача.
  function touchToWorld(clientX: number, clientY: number): { wx: number; wy: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const c = camRef.current;
    return { wx: (clientX - rect.left - c.ox) / c.scale, wy: (clientY - rect.top - c.oy) / c.scale };
  }

  // world → screen (для будущих этапов; рендер пока считает сам).
  function toScreen(wx: number, wy: number): { sx: number; sy: number } {
    const c = camRef.current;
    return { sx: wx * c.scale + c.ox, sy: wy * c.scale + c.oy };
  }

  // Нативный слушатель: React вешает wheel пассивным, и preventDefault там
  // только ругается в консоль — страница уезжала бы из-под зума.
  // Зависимость от map: canvas появляется только после загрузки карты,
  // вешать один раз при монтировании — мимо (баг «зум не работает»).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const rx = e.clientX - rect.left;
      const ry = e.clientY - rect.top;
      zoomAt(rx, ry, Math.pow(MAP_CAM_WHEEL_BASE, -e.deltaY));
    };
    canvas.addEventListener("wheel", onWheelNative, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheelNative);
  }, [mapId, grid, width, height, zoomAt]);

  return { cam, setCam, camRef, fitCamera, zoomBy, zoomAt, toWorld, touchToWorld, toScreen };
}
