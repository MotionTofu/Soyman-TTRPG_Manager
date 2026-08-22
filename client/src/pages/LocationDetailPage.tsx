import { useEffect, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useUnloadTarget } from "../unloadTargets";
import { AliasesCard } from "../components/AliasesCard";
import { LocationMap } from "../components/LocationMap";
import { ChapterList } from "../components/ChapterList";
import { GalleryTab } from "../components/GalleryTab";
import { MentionsTab } from "../components/MentionsTab";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { GraphNeighbourhoodLink } from "../components/GraphNeighbourhoodLink";
import { RelationsTab } from "../components/RelationsTab";
import { EntityFieldsCard } from "../components/EntityFieldsCard";
import { BeingQuickCreate } from "../components/BeingQuickCreate";
import { BeingEntityRowList } from "../components/BeingEntityRowList";
import { LocationCascadePicker } from "../components/LocationCascadePicker";
import { LocationNode } from "../components/LocationTree";
import { useTabState } from "../hooks/useTabState";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useImageCrop } from "../hooks/useImageCrop";
import { formatImportantDate } from "../inworldCalendar";
import { NavIcon } from "../components/NavIcons";
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
  "Отношения",
  "Важные даты",
  "Галерея",
  "Карточка локации",
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
  const [editingParent, setEditingParent] = useState(false);
  const [parentDraft, setParentDraft] = useState<number | null>(null);
  const [childName, setChildName] = useState("");
  const [childKind, setChildKind] = useState("");
  const [inhabitantsDragOver, setInhabitantsDragOver] = useState(false);
  const [showNestedInhabitants, setShowNestedInhabitants] = useState(false);
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
    const query = showNestedInhabitants ? "?nested=1" : "";
    api.get<SettingLocationDetail>(`/setting-locations/${locationId}${query}`).then((l) => {
      setLocation(l);
      api.get<SettingCommunity[]>(`/setting-communities?setting_id=${l.setting_id}`).then(setCommunities);
      api.get<SettingLocation[]>(`/setting-locations?setting_id=${l.setting_id}`).then(setAllLocations);
    });
  }
  useEffect(refresh, [locationId, showNestedInhabitants]);

  // Мешок выгружает сюда существ и сообщества — то же, что перетаскивание в
  // «Обитатели», только без перетаскивания (см. unloadTargets.tsx).
  useUnloadTarget({
    label: "Обитатели локации",
    accepts: (item) => item.type === "being" || item.type === "community",
    drop: addInhabitant,
  });

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

  // "Обитатели" grouped by faction instead of a flat list — a faction is a
  // section, its members are the entries inside. A being with no faction
  // goes to "Без фракций" (deliberately last), so missing-faction beings are
  // easy to spot. A being in several factions appears once per faction
  // (each occurrence flagged with the multi-faction icon via getFactions).
  const allInhabitants = showNestedInhabitants
    ? [...location.inhabitant_beings, ...location.nested_inhabitant_beings]
    : location.inhabitant_beings;
  const directIds = new Set(location.inhabitant_beings.map((b) => b.id));
  const factionGroups = new Map<number, { id: number; name: string; beings: typeof allInhabitants }>();
  const noFactionBeings: typeof allInhabitants = [];
  for (const b of allInhabitants) {
    if (b.communities.length === 0) {
      noFactionBeings.push(b);
      continue;
    }
    for (const c of b.communities) {
      const group = factionGroups.get(c.id) ?? { id: c.id, name: c.name, beings: [] };
      group.beings.push(b);
      factionGroups.set(c.id, group);
    }
  }
  // Communities marked as habitats of this location but with no beings
  // living here still get a (empty) section — same reasoning as "Без
  // фракций": the habitat association should stay visible/removable without
  // a second, separate list duplicating what's already shown here.
  for (const c of location.inhabitant_communities) {
    if (!factionGroups.has(c.id)) factionGroups.set(c.id, { id: c.id, name: c.name, beings: [] });
  }
  const sortedFactionGroups = Array.from(factionGroups.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "ru")
  );

  async function saveNameKind(values: { name: string; kind: string; short_name: string }) {
    await api.put(`/setting-locations/${locationId}`, {
      name: values.name,
      kind: values.kind,
      short_name: values.short_name.trim(),
    });
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

  async function addInhabitant(result: SearchResult) {
    if (result.type !== "being" && result.type !== "community") return;
    await api.post(`/setting-locations/${locationId}/inhabitants`, {
      type: result.type,
      id: result.id,
    });
    refresh();
  }

  function handleInhabitantDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setInhabitantsDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    addInhabitant(JSON.parse(raw) as SearchResult);
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
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
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
          <div className="row" style={{ alignItems: "center" }}>
            <h1>{location.name}</h1>
            <EntityTypeChip type="location" />
            {location.kind && <span className="badge tag">{location.kind}</span>}
            <GraphNeighbourhoodLink type="location" id={location.id} />
          </div>
        </div>
        <div className="entity-header-actions">
          {/* Имя, тип и короткое имя правятся карточкой «Основное» во вкладке
              «Информация о локации». */}
          <button className="danger" onClick={archiveLocation}>
            <NavIcon name="archive" /> Архивировать
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
        <div className="stack">
          <EntityFieldsCard
            key={`fields-${location.id}`}
            fields={[
              { key: "name", label: "Имя", value: location.name, required: true },
              {
                key: "kind",
                label: "Тип",
                value: location.kind ?? "",
                placeholder: "континент/город/таверна…",
              },
              {
                key: "short_name",
                label: "Короткое имя для карты",
                value: location.short_name ?? "",
                title: "Показывается вместо полного имени в подписи пина на карте локации",
              },
            ]}
            onSave={(v) => saveNameKind({ name: v.name, kind: v.kind, short_name: v.short_name })}
          />
          <AliasesCard
            aliases={location.aliases ?? []}
            nameOriginal={location.name_original ?? ""}
            onSave={async (aliases, name_original) => {
              await api.put(`/setting-locations/${locationId}`, { aliases, name_original });
              refresh();
            }}
          />
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
        </div>
      )}

      {tab === "Карта" && (
        <LocationMap
          locationId={locationId}
          locationName={location.name}
          settingId={location.setting_id}
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

      {tab === "Карточка локации" && (
        <div className="card stack">
          <p className="muted">
            Карточка локации — скоро здесь появится компактная витрина для показа игрокам (пульт
            управления сессией и другие места).
          </p>
        </div>
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

      {tab === "Отношения" && (
        <div className="card stack">
          <RelationsTab
            entityType="location"
            entityId={location.id}
            entityName={location.name}
            defaultSettingId={location.setting_id}
          />
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
          <label className="row" style={{ gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={showNestedInhabitants}
              onChange={(e) => setShowNestedInhabitants(e.target.checked)}
            />
            Показывать обитателей вложенных локаций
          </label>
          {sortedFactionGroups.map((group) => (
            <details key={group.id} className="entity-group" open>
              <summary className="entity-group-header entity-group-header-toggle">
                <span>
                  {group.name} ({group.beings.length})
                </span>
                <span className="entity-group-actions" onClick={(e) => e.preventDefault()}>
                  <Link to={`/communities/${group.id}`}>Перейти</Link>
                  <button type="button" onClick={() => removeInhabitant("community", group.id)}>
                    Убрать
                  </button>
                </span>
              </summary>
              <BeingEntityRowList
                beings={group.beings}
                onDelete={(id) => removeInhabitant("being", id)}
                deleteLabel="Убрать отсюда"
                emptyLabel="Никого из этой фракции здесь пока нет."
                getFactions={(b) => b.communities}
                getLocationSuffix={(b) => b.location_names?.join(", ")}
                hideDelete={(b) => !directIds.has(b.id)}
              />
            </details>
          ))}
          <details className="entity-group" open>
            <summary className="entity-group-header entity-group-header-toggle">
              Без фракций ({noFactionBeings.length})
            </summary>
            <BeingEntityRowList
              beings={noFactionBeings}
              onDelete={(id) => removeInhabitant("being", id)}
              deleteLabel="Убрать отсюда"
              emptyLabel="Обитателей-существ пока нет."
              getFactions={(b) => b.communities}
              getLocationSuffix={(b) => b.location_names?.join(", ")}
              hideDelete={(b) => !directIds.has(b.id)}
            />
          </details>
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
