import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";

export type CropShape = "background" | "square" | "thumbnail";

// Container box each shape crops into — background is a 16:9 banner,
// square is used for avatars/item photos, thumbnail is the wide strip used
// on campaign/setting list cards.
const BOX: Record<CropShape, { w: number; h: number; outW: number; outH: number; label: string }> = {
  background: { w: 480, h: 270, outW: 1600, outH: 900, label: "фон (16:9)" },
  square: { w: 320, h: 320, outW: 640, outH: 640, label: "квадрат 1:1" },
  thumbnail: { w: 360, h: 130, outW: 1080, outH: 390, label: "тамбнейл (широкий)" },
};

interface Props {
  file: File;
  shape: CropShape;
  onCancel: () => void;
  onSkip: (file: File) => void;
  onConfirm: (file: File) => void;
}

export function ImageCropModal({ file, shape, onCancel, onSkip, onConfirm }: Props) {
  const box = BOX[shape];
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; startOffset: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const baseScale = natural ? Math.max(box.w / natural.w, box.h / natural.h) : 1;
  const dispScale = baseScale * zoom;
  const dispW = natural ? natural.w * dispScale : 0;
  const dispH = natural ? natural.h * dispScale : 0;
  const maxOffsetX = Math.max(0, (dispW - box.w) / 2);
  const maxOffsetY = Math.max(0, (dispH - box.h) / 2);

  function clamp(o: { x: number; y: number }, mx: number, my: number) {
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  }

  function handlePointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffset: offset };
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(
      clamp(
        { x: dragRef.current.startOffset.x + dx, y: dragRef.current.startOffset.y + dy },
        maxOffsetX,
        maxOffsetY
      )
    );
  }
  function handlePointerUp() {
    dragRef.current = null;
  }
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    setZoom((z) => Math.min(4, Math.max(1, z - e.deltaY * 0.001)));
  }
  function handleZoomSlider(v: number) {
    setZoom(v);
  }

  // Re-clamp whenever zoom changes the max pan range.
  useEffect(() => {
    setOffset((o) => clamp(o, maxOffsetX, maxOffsetY));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, natural]);

  function handleConfirm() {
    const img = imgRef.current;
    if (!img || !natural) return;
    const srcLeft = (dispW / 2 - box.w / 2 - offset.x) / dispScale;
    const srcTop = (dispH / 2 - box.h / 2 - offset.y) / dispScale;
    const srcW = box.w / dispScale;
    const srcH = box.h / dispScale;
    const canvas = document.createElement("canvas");
    canvas.width = box.outW;
    canvas.height = box.outH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, box.outW, box.outH);
    ctx.drawImage(img, srcLeft, srcTop, srcW, srcH, 0, 0, box.outW, box.outH);
    canvas.toBlob(
      (blob) => {
        if (blob) onConfirm(new File([blob], "cropped.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.9
    );
  }

  return (
    <Modal onClose={onCancel}>
      <h3>Обрезка изображения</h3>
      <p className="muted">Формат: {box.label}. Перетащите картинку, чтобы выбрать область, колесо мыши — зум.</p>
      <div
        ref={containerRef}
        className="crop-viewport"
        style={{ width: box.w, height: box.h }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      >
        {url && (
          <img
            ref={imgRef}
            src={url}
            alt=""
            draggable={false}
            onLoad={(e) =>
              setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            style={{
              width: dispW || undefined,
              height: dispH || undefined,
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
          />
        )}
      </div>
      <label className="row" style={{ alignItems: "center", gap: 8 }}>
        Зум
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(e) => handleZoomSlider(Number(e.target.value))}
          style={{ flex: 1 }}
        />
      </label>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button onClick={onCancel}>Отмена</button>
        <button onClick={() => onSkip(file)}>Пропустить и загрузить как есть</button>
        <button className="primary" onClick={handleConfirm} disabled={!natural}>
          Обрезать и загрузить
        </button>
      </div>
    </Modal>
  );
}
