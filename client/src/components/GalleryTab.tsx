import { useEffect, useState, type ReactNode } from "react";
import { api, deleteFileWithChoice } from "../api/client";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import type { GalleryImage } from "../types";
import { ImageLightbox } from "./ImageLightbox";

// Lets the owning detail page (Character/Being) keep its own useImageCrop
// state/handler but render the thumbnail-upload control inside the Gallery
// tab, next to the rest of this entity's images, instead of up in the
// avatar column.
interface ThumbnailUploadProps {
  previewUrl: string | null;
  uploading: boolean;
  onSelect: (file: File | null) => void;
  modal: ReactNode;
}

interface Props {
  ownerType: "character" | "being" | "location" | "community" | "campaign_player_section" | "artifact";
  ownerId: number;
  thumbnailUpload?: ThumbnailUploadProps;
  // Same shape as thumbnailUpload — used for entities (locations) whose
  // avatar isn't shown on the profile itself, only as the list-thumbnail
  // fallback when no dedicated thumbnail is set (see LocationTree.tsx).
  avatarUpload?: ThumbnailUploadProps;
}

export function GalleryTab({ ownerType, ownerId, thumbnailUpload, avatarUpload }: Props) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  function refresh() {
    api
      .get<GalleryImage[]>(`/gallery?owner_type=${ownerType}&owner_id=${ownerId}`)
      .then(setImages);
  }
  useEffect(refresh, [ownerType, ownerId]);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append("owner_type", ownerType);
      form.append("owner_id", String(ownerId));
      await api.post("/gallery", form);
    }
    setUploading(false);
    refresh();
  }

  async function removeImage(id: number) {
    if (!confirm("Удалить изображение?")) return;
    const deleted = await deleteFileWithChoice(`/gallery/${id}`);
    if (!deleted) return;
    setLightboxIndex(null);
    refresh();
  }

  async function saveCaption(id: number, caption: string) {
    await api.put(`/gallery/${id}`, { caption });
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, caption } : img)));
  }

  async function reorder(draggedId: number, targetId: number) {
    if (draggedId === targetId) return;
    const ids = images.map((i) => i.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    const order = new Map(ids.map((id, i) => [id, i]));
    setImages((prev) => [...prev].sort((a, b) => order.get(a.id)! - order.get(b.id)!));
    await api.put("/gallery/reorder", { order: ids });
  }

  // Sorts by caption (falling back to the filename for uncaptioned images,
  // so the button still does something useful before anyone's bothered to
  // caption their gallery).
  function labelFor(img: GalleryImage): string {
    // The URL carries a query string (cache-busting ?v=, ?token=) — cut it off
    // before taking the basename, or the label ends up with the whole tail.
    const withoutQuery = img.image_url.split("?")[0];
    return img.caption || decodeURIComponent(withoutQuery.split("/").pop() || "");
  }
  async function sortAlphabetically() {
    const ids = [...images].sort((a, b) => labelFor(a).localeCompare(labelFor(b), "ru")).map((i) => i.id);
    const order = new Map(ids.map((id, i) => [id, i]));
    setImages((prev) => [...prev].sort((a, b) => order.get(a.id)! - order.get(b.id)!));
    await api.put("/gallery/reorder", { order: ids });
  }

  return (
    <div className="stack">
      {thumbnailUpload && (
        <div className="row gallery-thumbnail-upload" style={{ alignItems: "center" }}>
          {thumbnailUpload.previewUrl && (
            <img src={thumbnailUpload.previewUrl} alt="" className="gallery-thumbnail-preview" />
          )}
          <label className="character-avatar-upload" title={IMAGE_HINT}>
            {thumbnailUpload.uploading ? "Загрузка…" : "Тамбнейл для списка"}
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => thumbnailUpload.onSelect(e.target.files?.[0] ?? null)}
            />
          </label>
          {thumbnailUpload.modal}
        </div>
      )}
      {avatarUpload && (
        <div className="row gallery-thumbnail-upload" style={{ alignItems: "center" }}>
          {avatarUpload.previewUrl && (
            <img src={avatarUpload.previewUrl} alt="" className="gallery-thumbnail-preview" />
          )}
          <label className="character-avatar-upload" title={IMAGE_HINT}>
            {avatarUpload.uploading ? "Загрузка…" : "Аватарка (запасной вариант для списка)"}
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => avatarUpload.onSelect(e.target.files?.[0] ?? null)}
            />
          </label>
          {avatarUpload.modal}
        </div>
      )}
      {images.length > 1 && (
        <button type="button" className="comp-mini" onClick={sortAlphabetically} title="Отсортировать по алфавиту (по подписи)" style={{ alignSelf: "flex-start" }}>
          А-Я
        </button>
      )}
      <div className="gallery-grid">
        {images.map((img, i) => (
          <div
            key={img.id}
            className="gallery-thumb-wrap"
            draggable
            onDragStart={() => setDragId(img.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dragId != null && reorder(dragId, img.id)}
          >
            <img
              src={img.image_url}
              alt={img.caption}
              className="gallery-thumb"
              onClick={() => setLightboxIndex(i)}
            />
          </div>
        ))}
        <label className="gallery-upload-tile">
          {uploading ? "Загрузка…" : "+ Добавить"}
          <input
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            style={{ display: "none" }}
            onChange={(e) => uploadFiles(e.target.files)}
          />
        </label>
      </div>
      {images.length === 0 && <span className="muted image-hint">{IMAGE_HINT}</span>}

      {lightboxIndex != null && images[lightboxIndex] && (
        <ImageLightbox
          images={images}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDelete={removeImage}
          onCaptionChange={saveCaption}
        />
      )}
    </div>
  );
}
