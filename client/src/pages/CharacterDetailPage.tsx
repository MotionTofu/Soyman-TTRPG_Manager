import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { RelationsTab } from "../components/RelationsTab";
import { StatblockList } from "../components/StatblockList";
import { ChapterList } from "../components/ChapterList";
import { GalleryTab } from "../components/GalleryTab";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { useTabState } from "../hooks/useTabState";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useImageCrop } from "../hooks/useImageCrop";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { formatImportantDate } from "../inworldCalendar";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { GraphNeighbourhoodLink } from "../components/GraphNeighbourhoodLink";
import type { Character, DateRecurrence, EntityRelationsResponse, Statblock } from "../types";
import { NavIcon } from "../components/NavIcons";
import { normalizeDndCharacter } from "../components/dnd/DndCharacterForm";
import { EmptyState } from "../components/EmptyState";
import { ConfirmModal } from "../components/ConfirmModal";

// Досье bundles these as collapsible sub-sections in one tab; the remaining
// chapter sections stay standalone tabs.
const DOSSIER_SECTIONS: { key: "personality" | "backstory" | "personal_arc"; label: string }[] = [
  { key: "personality", label: "Личность" },
  { key: "backstory", label: "Предыстория" },
  { key: "personal_arc", label: "Приключение" },
];

const TABS = [
  { key: "statblock" as const, label: "Чарник" },
  { key: "about" as const, label: "Досье" },
  { key: "relations" as const, label: "Отношения" },
  { key: "future_thoughts" as const, label: "Заметки" },
  { key: "inventory" as const, label: "Имущество" },
  { key: "gallery" as const, label: "Галерея" },
];
const TAB_KEYS = TABS.map((t) => t.key);

