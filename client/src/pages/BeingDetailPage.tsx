import { useEffect, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { StatblockList } from "../components/StatblockList";
import { GalleryTab } from "../components/GalleryTab";
import { MentionsTab } from "../components/MentionsTab";
import { ChapterList } from "../components/ChapterList";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { RelationsTab } from "../components/RelationsTab";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { formatImportantDate } from "../inworldCalendar";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { useTabState } from "../hooks/useTabState";
import { useImageCrop } from "../hooks/useImageCrop";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { TagChips } from "../components/TagChips";
import { LocationCascadePicker } from "../components/LocationCascadePicker";
import type {
  Campaign,
  DateRecurrence,
  SearchResult,
  SettingBeingDetail,
  SettingCommunity,
  SettingLocation,
} from "../types";

const TABS = [
  "Статблок",
  "Досье",
  "Связи",
  "Места обитания",
  "Важные даты",
  "Галерея",
  "Упоминания",
] as const;

// Splits a list into rows of 4 for the borderless faction/community table.
function chunkFours<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 4) rows.push(items.slice(i, i + 4));
  return rows;
}

const CATEGORY_LABELS: Record<string, string> = {
  bestiary: "Бестиарий",
  key_figure: "Ключевая фигура",
  influential: "Влиятельная личность",
  notable: "Занимательная личность",
};

