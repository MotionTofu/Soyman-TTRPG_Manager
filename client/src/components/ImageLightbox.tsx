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
            <button className="lightbox-nav lightbox-nav-prev" onClick={() => onIndexChange(index - 1)}>
              ‹
            </button>
          )}
          <img src={img.image_url} alt={img.caption} className="lightbox-image" />
          {index < images.length - 1 && (
            <button className="lightbox-nav lightbox-nav-next" onClick={() => onIndexChange(index + 1)}>
              ›
            </button>
          )}
        </div>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <input
            placeholder="Подпись…"
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            onBlur={() => captionDraft !== img.caption && onCaptionChange(img.id, captionDraft)}
            style={{ flex: 1 }}
          />
          <span className="muted">
            {index + 1} / {images.length}
          </span>
          <button className="danger" onClick={() => onDelete(img.id)}>
            Удалить
          </button>
          <button onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </Modal>
  );
}