export function CharacterDetailPage() {
  const { id } = useParams();
  const characterId = Number(id);
  const navigate = useNavigate();

  const [character, setCharacter] = useState<Character | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, selectTab] = useTabState(TAB_KEYS, "statblock");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [shortNameDraft, setShortNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [dateTitle, setDateTitle] = useState("");
  const [dateRecurrence, setDateRecurrence] = useState<DateRecurrence>("once");
  const [dateYear, setDateYear] = useState("");
  const [dateMonth, setDateMonth] = useState("");
  const [dateDay, setDateDay] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [dateSaving, setDateSaving] = useState(false);
  const [pendingDateDeleteId, setPendingDateDeleteId] = useState<number | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const calendar = useSettingCalendar(character?.campaign_setting_id);
  const avatarCrop = useImageCrop("square", handleAvatarChange);
  const thumbnailCrop = useImageCrop("thumbnail", handleThumbnailChange);
  const { toast: undoToast, deleteWithUndo, dismiss: dismissUndo } = useUndoDelete();

  function refresh(signal?: AbortSignal) {
    setLoadError(null);
    setNotFound(false);
    api
      .get<Character>(`/characters/${characterId}`, signal ? { signal } : undefined)
      .then((c) => {
        setCharacter(c);
        setNameDraft(c.character_name);
        setShortNameDraft(c.short_name ?? "");
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        const msg = String(e instanceof Error ? e.message : e);
        if (msg.includes("404") || msg.toLowerCase().includes("not found")) setNotFound(true);
        else setLoadError(msg);
      });
  }
  useEffect(() => {
    const ctrl = new AbortController();
    refresh(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);
  // сброс черновиков при смене id — C-P1-1
  useEffect(() => {
    setEditingName(false);
    setNameError(null);
    setDateError(null);
    setPendingDateDeleteId(null);
    setShowArchiveConfirm(false);
    setAvatarError(null);
  }, [characterId]);

  // U-P0-2 beforeunload для несохранённых черновиков + Ctrl+S / Esc
  useEffect(() => {
    const isDirty = editingName && (nameDraft !== (character?.character_name ?? "") || shortNameDraft !== (character?.short_name ?? ""));
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    if (isDirty) window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editingName, nameDraft, shortNameDraft, character?.character_name, character?.short_name]);

  useEffect(() => {
    if (!editingName) return;
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveName();
      } else if (e.key === "Escape") {
        setEditingName(false);
        setNameError(null);
        if (character) {
          setNameDraft(character.character_name);
          setShortNameDraft(character.short_name ?? "");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingName, nameDraft, shortNameDraft, characterId]);

  // Live sync — player-app editing this same character (or another open GM
  // instance) pushes here via RealtimeListener's "character-updated" event.
  // Debounced (300ms) to avoid double refresh when both CharacterDetailPage and StatblockList listen.
  useEffect(() => {
    let t: number | null = null;
    function onCharacterUpdated(e: Event) {
      const detail = (e as CustomEvent<{ characterId: number }>).detail;
      if (detail?.characterId !== characterId) return;
      if (t != null) window.clearTimeout(t);
      t = window.setTimeout(() => { t = null; refresh(); }, 300);
    }
    window.addEventListener("character-updated", onCharacterUpdated);
    return () => {
      window.removeEventListener("character-updated", onCharacterUpdated);
      if (t != null) window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  if (notFound) {
    return (
      <div className="stack" style={{ padding: 24 }}>
        <EmptyState icon="barcode" title="Персонаж не найден" hint="Возможно, он был архивирован или ссылка устарела." action={<Link to="/campaigns" className="primary" style={{ display: "inline-block", padding: "8px 16px", border: "1px solid var(--line)", background: "var(--paper-2)", color: "var(--ink)", textDecoration: "none" }}>К кампаниям</Link>} />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="stack" style={{ padding: 24 }}>
        <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Не удалось загрузить персонажа: {loadError}</span>
          <button className="primary" onClick={() => refresh()}>Повторить</button>
        </div>
      </div>
    );
  }
  if (!character) return <p className="muted">Загрузка…</p>;

  async function saveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed) { setNameError("Имя не может быть пустым"); return; }
    if (trimmed.length > 80) { setNameError("Имя — до 80 символов"); return; }
    if (shortNameDraft.trim().length > 40) { setNameError("Короткое имя — до 40 символов"); return; }
    setNameError(null);
    setNameSaving(true);
    try {
      await api.put(`/characters/${characterId}`, {
        character_name: trimmed,
        short_name: shortNameDraft.trim(),
      });
      setEditingName(false);
      refresh();
    } catch (e) {
      setNameError(String(e instanceof Error ? e.message : e));
    } finally {
      setNameSaving(false);
    }
  }

  async function archiveCharacter() {
    if (!character) return;
    setShowArchiveConfirm(false);
    const name = character.character_name || "Без имени";
    await deleteWithUndo({
      entityName: name,
      deleteFn: () => api.del(`/characters/${characterId}`),
      restoreFn: () => api.put(`/characters/${characterId}/restore`),
    });
    navigate(`/campaigns/${character.campaign_id}`);
  }

  async function handleAvatarChange(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setAvatarError("Можно загружать только изображения"); return; }
    if (file.size > 15 * 1024 * 1024) { setAvatarError("Файл слишком большой — лимит 15 МБ"); return; }
    setAvatarError(null);
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/characters/${characterId}/avatar`, form);
      refresh();
    } catch (e) {
      setAvatarError(String(e instanceof Error ? e.message : e));
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleThumbnailChange(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setAvatarError("Можно загружать только изображения"); return; }
    if (file.size > 15 * 1024 * 1024) { setAvatarError("Файл слишком большой — лимит 15 МБ"); return; }
    setAvatarError(null);
    setUploadingThumbnail(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/characters/${characterId}/thumbnail`, form);
      refresh();
    } catch (e) {
      setAvatarError(String(e instanceof Error ? e.message : e));
    } finally {
      setUploadingThumbnail(false);
    }
  }

  async function addImportantDate() {
    setDateError(null);
    const t = dateTitle.trim();
    if (!t) { setDateError("Введите название"); return; }
    if (t.length > 80) { setDateError("Название — до 80 символов"); return; }
    const dayNum = Number(dateDay);
    if (!dateDay || !Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) { setDateError("День — число 1..31"); return; }
    if (dateRecurrence === "once" && dateYear) {
      const y = Number(dateYear);
      if (!Number.isFinite(y)) { setDateError("Год — число"); return; }
    }
    setDateSaving(true);
    try {
      await api.post(`/characters/${characterId}/important-dates`, {
        title: t,
        recurrence: dateRecurrence,
        year: dateRecurrence === "once" ? (dateYear ? Number(dateYear) : null) : null,
        month: dateRecurrence !== "monthly" ? (dateMonth ? Number(dateMonth) : null) : null,
        day: dayNum,
      });
      setDateTitle("");
      setDateYear("");
      setDateMonth("");
      setDateDay("");
      refresh();
    } catch (e) {
      setDateError(String(e instanceof Error ? e.message : e));
    } finally {
      setDateSaving(false);
    }
  }

  async function confirmRemoveDate() {
    if (pendingDateDeleteId == null) return;
    const id = pendingDateDeleteId;
    setPendingDateDeleteId(null);
    try {
      await api.del(`/characters/important-dates/${id}`);
      refresh();
    } catch (e) {
      setDateError(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="stack">
      <Breadcrumbs
        items={[
          { label: "Кампания", to: `/campaigns/${character.campaign_id}` },
          { label: character.player_name ?? "Игрок", to: `/players/${character.player_id}` },
          { label: character.character_name },
        ]}
      />
      <div className="character-layout">
      <div className="character-avatar-col">
        <label className="avatar-upload-label character-avatar-wrap" title={IMAGE_HINT}>
          {character.avatar_image_url ? (
            <div className="character-avatar cover-photo cover-halftone" aria-hidden="true">
              <div className="cover-art-image" style={{ backgroundImage: `url("${character.avatar_image_url}")` }} />
            </div>
          ) : (
            <div className="character-avatar character-avatar-placeholder cover-art-fallback zine-grain">Нет фото</div>
          )}
          <span className="avatar-upload-hint">{uploadingAvatar ? "Загрузка…" : "Сменить фото"}</span>
          <input
            type="file"
            accept={IMAGE_ACCEPT}
            style={{ display: "none" }}
            onChange={(e) => avatarCrop.onSelect(e.target.files?.[0] ?? null)}
          />
        </label>
        {avatarCrop.modal}
      </div>

      <div className="card character-name-block stack">
        <div className="campaign-player-header">
          <span>Персонаж</span>
          <span className="row" style={{ gap: 4 }}>
            <GraphNeighbourhoodLink type="character" id={character.id} />
            <button className="danger comp-mini" onClick={() => setShowArchiveConfirm(true)} aria-label="Архивировать персонажа">
              <NavIcon name="archive" /> Архивировать
            </button>
          </span>
        </div>
        {editingName ? (
          <div className="stack">
            <div className="row" style={{ flexWrap: "wrap" }}>
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus maxLength={80} aria-label="Имя персонажа" onKeyDown={(e) => { if (e.key === "Enter") void saveName(); if (e.key === "Escape") { setEditingName(false); setNameError(null); if (character) { setNameDraft(character.character_name); setShortNameDraft(character.short_name ?? ""); } } }} style={{ flex: "1 1 160px", minWidth: 0 }} />
              <input
                value={shortNameDraft}
                onChange={(e) => setShortNameDraft(e.target.value)}
                placeholder="Короткое имя для карты"
                title="Показывается вместо полного имени в подписи пина на карте локации"
                maxLength={40}
                aria-label="Короткое имя для карты"
                onKeyDown={(e) => { if (e.key === "Enter") void saveName(); if (e.key === "Escape") { setEditingName(false); setNameError(null); if (character) { setNameDraft(character.character_name); setShortNameDraft(character.short_name ?? ""); } } }}
                style={{ flex: "1 1 140px", minWidth: 0 }}
              />
              <button className="primary" onClick={saveName} disabled={nameSaving}>
                {nameSaving ? "Сохранение…" : "Сохранить"}
              </button>
              <button onClick={() => { setEditingName(false); setNameError(null); }} disabled={nameSaving}>Отмена</button>
            </div>
            {nameError && <p className="error" role="alert">{nameError}</p>}
          </div>
        ) : (
          <h1 className="editable-title" onClick={() => setEditingName(true)} title="Нажмите, чтобы переименовать" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setEditingName(true); }} aria-label="Переименовать персонажа">
            {character.character_name}
          </h1>
        )}
        {avatarError && <p className="error" role="alert">{avatarError}</p>}
        <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
          Игрок: <Link to={`/players/${character.player_id}`}>{character.player_name}</Link>
          {" · "}
          Кампания: <Link to={`/campaigns/${character.campaign_id}`}>{character.campaign_name}</Link>
        </div>
      </div>

      <div className="character-tabs-row">
        <div className="tabs" role="tablist" aria-label="Разделы персонажа">
          {TABS.map((s) => (
            <button key={s.key} className={tab === s.key ? "active" : ""} onClick={() => selectTab(s.key)} role="tab" aria-selected={tab === s.key}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      </div>

      <div className="stack">
        {tab === "statblock" && (
          <StatblockList
            ownerType="character"
            ownerId={characterId}
            campaignId={character.campaign_id ?? undefined}
            ownerName={character.character_name}
            ownerPlayerName={character.player_name}
          />
        )}

        {tab === "about" && (
          <div className="stack character-dossier">
            {DOSSIER_SECTIONS.map((s) => (
              <details key={s.key} className="card">
                <summary className="campaign-player-header" style={{ margin: "-14px -14px 10px", cursor: "pointer" }}>
                  {s.label}
                </summary>
                <ChapterList
                  ownerId={characterId}
                  ownerType="character"
                  apiBase="/characters"
                  section={s.key}
                  chapters={(character.chapters ?? []).filter((c) => c.section === s.key)}
                  onChange={refresh}
                />
              </details>
            ))}
            <CharacterRelationsPreview characterId={characterId} characterName={character.character_name} />
          </div>
        )}

        {tab === "relations" && (
          <RelationsTab
            entityType="character"
            entityId={characterId}
            entityName={character.character_name}
            defaultSettingId={character.campaign_setting_id ?? undefined}
          />
        )}

        {tab === "inventory" && (
          <CharacterInventoryTab characterId={characterId} character={character} onRefresh={refresh} />
        )}

        {tab === "future_thoughts" && (
          <div className="stack">
            <ChapterList
              ownerId={characterId}
              ownerType="character"
              apiBase="/characters"
              section="future_thoughts"
              chapters={(character.chapters ?? []).filter((c) => c.section === "future_thoughts")}
              onChange={refresh}
            />

            <details className="card">
              <summary className="campaign-player-header" style={{ margin: "-14px -14px 10px", cursor: "pointer" }}>
                Важные даты
              </summary>
              <div className="stack">
                {!character.campaign_setting_id && (
                  <span className="muted">
                    У кампании персонажа не привязан сеттинг — календарь недоступен, но даты всё
                    равно можно добавлять.
                  </span>
                )}
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <input
                    placeholder="Название (напр. День рождения)"
                    value={dateTitle}
                    onChange={(e) => setDateTitle(e.target.value)}
                    maxLength={80}
                    aria-label="Название даты"
                    style={{ flex: "1 1 200px", minWidth: 0 }}
                  />
                  <select value={dateRecurrence} onChange={(e) => setDateRecurrence(e.target.value as DateRecurrence)} aria-label="Повторение">
                    <option value="once">Разовое</option>
                    <option value="annual">Ежегодное</option>
                    <option value="monthly">Ежемесячное</option>
                  </select>
                  {dateRecurrence === "once" && (
                    <input
                      type="number"
                      placeholder="Год"
                      style={{ width: "80px" }}
                      value={dateYear}
                      onChange={(e) => setDateYear(e.target.value)}
                      aria-label="Год"
                    />
                  )}
                  {dateRecurrence !== "monthly" && (
                    <select value={dateMonth} onChange={(e) => setDateMonth(e.target.value)} aria-label="Месяц">
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
                    style={{ width: "70px" }}
                    value={dateDay}
                    onChange={(e) => setDateDay(e.target.value)}
                    min={1}
                    max={31}
                    aria-label="День"
                  />
                  <button className="primary" onClick={addImportantDate} disabled={dateSaving}>
                    {dateSaving ? "Добавление…" : "Добавить"}
                  </button>
                </div>
                {dateError && <p className="error" role="alert">{dateError}</p>}
                <div className="stack">
                  {(character.important_dates ?? []).map((d) => (
                    <div key={d.id} className="row" style={{ justifyContent: "space-between" }}>
                      <span>
                        <strong>{d.title}</strong> — {formatImportantDate(d, calendar?.months ?? [], calendar?.weekdays ?? [])}
                      </span>
                      <button className="danger comp-mini" onClick={() => setPendingDateDeleteId(d.id)} aria-label={`Удалить дату ${d.title}`} title={`Удалить «${d.title}»`}>
                        ✕
                      </button>
                    </div>
                  ))}
                  {(character.important_dates ?? []).length === 0 && (
                    <EmptyState icon="barcode" title="Важных дат пока нет" hint="Добавьте день рождения, годовщину или дедлайн — попадёт в календарь кампании." />
                  )}
                </div>
              </div>
            </details>
          </div>
        )}

        {tab === "gallery" && (
          <GalleryTab
            ownerType="character"
            ownerId={characterId}
            thumbnailUpload={{
              previewUrl: character.thumbnail_image_url,
              uploading: uploadingThumbnail,
              onSelect: thumbnailCrop.onSelect,
              modal: thumbnailCrop.modal,
            }}
          />
        )}
      </div>
      {undoToast && (
        <div className="archive-toast" role="status" aria-live="polite">
          <span className="archive-toast__msg">{undoToast.msg}</span>
          <div className="archive-toast__actions">
            <button className="archive-toast__undo" onClick={() => { const cb = undoToast.onUndo; cb(); }}>Отменить</button>
            <button className="archive-toast__close" onClick={dismissUndo} aria-label="Закрыть">×</button>
          </div>
        </div>
      )}
      {pendingDateDeleteId != null && (() => { const d = (character.important_dates ?? []).find(x => x.id === pendingDateDeleteId); return (
        <ConfirmModal
          title="Удалить дату?"
          message={d ? `Удалить «${d.title}»?` : "Удалить эту дату?"}
          confirmLabel="Удалить"
          cancelLabel="Отмена"
          danger
          onClose={() => setPendingDateDeleteId(null)}
          onConfirm={confirmRemoveDate}
        />
      ); })()}
      {showArchiveConfirm && (
        <ConfirmModal
          title="Архивировать персонажа?"
          message={`Архивировать «${character.character_name}»? Персонаж пропадёт из ростера, но его можно восстановить из Архива.`}
          confirmLabel="Архивировать"
          cancelLabel="Отмена"
          danger
          onClose={() => setShowArchiveConfirm(false)}
          onConfirm={archiveCharacter}
        />
      )}
    </div>
  );
}

function CharacterRelationsPreview({ characterId, characterName }: { characterId: number; characterName: string }) {
  const [data, setData] = useState<EntityRelationsResponse | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    api.get<EntityRelationsResponse>(`/entity-relations?entity_type=character&entity_id=${characterId}`, { signal: ctrl.signal }).then(setData).catch(() => {});
    return () => ctrl.abort();
  }, [characterId]);
  const all = [...(data?.outgoing ?? []), ...(data?.incoming ?? [])].slice(0, 3);
  if (!data || all.length === 0) return null;
  return (
    <div className="card stack">
      <div className="campaign-player-header" style={{ margin: "-14px -14px 10px" }}><span>Связи</span><Link to={`?tab=relations`} className="comp-mini">Все →</Link></div>
      <div className="stack" style={{ gap: 6 }}>
        {all.map((r) => (
          <div key={r.id} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
            <span><span className="badge tag" style={{ fontSize: "var(--fs-micro)" }}>{r.tone}</span> {r.label || "—"} <span className="muted">→ {r.other_name ?? `#${r.other_id}`}</span></span>
            <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>{r.other_type}</span>
          </div>
        ))}
      </div>
      <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>Всего связей: {(data.outgoing?.length ?? 0) + (data.incoming?.length ?? 0)} · персонаж «{characterName}»</span>
    </div>
  );
}

function CharacterInventoryTab({
  characterId,
  character,
  onRefresh,
}: {
  characterId: number;
  character: Character;
  onRefresh: () => void;
}) {
  const [statblocks, setStatblocks] = useState<Statblock[] | null>(null);
  const [invError, setInvError] = useState<string | null>(null);
  const invChapters = (character.chapters ?? []).filter((c) => c.section === "inventory");
  useEffect(() => {
    const ctrl = new AbortController();
    setInvError(null);
    api.get<Statblock[]>(`/statblocks?owner_type=character&owner_id=${characterId}`, { signal: ctrl.signal }).then(setStatblocks).catch((e) => {
      if ((e as Error).name === "AbortError") return;
      setInvError(String(e instanceof Error ? e.message : e));
      setStatblocks([]);
    });
    return () => ctrl.abort();
  }, [characterId]);
  const dnd = statblocks?.find((s) => s.format === "dnd_character");
  let data: ReturnType<typeof normalizeDndCharacter> | null = null;
  let dataParseError: string | null = null;
  if (dnd) {
    try { data = normalizeDndCharacter(JSON.parse(dnd.content || "{}")); } catch (e) { dataParseError = String(e instanceof Error ? e.message : e); }
  }
  const hasStructured = !!data && data.equipmentSections.some((s) => s.items.length > 0);
  const hasProse = invChapters.length > 0;
  const [migrateTarget, setMigrateTarget] = useState<string>(() => data?.equipmentSections[0]?.name ?? "Общее");
  const [migrateSaving, setMigrateSaving] = useState(false);
  useEffect(() => { if (data && !migrateTarget) setMigrateTarget(data.equipmentSections[0]?.name ?? "Общее"); }, [data]);
  async function migrate() {
    if (!dnd || !data) return;
    const items = invChapters
      .flatMap((c) => `${c.title ?? ""}\n${c.content ?? ""}`.split("\n"))
      .map((l) => l.trim())
      .filter(Boolean)
      .map((name) => ({ name, qty: "", weight: "", notes: "" }));
    if (items.length === 0) return;
    setMigrateSaving(true);
    try {
      const targetIdx = data.equipmentSections.findIndex((s) => s.name.trim() === migrateTarget.trim());
      const idx = targetIdx >= 0 ? targetIdx : 0;
      let nextSections = data.equipmentSections.map((sec, i) => (i === idx ? { ...sec, items: [...sec.items, ...items] } : sec));
      if (targetIdx < 0) {
        const exists = nextSections.some((s) => s.name.trim() === migrateTarget.trim());
        if (!exists) nextSections = [...nextSections, { name: migrateTarget.trim() || "Общее", items }];
        else nextSections = data.equipmentSections.map((sec, i) => (i === idx ? { ...sec, items: [...sec.items, ...items] } : sec));
      }
      const next = { ...data, equipmentSections: nextSections.length ? nextSections : [{ name: "Общее", items }] };
      await api.put(`/statblocks/${dnd.id}`, { content: JSON.stringify(next) });
      onRefresh();
      api.get<Statblock[]>(`/statblocks?owner_type=character&owner_id=${characterId}`).then(setStatblocks);
    } finally {
      setMigrateSaving(false);
    }
  }
  if (statblocks === null) return <p className="muted">Загрузка…</p>;
  if (invError) {
    return (
      <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span>Не удалось загрузить инвентарь: {invError}</span>
        <button className="primary" onClick={() => { setStatblocks(null); api.get<Statblock[]>(`/statblocks?owner_type=character&owner_id=${characterId}`).then(setStatblocks).catch(() => setStatblocks([])); }}>Повторить</button>
      </div>
    );
  }
  if (dataParseError) {
    return <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)" }}>Чарник повреждён: <span className="muted">{dataParseError}</span> — пересоздайте чарник на вкладке «Чарник».</div>;
  }
  return (
    <div className="stack">
      {data ? (
        <>
          {hasStructured ? (
            <div className="card stack">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="sb-prop-label">Снаряжение (из чарника)</span>
                <Link to={`?tab=statblock`} className="comp-mini">→ Чарник</Link>
              </div>
              {data.equipmentSections.filter((s) => s.items.length > 0).map((sec, si) => (
                <div key={si} className="sb-entry">
                  {data.equipmentSections.length > 1 && <span className="sb-prop-label">{sec.name}</span>}
                  <ul className="dnd-equipment-view-list">
                    {sec.items.map((it, ii) => (
                      <li key={ii}>{it.name}{it.qty && ` ×${it.qty}`}{it.weight && ` (${it.weight})`}{it.notes && ` — ${it.notes}`}{it.equipped ? " ●" : ""}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {data.coins && (["cp","sp","ep","gp","pp"] as const).some((k) => (data.coins as unknown as Record<string,string>)[k]?.trim()) && (
                <div className="sb-entry">
                  <span className="sb-prop-label">Монеты</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                    {([
                      ["cp","ММ"],["sp","СМ"],["ep","ЭМ"],["gp","ЗМ"],["pp","ПМ"]] as const).filter(([k]) => (data.coins as unknown as Record<string,string>)[k]?.trim()).map(([k,label]) => `${(data.coins as unknown as Record<string,string>)[k]} ${label}`).join(" · ")}
                  </span>
                </div>
              )}
              {!hasStructured && <p className="muted">Снаряжение в чарнике пусто — заполните на вкладке «Чарник → Инвентарь».</p>}
            </div>
          ) : (
            <p className="muted">Структурированного инвентаря ещё нет. Заполните его в <Link to={`?tab=statblock`}>Чарнике → Инвентарь</Link>.</p>
          )}
          {hasProse && (
            <div className="card stack">
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <span className="muted">Старые записи «Имущество» (проза) — {invChapters.length}</span>
                <span className="row" style={{ gap: 6 }}>
                  <select value={migrateTarget} onChange={(e) => setMigrateTarget(e.target.value)} aria-label="Секция для импорта" style={{ maxWidth: 160 }}>
                    {data!.equipmentSections.map((s) => (
                      <option key={s.name} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                  <button type="button" className="primary" onClick={migrate} disabled={migrateSaving}>{migrateSaving ? "Импорт…" : "Импортировать"}</button>
                </span>
              </div>
              <p className="muted" style={{ fontSize: "var(--fs-meta)" }}>Каждая строка станет предметом в выбранную секцию. После импорта удалите прозу вручную.</p>
              <ChapterList ownerId={characterId} ownerType="character" apiBase="/characters" section="inventory" chapters={invChapters} onChange={onRefresh} allowImage />
            </div>
          )}
        </>
      ) : invChapters.length > 0 ? (
        <>
          <p className="muted">Чарника D&D ещё нет — заведите его на вкладке «Чарник». Пока инвентарь как проза:</p>
          <ChapterList ownerId={characterId} ownerType="character" apiBase="/characters" section="inventory" chapters={invChapters} onChange={onRefresh} allowImage />
        </>
      ) : (
        <EmptyState icon="splatter" title="Имущества пока нет" hint="Заведите чарник D&D и заполните «Инвентарь» или добавьте первую запись прозы." />
      )}
    </div>
  );
}