export function BeingDetailPage() {
  const { id } = useParams();
  const beingId = Number(id);
  const navigate = useNavigate();

  const [being, setBeing] = useState<SettingBeingDetail | null>(null);
  const [tab, selectTab] = useTabState(TABS, "Статблок");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [shortNameDraft, setShortNameDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("bestiary");
  const [communities, setCommunities] = useState<SettingCommunity[]>([]);
  const [communityDraft, setCommunityDraft] = useState<number[]>([]);
  const [showAllCommunities, setShowAllCommunities] = useState(true);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  const [locationsDragOver, setLocationsDragOver] = useState(false);
  const [settingLocations, setSettingLocations] = useState<SettingLocation[]>([]);
  const [addLocationId, setAddLocationId] = useState<number | null>(null);
  const [dateTitle, setDateTitle] = useState("");
  const [dateRecurrence, setDateRecurrence] = useState<DateRecurrence>("once");
  const [dateYear, setDateYear] = useState("");
  const [dateMonth, setDateMonth] = useState("");
  const [dateDay, setDateDay] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);

  const calendar = useSettingCalendar(being?.setting_id);
  const avatarCrop = useImageCrop("square", handleAvatarChange);
  const thumbnailCrop = useImageCrop("thumbnail", handleThumbnailChange);

  function refresh() {
    api.get<SettingBeingDetail>(`/setting-beings/${beingId}`).then((b) => {
      setBeing(b);
      setNameDraft(b.name);
      setShortNameDraft(b.short_name ?? "");
      setCategoryDraft(b.category);
      setCommunityDraft(b.communities.map((c) => c.id));
    });
  }
  useEffect(refresh, [beingId]);

  useEffect(() => {
    if (!being) return;
    api
      .get<Campaign[]>("/campaigns")
      .then((all) => setCampaigns(all.filter((c) => c.setting_id === being.setting_id)));
    api
      .get<SettingCommunity[]>(`/setting-communities?setting_id=${being.setting_id}`)
      .then(setCommunities);
    api
      .get<SettingLocation[]>(`/setting-locations?setting_id=${being.setting_id}`)
      .then(setSettingLocations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [being?.setting_id]);

  if (!being) return <p className="muted">Загрузка…</p>;

  async function saveTags(tags: string[]) {
    await api.put(`/setting-beings/${beingId}`, { tags });
    refresh();
  }

  async function saveName() {
    if (!nameDraft.trim()) return;
    await api.put(`/setting-beings/${beingId}`, {
      name: nameDraft,
      category: categoryDraft,
      short_name: shortNameDraft.trim(),
    });
    await api.put(`/setting-beings/${beingId}/communities`, { community_ids: communityDraft });
    setEditingName(false);
    refresh();
  }

  function toggleCommunity(id: number) {
    setCommunityDraft((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  const sortedCommunities = [...communities].sort((a, b) => {
    const aSel = communityDraft.includes(a.id);
    const bSel = communityDraft.includes(b.id);
    if (aSel !== bSel) return aSel ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const visibleCommunities = showAllCommunities
    ? sortedCommunities
    : sortedCommunities.filter((c) => communityDraft.includes(c.id));

  async function archiveBeing() {
    if (!being) return;
    if (!confirm("Отправить существо в архив?")) return;
    await api.del(`/setting-beings/${beingId}`);
    navigate(`/settings/${being.setting_id}`);
  }

  function handleLocationDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setLocationsDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    const result: SearchResult = JSON.parse(raw);
    if (result.type !== "location") return;
    api.post(`/setting-beings/${beingId}/locations`, { location_id: result.id }).then(refresh);
  }

  async function removeLocation(locationId: number) {
    await api.del(`/setting-beings/${beingId}/locations/${locationId}`);
    refresh();
  }

  async function addLocationViaCascade() {
    if (!addLocationId) return;
    await api.post(`/setting-beings/${beingId}/locations`, { location_id: addLocationId });
    setAddLocationId(null);
    refresh();
  }

  async function addImportantDate() {
    if (!dateTitle.trim() || !dateDay) return;
    await api.post(`/setting-beings/${beingId}/important-dates`, {
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
    await api.del(`/setting-beings/important-dates/${dateId}`);
    refresh();
  }

  async function handleAvatarChange(file: File | null) {
    if (!file) return;
    setUploadingAvatar(true);
    const form = new FormData();
    form.append("file", file);
    await api.post(`/setting-beings/${beingId}/avatar`, form);
    setUploadingAvatar(false);
    refresh();
  }

  async function handleThumbnailChange(file: File | null) {
    if (!file) return;
    setUploadingThumbnail(true);
    const form = new FormData();
    form.append("file", file);
    await api.post(`/setting-beings/${beingId}/thumbnail`, form);
    setUploadingThumbnail(false);
    refresh();
  }

  return (
    <div className="stack">
      <Breadcrumbs
        items={[
          {
            label: "Население",
            to: `/settings/${being.setting_id}?tab=${encodeURIComponent("Население")}`,
          },
          { label: being.name },
        ]}
      />

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="stack" style={{ alignItems: "center" }}>
            <label className="avatar-upload-label" title={IMAGE_HINT}>
              {being.avatar_image_url ? (
                <img src={being.avatar_image_url} alt="" className="being-avatar" />
              ) : (
                <div className="being-avatar roster-avatar-placeholder" />
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
        {editingName ? (
          <div className="stack">
            <div className="row">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
              <input
                value={shortNameDraft}
                onChange={(e) => setShortNameDraft(e.target.value)}
                placeholder="Короткое имя для карты"
                title="Показывается вместо полного имени в подписи пина на карте локации"
              />
              <select value={categoryDraft} onChange={(e) => setCategoryDraft(e.target.value)}>
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <label className="row">
              <input
                type="checkbox"
                checked={showAllCommunities}
                onChange={(e) => setShowAllCommunities(e.target.checked)}
              />
              Показывать все сообщества (а не только выбранные)
            </label>
            {communities.length === 0 ? (
              <span className="muted">Сообществ в сеттинге ещё нет.</span>
            ) : (
              <table className="being-community-table">
                <tbody>
                  {chunkFours(visibleCommunities).map((row, i) => (
                    <tr key={i}>
                      {row.map((c) => (
                        <td key={c.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={communityDraft.includes(c.id)}
                              onChange={() => toggleCommunity(c.id)}
                            />
                            {c.name}
                          </label>
                        </td>
                      ))}
                      {row.length < 4 &&
                        Array.from({ length: 4 - row.length }, (_, j) => <td key={`pad${j}`} />)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="row">
              <button className="primary" onClick={saveName}>
                Сохранить
              </button>
              <button onClick={() => setEditingName(false)}>Отмена</button>
            </div>
          </div>
        ) : (
          <div>
            <div className="row" style={{ alignItems: "center" }}>
              <h1>{being.name}</h1>
              <EntityTypeChip type="being" />
            </div>
            <div className="row">
              <span className="badge tag">{CATEGORY_LABELS[being.category]}</span>
              {being.locations.map((l) => (
                <Link key={l.id} to={`/locations/${l.id}`} className="entity-type-chip location">
                  {l.name}
                </Link>
              ))}
              {being.communities.map((c) => (
                <Link key={c.id} to={`/communities/${c.id}`} className="entity-type-chip community">
                  {c.name}
                </Link>
              ))}
            </div>
            {being.base_monster_id && (
              <div className="row" style={{ marginTop: 4 }}>
                <span className="muted">
                  На основе:{" "}
                  <Link to={`/compendium/${being.base_monster_id}`}>{being.base_monster_name}</Link>
                </span>
              </div>
            )}
            <div className="row" style={{ marginTop: 4 }}>
              <TagChips tags={being.tags} onChange={saveTags} />
            </div>
          </div>
        )}
        </div>
        <div className="entity-header-actions">
          <button onClick={() => setEditingName(true)}>Редактировать</button>
          <button className="danger" onClick={archiveBeing}>
            Архивировать
          </button>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => selectTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Статблок" && (
        <StatblockList ownerType="being" ownerId={beingId} ownerName={being.name} settingId={being.setting_id} />
      )}

      {tab === "Досье" && (
        <div className="stack">
          <details className="card">
            <summary className="sb-section" style={{ margin: 0 }}>
              История
            </summary>
            <ChapterList
              ownerId={beingId}
              ownerType="being"
              apiBase="/setting-beings"
              section="history"
              chapters={being.chapters.filter((c) => c.section === "history")}
              onChange={refresh}
              defaultSettingId={being.setting_id}
              visibilityToggle
            />
          </details>
          <details className="card">
            <summary className="sb-section" style={{ margin: 0 }}>
              Поведение
            </summary>
            <ChapterList
              ownerId={beingId}
              ownerType="being"
              apiBase="/setting-beings"
              section="behavior"
              chapters={being.chapters.filter((c) => c.section === "behavior")}
              onChange={refresh}
              defaultSettingId={being.setting_id}
              visibilityToggle
            />
          </details>
          <details className="card">
            <summary className="sb-section" style={{ margin: 0 }}>
              Текущая ситуация
            </summary>
            <ChapterList
              ownerId={beingId}
              ownerType="being"
              apiBase="/setting-beings"
              section="current_situation"
              chapters={being.chapters.filter((c) => c.section === "current_situation")}
              onChange={refresh}
              defaultSettingId={being.setting_id}
              campaigns={campaigns}
              visibilityToggle
            />
          </details>
        </div>
      )}

      {tab === "Галерея" && (
        <GalleryTab
          ownerType="being"
          ownerId={beingId}
          thumbnailUpload={{
            previewUrl: being.thumbnail_image_url,
            uploading: uploadingThumbnail,
            onSelect: thumbnailCrop.onSelect,
            modal: thumbnailCrop.modal,
          }}
        />
      )}

      {tab === "Упоминания" && <MentionsTab entityType="being" entityId={beingId} />}

      {tab === "Связи" && (
        <RelationsTab
          entityType="being"
          entityId={beingId}
          entityName={being.name}
          defaultSettingId={being.setting_id}
        />
      )}

      {tab === "Места обитания" && (
        <div className="card stack">
          <div
            className={`drop-zone${locationsDragOver ? " drag-over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setLocationsDragOver(true);
            }}
            onDragLeave={() => setLocationsDragOver(false)}
            onDrop={handleLocationDrop}
          >
            <span className="muted">Перетащите локацию из поиска, чтобы добавить место обитания.</span>
          </div>
          <div className="row">
            <LocationCascadePicker
              locations={settingLocations}
              value={addLocationId}
              onChange={setAddLocationId}
            />
            <button type="button" onClick={addLocationViaCascade} disabled={!addLocationId}>
              + Добавить
            </button>
          </div>
          <div className="grid-cards">
            {being.locations.map((l) => (
              <div key={l.id} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <Link to={`/locations/${l.id}`}>
                    <h3>{l.name}</h3>
                  </Link>
                  <button className="danger" onClick={() => removeLocation(l.id)}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
            {being.locations.length === 0 && <p className="muted">Мест обитания пока нет.</p>}
          </div>
        </div>
      )}

      {tab === "Важные даты" && (
        <div className="card stack">
          <span className="muted">
            Эти даты отмечаются на календаре сеттинга и переносятся в календари связанных с ним
            кампаний.
          </span>
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
            {being.important_dates.map((d) => (
              <div key={d.id} className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  <strong>{d.title}</strong> — {formatImportantDate(d, calendar?.months ?? [])}
                </span>
                <button className="danger" onClick={() => removeImportantDate(d.id)}>
                  ✕
                </button>
              </div>
            ))}
            {being.important_dates.length === 0 && <p className="muted">Важных дат пока нет.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
