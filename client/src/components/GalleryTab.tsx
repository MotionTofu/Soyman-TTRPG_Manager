import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { getAuthToken } from "../api/client";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import type { GalleryImage } from "../types";
import { ImageLightbox } from "./ImageLightbox";
import { EmptyState } from "./EmptyState";
import { useConfirm } from "../hooks/useConfirm";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { ContextMenu } from "./ContextMenu";
import { isSafeImageUrl } from "../utils/safeUrl";
import { EntityImageSlot } from "./EntityImageSlot";

// Lets the owning detail page (Character/Being) keep its own useImageCrop
// state/handler but render the thumbnail-upload control inside the Gallery
// tab, next to the rest of this entity's images, instead of up in the
// avatar column.
interface ThumbnailUploadProps {
  previewUrl: string | null;
  uploading: boolean;
  onSelect: (file: File | null) => void;
  modal: ReactNode;
  onDelete?: () => void;
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
  const { offerUndo } = useUndoDelete();
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const [gridDragOver, setGridDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function load() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    api
      .get<GalleryImage[]>(`/gallery?owner_type=${ownerType}&owner_id=${ownerId}`, { signal: controller.signal } as any)
      .then((data) => {
        if (controller.signal.aborted) return;
        setImages(data);
        setLoading(false);
      })
      .catch((e: any) => {
        if (e?.name === "AbortError") return;
        if (controller.signal.aborted) return;
        setError(e?.message ?? "Ошибка загрузки галереи");
        setLoading(false);
      });
  }
  function refresh() {
    load();
  }
  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerType, ownerId]);

  async function uploadFiles(files: FileList | null, resetTarget?: HTMLInputElement | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadProgress({ done: 0, total: files.length });
    setError(null);
    try {
      const list = Array.from(files);
      const CONCURRENCY = 3;
      const results: PromiseSettledResult<unknown>[] = [];
      for (let i = 0; i < list.length; i += CONCURRENCY) {
        const chunk = list.slice(i, i + CONCURRENCY);
        const chunkResults = await Promise.allSettled(
          chunk.map(async (file) => {
            const form = new FormData();
            form.append("file", file);
            form.append("owner_type", ownerType);
            form.append("owner_id", String(ownerId));
            return api.post("/gallery", form);
          })
        );
        results.push(...chunkResults);
        setUploadProgress({ done: Math.min(i + CONCURRENCY, list.length), total: list.length });
      }
      const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      if (failed.length) {
        const firstMsg = failed[0].reason?.message ?? "";
        const suffix = failed.length > 1 ? ` (ещё ${failed.length - 1} не загружено)` : "";
        setError(firstMsg ? `${firstMsg}${suffix}` : `Не загружено ${failed.length} файлов${suffix}`);
      }
    } catch (e: any) {
      setError(e?.message ?? "Ошибка загрузки");
    } finally {
      setUploading(false);
      setUploadProgress(null);
      if (resetTarget) resetTarget.value = "";
      refresh();
    }
  }

  // Удаление без блокирующего native confirm — 409 обрабатывается модалками (C-P0-7)
  //
  // Возвращает `null`, если Мастер передумал в диалоге, и `undoId` — номер
  // записи отмены, когда файл уехал в `_Archive` и его есть чем вернуть. После
  // «удалить навсегда» отменять нечего, и сервер номера не даёт: тост в этом
  // случае не показывается, иначе он обещал бы невозможное.
  async function deleteWithChoice(path: string): Promise<{ undoId: number | null } | null> {
    const BASE = "/api";
    const token = getAuthToken();
    const doDelete = (mode?: "forever" | "archive") =>
      fetch(`${BASE}${path}${mode ? `?mode=${mode}` : ""}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    let res = await doDelete();
    if (res.status === 409) {
      const toArchive = await confirm({
        title: "Последняя копия файла",
        message: "Это последняя копия этого файла в хранилище. Отправить в архив (останется на странице «Архив») или удалить навсегда?",
        confirmLabel: "В архив",
        danger: false,
      });
      if (toArchive) {
        res = await doDelete("archive");
      } else {
        const forever = await confirm({
          title: "Удалить навсегда?",
          message: "Файл будет удалён без возможности восстановления. Продолжить?",
          confirmLabel: "Удалить навсегда",
          danger: true,
        });
        if (!forever) return null;
        res = await doDelete("forever");
      }
    }
    if (!res.ok) {
      const text = await res.text();
      let msg = text;
      try { const p = JSON.parse(text); if (p?.error) msg = p.error; } catch {}
      throw new Error(msg || `${res.status}`);
    }
    let undoId: number | null = null;
    try {
      const body = (await res.json()) as { undo_id?: number };
      if (typeof body?.undo_id === "number") undoId = body.undo_id;
    } catch {
      // Пустой ответ — просто нечего отменять.
    }
    return { undoId };
  }

  async function removeImage(id: number) {
    const ok = await confirm({ title: "Удалить изображение?", message: "Изображение будет удалено из галереи.", confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    const image = images.find((i) => i.id === id);
    let outcome: { undoId: number | null } | null;
    try {
      outcome = await deleteWithChoice(`/gallery/${id}`);
      if (!outcome) return;
    } catch (e: any) {
      setError(e?.message ?? "Ошибка удаления");
      return;
    }
    setLightboxIndex(null);
    refresh();
    const undoId = outcome.undoId;
    if (undoId == null) return;
    offerUndo({
      entityName: image?.caption?.trim() || "Изображение",
      restoreFn: async () => {
        await api.put(`/gallery/undo/${undoId}`, {});
        refresh();
      },
    });
  }

  async function saveCaption(id: number, caption: string) {
    const trimmed = caption.trim().slice(0, 500);
    try {
      await api.put(`/gallery/${id}`, { caption: trimmed });
      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, caption: trimmed } : img)));
    } catch (e: any) {
      setError(e?.message ?? "Не удалось сохранить подпись");
    }
  }

  async function reorder(draggedId: number, targetId: number) {
    if (draggedId === targetId) return;
    const ids = images.map((i) => i.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    const order = new Map(ids.map((id, i) => [id, i]));
    const prev = [...images];
    setImages((p) => [...p].sort((a, b) => order.get(a.id)! - order.get(b.id)!));
    try {
      await api.put("/gallery/reorder", { order: ids });
    } catch (e: any) {
      setImages(prev);
      setError(e?.message ?? "Не удалось изменить порядок");
    }
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
    const ok = await confirm({ title: "Отсортировать по алфавиту?", message: "Текущий порядок будет перезаписан сортировкой по подписи (или имени файла). Отменить нельзя, но можно перетащить заново.", confirmLabel: "Сортировать", danger: false });
    if (!ok) return;
    const ids = [...images].sort((a, b) => labelFor(a).localeCompare(labelFor(b), "ru")).map((i) => i.id);
    const order = new Map(ids.map((id, i) => [id, i]));
    const prev = [...images];
    setImages((p) => [...p].sort((a, b) => order.get(a.id)! - order.get(b.id)!));
    try {
      await api.put("/gallery/reorder", { order: ids });
    } catch (e: any) {
      setImages(prev);
      setError(e?.message ?? "Не удалось отсортировать");
    }
  }

  function safeImageUrl(url: string): string {
    return isSafeImageUrl(url) ? url : "";
  }

  const galleryTitle =
    ownerType === "being"
      ? "ИЗОБРАЖЕНИЯ СУЩЕСТВА"
      : ownerType === "community"
        ? "ИЗОБРАЖЕНИЯ СООБЩЕСТВА"
        : ownerType === "character"
          ? "ИЗОБРАЖЕНИЯ ПЕРСОНАЖА"
          : ownerType === "artifact"
            ? "ИЗОБРАЖЕНИЯ ПРЕДМЕТА"
            : "ИЗОБРАЖЕНИЯ ЛОКАЦИИ";
  const galleryHint =
    ownerType === "being"
      ? "Портреты, референсы и мудборд существа — изображения-содержимое не проходят дуотон и показываются как загружено."
      : "Референсы, карты и мудборд локации — изображения-содержимое не проходят дуотон и показываются как загружено.";

  return (
    <div className="stack gallery-tab">
      <div className="gallery-tab-header">
        <span className="gallery-tab-title">{galleryTitle}</span>
        <span className="gallery-tab-count" aria-label={`Всего ${images.length} изображений`}>{images.length}</span>
      </div>
      <p className="muted gallery-tab-hint" style={{ fontSize: "var(--fs-meta)", lineHeight: 1.4, margin: 0 }}>
        {galleryHint} {IMAGE_HINT} до 15MB. Перетащите файлы на сетку или нажмите «+ Добавить».
      </p>

      {(thumbnailUpload || avatarUpload) && (
        <div className="entity-image-slots">
          {thumbnailUpload && (
            <EntityImageSlot
              title="Тамбнейл — 16×10"
              hint="Карточка в списке Географии. Рекомендуем 900×562 (16×10), до 15 MB, JPG/PNG/GIF/WebP/AVIF."
              url={thumbnailUpload.previewUrl}
              uploading={thumbnailUpload.uploading}
              onSelect={thumbnailUpload.onSelect}
              onDelete={thumbnailUpload.onDelete}
            />
          )}
          {avatarUpload && (
            <EntityImageSlot
              title="Аватар — квадрат 1:1"
              hint="Запасной вариант для списка, когда тамбнейл не задан. Рекомендуем 700×700, до 15 MB."
              url={avatarUpload.previewUrl}
              uploading={avatarUpload.uploading}
              onSelect={avatarUpload.onSelect}
              onDelete={avatarUpload.onDelete}
            />
          )}
        </div>
      )}
      {thumbnailUpload?.modal}
      {avatarUpload?.modal}
      {images.length > 1 && (
        <button type="button" className="comp-mini" onClick={sortAlphabetically} title="Отсортировать по алфавиту (по подписи)" style={{ alignSelf: "flex-start", fontFamily: "var(--font-ui)", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "var(--fs-meta)" }}>
          А-Я
        </button>
      )}
      {loading && <p className="muted" aria-busy="true">Загрузка…</p>}
      {error && (
        <div className="card" style={{ borderColor: "var(--danger, #c00)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ color: "var(--danger, #c00)", fontSize: "var(--fs-meta)" }}>{error}</span>
          <button onClick={() => load()}>Повторить</button>
        </div>
      )}
      {!loading && images.length === 0 && !error && (
        <EmptyState title="Галерея пуста" hint={IMAGE_HINT} action={<label className="primary" style={{ padding: "6px 12px", border: "1px solid var(--primary-bg)", cursor: "pointer" }}>Выбрать файлы<input type="file" accept={IMAGE_ACCEPT} multiple style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }} tabIndex={-1} aria-hidden="true" onChange={(e) => uploadFiles(e.target.files, e.target as HTMLInputElement)} /></label>} />
      )}
      {uploadProgress && (
        <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }} aria-live="polite">
          Загрузка {uploadProgress.done} / {uploadProgress.total}…
        </div>
      )}
      {(!loading && images.length > 0) || loading ? (
      <div
        className={`gallery-grid${gridDragOver ? " drag-over" : ""}`}
        onDragEnter={() => setGridDragOver(true)}
        onDragLeave={() => setGridDragOver(false)}
        onDragOver={(e) => { e.preventDefault(); setGridDragOver(true); }}
        onDrop={(e) => {
          e.preventDefault();
          setGridDragOver(false);
          const files = e.dataTransfer.files;
          if (files && files.length) uploadFiles(files, null);
        }}
      >
        {images.map((img, i) => {
          const safeUrl = safeImageUrl(img.image_url);
          const label = labelFor(img);
          return (
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
            title={label}
            role="button"
            tabIndex={0}
            aria-label={`Открыть ${label || `изображение ${i + 1}`}`}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLightboxIndex(i); } }}
          >
            {safeUrl ? (
              <img
                src={safeUrl}
                alt={img.caption || label || `Изображение ${i + 1}`}
                className="gallery-thumb"
                loading="lazy"
                decoding="async"
                onClick={() => setLightboxIndex(i)}
              />
            ) : (
              <div className="gallery-thumb gallery-thumb-broken" aria-label="Битый URL изображения">×</div>
            )}
            <button
              type="button"
              className="gallery-thumb-delete"
              aria-label={`Удалить ${label || `изображение ${i + 1}`}`}
              title="Удалить (или правый клик)"
              onClick={(e) => { e.stopPropagation(); removeImage(img.id); }}
            >
              ×
            </button>
            {label && <span className="gallery-thumb-caption" aria-hidden="true">{label}</span>}
          </div>
        );})}
        <label className="gallery-upload-tile" title="Нажмите или перетащите файлы сюда">
          {uploading && uploadProgress ? `Загрузка ${uploadProgress.done}/${uploadProgress.total}…` : uploading ? "Загрузка…" : "+ Добавить"}
          <input
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => uploadFiles(e.target.files, e.target as HTMLInputElement)}
          />
        </label>
      </div>
      ) : null}
      {images.length === 0 && !loading && !error && <span className="muted image-hint" style={{ display: "none" }} aria-hidden="true">{IMAGE_HINT}</span>}

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
