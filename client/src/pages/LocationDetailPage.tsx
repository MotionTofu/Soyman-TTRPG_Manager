import { useEffect, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { LocationMap } from "../components/LocationMap";
import { ChapterList } from "../components/ChapterList";
import { GalleryTab } from "../components/GalleryTab";
import { MentionsTab } from "../components/MentionsTab";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { BeingQuickCreate } from "../components/BeingQuickCreate";
import { BeingEntityRowList } from "../components/BeingEntityRowList";
import { LocationCascadePicker } from "../components/LocationCascadePicker";
import { LocationNode } from "../components/LocationTree";
import { useTabState } from "../hooks/useTabState";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useImageCrop } from "../hooks/useImageCrop";
import { formatImportantDate } from "../inworldCalendar";
import type {
  DateRecurrence,
  SearchResult,
  SettingCommunity,
  SettingLocation,
  SettingLocationDetail,
} from "../types";

// Every location reachable from `id` by walking down parent_id links — used
// to keep the parent picker from offering a cycle (nesting a location under
// its own descendant).
function descendantIds(id: number, all: SettingLocation[]): Set<number> {
  const result = new Set<number>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const l of all) {
      if (l.parent_id === current && !result.has(l.id)) {
        result.add(l.id);
        queue.push(l.id);
      }
    }
  }
  return result;
}

const TABS = [
  "Информация о локации",
  "Карта",
  "Вложенные локации",
  "Обитатели",
  "Важные даты",
  "Галерея",
  "Упоминания",
] as const;

