import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
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
import { EntityImageSlot } from "../components/EntityImageSlot";
import { useTabState } from "../hooks/useTabState";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useImageCrop } from "../hooks/useImageCrop";
import { NavIcon } from "../components/NavIcons";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { useConfirm } from "../hooks/useConfirm";
import { BEING_CATEGORIES } from "../beingCategories";
import { EditableTextCard } from "../components/EditableTextCard";
import { LocationImportantDatesTab } from "../components/LocationImportantDatesTab";
import type {
  SearchResult,
  SettingCommunity,
  SettingLocation,
  SettingLocationDetail,
  LocationInhabitantBeing,
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
  "Вложенность",
  "Обитатели",
  "Отношения",
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
  const [editingParent, setEditingParent] = useState(false);
  const [parentDraft, setParentDraft] = useState<number | null>(null);
  const [childName, setChildName] = useState("");
  const [childKind, setChildKind] = useState("");
  const [inhabitantsDragOver, setInhabitantsDragOver] = useState(false);
  const [showNestedInhabitants, setShowNestedInhabitants] = useState(false);
  const [nestedLoading, setNestedLoading] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inhabitantsSaving, setInhabitantsSaving] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [sortMode, setSortMode] = useState<"name" | "category">("name");
  const [communityName, setCommunityName] = useState("");
  const [communitySaving, setCommunitySaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const { deleteWithUndo } = useUndoDelete();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const calendar = useSettingCalendar(location?.setting_id);
  const avatarCrop = useImageCrop("square", handleAvatarChange);
  const thumbnailCrop = useImageCrop("thumbnail", handleThumbnailChange);
  const excludedDescendants = useMemo(() => descendantIds(locationId, allLocations), [locationId, allLocations]);

  function showSuccess(msg: string) {
    setSuccessMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setSuccessMessage(null), 2000);
  }

  async function handleAvatarChange(file: File | null) {
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/setting-locations/${locationId}/avatar`, form);
      refresh();
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleThumbnailChange(file: File | null) {
    if (!file) return;
    setUploadingThumbnail(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/setting-locations/${locationId}/thumbnail`, form);
      refresh();
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      setUploadingThumbnail(false);
    }
  }

  async function deleteLocationImage(kind: "avatar" | "thumbnail") {
    const title = kind === "avatar" ? "Удалить аватар?" : "Удалить тамбнейл?";
    const message = kind === "avatar" ? "Аватар локации будет удалён. Тамбнейл (если есть) останется." : "Тамбнейл локации будет удалён. В списке будет показан аватар (если есть).";
    const ok = await confirm({ title, message, confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    const url = `/setting-locations/${locationId}/${kind}`;
    try {
      await api.del(url);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("409") || msg.includes("needsChoice") || String(e).includes("409")) {
        const toArchive = await confirm({ title: "Последняя копия файла", message: "Это последняя копия файла в хранилище. Отправить в архив?", confirmLabel: "В архив", danger: false });
        if (toArchive) await api.del(`${url}?mode=archive`);
        else {
          const forever = await confirm({ title: "Удалить навсегда?", message: "Без возможности восстановления.", confirmLabel: "Удалить навсегда", danger: true });
          if (!forever) return;
          await api.del(`${url}?mode=forever`);
        }
      } else throw e;
    }
    refresh();
  }
  async function handleAvatarDelete() { await deleteLocationImage("avatar"); }
  async function handleThumbnailDelete() { await deleteLocationImage("thumbnail"); }

  const refresh = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const query = showNestedInhabitants ? "?nested=1" : "";
    setLoadError(null);
    api
      .get<SettingLocationDetail>(`/setting-locations/${locationId}${query}`, { signal: controller.signal })
      .then((l) => {
        if (controller.signal.aborted) return;
        setLocation(l);
        setNestedLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setLoadError(String(e instanceof Error ? e.message : e));
        setNestedLoading(false);
      });
  }, [locationId, showNestedInhabitants]);
  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(rawQuery), 150);
    return () => clearTimeout(t);
  }, [rawQuery]);

  // Cleanup toast timer on unmount
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  // Communities and all-locations list (including archived) only depend on setting_id.
  useEffect(() => {
    if (!location) return;
    const controller = new AbortController();
    Promise.allSettled([
      api.get<SettingCommunity[]>(`/setting-communities?setting_id=${location.setting_id}`, { signal: controller.signal }),
      api.get<SettingLocation[]>(`/setting-locations?setting_id=${location.setting_id}&archived=include`, { signal: controller.signal }),
    ]).then(([c, l]) => {
      if (!controller.signal.aborted) {
        if (c.status === "fulfilled") setCommunities(c.value);
        if (l.status === "fulfilled") setAllLocations(l.value);
      }
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only setting_id matters, not the full location object
  }, [location?.setting_id]);

  // Мешок выгружает сюда существ и сообщества — то же, что перетаскивание в
  // «Обитатели», только без перетаскивания (см. unloadTargets.tsx).
  useUnloadTarget({
    label: "Обитатели локации",
    accepts: (item) => item.type === "being" || item.type === "community",
    drop: addInhabitant,
  });

  // All hooks must be declared before any early returns (React rules of hooks).
  // childByParent and faction groups are computed here unconditionally; they
  // produce empty defaults when `location` is still null (loading state).
  const childByParent = useMemo(() => {
    const m = new Map<number | null, SettingLocation[]>();
    // Only active (non-archived) locations go into the tree
    for (const l of allLocations) {
      if (l.archived_at) continue;
      const list = m.get(l.parent_id) ?? [];
      list.push(l);
      m.set(l.parent_id, list);
    }
    for (const [key, list] of m) m.set(key, [...list].sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true })));
    return m;
  }, [allLocations]);

  const archivedChildren = useMemo(() => {
    if (!location) return [] as SettingLocation[];
    return allLocations
      .filter((l) => l.parent_id === locationId && l.archived_at)
      .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- location used only for null check
  }, [allLocations, locationId]);

  const { allInhabitants, directIds, sortedFactionGroups, noFactionBeings, filteredCount, categoryCounts } = useMemo(() => {
    if (!location) return { allInhabitants: [] as LocationInhabitantBeing[], directIds: new Set<number>(), sortedFactionGroups: [] as { id: number; name: string; beings: LocationInhabitantBeing[] }[], noFactionBeings: [] as LocationInhabitantBeing[], filteredCount: 0, categoryCounts: new Map<string, number>() };
    const rawAll = showNestedInhabitants
      ? [...location.inhabitant_beings, ...location.nested_inhabitant_beings]
      : location.inhabitant_beings;
    // Фильтрация (U-P0-1 / U-P1-1) — по имени/тегам/типу/сообществам
    const q = debouncedQuery.trim().toLowerCase();
    const cat = categoryFilter;
    let all = rawAll;
    if (q || cat) {
      all = rawAll.filter((b) => {
        if (cat && b.category !== cat) return false;
        if (!q) return true;
        const hay = [
          b.name,
          b.category,
          (b.tags ?? []).join(" "),
          b.creature_meta?.size ?? "",
          b.creature_meta?.creatureType ?? "",
          b.creature_meta?.alignment ?? "",
          (b.communities ?? []).map((c) => c.name).join(" "),
          (b as unknown as { description?: string }).description ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    // Сортировка (U-P1-2)
    if (sortMode === "category") {
      all = [...all].sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "", "ru") || a.name.localeCompare(b.name, "ru", { numeric: true }));
    } else {
      all = [...all].sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
    }
    const direct = new Set(location.inhabitant_beings.map((b) => b.id));
    // Группировка — только отфильтрованных, чтобы пустые фракции скрывались
    const qActive = !!q || !!cat;
    const groups = new Map<number, { id: number; name: string; beings: typeof all }>();
    const noFaction: typeof all = [];
    for (const b of all) {
      if (b.communities.length === 0) {
        noFaction.push(b);
        continue;
      }
      for (const c of b.communities) {
        const g = groups.get(c.id) ?? { id: c.id, name: c.name, beings: [] };
        g.beings.push(b);
        groups.set(c.id, g);
      }
    }
    // Пустые фракции-общины показываем только когда нет фильтра — иначе они мусорят
    if (!qActive) {
      for (const c of location.inhabitant_communities) {
        if (!groups.has(c.id)) groups.set(c.id, { id: c.id, name: c.name, beings: [] });
      }
    }
    const sorted = Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    // Сортировка внутри групп уже учтена через all order, но на всякий — отсортировать
    if (sortMode === "category") {
      for (const g of sorted) g.beings.sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "", "ru") || a.name.localeCompare(b.name, "ru", { numeric: true }));
      noFaction.sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "", "ru") || a.name.localeCompare(b.name, "ru", { numeric: true }));
    }
    return { allInhabitants: rawAll, directIds: direct, sortedFactionGroups: sorted, noFactionBeings: noFaction, filteredCount: all.length, categoryCounts: new Map(Object.entries(rawAll.reduce((acc, b) => { acc[b.category] = (acc[b.category] ?? 0) + 1; return acc; }, {} as Record<string, number>))) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- location fields accessed via optional chaining
  }, [location?.inhabitant_beings, location?.nested_inhabitant_beings, location?.inhabitant_communities, showNestedInhabitants, debouncedQuery, categoryFilter, sortMode]);

  if (loadError && !location) {
    return (
      <div className="stack">
        {confirmDialog}
        <div
          className="card"
          style={{
            borderLeft: "3px solid var(--status-cancelled)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>Не удалось загрузить локацию: {loadError}</span>
          <button className="primary" onClick={() => refresh()}>
            Повторить
          </button>
        </div>
      </div>
    );
  }
  if (!location) return <div className="stack"><div className="card" style={{ padding: 24 }}><p className="muted" aria-busy="true">Загрузка…</p></div></div>;

  async function saveNameKind(values: { name: string; kind: string; short_name: string }) {
    try {
      await api.put(`/setting-locations/${locationId}`, {
        name: values.name,
        kind: values.kind,
        short_name: values.short_name.trim(),
      });
      refresh();
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    }
  }

  async function saveDescription(value: string) {
    try {
      await api.put(`/setting-locations/${locationId}`, { description: value });
      refresh();
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    }
  }

  async function saveParent() {
    try {
      await api.put(`/setting-locations/${locationId}/parent`, { parent_id: parentDraft });
      setEditingParent(false);
      refresh();
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    }
  }

  async function archiveLocation() {
    if (!location) return;
    const ok = await confirm({
      title: "Архивировать локацию?",
      message: "Отправить локацию (и все вложенные) в архив?",
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteWithUndo({
        entityName: location.name,
        deleteFn: () => api.del(`/setting-locations/${locationId}`),
        restoreFn: () => api.put(`/setting-locations/${locationId}/restore`),
      });
      navigate(
        location.parent_id ? `/locations/${location.parent_id}` : `/settings/${location.setting_id}`
      );
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    }
  }

  async function restoreChild(id: number) {
    try {
      await api.put(`/setting-locations/${id}/restore`);
      refresh();
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    }
  }

  async function addChild() {
    if (!childName.trim() || addingChild) return;
    setAddingChild(true);
    try {
      await api.post("/setting-locations", {
        setting_id: location!.setting_id,
        parent_id: locationId,
        name: childName.trim(),
        kind: childKind.trim() || null,
      });
      setChildName("");
      setChildKind("");
      refresh();
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      setAddingChild(false);
    }
  }

  async function addInhabitant(result: SearchResult) {
    if (result.type !== "being" && result.type !== "community") return;
    if (inhabitantsSaving) return;
    setInhabitantsSaving(true);
    try {
      await api.post(`/setting-locations/${locationId}/inhabitants`, {
        type: result.type,
        id: result.id,
      });
      refresh();
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      setInhabitantsSaving(false);
    }
  }

  function handleInhabitantDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setInhabitantsDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    try {
      addInhabitant(JSON.parse(raw) as SearchResult);
    } catch {
      /* битый dragData — молча игнорируем */
    }
  }

  async function removeInhabitant(type: "being" | "community", targetId: number) {
    const isCommunity = type === "community";
    const ok = await confirm({
      title: isCommunity ? "Убрать сообщество?" : "Убрать обитателя?",
      message: isCommunity
        ? "Связь сообщества с локацией будет удалена. Само сообщество останется в «Населении»."
        : "Связь существа с локацией будет удалена. Существо останется в «Населении».",
      confirmLabel: "Убрать",
    });
    if (!ok) return;
    if (inhabitantsSaving) return;
    setInhabitantsSaving(true);
    try {
      await api.del(`/setting-locations/${locationId}/inhabitants/${type}/${targetId}`);
      refresh();
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      setInhabitantsSaving(false);
    }
  }

  async function createCommunity() {
    if (!communityName.trim() || communitySaving) return;
    setCommunitySaving(true);
    try {
      const created = await api.post<{ id: number }>("/setting-communities", {
        setting_id: location!.setting_id,
        name: communityName.trim(),
      });
      await api.post(`/setting-locations/${locationId}/inhabitants`, {
        type: "community",
        id: created.id,
      });
      setCommunityName("");
      refresh();
      showSuccess(`Община «${communityName.trim()}» создана`);
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      setCommunitySaving(false);
    }
  }



  return (
    <div className={`stack${tab === "Карта" ? " page-fill" : ""}`}>
      {confirmDialog}
      <Breadcrumbs
        items={[
          { label: "Сеттинг", to: `/settings/${location.setting_id}` },
          { label: "География", to: `/settings/${location.setting_id}?tab=${encodeURIComponent("География")}` },
          ...location.ancestors.map((a) => ({ label: a.name, to: `/locations/${a.id}` })),
          { label: location.name },
        ]}
      />

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
          <button onClick={() => { selectTab("Вложенность"); setTimeout(() => document.querySelector<HTMLInputElement>(".location-nested input")?.focus(), 50); }}>
            <NavIcon name="plus" /> Вложенная
          </button>
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
          <EditableTextCard
            title="Описание"
            help="Короткая сводка о локации — что это за место, чем примечательно."
            value={location.description}
            onSave={saveDescription}
            rows={4}
            entityType="location"
            entityId={locationId}
            defaultSettingId={location.setting_id}
            collapsible
            defaultOpen
          />
          <AliasesCard
            aliases={location.aliases ?? []}
            nameOriginal={location.name_original ?? ""}
            help="Другие переводы и написания имени — по ним работает поиск и сверка при импорте книги."
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
          listTitle="Статьи"
          emptyState={
            <EmptyState
              title="Статьи помогают описать локацию"
              hint="Запишите подробности, которые не влезают в основное описание — история, тайны, заметки мастера."
              action={
                <button
                  className="primary"
                  onClick={() => {
                    void api.post(`/setting-locations/${locationId}/chapters`, {
                      title: `Статья 1`,
                      content: "",
                    }).then(refresh);
                  }}
                >
                  + Добавить статью
                </button>
              }
            />
          }
        />
          <div className="card res-group" id="section-location-images">
            <div className="res-group__band" style={{ cursor: "default" }}>
              <span className="res-group__title">тамбнейл и аватар</span>
            </div>
            <div className="res-group__body" style={{ padding: 12 }}>
              <div className="entity-image-slots">
                <EntityImageSlot
                  title="Тамбнейл — 16×10"
                  hint="Карточка в списке Географии. Рекомендуем 900×562 (16×10), до 15 MB, JPG/PNG/GIF/WebP/AVIF."
                  url={location.thumbnail_image_url}
                  uploading={uploadingThumbnail}
                  onSelect={thumbnailCrop.onSelect}
                  onDelete={location.thumbnail_image_url ? handleThumbnailDelete : undefined}
                />
                <EntityImageSlot
                  title="Аватар — квадрат 1:1"
                  hint="Запасной вариант для списка, когда тамбнейл не задан. Рекомендуем 700×700, до 15 MB."
                  url={location.avatar_image_url}
                  uploading={uploadingAvatar}
                  onSelect={avatarCrop.onSelect}
                  onDelete={location.avatar_image_url ? handleAvatarDelete : undefined}
                />
              </div>
            </div>
            {thumbnailCrop.modal}
            {avatarCrop.modal}
          </div>
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
        />
      )}

      {tab === "Упоминания" && <MentionsTab entityType="location" entityId={locationId} />}

      {tab === "Вложенность" && (
        <div className="card stack location-nested">
          <div className="card row" style={{ alignItems: "center", gap: 8, marginBottom: 8 }}>
            <strong>Родительская локация</strong>
            {editingParent ? (
              <>
                <LocationCascadePicker
                  locations={allLocations.filter(
                    (l) => l.id !== locationId && !excludedDescendants.has(l.id)
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
          <div className="geography-node-header" style={{ margin: "-14px -14px 10px", padding: "8px 12px" }}>
            Добавить вложенную локацию
          </div>
          <div className="row">
            <input
              placeholder="Название"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addChild(); }}
              disabled={addingChild}
            />
            <input
              placeholder="Тип (необязательно)"
              value={childKind}
              onChange={(e) => setChildKind(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addChild(); }}
              disabled={addingChild}
            />
            <button className="primary" onClick={addChild} disabled={addingChild}>
              {addingChild ? "…" : "Добавить"}
            </button>
          </div>
          <div className="stack">
            {childByParent.get(locationId)?.map((c) => (
              <LocationNode key={c.id} location={c} byParent={childByParent} onChange={refresh} />
            ))}
            {(childByParent.get(locationId)?.length ?? 0) === 0 && archivedChildren.length === 0 && (
              <EmptyState
                title="Вложенных локаций пока нет"
                hint="Под-территории: комнаты в здании, районы города, области страны."
                action={
                  <button className="primary" onClick={() => document.querySelector<HTMLInputElement>(".location-nested input")?.focus()}>
                    Добавить первую вложенную
                  </button>
                }
              />
            )}
            {archivedChildren.length > 0 && (
              <>
                <span className="muted" style={{ fontSize: "var(--fs-micro)", fontFamily: "var(--font-ui)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Архивированные ({archivedChildren.length})
                </span>
                {archivedChildren.map((c) => (
                  <div key={c.id} className="card row" style={{ justifyContent: "space-between", alignItems: "center", opacity: 0.65 }}>
                    <span className="muted">
                      {c.name} {c.kind && <span>· {c.kind}</span>}
                    </span>
                    <button onClick={() => restoreChild(c.id)}>Восстановить</button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "Отношения" && (
        <RelationsTab
          entityType="location"
          entityId={location.id}
          entityName={location.name}
          defaultSettingId={location.setting_id}
        />
      )}

      {tab === "Обитатели" && (
        <div className="card stack inhabitants-tab">
          {successMessage && <div className="settings-toast" role="status" aria-live="polite">{successMessage}</div>}
          <BeingQuickCreate
            settingId={location.setting_id}
            communities={communities}
            fixedLocationId={locationId}
            showCommunityPicker
            onCreated={refresh}
          />
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              placeholder="Имя новой общины"
              value={communityName}
              onChange={(e) => setCommunityName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createCommunity()}
              style={{ flex: "1 1 180px", minWidth: 0 }}
            />
            <button className="primary" onClick={createCommunity} disabled={communitySaving || !communityName.trim()}>
              {communitySaving ? "…" : "Добавить общину"}
            </button>
            <span className="muted" style={{ fontSize: "var(--fs-meta)", maxWidth: "32ch" }}>или перетащите общину из поиска — она станет фракцией</span>
          </div>
          <div
            className={`drop-zone inhabitants-drop${inhabitantsDragOver ? " drag-over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setInhabitantsDragOver(true);
            }}
            onDragLeave={() => setInhabitantsDragOver(false)}
            onDrop={handleInhabitantDrop}
          >
            <NavIcon name="search" />
            <span className="inhabitants-quick-label">Бросьте сюда</span>
            <span className="muted">существо или сообщество из поиска — или «Мешок → Обитатели локации».</span>
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <div style={{ flex: "1 1 200px", display: "flex", gap: 6, minWidth: 0 }}>
              <input
                placeholder="Поиск по имени, тегам, типу, фракции…"
                value={rawQuery}
                onChange={(e) => setRawQuery(e.target.value)}
                style={{ flex: 1, minWidth: 0 }}
              />
              {rawQuery && (
                <button onClick={() => setRawQuery("")} title="Сбросить поиск">✕</button>
              )}
            </div>
            <select className="inhabitants-filter" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">Все категории ({allInhabitants.length})</option>
              {BEING_CATEGORIES.filter((c) => c.key !== "all").map((c) => (
                <option key={c.key} value={c.key}>{c.label} ({categoryCounts.get(c.key) ?? 0})</option>
              ))}
            </select>
            <select className="inhabitants-filter" value={sortMode} onChange={(e) => setSortMode(e.target.value as "name" | "category")} title="Сортировка">
              <option value="name">Сорт: по имени</option>
              <option value="category">Сорт: по категории</option>
            </select>
            {(rawQuery || categoryFilter || sortMode !== "name") && (
              <button onClick={() => { setRawQuery(""); setCategoryFilter(""); setSortMode("name"); }}>Сбросить</button>
            )}
          </div>
          {loadError && (
            <div
              className="card"
              style={{
                borderLeft: "3px solid var(--status-cancelled)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span>Не удалось обновить обитателей: {loadError}</span>
              <button className="primary" onClick={() => refresh()}>
                Повторить
              </button>
            </div>
          )}
          {(allInhabitants.length > 0 || location.inhabitant_communities.length > 0) && (
            <div className="row muted" style={{ flexWrap: "wrap", gap: 12, fontSize: "var(--fs-meta)", fontFamily: "var(--font-mono)" }} aria-live="polite">
              <span>Обитателей: {filteredCount}{filteredCount !== allInhabitants.length ? ` из ${allInhabitants.length}` : ""}</span>
              {showNestedInhabitants && location.nested_inhabitant_beings.length > 0 && (
                <span>(+{location.nested_inhabitant_beings.length} из вложенных)</span>
              )}
              {filteredCount !== allInhabitants.length && (
                <span style={{ color: "var(--ink)" }}>Показано: {filteredCount}</span>
              )}
            </div>
          )}
          <label className="row inhabitants-nested-toggle">
            <input
              type="checkbox"
              checked={showNestedInhabitants}
              onChange={(e) => { setShowNestedInhabitants(e.target.checked); setNestedLoading(true); }}
            />
            Показывать обитателей вложенных локаций
            {showNestedInhabitants && location.nested_inhabitant_beings.length > 0 && (
              <span style={{ textTransform: "none", letterSpacing: 0, fontFamily: "var(--font-body)", fontSize: "var(--fs-micro)" }}> +{location.nested_inhabitant_beings.length} из дочерних · {(Array.from(new Set(location.nested_inhabitant_beings.flatMap((b)=> b.location_names ?? []))).join(", ") || "—")}</span>
            )}
          </label>
          {allInhabitants.length === 0 && location.inhabitant_communities.length === 0 ? (
            <EmptyState
              title="Здесь пока никто не живёт"
              hint="Добавьте личность через форму выше или перетащите существо / сообщество из поиска. Сообщества появятся как фракции."
              action={
                <button
                  className="primary"
                  onClick={() => {
                    const el = document.querySelector<HTMLInputElement>('.inhabitants-tab input[placeholder*="Имя существа"]');
                    el?.focus();
                  }}
                >
                  Создать обитателя
                </button>
              }
            />
          ) : filteredCount === 0 ? (
            <EmptyState kind="search"
              title="Ничего не найдено"
              hint={`По запросу «${(debouncedQuery || categoryFilter).trim()}» обитателей нет.`}
              action={
                <button onClick={() => { setRawQuery(""); setCategoryFilter(""); }}>Сбросить фильтры</button>
              }
            />
          ) : (
            <div style={{ opacity: nestedLoading ? 0.5 : 1, transition: "opacity 150ms" }}>
              {sortedFactionGroups.map((group) => (
                <details key={group.id} className="entity-group" open>
                  <summary className="inhabitants-group-header entity-group-header-toggle">
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
                    highlight={debouncedQuery}
                  />
                </details>
              ))}
              <details className="entity-group" open>
                <summary className="inhabitants-group-header entity-group-header-toggle">
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
                  highlight={debouncedQuery}
                />
              </details>
            </div>
          )}
        </div>
      )}

      {tab === "Важные даты" && (
        <LocationImportantDatesTab
          locationId={locationId}
          locationName={location.name}
          settingId={location.setting_id}
          dates={location.important_dates}
          calendarMonths={calendar?.months}
          calendarWeekdays={calendar?.weekdays}
          onChange={refresh}
          onShowOnMap={() => selectTab("Карта")}
        />
      )}
    </div>
  );
}
