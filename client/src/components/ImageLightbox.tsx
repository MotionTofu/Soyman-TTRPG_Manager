import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import type { GalleryImage } from "../types";
import {useAuthenticatedFileUrl} from "../utils/fileUrl";
import { isSafeImageUrl } from "../utils/safeUrl";

interface Props {
  variant?: "media";
  images: Pick<GalleryImage,"id"|"image_url"|"caption">[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onDelete: (id: number) => void;
  onCaptionChange: (id: number, caption: string) => void;
}

// Full-size viewer for GalleryTab — no lightbox existed anywhere in the app
// before this, so this is a from-scratch component (built on the shared
// Modal portal for consistent backdrop/close behavior).
export function ImageLightbox({ images, index, onIndexChange, onClose, onDelete, onCaptionChange, variant }: Props) {
  const img = images[index];
  const authenticated=useAuthenticatedFileUrl(img?.image_url);
  const imageUrl=img?.image_url.startsWith('/files/')?authenticated:img?.image_url;
  const media = variant === "media";
  const [captionDraft, setCaptionDraft] = useState(img?.caption ?? "");

  useEffect(() => {
    setCaptionDraft(img?.caption ?? "");
  }, [img?.id, img?.caption]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || (e.target instanceof HTMLElement && e.target.matches("input, textarea"))) return;
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && index < images.length - 1) onIndexChange(index + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, images.length, onClose, onIndexChange]);

  if (!img) return null;

  return (
    <Modal onClose={onClose} ariaLabel="Просмотр изображения" className={media ? "media-lightbox" : undefined}>
      <div className="lightbox-content">
        <div className="lightbox-image-wrap">
          {index > 0 && (
            <button className="lightbox-nav lightbox-nav-prev" aria-label="Предыдущее изображение" title="← Стрелка влево" onClick={() => onIndexChange(index - 1)}>
              ‹
            </button>
          )}
          {imageUrl&&(!media || imageUrl.startsWith("blob:") || isSafeImageUrl(imageUrl))&&<img src={imageUrl} alt={img.caption || `Изображение ${index + 1}`} className="lightbox-image" />}
          {index < images.length - 1 && (
            <button className="lightbox-nav lightbox-nav-next" aria-label="Следующее изображение" title="Стрелка вправо →" onClick={() => onIndexChange(index + 1)}>
              ›
            </button>
          )}
        </div>
        <div className={media ? "media-lightbox__footer" : "row"} style={media ? undefined : { justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
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
          <button className={media ? "d-btn d-btn--sm" : "danger"} onClick={() => onDelete(img.id)} aria-label={media ? "В архив" : "Удалить текущее изображение"}>
            {media ? "В архив" : "Удалить"}
          </button>
          <button className={media ? "d-btn d-btn--sm" : undefined} onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </Modal>
  );
}
