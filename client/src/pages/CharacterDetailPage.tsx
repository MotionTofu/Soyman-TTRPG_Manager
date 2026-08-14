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
import { formatImportantDate } from "../inworldCalendar";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import type { Character, DateRecurrence } from "../types";

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
  const [tab, selectTab] = useTabState(TAB_KEYS, "statblock");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [shortNameDraft, setShortNameDraft] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [dateTitle, setDateTitle] = useState("");
  const [dateRecurrence, setDateRecurrence] = useState<DateRecurrence>("once");
  const [dateYear, setDateYear] = useState("");
  const [dateMonth, setDateMonth] = useState("");
  const [dateDay, setDateDay] = useState("");
  const calendar = useSettingCalendar(character?.campaign_setting_id);
  const avatarCrop = useImageCrop("square", handleAvatarChange);
  const thumbnailCrop = useImageCrop("thumbnail", handleThumbnailChange);

  function refresh() {
    api.get<Character>(`/characters/${characterId}`).then((c) => {
      setCharacter(c);
      setNameDraft(c.character_name);
      setShortNameDraft(c.short_name ?? "");
    });
  }
  useEffect(refresh, [characterId]);

  // Live sync — player-app editing this same character (or another open GM
  // instance) pushes here via RealtimeListener's "character-updated" event.
  useEffect(() => {
    function onCharacterUpdated(e: Event) {
      const detail = (e as CustomEvent<{ characterId: number }>).detail;
      if (detail?.characterId === characterId) refresh();
    }
    window.addEventListener("character-updated", onCharacterUpdated);
    return () => window.removeEventListener("character-updated", onCharacterUpdated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  if (!character) return <p className="muted">Загрузка…</p>;

  async function saveName() {
    if (!nameDraft.trim()) return;
    await api.put(`/characters/${characterId}`, {
      character_name: nameDraft,
      short_name: shortNameDraft.trim(),
    });
    setEditingName(false);
    refresh();
  }

  async function archiveCharacter() {
    if (!character) return;
    if (!confirm("Отправить персонажа в архив?")) return;
    await api.del(`/characters/${characterId}`);
    navigate(`/campaigns/${character.campaign_id}`);
  }

  async function handleAvatarChange(file: File | null) {
    if (!file) return;
    setUploadingAvatar(true);
    const form = new FormData();
    form.append("file", file);
    await api.post(`/characters/${characterId}/avatar`, form);
    setUploadingAvatar(false);
    refresh();
  }

  async function handleThumbnailChange(file: File | null) {
    if (!file) return;
    setUploadingThumbnail(true);
    const form = new FormData();
    form.append("file", file);
    await api.post(`/characters/${characterId}/thumbnail`, form);
    setUploadingThumbnail(false);
    refresh();
  }

  async function addImportantDate() {
    if (!dateTitle.trim() || !dateDay) return;
    await api.post(`/characters/${characterId}/important-dates`, {
      title: dateTitle,
      recurrence: dateRecurrence,
      year: dateRecurrence === "once" ? Number(dateYear) || null : null,
      month: dateRecurrence !== "monthly" ? Number(dateMonth) || null : null,
      day: Number(dateDay),
    });
    setDateTitle("");
    setDateYear("");
    setDateMonth("");
    setDateDay("");
    refresh();
  }

  async function removeImportantDate(dateId: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    await api.del(`/characters/important-dates/${dateId}`);
    refresh();
  }

  return (
    <div className="stack">
      <Breadcrumbs
        items={[
          { label: "Кампания", to: `/campaigns/${character.campaign_id}` },
          { label: character.character_name },
        ]}
      />
      <div className="character-layout">
      <div className="character-avatar-col">
        <label className="avatar-upload-label" title={IMAGE_HINT}>
          {character.avatar_image_url ? (
            <img src={character.avatar_image_url} alt="" className="character-avatar" />
          ) : (
            <div className="character-avatar character-avatar-placeholder">Нет фото</div>
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

      <div className="character-name-block stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          {editingName ? (
            <div className="row">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
              <input
                value={shortNameDraft}
                onChange={(e) => setShortNameDraft(e.target.value)}
                placeholder="Короткое имя для карты"
                title="Показывается вместо полного имени в подписи пина на карте локации"
              />
              <button className="primary" onClick={saveName}>
                Сохранить
              </button>
              <button onClick={() => setEditingName(false)}>Отмена</button>
            </div>
          ) : (
            <h1 className="editable-title" onClick={() => setEditingName(true)} title="Нажмите, чтобы переименовать">
              {character.character_name}
            </h1>
          )}
          <button className="danger" onClick={archiveCharacter}>
            Архивировать
          </button>
        </div>
        <div className="muted">
          Игрок: <Link to={`/players/${character.player_id}`}>{character.player_name}</Link>
          {" · "}
          Кампания: <Link to={`/campaigns/${character.campaign_id}`}>{character.campaign_name}</Link>
        </div>
      </div>

      <div className="character-tabs-row">
        <div className="tabs">
          {TABS.map((s) => (
            <button key={s.key} className={tab === s.key ? "active" : ""} onClick={() => selectTab(s.key)}>
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
          <div className="stack">
            {DOSSIER_SECTIONS.map((s) => (
              <details key={s.key} className="card">
                <summary className="sb-section" style={{ margin: 0 }}>
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
          <ChapterList
            ownerId={characterId}
            ownerType="character"
            apiBase="/characters"
            section="inventory"
            chapters={(character.chapters ?? []).filter((c) => c.section === "inventory")}
            onChange={refresh}
            allowImage
          />
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
              <summary className="sb-section" style={{ margin: 0 }}>
                Важные даты
              </summary>
              <div className="stack">
                {!character.campaign_setting_id && (
                  <span className="muted">
                    У кампании персонажа не привязан сеттинг — календарь недоступен, но даты всё
                    равно можно добавлять.
                  </span>
                )}
                <div className="row">
                  <input
                    placeholder="Название (напр. День рождения)"
                    value={dateTitle}
                    onChange={(e) => setDateTitle(e.target.value)}
                  />
                  <select value={dateRecurrence} onChange={(e) => setDateRecurrence(e.target.value as DateRecurrence)}>
                    <option value="once">Разовое</option>
                    <option value="annual">Ежегодное</option>
                    <option value="monthly">Ежемесячное</option>
                  </select>
                  {dateRecurrence === "once" && (
                    <input
                      type="number"
                      placeholder="Год"
                      style={{ width: 80 }}
                      value={dateYear}
                      onChange={(e) => setDateYear(e.target.value)}
                    />
                  )}
                  {dateRecurrence !== "monthly" && (
                    <select value={dateMonth} onChange={(e) => setDateMonth(e.target.value)}>
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
                    value={dateDay}
                    onChange={(e) => setDateDay(e.target.value)}
                  />
                  <button className="primary" onClick={addImportantDate}>
                    Добавить
                  </button>
                </div>
                <div className="stack">
                  {(character.important_dates ?? []).map((d) => (
                    <div key={d.id} className="row" style={{ justifyContent: "space-between" }}>
                      <span>
                        <strong>{d.title}</strong> — {formatImportantDate(d, calendar?.months ?? [])}
                      </span>
                      <button className="danger" onClick={() => removeImportantDate(d.id)}>
                        ✕
                      </button>
                    </div>
                  ))}
                  {(character.important_dates ?? []).length === 0 && (
                    <p className="muted">Важных дат пока нет.</p>
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
    </div>
  );
}
