import { useEffect, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useUnloadTarget } from "../unloadTargets";
import { AliasesCard } from "../components/AliasesCard";
import { StatblockList } from "../components/StatblockList";
import { GalleryTab } from "../components/GalleryTab";
import { MentionsTab } from "../components/MentionsTab";
import { ChapterList } from "../components/ChapterList";
import { CreatureCardEditor } from "../components/CreatureCardEditor";
import { CreatureCardLoader } from "../components/CreatureCard";
import { Modal } from "../components/Modal";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { RelationsTab } from "../components/RelationsTab";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { formatImportantDate } from "../inworldCalendar";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { GraphNeighbourhoodLink } from "../components/GraphNeighbourhoodLink";
import { EntityFieldsCard } from "../components/EntityFieldsCard";
import { useTabState } from "../hooks/useTabState";
import { useImageCrop } from "../hooks/useImageCrop";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { TagChips } from "../components/TagChips";
import { LocationCascadePicker } from "../components/LocationCascadePicker";
import { EditableTextCard } from "../components/EditableTextCard";
import { MonsterTemplatePicker } from "../components/MonsterTemplatePicker";
import { loadThumbnailStyles } from "../thumbnailStyles";
import { NavIcon } from "../components/NavIcons";
import { EmptyState } from "../components/EmptyState";
import { useAlert, useConfirm } from "../hooks/useConfirm";
import { useUndoDelete } from "../hooks/useUndoDelete";
import type {
  CompendiumLink,
  Campaign,
  DateRecurrence,
  SearchResult,
  SettingBeingDetail,
  SettingCommunity,
  SettingLocation,
} from "../types";

