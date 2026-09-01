import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import type { GalleryImage } from "../types";

interface Props {
  images: GalleryImage[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onDelete: (id: number) => void;
  onCaptionChange: (id: number, caption: string) => void;
}

// Full-size viewer for GalleryTab — no lightbox existed anywhere in the app
// before this, so this is a from-scratch component (built on the shared
// Modal portal for consistent backdrop/close behavior).
export function ImageLightbox({ images, index, onIndexChange, onClose, onDelete, onCaptionChange }: Props) {
  const img = images[index];
  const [captionDraft, setCaptionDraft] = useState(img?.caption ?? "");

  useEffect(() => {
    setCaptionDraft(img?.caption ?? "");
  }, [img?.id, img?.caption]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && index < images.length - 1) onIndexChange(index + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, images.length, onClose, onIndexChange]);

  if (!img) return null;

  return (
    <Modal onClose={onClose}>
      <div className="lightbox-content">
        <div className="lightbox-image-wrap">
          {index > 0 && (
            <button className="lightbox-nav lightbox-nav-prev" aria-label="Предыдущее изображение" title="← Стрелка влево" onClick={() => onIndexChange(index - 1)}>
              ‹
            </button>
          )}
          <img src={img.image_url} alt={img.caption || `Изображение ${index + 1}`} className="lightbox-image" />
          {index < images.length - 1 && (
            <button className="lightbox-nav lightbox-nav-next" aria-label="Следующее изображение" title="Стрелка вправо →" onClick={() => onIndexChange(index + 1)}>
              ›
            </button>
          )}
        </div>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <input
            placeholder="Подпись…"
            value={captionDraft}
            maxLength={500}
            onChange={(e) => setCaptionDraft(e.target.value)}
            onBlur={() => captionDraft.trim().slice(0,500) !== img.caption && onCaptionChange(img.id, captionDraft.trim().slice(0,500))}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setCaptionDraft(img.caption ?? ""); }}
            style={{ flex: "1 1 200px", minWidth: 200 }}
            aria-label="Подпись изображения"
          />
          <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }} aria-live="polite">
            {index + 1} / {images.length}
          </span>
          <button className="danger" onClick={() => onDelete(img.id)} aria-label="Удалить текущее изображение">
            Удалить
          </button>
          <button onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </Modal>
  );
}
