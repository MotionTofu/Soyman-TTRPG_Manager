import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ScreenCamera } from "./screens";

/** Экран игроков как камера над кадром (гриллинг 2026-10-23): кадр сцены
 * остаётся холстом 16:9, экран поворачивает его, вписывает или заполняет,
 * масштабирует и сдвигает. Одна разметка на окно показа и превью пульта —
 * превью лишь меньше, поэтому совпадает с экраном один в один.
 *
 * `fill` — кадр без своих пропорций (карта вписывается сама): занимает весь
 * повёрнутый экран, масштаб и сдвиг к нему не применяются (Q6, «Стол»).
 * `overlay` — поверх, в осях кадра (метка «низ кадра» превью). */
export function ScreenView({
  camera,
  fill = false,
  style,
  overlay,
  children,
}: {
  camera: ScreenCamera;
  fill?: boolean;
  style?: CSSProperties;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const side = camera.rotation % 180 !== 0;
  const uw = side ? box.h : box.w;
  const uh = side ? box.w : box.h;
  let fw = uw;
  let fh = uh;
  let pan = { x: 0, y: 0 };
  if (!fill) {
    const s = (camera.fit === "cover" ? Math.max : Math.min)(uw / 16, uh / 9) * camera.zoom;
    fw = 16 * s;
    fh = 9 * s;
    pan = { x: camera.pan_x * uw, y: camera.pan_y * uh };
  }

  return (
    <div ref={ref} style={{ position: "relative", overflow: "hidden", background: "#000", ...style }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: uw,
          height: uh,
          transform: `translate(-50%, -50%) rotate(${camera.rotation}deg)`,
        }}
      >
        <div style={{ position: "absolute", width: fw, height: fh, left: (uw - fw) / 2 + pan.x, top: (uh - fh) / 2 + pan.y }}>
          {children}
        </div>
        {overlay}
      </div>
    </div>
  );
}
