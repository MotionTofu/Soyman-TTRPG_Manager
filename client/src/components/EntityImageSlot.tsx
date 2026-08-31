import { useState } from "react";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";

interface Props {
  title: string;
  hint: string;
  url: string | null;
  wide?: boolean;
  uploading: boolean;
  onSelect: (file: File | null) => void;
  onDelete?: () => void;
}

// Единый модуль превью 16/10 + оверлей удаления — работает и в сеттинге, и в кампании.
// Вынесён из SettingDetailPage.ImageSlot, чтобы механизм был один (D-P1-5, U-P1-4).
export function EntityImageSlot({ title, hint, url, wide, uploading, onSelect, onDelete }: Props) {
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) onSelect(file);
  }
  function handlePaste(e: React.ClipboardEvent) {
    const file = e.clipboardData.files?.[0];
    if (file && file.type.startsWith("image/")) {
      e.preventDefault();
      onSelect(file);
    }
  }

  return (
    <div
      className="stack entity-image-slot"
      onPaste={handlePaste}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <strong>{title}</strong>
      <div style={{ position: "relative", width: "100%", maxWidth: wide ? 320 : 288 }}>
        <label
          className={`entity-image-frame${wide ? " wide" : ""}${uploading ? " uploading" : ""}${dragOver ? " drag-over" : ""}`}
          title={`${IMAGE_HINT} · Перетащите файл сюда или вставьте из буфера (Ctrl+V)`}
        >
          {url ? (
            <img src={url} alt="" />
          ) : (
            <span className="muted entity-image-empty">Нажмите, чтобы загрузить</span>
          )}
          <span className="avatar-upload-hint">{uploading ? "Загрузка…" : url ? "Заменить" : "Загрузить"}</span>
          <input
            type="file"
            accept={IMAGE_ACCEPT}
            style={{ display: "none" }}
            onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
          />
        </label>
        {url && onDelete && (
          <button
            type="button"
            className="entity-image-delete"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            disabled={uploading}
            title="Удалить изображение"
            aria-label="Удалить изображение"
          >
            ✕
          </button>
        )}
      </div>
      <span className="muted image-hint" style={{ fontSize: "var(--fs-micro)" }}>
        {hint}
      </span>
    </div>
  );
}