const TABS = [
  "Досье",
  "Отношения",
  "Места обитания",
  "Важные даты",
  "Галерея",
  "Карточка существа",
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
  const [tab, selectTab] = useTabState(TABS, "Досье");
  const [communities, setCommunities] = useState<SettingCommunity[]>([]);
  const [communityDraft, setCommunityDraft] = useState<number[]>([]);
  // «На основе» правится вместе с остальным в карточке «Основное»; в черновике
  // лежит выбор пикера, а у него формат результата поиска.
  const [baseDraft, setBaseDraft] = useState<SearchResult | null>(null);
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
  const thumbnailStyles = loadThumbnailStyles();
  const avatarCrop = useImageCrop("square", handleAvatarChange);
  const thumbnailCrop = useImageCrop("thumbnail", handleThumbnailChange);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const { deleteWithUndo } = useUndoDelete();
  const [alertDialog, showAlert] = useAlert();
  const [dossierQuery, setDossierQuery] = useState("");
  const [neighbourIds, setNeighbourIds] = useState<{ prev: number | null; next: number | null }>({ prev: null, next: null });
  const [cardPreviewOpen, setCardPreviewOpen] = useState(false);

  async function loadBeing(signal?: AbortSignal) {
    setLoading(true);
    setLoadError(null);
    const opts = signal ? { signal } : undefined;
    try {
      const b = await api.get<SettingBeingDetail>(`/setting-beings/${beingId}`, opts as any);
      if (signal?.aborted) return;
      setBeing(b);
      setCommunityDraft(b.communities.map((c) => c.id));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      if (signal?.aborted) return;
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  function refresh() {
    void loadBeing();
  }
  useEffect(() => {
    const controller = new AbortController();
    void loadBeing(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beingId]);

  // Мешок выгружает сюда локации — то же, что перетаскивание в «Места
  // обитания» (см. unloadTargets.tsx).
  useUnloadTarget({
    label: "Места обитания",
    accepts: (item) => item.type === "location",
    drop: addLocation,
  });

  useEffect(() => {
    if (!being) return;
    const controller = new AbortController();
    const opts = { signal: controller.signal } as any;
    api
      .get<Campaign[]>("/campaigns", opts)
      .then((all) => {
        if (controller.signal.aborted) return;
        setCampaigns(all.filter((c) => c.setting_id === being.setting_id));
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
      });
    api
      .get<SettingCommunity[]>(`/setting-communities?setting_id=${being.setting_id}`, opts)
      .then((data) => {
        if (controller.signal.aborted) return;
        setCommunities(data);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
      });
    api
      .get<SettingLocation[]>(`/setting-locations?setting_id=${being.setting_id}`, opts)
      .then((data) => {
        if (controller.signal.aborted) return;
        setSettingLocations(data);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [being?.setting_id]);

  // Соседи по сеттингу — для prev/next навигации (U-P0-1)
  useEffect(() => {
    if (!being) return;
    const controller = new AbortController();
    api
      .get<{ id: number }[]>(`/setting-beings?setting_id=${being.setting_id}`, { signal: controller.signal } as any)
      .then((all) => {
        if (controller.signal.aborted) return;
        const ids = all.map((r) => r.id).sort((a, b) => a - b);
        const idx = ids.indexOf(being.id);
        setNeighbourIds({
          prev: idx > 0 ? ids[idx - 1] : null,
          next: idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null,
        });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [being?.id, being?.setting_id]);

  async function duplicateBeing() {
    if (!being) return;
    try {
      const created = await api.post<{ id: number }>("/setting-beings", {
        setting_id: being.setting_id,
        name: `Копия — ${being.name}`,
        category: being.category,
        tags: being.tags,
      });
      navigate(`/beings/${created.id}`);
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  if (loadError && !being) {
    return (
      <div className="stack" style={{ position: "relative", paddingBottom: 50 }}>
        {confirmDialog}
        {alertDialog}
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
          <span>Не удалось загрузить существо: {loadError}</span>
          <button className="primary" onClick={() => refresh()}>
            Повторить
          </button>
        </div>
      </div>
    );
  }

  if (loading && !being) {
    return (
      <div className="stack" aria-busy="true" aria-label="Загрузка существа">
        {confirmDialog}
        {alertDialog}
        <div
          className="card"
          style={{
            height: 140,
            opacity: 0.45,
            background: "var(--bg-elevated)",
            animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate",
          }}
        />
        <div
          className="card"
          style={{
            height: 220,
            opacity: 0.45,
            background: "var(--bg-elevated)",
            animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate",
            animationDelay: "120ms",
          }}
        />
      </div>
    );
  }

  if (!being) return <p className="muted">Загрузка…</p>;

  async function saveTags(tags: string[]) {
    setSaving(true);
    try {
      await api.put(`/setting-beings/${beingId}`, { tags });
      refresh();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  async function saveDescription(value: string) {
    setSaving(true);
    try {
      await api.put(`/setting-beings/${beingId}`, { description: value });
      refresh();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  async function saveName(values: { name: string; category: string; short_name: string }) {
    setSaving(true);
    try {
      await api.put(`/setting-beings/${beingId}`, {
        name: values.name,
        category: values.category,
        short_name: values.short_name.trim(),
        // Смена основы догружает её статблок и описание, ничего не затирая, —
        // поэтому и уходит только когда её действительно поменяли.
        ...(baseDraft?.id !== being?.base_monster_id ? { base_monster_id: baseDraft?.id ?? null } : {}),
      });
      await api.put(`/setting-beings/${beingId}/communities`, { community_ids: communityDraft });
      refresh();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
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
    const ok = await confirm({
      title: "Отправить в архив?",
      message: `Отправить существо «${being.name}» в архив? Его можно восстановить позже.`,
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteWithUndo({
        entityName: being.name,
        deleteFn: () => api.del(`/setting-beings/${beingId}`),
        restoreFn: () => api.put(`/setting-beings/${beingId}/restore`),
      });
      navigate(`/settings/${being.setting_id}`);
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  async function addLocation(result: SearchResult) {
    if (result.type !== "location") return;
    try {
      await api.post(`/setting-beings/${beingId}/locations`, { location_id: result.id });
      refresh();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  function handleLocationDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setLocationsDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    addLocation(JSON.parse(raw) as SearchResult);
  }

  async function removeLocation(locationId: number) {
    try {
      await api.del(`/setting-beings/${beingId}/locations/${locationId}`);
      refresh();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  async function addLocationViaCascade() {
    if (!addLocationId) return;
    try {
      await api.post(`/setting-beings/${beingId}/locations`, { location_id: addLocationId });
      setAddLocationId(null);
      refresh();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  async function addImportantDate() {
    if (!dateTitle.trim() || !dateDay) return;
    try {
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
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  async function removeImportantDate(dateId: number) {
    const ok = await confirm({
      title: "Удалить дату?",
      message: "Удалить важную дату?",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/setting-beings/important-dates/${dateId}`);
      refresh();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  async function handleAvatarChange(file: File | null) {
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/setting-beings/${beingId}/avatar`, form);
      refresh();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
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
      await api.post(`/setting-beings/${beingId}/thumbnail`, form);
      refresh();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    } finally {
      setUploadingThumbnail(false);
    }
  }

  return (
    <div className="stack" style={{ position: "relative", paddingBottom: 50 }}>
      {confirmDialog}
      {alertDialog}
      {loadError && being && (
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
          <span>Ошибка загрузки: {loadError}</span>
          <button className="primary" onClick={() => refresh()}>
            Повторить
          </button>
        </div>
      )}
      {saving && <span className="muted" aria-live="polite" style={{ fontSize: "var(--fs-meta)" }}>Сохранение…</span>}
      {(() => {
        const lastFilters = (() => {
          try {
            return sessionStorage.getItem(`population-last-filters-${being.setting_id}`) || "";
          } catch {
            return "";
          }
        })();
        const baseTo = `/settings/${being.setting_id}?tab=${encodeURIComponent("Население")}`;
        const to = lastFilters ? `${baseTo}&${lastFilters}` : baseTo;
        return (
          <Breadcrumbs
            items={[
              { label: "Население", to },
              { label: being.name },
            ]}
          />
        );
      })()}

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
          <div>
            <div className="row" style={{ alignItems: "center" }}>
              <h1
                title="Нажмите чтобы перейти к редактированию основного"
                style={{ cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 4 }}
                onClick={() => {
                  selectTab("Досье");
                  setTimeout(() => document.getElementById("dossier-fields")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
                }}
              >
                {being.name}
              </h1>
              <EntityTypeChip type="being" />
              <GraphNeighbourhoodLink type="being" id={being.id} />
              <span className="row" style={{ gap: 4, marginLeft: 8 }}>
                <button
                  type="button"
                  className="comp-mini"
                  disabled={!neighbourIds.prev}
                  title={neighbourIds.prev ? "Предыдущее существо" : "Нет предыдущего"}
                  onClick={() => neighbourIds.prev && navigate(`/beings/${neighbourIds.prev}`)}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="comp-mini"
                  disabled={!neighbourIds.next}
                  title={neighbourIds.next ? "Следующее существо" : "Нет следующего"}
                  onClick={() => neighbourIds.next && navigate(`/beings/${neighbourIds.next}`)}
                >
                  →
                </button>
              </span>
            </div>
            {being.creature_meta && (
              <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", letterSpacing: "0.02em" }}>
                {[being.creature_meta.size, being.creature_meta.creatureType, being.creature_meta.alignment]
                  .filter((p) => p && p.trim())
                  .join(" · ")}
              </div>
            )}
            <div className="row">
              <span className="badge tag" style={{ fontFamily: "var(--font-ui)", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.10em" }}>{CATEGORY_LABELS[being.category]}</span>
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
        </div>
        <div className="entity-header-actions">
          <button onClick={() => setCardPreviewOpen(true)} title="Быстрый просмотр карточки — для стола">
            <NavIcon name="card" /> Карточка
          </button>
          <button onClick={() => window.print()} title="Печать профиля">
            <NavIcon name="document" /> Печать
          </button>
          <button onClick={duplicateBeing} title="Создать копию этого существа">
            <NavIcon name="plus" /> Дублировать
          </button>
          <button className="danger" onClick={archiveBeing}>
            <NavIcon name="archive" /> Архивировать
          </button>
        </div>
      </div>
      {cardPreviewOpen && (
        <Modal onClose={() => setCardPreviewOpen(false)}>
          <div className="stack" style={{ minWidth: 320, maxWidth: 560 }}>
            <CreatureCardLoader type="being" id={beingId} />
            <button onClick={() => setCardPreviewOpen(false)}>Закрыть</button>
          </div>
        </Modal>
      )}

      <div className="tabs">
        {(() => {
          const counts: Record<string, number> = {
            Досье: being.chapters.length + (being.description ? 1 : 0),
            Отношения: (being.relations?.length ?? 0),
            "Места обитания": being.locations.length,
            "Важные даты": being.important_dates.length,
            Галерея: 0,
            "Карточка существа": being.statblock_count ?? 0,
            Упоминания: 0,
          };
          return TABS.map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => selectTab(t)}>
              {t}
              {counts[t] !== undefined && counts[t] > 0 && (
                <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "10px", marginLeft: 6, opacity: 0.7 }}>
                  · {counts[t]}
                </span>
              )}
            </button>
          ));
        })()}
      </div>

      {tab === "Досье" && (
        <div className="stack">
          <div className="row" style={{ gap: 8 }}>
            <input
              placeholder="Поиск по досье — имя, описание, главы…"
              value={dossierQuery}
              onChange={(e) => setDossierQuery(e.target.value)}
              aria-label="Поиск по досье"
              style={{ flex: 1 }}
            />
            {dossierQuery && (
              <button onClick={() => setDossierQuery("")} title="Сбросить">
                ✕
              </button>
            )}
          </div>
          <div id="dossier-fields" />
          <EntityFieldsCard
            key={`fields-${being.id}`}
            fields={[
              { key: "name", label: "Имя", value: being.name, required: true },
              {
                key: "short_name",
                label: "Короткое имя для карты",
                value: being.short_name ?? "",
                title: "Показывается вместо полного имени в подписи пина на карте локации",
              },
              {
                key: "category",
                label: "Категория",
                value: being.category,
                options: Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
              },
            ]}
            onEditStart={() => {
              setCommunityDraft(being.communities.map((c) => c.id));
              setBaseDraft(
                being.base_monster_id
                  ? ({
                      id: being.base_monster_id,
                      title: being.base_monster_name ?? "",
                      type: "compendium_entry",
                    } as SearchResult)
                  : null
              );
            }}
            onSave={(v) =>
              saveName({ name: v.name, category: v.category, short_name: v.short_name })
            }
            editExtras={
              <>
                <span className="editable-card-field-label">На основе</span>
                <span className="muted">
                  Смена основы догрузит её статблок и описание отдельными статьями. Уже написанное
                  останется на месте — ничего не переписывается.
                </span>
                <MonsterTemplatePicker value={baseDraft} onChange={setBaseDraft} />
                <span className="editable-card-field-label">Сообщества</span>
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
              </>
            }
          />
          <AliasesCard
            title="Известен также как"
            aliases={being.aliases ?? []}
            nameOriginal={being.name_original ?? ""}
            onSave={async (aliases, name_original) => {
              await api.put(`/setting-beings/${beingId}`, { aliases, name_original });
              refresh();
            }}
          />
          <CompendiumLinksCard
            beingId={beingId}
            links={being.compendium_links}
            onChange={refresh}
          />
          <StatblockList ownerType="being" ownerId={beingId} ownerName={being.name} settingId={being.setting_id} />
          <EditableTextCard
            title="Описание"
            help="Короткая сводка — тоже используется как краткое описание в раскрываемых карточках (Обитатели, Представители)."
            value={being.description}
            onSave={saveDescription}
            rows={4}
            entityType="being"
            entityId={beingId}
            defaultSettingId={being.setting_id}
            collapsible
            defaultOpen
          />
          <details className="card" open>
            <summary className="card-header--inverted chevron-summary" style={{ margin: "-14px -14px 12px -14px", cursor: "pointer", listStyle: "none" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <NavIcon name="chevron" className="chevron-icon" /> История
              </span>
              <span className="card-header--inverted-count">· {being.chapters.filter((c) => c.section === "history").length}</span>
            </summary>
            <ChapterList
              ownerId={beingId}
              ownerType="being"
              apiBase="/setting-beings"
              section="history"
              chapters={being.chapters.filter((c) => c.section === "history" && (!dossierQuery.trim() || c.title.toLowerCase().includes(dossierQuery.toLowerCase()) || c.content.toLowerCase().includes(dossierQuery.toLowerCase())))}
              onChange={refresh}
              defaultSettingId={being.setting_id}
              visibilityToggle
            />
          </details>
          <details className="card" open>
            <summary className="card-header--inverted chevron-summary" style={{ margin: "-14px -14px 12px -14px", cursor: "pointer", listStyle: "none" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <NavIcon name="chevron" className="chevron-icon" /> Поведение
              </span>
              <span className="card-header--inverted-count">· {being.chapters.filter((c) => c.section === "behavior").length}</span>
            </summary>
            <ChapterList
              ownerId={beingId}
              ownerType="being"
              apiBase="/setting-beings"
              section="behavior"
              chapters={being.chapters.filter((c) => c.section === "behavior" && (!dossierQuery.trim() || c.title.toLowerCase().includes(dossierQuery.toLowerCase()) || c.content.toLowerCase().includes(dossierQuery.toLowerCase())))}
              onChange={refresh}
              defaultSettingId={being.setting_id}
              visibilityToggle
            />
          </details>
          <details className="card" open>
            <summary className="card-header--inverted chevron-summary" style={{ margin: "-14px -14px 12px -14px", cursor: "pointer", listStyle: "none" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <NavIcon name="chevron" className="chevron-icon" /> Текущая ситуация
              </span>
              <span className="card-header--inverted-count">· {being.chapters.filter((c) => c.section === "current_situation").length}</span>
            </summary>
            <ChapterList
              ownerId={beingId}
              ownerType="being"
              apiBase="/setting-beings"
              section="current_situation"
              chapters={being.chapters.filter((c) => c.section === "current_situation" && (!dossierQuery.trim() || c.title.toLowerCase().includes(dossierQuery.toLowerCase()) || c.content.toLowerCase().includes(dossierQuery.toLowerCase())))}
              onChange={refresh}
              defaultSettingId={being.setting_id}
              campaigns={campaigns}
              visibilityToggle
            />
          </details>
          {being.events.length > 0 && (
            <div className="card stack">
              <div className="card-header--inverted">
                <span className="card-header--inverted-label">Лента сессий</span>
                <span className="card-header--inverted-count">· {being.events.length}</span>
              </div>
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                В каких сессиях появлялось это существо — из `being_events` (мёртвый код G-P0-2 возвращён).
              </span>
              <div className="stack" style={{ gap: 8 }}>
                {being.events
                  .filter((ev) => !dossierQuery.trim() || ev.title.toLowerCase().includes(dossierQuery.toLowerCase()) || ev.description.toLowerCase().includes(dossierQuery.toLowerCase()))
                  .map((ev) => (
                    <div key={ev.id} className="row" style={{ justifyContent: "space-between", alignItems: "center", borderLeft: "2px solid var(--line)", paddingLeft: 8 }}>
                      <span>
                        <strong>{ev.title}</strong>
                        {ev.campaign_name && <span className="muted"> · {ev.campaign_name}</span>}
                        {ev.session_date && <span className="muted"> · {ev.session_date}</span>}
                        {ev.description && <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>{ev.description}</div>}
                      </span>
                      {ev.session_id && <Link to={`/sessions/${ev.session_id}`} className="comp-mini">К сессии →</Link>}
                    </div>
                  ))}
              </div>
            </div>
          )}
          <div className="card stack">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Упоминания</span>
              <button className="comp-mini" onClick={() => selectTab("Упоминания")}>Открыть →</button>
            </div>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Где ещё встречается это имя — полный список во вкладке «Упоминания».</span>
          </div>
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

      {tab === "Карточка существа" && (
        <CreatureCardEditor type="being" id={beingId} onChange={refresh} />
      )}

      {tab === "Упоминания" && <MentionsTab entityType="being" entityId={beingId} />}

      {tab === "Отношения" && (
        <RelationsTab
          entityType="being"
          entityId={beingId}
          entityName={being.name}
          defaultSettingId={being.setting_id}
        />
      )}

      {tab === "Места обитания" && (
        <div className="card stack">
          <div className="card-header--inverted">
            <span className="card-header--inverted-label">Места обитания</span>
            <span className="card-header--inverted-count">· {being.locations.length}</span>
          </div>
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
          <div className="entity-row-list">
            {being.locations.map((l) => {
              const full = settingLocations.find((loc) => loc.id === l.id);
              const url = full?.thumbnail_image_url || full?.avatar_image_url;
              const isBg = thumbnailStyles.locations === "background" && !!url;
              return (
                <Link
                  key={l.id}
                  to={`/locations/${l.id}`}
                  className={`entity-row${isBg ? " entity-row-bg" : ""}`}
                  style={isBg ? { backgroundImage: `url("${url}")` } : undefined}
                >
                  {thumbnailStyles.locations === "banner" && url && (
                    <img src={url} alt="" className="entity-row-thumb" />
                  )}
                  <span className="entity-row-name">{l.name}</span>
                  <span className="muted">{full?.kind}</span>
                  <span className="entity-row-actions">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeLocation(l.id);
                      }}
                    >
                      Убрать отсюда
                    </button>
                  </span>
                </Link>
              );
            })}
            {being.locations.length === 0 && (
              <EmptyState
                icon="anarchyStar"
                title="МЕСТ ПОКА НЕТ"
                hint="Перетащите локацию из поиска, выберите из списка или из мешка — существо появится на карте."
              />
            )}
          </div>
        </div>
      )}

      {tab === "Важные даты" && (
        <div className="card stack">
          <div className="card-header--inverted">
            <span className="card-header--inverted-label">Важные даты</span>
            <span className="card-header--inverted-count">· {being.important_dates.length}</span>
          </div>
          <span className="muted">
            Эти даты отмечаются на календаре сеттинга и переносятся в календари связанных с ним
            кампаний.
          </span>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
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
                  <strong>{d.title}</strong> — {formatImportantDate(d, calendar?.months ?? [], calendar?.weekdays ?? [])}
                </span>
                <button className="danger" onClick={() => removeImportantDate(d.id)}>
                  ✕
                </button>
              </div>
            ))}
            {being.important_dates.length === 0 && (
              <EmptyState
                icon="issueStamp"
                title="ДАТ ПОКА НЕТ"
                hint="Добавьте день рождения, годовщину или ритуал — попадёт в календарь сеттинга и кампаний."
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// "Записи компендиумов" — monster templates from any number of systems tied
// to this being. Mostly used by бестиарий entries (the same creature kind
// statted for D&D and for another system), but available to named
// personalities too. Distinct from the single "На основе" template shown in
// the header, which records a one-time clone at creation.
function CompendiumLinksCard({
  beingId,
  links,
  onChange,
}: {
  beingId: number;
  links: CompendiumLink[];
  onChange: () => void;
}) {
  async function add(entry: SearchResult | null) {
    if (!entry) return;
    await api.post(`/setting-beings/${beingId}/compendium-links`, { compendium_entry_id: entry.id });
    onChange();
  }

  async function remove(entryId: number) {
    await api.del(`/setting-beings/${beingId}/compendium-links/${entryId}`);
    onChange();
  }

  return (
    <details className="card">
      <summary className="card-header--inverted chevron-summary" style={{ margin: "-14px -14px 12px -14px", cursor: "pointer", listStyle: "none" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <NavIcon name="chevron" className="chevron-icon" /> Записи компендиумов
        </span>
        <span className="card-header--inverted-count">· {links.length}</span>
      </summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <span className="muted">
          Монстры из компендиумов систем, соответствующие этому существу. Можно связать записи
          сразу из нескольких систем.
        </span>
        <MonsterTemplatePicker value={null} onChange={add} />
        <div className="stack">
          {links.map((l) => (
            <div key={l.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>
                <Link to={`/compendium/${l.id}`}>{l.name}</Link>
                {l.system_name && <span className="muted"> · {l.system_name}</span>}
              </span>
              <button className="danger" onClick={() => remove(l.id)}>
                ✕
              </button>
            </div>
          ))}
          {links.length === 0 && <p className="muted">Связанных записей компендиума нет.</p>}
        </div>
      </div>
    </details>
  );
}
