import { useState } from "react";
import { useAction, useAfterWrite, useResource, write } from "../data/hooks";
import { useCurrentUser } from "../api/currentUser";
import { PC_PARTICIPATION_FIELDS } from "../beingForce";
import { PaperFieldsCard } from "./PaperFieldsCard";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useImageCrop } from "../hooks/useImageCrop";
import { formatImportantDate } from "../inworldCalendar";
import type { Character, CharacterChapter, DateRecurrence, RelationTone } from "../types";
import { RELATION_TONE_COLORS, RELATION_TONE_LABELS } from "../relations";
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
 *
 * На бумаге (гриллинг профилей 2026-10-02, Q16; доска 37): сверху «В
 * кампании» и «Зацепки» — оба только Мастеру, — ниже разделы сгибами.
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
  const { user } = useCurrentUser();
  const isGm = user?.role !== "player";
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
  const hooks = chapters.filter((c) => c.section === "hooks");
  return (
    <div className="character-dossier-extra paper-scope paper-sheet">
      {isGm && character.campaign_id != null && (
        <CampaignParticipation
          characterId={character.id}
          campaignId={character.campaign_id}
          campaignName={character.campaign_name ?? null}
        />
      )}
      {isGm && (
        <section className="character-dossier__hooks">
          <h3 className="paper-group__head">
            Зацепки <span className="paper-group__count">· {hooks.length}</span>
          </h3>
          <HookList characterId={character.id} hooks={hooks} />
        </section>
      )}
      {SECTIONS.map((s) => {
        const list = chapters.filter((c) => c.section === s.key);
        return (
          <details key={s.key} className="paper-fold" open={list.length > 0}>
            <summary>
              {s.label} <span className="paper-fold__count">· {list.length}</span>
              {s.note && character.system_code === "phb" && <span className="dossier-note">{s.note}</span>}
            </summary>
            <div className="paper-fold__body">
              <ChapterList ownerId={character.id} ownerType="character" apiBase="/characters" section={s.key} chapters={list} />
            </div>
          </details>
        );
      })}
      <details className="paper-fold">
        <summary>Галерея</summary>
        <div className="paper-fold__body">
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
        </div>
      </details>
      <details className="paper-fold">
        <summary>
          Важные даты <span className="paper-fold__count">· {character.important_dates?.length ?? 0}</span>
        </summary>
        <div className="paper-fold__body">
          <ImportantDates character={character} />
        </div>
      </details>
    </div>
  );
}

/**
 * Зацепки — строками, как на доске 37: одна фраза, правка по клику. Лежат
 * главами раздела `hooks`; длинный текст главы им не нужен.
 */
function HookList({ characterId, hooks }: { characterId: number; hooks: CharacterChapter[] }) {
  const run = useAction();
  const affects = [{ kind: "character" as const, id: characterId }];
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState("");

  function start(id: number | "new", text: string) {
    setDraft(text);
    setEditing(id);
  }
  async function submit() {
    const title = draft.trim();
    if (!title) return setEditing(null);
    const ok = await run(
      () =>
        (editing === "new"
          ? write.post(`/characters/${characterId}/chapters`, { section: "hooks", title })
          : write.put(`/characters/chapters/${editing}`, { title })
        ).then(() => true),
      { affects, retry: false }
    );
    if (ok) setEditing(null);
  }
  async function remove(id: number) {
    await run(() => write.del(`/characters/chapters/${id}`), { affects });
  }

  const editor = (
    <form
      className="hook-list__edit"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        autoFocus
        value={draft}
        placeholder="Чем историю зацепить персонажа"
        aria-label="Зацепка"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
      />
      <button type="submit" className="primary">
        Сохранить
      </button>
      <button type="button" onClick={() => setEditing(null)}>
        Отмена
      </button>
    </form>
  );

  return (
    <>
      {hooks.length > 0 && (
        <ul className="paper-rows hook-list">
          {hooks.map((h) => (
            <li key={h.id}>
              {editing === h.id ? (
                editor
              ) : (
                <>
                  <button type="button" className="hook-list__text paper-rows__main" onClick={() => start(h.id, h.title)}>
                    {h.title || h.content}
                  </button>
                  <button type="button" className="comp-mini" title="Убрать зацепку" onClick={() => void remove(h.id)}>
                    ✕
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing === "new" ? (
        editor
      ) : (
        <button type="button" className="editable-card-add" onClick={() => start("new", "")}>
          + Зацепка
        </button>
      )}
    </>
  );
}

/**
 * «В кампании»: почему здесь · личная ставка · почему сейчас (словарь граф
 * №21). Хранится в таблице участия (кампания + персонаж), не на персонаже:
 * в другой кампании у того же героя другие причины. Пишет только Мастер.
 */
function CampaignParticipation({
  characterId,
  campaignId,
  campaignName,
}: {
  characterId: number;
  campaignId: number;
  campaignName: string | null;
}) {
  const path = `/participations/campaign/${campaignId}/character/${characterId}`;
  const state = useResource<{ data: Record<string, string> }>(path);
  const run = useAction();

  async function save(next: Record<string, string>) {
    const done = await run(() => write.put(path, { data: next }).then(() => true), { affects: [{ path }] });
    if (!done) throw new Error("Не сохранилось");
  }

  return (
    <PaperFieldsCard
      strong
      label={campaignName ? `В кампании · ${campaignName}` : "В кампании"}
      fields={PC_PARTICIPATION_FIELDS}
      values={state.data?.data ?? {}}
      onSave={save}
      empty="Почему персонаж здесь и что для него на кону."
    />
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
export function CharacterRelationsModal({
  character,
  readOnly,
  onClose,
}: {
  character: Character;
  /** Игрок: только просмотр связей с тем, что он и так видит. */
  readOnly?: boolean;
  onClose: () => void;
}) {
  if (readOnly) {
    return (
      <Modal wide className="sheet-side-modal" ariaLabel="Отношения" onClose={onClose}>
        <div className="sheet-side-modal-head">
          <h2>Отношения · {character.character_name}</h2>
          <button type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <PlayerRelationsList characterId={character.id} />
      </Modal>
    );
  }
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

type PlayerRelation = {
  id: number;
  direction: "out" | "in";
  tone: RelationTone;
  label: string;
  description: string;
  other_name: string | null;
};

/**
 * Связи персонажа глазами игрока — только чтение. Сервер отдаёт лишь те, чей
 * другой конец игрок и так видит (сопартийцы, выданное Мастером), поэтому
 * здесь ничего не прячется и не считается.
 */
function PlayerRelationsList({ characterId }: { characterId: number }) {
  const state = useResource<PlayerRelation[]>(`/player/characters/${characterId}/relations`);
  if (state.error) return <p className="error">{state.error}</p>;
  if (!state.data) return <p className="muted">Загрузка…</p>;
  if (state.data.length === 0) return <p className="muted">Отношений пока нет — их заводит Мастер по ходу игры.</p>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {state.data.map((r) => (
        <div key={r.id} className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <span
            title={RELATION_TONE_LABELS[r.tone]}
            aria-label={RELATION_TONE_LABELS[r.tone]}
            style={{ width: 10, height: 10, borderRadius: "50%", marginTop: 6, flex: "none", background: RELATION_TONE_COLORS[r.tone] }}
          />
          <span style={{ minWidth: 0 }}>
            <strong>{r.other_name ?? "—"}</strong>
            {r.label && <span className="muted"> · {r.direction === "in" ? `${r.label} (к вам)` : r.label}</span>}
            {r.description && <div style={{ whiteSpace: "pre-wrap" }}>{r.description}</div>}
          </span>
        </div>
      ))}
    </div>
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
