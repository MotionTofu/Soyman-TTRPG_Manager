import { useEffect, useState, type ReactNode } from "react";
import { api, deleteFileWithChoice } from "../api/client";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import type { GalleryImage } from "../types";
import { ImageLightbox } from "./ImageLightbox";
import { EmptyState } from "./EmptyState";
import { useConfirm } from "../hooks/useConfirm";
import { ContextMenu } from "./ContextMenu";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null);

  function load(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    api
      .get<GalleryImage[]>(`/gallery?owner_type=${ownerType}&owner_id=${ownerId}`, { signal } as any)
      .then((data) => {
        setImages(data);
        setLoading(false);
      })
      .catch((e: any) => {
        if (e?.name === "AbortError") return;
        setError(e?.message ?? "Ошибка загрузки галереи");
        setLoading(false);
      });
  }
  function refresh() {
    load();
  }
  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [ownerType, ownerId]);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const list = Array.from(files);
      const results = await Promise.allSettled(
        list.map(async (file) => {
          const form = new FormData();
          form.append("file", file);
          form.append("owner_type", ownerType);
          form.append("owner_id", String(ownerId));
          return api.post("/gallery", form);
        })
      );
      const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      if (failed.length) setError(failed[0].reason?.message ?? `Не загружено ${failed.length} файлов`);
    } catch (e: any) {
      setError(e?.message ?? "Ошибка загрузки");
    } finally {
      setUploading(false);
      refresh();
    }
  }

  async function removeImage(id: number) {
    const ok = await confirm({ title: "Удалить изображение?", message: "Изображение будет удалено.", confirmLabel: "Удалить", danger: true });
    if (!ok) return;
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
      {loading && <p className="muted">Загрузка…</p>}
      {error && (
        <div className="card" style={{ borderColor: "var(--danger, #c00)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ color: "var(--danger, #c00)", fontSize: 13 }}>{error}</span>
          <button onClick={() => load()}>Повторить</button>
        </div>
      )}
      {!loading && images.length === 0 && ownerType === "campaign_player_section" && !error && (
        <EmptyState icon="skullDie" title="ГАЛЕРЕЯ ПУСТА" hint={IMAGE_HINT} action={<label className="primary" style={{ padding: "6px 12px", border: "1px solid var(--primary-bg)", cursor: "pointer" }}>Выбрать файлы<input type="file" accept={IMAGE_ACCEPT} multiple style={{ display: "none" }} onChange={(e) => uploadFiles(e.target.files)} /></label>} />
      )}
      <div className="gallery-grid">
        {images.map((img, i) => (
          <div
            key={img.id}
            className="gallery-thumb-wrap"
            draggable
            onDragStart={() => setDragId(img.id)}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragId != null) {
                reorder(dragId, img.id);
                setDragId(null);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, id: img.id });
            }}
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
      {images.length === 0 && ownerType !== "campaign_player_section" && <span className="muted image-hint">{IMAGE_HINT}</span>}

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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[{ label: "Удалить", danger: true, onClick: () => removeImage(menu.id) }]}
          onClose={() => setMenu(null)}
        />
      )}
      {confirmDialog}
    </div>
  );
}
