import { useState } from "react";
import { useAfterWrite, write } from "../data/hooks";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useImageCrop } from "../hooks/useImageCrop";
import { formatImportantDate } from "../inworldCalendar";
import type { Character, DateRecurrence } from "../types";
import { ChapterList } from "./ChapterList";
import { GalleryTab } from "./GalleryTab";
import { RelationsTab } from "./RelationsTab";
import { GraphNeighbourhoodLink } from "./GraphNeighbourhoodLink";
import { ConfirmModal } from "./ConfirmModal";
import { Modal } from "./Modal";

/**
 * Досье персонажа на листе (гриллинг «персонаж = лист» 2026-09-27, Q4/Q5,
 * Q25/Q26): главы профиля, записи об имуществе, галерея с миниатюрой для
 * пина и важные даты. У D&D встаёт под четыре поля «Характера» во вкладке
 * «Досье», у LitM и персонажа без листа — окном из «⋯». Данные остаются
 * там же, где жили в профиле: в OneShot уходят только поля листа.
 */
const SECTIONS: { key: string; label: string; note?: string }[] = [
  { key: "personality", label: "Личность" },
  { key: "backstory", label: "Предыстория" },
  { key: "personal_arc", label: "Приключение" },
  {
    key: "inventory",
    label: "Имущество — записи",
    note: "вещи с весом и ценой — во вкладке «Снаряжение»",
  },
];

export function CharacterDossier({ character }: { character: Character }) {
  const afterWrite = useAfterWrite();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thumbnailCrop = useImageCrop("thumbnail", uploadThumbnail);

  async function uploadThumbnail(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Можно загружать только изображения");
    if (file.size > 15 * 1024 * 1024) return setError("Файл слишком большой — лимит 15 МБ");
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await write.post(`/characters/${character.id}/thumbnail`, form, {
        timeoutMs: 60_000,
      });
      afterWrite([{ kind: "character", id: character.id }]);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setUploading(false);
    }
  }

  const chapters = character.chapters ?? [];
  return (
    <div className="character-dossier-extra">
      {SECTIONS.map((s) => {
        const list = chapters.filter((c) => c.section === s.key);
        return (
          <details key={s.key} className="dossier-section" open={list.length > 0}>
            <summary>
              {s.label}
              <span className="dossier-count">{list.length}</span>
              {s.note && character.system_code === "phb" && <span className="dossier-note">{s.note}</span>}
            </summary>
            <ChapterList ownerId={character.id} ownerType="character" apiBase="/characters" section={s.key} chapters={list} />
          </details>
        );
      })}
      <details className="dossier-section">
        <summary>Галерея</summary>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <GalleryTab
          ownerType="character"
          ownerId={character.id}
          thumbnailUpload={{
            previewUrl: character.thumbnail_image_url,
            uploading,
            onSelect: thumbnailCrop.onSelect,
            modal: thumbnailCrop.modal,
          }}
        />
      </details>
      <details className="dossier-section">
        <summary>
          Важные даты
          <span className="dossier-count">{character.important_dates?.length ?? 0}</span>
        </summary>
        <ImportantDates character={character} />
      </details>
    </div>
  );
}

/** Окно досье — для листа LitM и персонажа без листа (пункт «Досье» в «⋯»). */
export function CharacterDossierModal({ character, onClose }: { character: Character; onClose: () => void }) {
  return (
    <Modal wide className="sheet-side-modal" ariaLabel="Досье" onClose={onClose}>
      <div className="sheet-side-modal-head">
        <h2>Досье · {character.character_name}</h2>
        <button type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <CharacterDossier character={character} />
    </Modal>
  );
}

/** «Отношения» — кнопкой на обороте карты D&D и пунктом «⋯» (Q4, Q28). */
export function CharacterRelationsModal({ character, onClose }: { character: Character; onClose: () => void }) {
  return (
    <Modal wide className="sheet-side-modal" ariaLabel="Отношения" onClose={onClose}>
      <div className="sheet-side-modal-head">
        <h2>Отношения · {character.character_name}</h2>
        <GraphNeighbourhoodLink type="character" id={character.id} />
        <button type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <RelationsTab
        entityType="character"
        entityId={character.id}
        entityName={character.character_name}
        defaultSettingId={character.campaign_setting_id ?? undefined}
      />
    </Modal>
  );
}

function ImportantDates({ character }: { character: Character }) {
  const afterWrite = useAfterWrite();
  const calendar = useSettingCalendar(character.campaign_setting_id);
  const [title, setTitle] = useState("");
  const [recurrence, setRecurrence] = useState<DateRecurrence>("once");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const dates = character.important_dates ?? [];

  async function add() {
    setError(null);
    const t = title.trim();
    if (!t) return setError("Введите название");
    if (t.length > 80) return setError("Название — до 80 символов");
    const dayNum = Number(day);
    if (!day || !Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) return setError("День — число 1..31");
    if (recurrence === "once" && year && !Number.isFinite(Number(year))) return setError("Год — число");
    setSaving(true);
    try {
      await write.post(`/characters/${character.id}/important-dates`, {
        title: t,
        recurrence,
        year: recurrence === "once" ? (year ? Number(year) : null) : null,
        month: recurrence !== "monthly" ? (month ? Number(month) : null) : null,
        day: dayNum,
      });
      setTitle("");
      setYear("");
      setMonth("");
      setDay("");
      afterWrite([{ kind: "character", id: character.id }]);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (pendingDeleteId == null) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      await write.del(`/characters/important-dates/${id}`);
      afterWrite([{ kind: "character", id: character.id }]);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  const pending = dates.find((d) => d.id === pendingDeleteId);
  return (
    <div className="stack">
      {!character.campaign_setting_id && (
        <span className="muted">У кампании не привязан сеттинг — календарь недоступен, но даты всё равно можно добавлять.</span>
      )}
      {dates.map((d) => (
        <div key={d.id} className="row" style={{ justifyContent: "space-between" }}>
          <span>
            <strong>{d.title}</strong> — {formatImportantDate(d, calendar?.months ?? [], calendar?.weekdays ?? [])}
          </span>
          <button className="danger comp-mini" onClick={() => setPendingDeleteId(d.id)} aria-label={`Удалить дату ${d.title}`}>
            ✕
          </button>
        </div>
      ))}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <input
          placeholder="Название (напр. День рождения)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          aria-label="Название даты"
          style={{ flex: "1 1 200px", minWidth: 0 }}
        />
        <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as DateRecurrence)} aria-label="Повторение">
          <option value="once">Разовое</option>
          <option value="annual">Ежегодное</option>
          <option value="monthly">Ежемесячное</option>
        </select>
        {recurrence === "once" && (
          <input
            type="number"
            placeholder="Год"
            style={{ width: 80 }}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            aria-label="Год"
          />
        )}
        {recurrence !== "monthly" && (
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Месяц">
            <option value="">Месяц…</option>
            {(calendar?.months ?? []).map((m) => (
              <option key={m.id} value={m.position}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <input
          type="number"
          placeholder="День"
          style={{ width: 70 }}
          value={day}
          onChange={(e) => setDay(e.target.value)}
          min={1}
          max={31}
          aria-label="День"
        />
        <button className="primary" onClick={() => void add()} disabled={saving}>
          {saving ? "Добавление…" : "Добавить"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {pendingDeleteId != null && (
        <ConfirmModal
          title="Удалить дату?"
          message={pending ? `Удалить «${pending.title}»?` : "Удалить эту дату?"}
          confirmLabel="Удалить"
          cancelLabel="Отмена"
          danger
          onClose={() => setPendingDeleteId(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}
