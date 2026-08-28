import { useEffect, useState } from "react";
import { api } from "../api/client";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { useImageCrop } from "../hooks/useImageCrop";

// Вкладка «Изображения» профиля записи компендиума — бестиария и транспорта.
// Собрана из двух подразделов, потому что у записи две разные картинки и
// раньше их путали: аватар — портрет самого существа (плитка бестиария,
// модалка предпросмотра, карточка существа), портрет статблока — арт внутри
// конкретной карточки правил. Смысл вкладки в том, что обе меняются в одном
// месте: раньше портрет статблока правился только изнутри статблока, а своего
// аватара у записи не было вовсе — плитка показывала картинку статблока.
interface StatblockSummary {
  id: number;
  kind: string;
  note: string | null;
  avatar_image_url: string | null;
}

export function EntryImagesTab({
  entryId,
  entryName,
  entryKind,
  avatarUrl,
  onChange,
}: {
  entryId: number;
  entryName: string;
  entryKind: string;
  avatarUrl: string | null;
  onChange: () => void;
}) {
  // Карточка существа есть только у бестиария — у поста экипажа обещать её в
  // подсказке нельзя, иначе Мастер пойдёт искать вкладку, которой нет.
  const hasCreatureCard = entryKind === "monster";
  const [statblocks, setStatblocks] = useState<StatblockSummary[]>([]);

  function loadStatblocks() {
    api
      .get<StatblockSummary[]>(`/statblocks?owner_type=compendium_entry&owner_id=${entryId}`)
      .then(setStatblocks)
      .catch(() => setStatblocks([]));
  }

  useEffect(loadStatblocks, [entryId]);

  return (
    <div className="stack">
      <div className="card stack">
        <h3>Аватар</h3>
        <p className="muted" style={{ margin: 0 }}>
          Портрет {entryName} — на плитке раздела
          {hasCreatureCard ? ", в карточке существа" : ""} и в окнах предпросмотра.
          Без него везде показывается монограмма.
        </p>
        <div className="entity-image-slots">
          <EntryImageSlot
            title="Аватар записи"
            hint="Одна картинка на все места, где встречается запись."
            url={avatarUrl}
            uploadUrl={`/systems/entries/${entryId}/avatar`}
            deleteUrl={`/systems/entries/${entryId}/avatar`}
            onDone={onChange}
          />
        </div>
      </div>

      <div className="card stack">
        <h3>Изображения статблоков</h3>
        {statblocks.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            У записи ещё нет статблоков — их изображения появятся здесь вместе с ними.
          </p>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Арт внутри самой карточки правил. Меняется независимо от аватара: в
              статблоке уместен разворот из книги, на плитке — морда.
            </p>
            <div className="entity-image-slots">
              {statblocks.map((sb) => (
                <EntryImageSlot
                  key={sb.id}
                  title={sb.kind === "short" ? "Краткий статблок" : "Полный статблок"}
                  hint={sb.note?.trim() || "Показывается в шапке статблока."}
                  url={sb.avatar_image_url}
                  uploadUrl={`/statblocks/${sb.id}/avatar`}
                  deleteUrl={`/statblocks/${sb.id}/avatar`}
                  onDone={loadStatblocks}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Одна ячейка: превью, оно же кнопка замены (как в «Изображениях сеттинга»),
// плюс «Убрать» — без неё нельзя вернуться к пустому состоянию, а загрузив не
// ту картинку, Мастер оставался с ней навсегда.
function EntryImageSlot({
  title,
  hint,
  url,
  uploadUrl,
  deleteUrl,
  onDone,
}: {
  title: string;
  hint: string;
  url: string | null;
  uploadUrl: string;
  deleteUrl: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(uploadUrl, form);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  const crop = useImageCrop("square", upload);

  async function remove() {
    if (!confirm("Убрать изображение? Файл уйдёт в архив хранилища.")) return;
    setBusy(true);
    try {
      await api.del(deleteUrl);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack entity-image-slot">
      <strong>{title}</strong>
      <label className={`entity-image-frame${busy ? " uploading" : ""}`} title={IMAGE_HINT}>
        {url ? (
          <img src={url} alt="" />
        ) : (
          <span className="muted entity-image-empty">Нажмите, чтобы загрузить</span>
        )}
        <span className="avatar-upload-hint">
          {busy ? "Загрузка…" : url ? "Заменить" : "Загрузить"}
        </span>
        <input
          type="file"
          accept={IMAGE_ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => crop.onSelect(e.target.files?.[0] ?? null)}
        />
      </label>
      <span className="muted image-hint">{hint}</span>
      {url && (
        <button className="ghost" onClick={remove} disabled={busy}>
          Убрать
        </button>
      )}
      {crop.modal}
    </div>
  );
}