export function LocationDetailPage() {
  const { id } = useParams();
  const locationId = Number(id);
  const navigate = useNavigate();

  const [location, setLocation] = useState<SettingLocationDetail | null>(null);
  const [communities, setCommunities] = useState<SettingCommunity[]>([]);
  const [allLocations, setAllLocations] = useState<SettingLocation[]>([]);
  const [tab, selectTab] = useTabState(TABS, "Информация о локации");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [shortNameDraft, setShortNameDraft] = useState("");
  const [kindDraft, setKindDraft] = useState("");
  const [editingParent, setEditingParent] = useState(false);
  const [parentDraft, setParentDraft] = useState<number | null>(null);
  const [childName, setChildName] = useState("");
  const [childKind, setChildKind] = useState("");
  const [inhabitantsDragOver, setInhabitantsDragOver] = useState(false);
  const [dateTitle, setDateTitle] = useState("");
  const [dateRecurrence, setDateRecurrence] = useState<DateRecurrence>("once");
  const [dateYear, setDateYear] = useState("");
  const [dateMonth, setDateMonth] = useState("");
  const [dateDay, setDateDay] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const calendar = useSettingCalendar(location?.setting_id);
  const avatarCrop = useImageCrop("square", handleAvatarChange);
  const thumbnailCrop = useImageCrop("thumbnail", handleThumbnailChange);

  async function handleAvatarChange(file: File | null) {
    if (!file) return;
    setUploadingAvatar(true);
    const form = new FormData();
    form.append("file", file);
    await api.post(`/setting-locations/${locationId}/avatar`, form);
    setUploadingAvatar(false);
    refresh();
  }

  async function handleThumbnailChange(file: File | null) {
    if (!file) return;
    setUploadingThumbnail(true);
    const form = new FormData();
    form.append("file", file);
    await api.post(`/setting-locations/${locationId}/thumbnail`, form);
    setUploadingThumbnail(false);
    refresh();
  }

  function refresh() {
    api.get<SettingLocationDetail>(`/setting-locations/${locationId}`).then((l) => {
      setLocation(l);
      setNameDraft(l.name);
      setShortNameDraft(l.short_name ?? "");
      setKindDraft(l.kind);
      api.get<SettingCommunity[]>(`/setting-communities?setting_id=${l.setting_id}`).then(setCommunities);
      api.get<SettingLocation[]>(`/setting-locations?setting_id=${l.setting_id}`).then(setAllLocations);
    });
  }
  useEffect(refresh, [locationId]);

  if (!location) return <p className="muted">Загрузка…</p>;

  // Nested (not just direct) sub-locations for the "Вложенные локации" tab —
  // same grouping LocationTree.tsx uses for the setting-wide География tab,
  // just re-rooted at this location instead of at the setting's top level.
  const childByParent = new Map<number | null, SettingLocation[]>();
  for (const l of allLocations) {
    const list = childByParent.get(l.parent_id) ?? [];
    list.push(l);
    childByParent.set(l.parent_id, list);
  }
  // Natural sort ("2" before "11") instead of the API's plain lexicographic
  // ORDER BY name, so numbered sub-locations (1 - поле, 2 - склад, …, 15 -
  // сад) list in numeric order rather than string order.
  for (const list of childByParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
  }

  async function saveNameKind() {
    if (!nameDraft.trim()) return;
    await api.put(`/setting-locations/${locationId}`, {
      name: nameDraft,
      kind: kindDraft,
      short_name: shortNameDraft.trim(),
    });
    setEditingName(false);
    refresh();
  }

  async function saveParent() {
    await api.put(`/setting-locations/${locationId}/parent`, { parent_id: parentDraft });
    setEditingParent(false);
    refresh();
  }

  async function archiveLocation() {
    if (!location) return;
    if (!confirm("Отправить локацию (и все вложенные) в архив?")) return;
    await api.del(`/setting-locations/${locationId}`);
    navigate(
      location.parent_id ? `/locations/${location.parent_id}` : `/settings/${location.setting_id}`
    );
  }

  async function addChild() {
    if (!childName.trim()) return;
    await api.post("/setting-locations", {
      setting_id: location!.setting_id,
      parent_id: locationId,
      name: childName,
      kind: childKind,
    });
    setChildName("");
    setChildKind("");
    refresh();
  }

  function handleInhabitantDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setInhabitantsDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    const result: SearchResult = JSON.parse(raw);
    if (result.type !== "being" && result.type !== "community") return;
    api
      .post(`/setting-locations/${locationId}/inhabitants`, { type: result.type, id: result.id })
      .then(refresh);
  }

  async function removeInhabitant(type: "being" | "community", targetId: number) {
    await api.del(`/setting-locations/${locationId}/inhabitants/${type}/${targetId}`);
    refresh();
  }

  async function addImportantDate() {
    if (!dateTitle.trim() || !dateDay) return;
    await api.post(`/setting-locations/${locationId}/important-dates`, {
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
    await api.del(`/setting-locations/important-dates/${dateId}`);
    refresh();
  }

  return (
    <div className={`stack${tab === "Карта" ? " page-fill" : ""}`}>
      <Breadcrumbs
        items={[
          { label: "Сеттинг", to: `/settings/${location.setting_id}` },
          ...location.ancestors.map((a) => ({ label: a.name, to: `/locations/${a.id}` })),
          { label: location.name },
        ]}
      />

      <div className="card row" style={{ alignItems: "center", gap: 8 }}>
        <strong>Родительская локация</strong>
        {editingParent ? (
          <>
            <LocationCascadePicker
              locations={allLocations.filter(
                (l) => l.id !== locationId && !descendantIds(locationId, allLocations).has(l.id)
              )}
              value={parentDraft}
              onChange={setParentDraft}
            />
            <button className="primary" onClick={saveParent}>
              Сохранить
            </button>
            <button onClick={() => setEditingParent(false)}>Отмена</button>
          </>
        ) : (
          <>
            {location.parent_id ? (
              <Link to={`/locations/${location.parent_id}`}>
                {location.ancestors[location.ancestors.length - 1]?.name}
              </Link>
            ) : (
              <span className="muted">— нет, верхний уровень —</span>
            )}
            <button
              onClick={() => {
                setParentDraft(location.parent_id);
                setEditingParent(true);
              }}
            >
              Изменить
            </button>
          </>
        )}
      </div>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          {editingName ? (
            <div className="row">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
              <input
                placeholder="Тип (континент/город/таверна…)"
                value={kindDraft}
                onChange={(e) => setKindDraft(e.target.value)}
              />
              <input
                value={shortNameDraft}
                onChange={(e) => setShortNameDraft(e.target.value)}
                placeholder="Короткое имя для карты"
                title="Показывается вместо полного имени в подписи пина на карте локации"
              />
              <button className="primary" onClick={saveNameKind}>
                Сохранить
              </button>
              <button onClick={() => setEditingName(false)}>Отмена</button>
            </div>
          ) : (
            <div className="row" style={{ alignItems: "center" }}>
              <h1>{location.name}</h1>
              <EntityTypeChip type="location" />
              {location.kind && <span className="badge tag">{location.kind}</span>}
            </div>
          )}
        </div>
        <div className="entity-header-actions">
          <button onClick={() => setEditingName(true)}>Редактировать</button>
          <button className="danger" onClick={archiveLocation}>
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

      {tab === "Информация о локации" && (
        <ChapterList
          ownerId={locationId}
          ownerType="location"
          apiBase="/setting-locations"
          chapters={location.chapters}
          onChange={refresh}
          titlePrefix="Статья"
          addLabel="статью"
          defaultSettingId={location.setting_id}
          visibilityToggle
        />
      )}

      {tab === "Карта" && (
        <LocationMap
          locationId={locationId}
          mapImageUrl={location.map_image_url}
          pins={location.pins}
          mapMaxZoom={location.map_max_zoom}
          mapStartZoom={location.map_start_zoom}
          mapGotoZoom={location.map_goto_zoom}
          mapLabelsAlways={location.map_labels_always}
          otherLocations={allLocations}
          onChange={refresh}
        />
      )}

      {tab === "Галерея" && (
        <GalleryTab
          ownerType="location"
          ownerId={locationId}
          thumbnailUpload={{
            previewUrl: location.thumbnail_image_url,
            uploading: uploadingThumbnail,
            onSelect: thumbnailCrop.onSelect,
            modal: thumbnailCrop.modal,
          }}
          avatarUpload={{
            previewUrl: location.avatar_image_url,
            uploading: uploadingAvatar,
            onSelect: avatarCrop.onSelect,
            modal: avatarCrop.modal,
          }}
        />
      )}

      {tab === "Упоминания" && <MentionsTab entityType="location" entityId={locationId} />}

      {tab === "Вложенные локации" && (
        <div className="card stack">
          <div className="row">
            <input
              placeholder="Название"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
            />
            <input
              placeholder="Тип (город/район/место…)"
              value={childKind}
              onChange={(e) => setChildKind(e.target.value)}
            />
            <button className="primary" onClick={addChild}>
              Добавить
            </button>
          </div>
          <div className="stack">
            {childByParent.get(locationId)?.map((c) => (
              <LocationNode key={c.id} location={c} byParent={childByParent} onChange={refresh} />
            ))}
            {(childByParent.get(locationId)?.length ?? 0) === 0 && (
              <p className="muted">Вложенных локаций пока нет.</p>
            )}
          </div>
        </div>
      )}

      {tab === "Обитатели" && (
        <div className="card stack">
          <BeingQuickCreate
            settingId={location.setting_id}
            communities={communities}
            fixedLocationId={locationId}
            showCommunityPicker
            onCreated={refresh}
          />
          <div
            className={`drop-zone${inhabitantsDragOver ? " drag-over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setInhabitantsDragOver(true);
            }}
            onDragLeave={() => setInhabitantsDragOver(false)}
            onDrop={handleInhabitantDrop}
          >
            <span className="muted">
              Перетащите сюда существо или сообщество/народ/культуру из поиска.
            </span>
          </div>
          <BeingEntityRowList
            beings={location.inhabitant_beings}
            onDelete={(id) => removeInhabitant("being", id)}
            deleteLabel="Убрать отсюда"
            emptyLabel="Обитателей-существ пока нет."
          />
          <div className="grid-cards">
            {location.inhabitant_communities.map((c) => (
              <div key={`community-${c.id}`} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <Link to={`/communities/${c.id}`}>
                    <h3>{c.name}</h3>
                    <span className="muted">Сообщество</span>
                  </Link>
                  <button className="danger" onClick={() => removeInhabitant("community", c.id)}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
            {location.inhabitant_communities.length === 0 && (
              <p className="muted">Сообществ-обитателей пока нет.</p>
            )}
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
              placeholder="Название (напр. День основания)"
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
            {location.important_dates.map((d) => (
              <div key={d.id} className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  <strong>{d.title}</strong> — {formatImportantDate(d, calendar?.months ?? [])}
                </span>
                <button className="danger" onClick={() => removeImportantDate(d.id)}>
                  ✕
                </button>
              </div>
            ))}
            {location.important_dates.length === 0 && <p className="muted">Важных дат пока нет.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
