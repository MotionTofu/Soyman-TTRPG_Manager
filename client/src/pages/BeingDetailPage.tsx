import { useEffect, useMemo, useState, type DragEvent } from "react";
import { EntityParticipates } from "../components/EntityParticipates";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PdfEntitySources } from "../components/PdfEntitySources";
import {
  useAction,
  useAfterWrite,
  useEntity,
  useResource,
  useSaveEntity,
  write,
} from "../data/hooks";
import { showSaveError } from "../data/notices";
import { beingAffects, settingPaths } from "../data/settingEntities";
import { sessionPaths } from "../data/sessions";
import type { Affect } from "../data/entities";
import { useUnloadTarget } from "../unloadTargets";
import { AliasesCard } from "../components/AliasesCard";
import { StatblockList } from "../components/StatblockList";
import { GalleryTab } from "../components/GalleryTab";
import { MentionsTab } from "../components/MentionsTab";
import { ChapterList } from "../components/ChapterList";
import { CreatureCardEditor } from "../components/CreatureCardEditor";
import { CreatureCardLoader } from "../components/CreatureCard";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { RelationsTab } from "../components/RelationsTab";
import { MentionText } from "../components/mentions/MentionText";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { formatImportantDate } from "../inworldCalendar";
import { EntityPage } from "../components/EntityPage";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { GraphNeighbourhoodLink } from "../components/GraphNeighbourhoodLink";
import { EntityFieldsCard } from "../components/EntityFieldsCard";
import { useTabState } from "../hooks/useTabState";
import { useImageCrop } from "../hooks/useImageCrop";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { TagChips } from "../components/TagChips";
import { LocationCascadePicker } from "../components/LocationCascadePicker";
import { EditableTextCard } from "../components/EditableTextCard";
import { MonsterTemplatePicker } from "../components/MonsterTemplatePicker";
import { EmptyState } from "../components/EmptyState";
import { NavIcon } from "../components/NavIcons";
import { useConfirm } from "../hooks/useConfirm";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { PARTICIPATION_FIELDS } from "../beingForce";
import { rememberOpenedBeing } from "../populationRecent";
import type {
  BeingChapter,
  BeingParticipation,
  CompendiumLink,
  Campaign,
  DateRecurrence,
  EntityRelationsResponse,
  LiveSession,
  SearchResult,
  SettingBeingDetail,
  SettingCommunity,
  SettingLocation,
} from "../types";

// Профиль существа — пилот бумажного вида (разбор профилей 2026-10-01).
// Вкладки (Q2): «Связи» собрала «Отношения» и «Места обитания», «Хроника» —
// «Важные даты» и ленту сессий (Q16), вкладка-редактор «Карточка существа»
// ушла в досье: карточка правится по месту (Q8).
const TABS = ["Досье", "Связи", "Хроника", "Галерея", "Упоминания"] as const;

const TAB_ALIASES: Readonly<Record<string, string>> = {
  Отношения: "Связи",
  "Места обитания": "Связи",
  "Важные даты": "Хроника",
  "Карточка существа": "Досье",
};

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

function matches(query: string, ...texts: string[]): boolean {
  const q = query.trim().toLowerCase();
  return !q || texts.some((t) => t.toLowerCase().includes(q));
}

export function BeingDetailPage() {
  const { id } = useParams();
  const beingId = Number(id);
  const navigate = useNavigate();

  const beingState = useEntity<SettingBeingDetail>("being", beingId);
  const being = beingState.data ?? null;
  const settingId = being?.setting_id ?? null;
  const [tab, selectTab] = useTabState(TABS, "Досье", TAB_ALIASES);
  const communities =
    useResource<SettingCommunity[]>(
      settingId ? settingPaths.inSetting("community", settingId) : null,
    ).data ?? [];
  const [communityDraft, setCommunityDraft] = useState<number[]>([]);
  // «На основе» правится вместе с остальным в карточке «Основное»; в черновике
  // лежит выбор пикера, а у него формат результата поиска.
  const [baseDraft, setBaseDraft] = useState<SearchResult | null>(null);
  const [showAllCommunities, setShowAllCommunities] = useState(true);

  const allCampaigns = useResource<Campaign[]>(settingPaths.campaigns()).data;
  const campaigns = useMemo(
    () => (allCampaigns ?? []).filter((c) => c.setting_id === settingId),
    [allCampaigns, settingId],
  );
  const live =
    useResource<LiveSession | null>(sessionPaths.live()).data ?? null;
  // Счётчик «Связей» — тот же список, что читает сама вкладка, из кэша слоя.
  const relations =
    useResource<EntityRelationsResponse>(
      settingPaths.relations("being", beingId),
    ).data ?? null;

  const [locationsDragOver, setLocationsDragOver] = useState(false);
  const settingLocations =
    useResource<SettingLocation[]>(
      settingId ? settingPaths.inSetting("location", settingId) : null,
    ).data ?? [];
  const [addLocationId, setAddLocationId] = useState<number | null>(null);
  const [dateTitle, setDateTitle] = useState("");
  const [dateRecurrence, setDateRecurrence] = useState<DateRecurrence>("once");
  const [dateYear, setDateYear] = useState("");
  const [dateMonth, setDateMonth] = useState("");
  const [dateDay, setDateDay] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [editingCard, setEditingCard] = useState(false);
  const [newCampaignId, setNewCampaignId] = useState("");

  const calendar = useSettingCalendar(being?.setting_id);
  const avatarCrop = useImageCrop("square", handleAvatarChange);
  const [confirmDialog, confirm] = useConfirm();
  const { deleteWithUndo } = useUndoDelete();
  const mine: Affect[] = beingAffects(beingId);
  const { save, saving } = useSaveEntity<SettingBeingDetail>("being", beingId, {
    affects: mine.slice(1),
  });
  const run = useAction();
  const afterWrite = useAfterWrite();
  const [dossierQuery, setDossierQuery] = useState("");

  // Соседи по сеттингу — для prev/next навигации (U-P0-1). Тот же список
  // существ сеттинга, что у «Связей» и «Населения», — из кэша слоя.
  const settingBeings = useResource<{ id: number }[]>(
    settingId ? settingPaths.inSetting("being", settingId) : null,
  ).data;
  const neighbourIds = useMemo(() => {
    if (!settingBeings) return { prev: null, next: null };
    const ids = settingBeings.map((r) => r.id).sort((a, b) => a - b);
    const idx = ids.indexOf(beingId);
    return {
      prev: idx > 0 ? ids[idx - 1] : null,
      next: idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null,
    };
  }, [settingBeings, beingId]);

  // Пять последних открытых — пустая правая колонка «Населения» (Q13).
  const openedSetting = being?.setting_id;
  const openedName = being?.name;
  useEffect(() => {
    if (openedSetting && openedName)
      rememberOpenedBeing(openedSetting, beingId, openedName);
  }, [openedSetting, openedName, beingId]);

  // Мешок выгружает сюда локации — то же, что перетаскивание в «Где» (см.
  // unloadTargets.tsx).
  useUnloadTarget({
    label: "Связи · Где",
    accepts: (item) => item.type === "location",
    drop: addLocation,
  });

  async function duplicateBeing() {
    if (!being) return;
    const created = await run(
      () =>
        write.post<{ id: number }>("/setting-beings", {
          setting_id: being.setting_id,
          name: `Копия — ${being.name}`,
          category: being.category,
          tags: being.tags,
        }),
      // Без «Повторить»: ответ мог потеряться после записи — повтор завёл бы вторую копию.
      { affects: [{ kind: "being" }], retry: false },
    );
    if (created) navigate(`/beings/${created.id}`);
  }

  if (beingState.error && !being) {
    return (
      <div className="stack">
        {confirmDialog}
        <LoadErrorCard
          message={<>Не удалось загрузить существо: {beingState.error}</>}
          onRetry={beingState.reload}
        />
      </div>
    );
  }

  if (!being) {
    return (
      <div className="stack">
        {confirmDialog}
        <ListSkeleton variant="paragraph" label="Загрузка существа" />
      </div>
    );
  }

  // Карточки полей держат правку открытой, пока сохранение не удалось: для
  // этого им нужна ошибка, а плашку показывает слой.
  async function saveOrThrow(patch: Partial<SettingBeingDetail>) {
    if (!(await save(patch))) throw new Error("Не сохранилось");
  }

  function saveTags(tags: string[]) {
    void save({ tags });
  }

  async function saveDescription(value: string) {
    await saveOrThrow({ description: value });
  }

  async function saveName(values: {
    name: string;
    category: string;
    short_name: string;
  }) {
    const body = {
      name: values.name,
      category: values.category,
      short_name: values.short_name.trim(),
      // Смена основы догружает её статблок и описание, ничего не затирая, —
      // поэтому и уходит только когда её действительно поменяли.
      ...(baseDraft?.id !== being?.base_monster_id
        ? { base_monster_id: baseDraft?.id ?? null }
        : {}),
    };
    const communityIds = communityDraft;
    const done = await run(
      async () => {
        await write.put(`/setting-beings/${beingId}`, body);
        await write.put(`/setting-beings/${beingId}/communities`, {
          community_ids: communityIds,
        });
        return true;
      },
      // Сообщества видят своих представителей: их карточки тоже задеты.
      { affects: [...mine, { kind: "community" }] },
    );
    if (!done) throw new Error("Не сохранилось");
  }

  function toggleCommunity(id: number) {
    setCommunityDraft((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
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
        deleteFn: async () => {
          await write.del(`/setting-beings/${beingId}`);
          afterWrite([{ kind: "being" }]);
        },
        restoreFn: async () => {
          await write.put(`/setting-beings/${beingId}/restore`);
          afterWrite([{ kind: "being" }]);
        },
      });
    } catch (e) {
      showSaveError(
        `Не удалось архивировать «${being.name}»: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    navigate(`/settings/${being.setting_id}`);
  }

  // Место обитания видно с обеих сторон: у существа и в «Обитателях» локации.
  const habitatAffects: Affect[] = [...mine, { kind: "location" }];

  async function addLocation(result: SearchResult) {
    if (result.type !== "location") return;
    await run(
      () =>
        write.post(`/setting-beings/${beingId}/locations`, {
          location_id: result.id,
        }),
      { affects: habitatAffects },
    );
  }

  function handleLocationDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setLocationsDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    addLocation(JSON.parse(raw) as SearchResult);
  }

  async function removeLocation(locationId: number) {
    await run(
      () => write.del(`/setting-beings/${beingId}/locations/${locationId}`),
      { affects: habitatAffects },
    );
  }

  async function addLocationViaCascade() {
    if (!addLocationId) return;
    const locationId = addLocationId;
    const done = await run(
      () =>
        write
          .post(`/setting-beings/${beingId}/locations`, {
            location_id: locationId,
          })
          .then(() => true),
      { affects: habitatAffects },
    );
    if (done) setAddLocationId(null);
  }

  // Участие (Q7): глава «Текущая ситуация» с кампанией. Завести — значит
  // завести такую главу; поля участия пишутся на неё же.
  async function addParticipation() {
    const campaignId = Number(newCampaignId);
    if (!campaignId) return;
    const done = await run(
      () =>
        write
          .post(`/setting-beings/${beingId}/chapters`, {
            section: "current_situation",
            campaign_id: campaignId,
            title: "",
          })
          .then(() => true),
      { affects: mine, retry: false },
    );
    if (done) setNewCampaignId("");
  }

  // Важные даты попадают в календарь сеттинга и кампаний.
  const dateAffects: Affect[] = [...mine, { path: "/calendar" }];

  async function addImportantDate() {
    if (!dateTitle.trim() || !dateDay) return;
    const body = {
      title: dateTitle,
      recurrence: dateRecurrence,
      year: dateRecurrence === "once" ? Number(dateYear) || null : null,
      month: dateRecurrence !== "monthly" ? Number(dateMonth) || null : null,
      day: Number(dateDay),
    };
    // Без «Повторить»: повтор после потерянного ответа завёл бы дату дважды.
    // Набранное остаётся в полях — добавить ещё раз можно самому.
    const done = await run(
      () =>
        write
          .post(`/setting-beings/${beingId}/important-dates`, body)
          .then(() => true),
      { affects: dateAffects, retry: false },
    );
    if (!done) return;
    setDateTitle("");
    setDateYear("");
    setDateMonth("");
    setDateDay("");
  }

  async function removeImportantDate(dateId: number) {
    const ok = await confirm({
      title: "Удалить дату?",
      message: "Удалить важную дату?",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    await run(() => write.del(`/setting-beings/important-dates/${dateId}`), {
      affects: dateAffects,
    });
  }

  async function handleAvatarChange(file: File | null) {
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await run(
        () =>
          write.post(`/setting-beings/${beingId}/avatar`, form, {
            timeoutMs: 60_000,
          }),
        { affects: mine },
      );
    } finally {
      setUploadingAvatar(false);
    }
  }

  const chaptersOf = (section: BeingChapter["section"]) =>
    being.chapters.filter(
      (c) => c.section === section && matches(dossierQuery, c.title, c.content),
    );
  // Участие — главы с кампанией; идущая сессия поднимает свою наверх (Q14).
  const participations = being.chapters
    .filter((c) => c.section === "current_situation" && c.campaign_id)
    .sort(
      (a, b) =>
        Number(b.campaign_id === live?.campaign_id) -
        Number(a.campaign_id === live?.campaign_id),
    );
  const freeCampaigns = campaigns.filter(
    (c) => !participations.some((p) => p.campaign_id === c.id),
  );
  const scenes = being.scenes ?? [];
  const relationCount = relations
    ? relations.outgoing.length + relations.incoming.length
    : 0;
  const linkCount = being.locations.length + relationCount + scenes.length;
  const chronicleCount = being.important_dates.length + being.events.length;
  const isBestiary = being.category === "bestiary";

  return (
    <EntityPage
      paper
      crumbs={[
        {
          label: "Население",
          to: (() => {
            // Возврат в «Население» с теми же фильтрами, с какими оттуда ушли.
            const lastFilters = (() => {
              try {
                return (
                  sessionStorage.getItem(
                    `population-last-filters-${being.setting_id}`,
                  ) || ""
                );
              } catch {
                return "";
              }
            })();
            const population = isBestiary ? "Бестиарий" : "Личности";
            const baseTo = `/settings/${being.setting_id}?tab=${encodeURIComponent("Население")}&population=${encodeURIComponent(population)}`;
            return lastFilters ? `${baseTo}&${lastFilters}` : baseTo;
          })(),
        },
        { label: being.name },
      ]}
      entityType="being"
      title={being.name}
      badges={
        <>
          {(being.aliases ?? [])[0] && (
            <span className="badge">«{being.aliases[0]}»</span>
          )}
        </>
      }
      meta={
        being.creature_meta &&
        [
          being.creature_meta.size,
          being.creature_meta.creatureType,
          being.creature_meta.alignment,
        ]
          .filter((p) => p && p.trim())
          .join(" · ")
      }
      // Главного действия нет: быстрый просмотр карточки стал шапкой досье
      // (Q3), а «Править» стоит на самой карточке — рядом с тем, что правят.
      actions={[
        { label: "Печать профиля", onClick: () => window.print() },
        { label: "Дублировать", onClick: duplicateBeing },
        { label: "Архивировать", danger: true, onClick: archiveBeing },
      ]}
      tabs={[
        "Досье",
        { id: "Связи", label: linkCount ? `Связи · ${linkCount}` : "Связи" },
        {
          id: "Хроника",
          label: chronicleCount ? `Хроника · ${chronicleCount}` : "Хроника",
        },
        "Галерея",
        "Упоминания",
      ]}
      tab={tab}
      onTab={(t) => selectTab(t as (typeof TABS)[number])}
      overlays={
        <>
          {confirmDialog}
          {avatarCrop.modal}
        </>
      }
    >
      {/* Соседи по списку населения — язычки на кромке листа, на всех
          вкладках (владелец, 2026-10-01). Если такое понадобится ещё
          одной карточке — это гнездо каркаса. */}
      <button
        type="button"
        className="paper-flap paper-flap--prev"
        disabled={!neighbourIds.prev}
        title={neighbourIds.prev ? "Предыдущее существо" : "Нет предыдущего"}
        onClick={() =>
          neighbourIds.prev && navigate(`/beings/${neighbourIds.prev}`)
        }
      >
        ←
      </button>
      <button
        type="button"
        className="paper-flap paper-flap--next"
        disabled={!neighbourIds.next}
        title={neighbourIds.next ? "Следующее существо" : "Нет следующего"}
        onClick={() =>
          neighbourIds.next && navigate(`/beings/${neighbourIds.next}`)
        }
      >
        →
      </button>
      {/* Обновление не удалось, прежние данные на экране. */}
      {beingState.error && (
        <div className="card entity-page__error">
          <span>Ошибка загрузки: {beingState.error}</span>
          <button className="primary" onClick={beingState.reload}>
            Повторить
          </button>
        </div>
      )}
      {saving && (
        <span className="muted entity-page__saving" aria-live="polite">
          Сохранение…
        </span>
      )}

      {tab === "Досье" && (
        <div className="dossier">
          <aside className="dossier__aside">
            <div className="dossier__figure">
              <label className="dossier__portrait" title={IMAGE_HINT}>
                {being.avatar_image_url ? (
                  <img
                    src={being.avatar_image_url}
                    alt={`Портрет: ${being.name}`}
                  />
                ) : (
                  <span className="dossier__portrait-empty">Портрет</span>
                )}
                <span className="dossier__portrait-hint">
                  {uploadingAvatar ? "Загрузка…" : "Сменить портрет"}
                </span>
                <input
                  type="file"
                  accept={IMAGE_ACCEPT}
                  hidden
                  onChange={(e) =>
                    avatarCrop.onSelect(e.target.files?.[0] ?? null)
                  }
                />
              </label>
              {/* Статус — под портретом (владелец, 2026-10-01). */}
              <span className="badge tag being-category-badge">
                {CATEGORY_LABELS[being.category]}
              </span>
            </div>
            <dl className="paper-facts">
              {being.communities.length > 0 && (
                <div>
                  <dt className="paper-label">Сообщества</dt>
                  <dd>
                    {being.communities.map((c) => (
                      <Link key={c.id} className="mention-link mention--com" to={`/communities/${c.id}`}>
                        {c.name}
                      </Link>
                    ))}
                  </dd>
                </div>
              )}
              {being.locations.length > 0 && (
                <div>
                  <dt className="paper-label">Где обитает</dt>
                  <dd>
                    {being.locations.map((l) => (
                      <Link key={l.id} className="mention-link mention--loc" to={`/locations/${l.id}`}>
                        {l.name}
                      </Link>
                    ))}
                  </dd>
                </div>
              )}
              {being.base_monster_id && (
                <div>
                  <dt className="paper-label">На основе</dt>
                  <dd>
                    <Link className="mention-link mention--cre" to={`/compendium/${being.base_monster_id}`}>
                      {being.base_monster_name}
                    </Link>
                  </dd>
                </div>
              )}
              <div>
                <dt className="paper-label">Теги</dt>
                <dd>
                  <TagChips tags={being.tags} onChange={saveTags} />
                </dd>
              </div>
            </dl>
            <div className="dossier__search">
              <input
                type="search"
                placeholder="Поиск по досье"
                value={dossierQuery}
                onChange={(e) => setDossierQuery(e.target.value)}
                aria-label="Поиск по досье"
              />
              <GraphNeighbourhoodLink type="being" id={being.id} />
            </div>
          </aside>

          <div className="dossier__main">
            {editingCard ? (
              <CreatureCardEditor
                type="being"
                id={beingId}
                inline
                settingId={being.setting_id}
                onDone={() => setEditingCard(false)}
              />
            ) : (
              <CreatureCardLoader
                type="being"
                id={beingId}
                variant="page"
                embedded
                hideProfileButton
                onEdit={() => setEditingCard(true)}
              />
            )}

            {participations.map((c) => (
              <Participation
                key={c.id}
                chapter={c}
                live={live?.campaign_id === c.campaign_id}
                settingId={being.setting_id}
                affects={mine}
              />
            ))}
            {freeCampaigns.length > 0 && (
              <div className="participation__actions">
                <select
                  value={newCampaignId}
                  onChange={(e) => setNewCampaignId(e.target.value)}
                  aria-label="Кампания для участия"
                >
                  <option value="">Участие в кампании…</option>
                  {freeCampaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addParticipation}
                  disabled={!newCampaignId}
                >
                  + Участие
                </button>
              </div>
            )}

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

            {(
              [
                ["history", "История"],
                ["behavior", "Поведение"],
              ] as const
            ).map(([section, title]) => (
              <details key={section} className="paper-fold" open>
                <summary>
                  {title}{" "}
                  <span className="paper-fold__count">
                    · {chaptersOf(section).length}
                  </span>
                </summary>
                <div className="paper-fold__body">
                  <ChapterList
                    ownerId={beingId}
                    ownerType="being"
                    apiBase="/setting-beings"
                    section={section}
                    chapters={chaptersOf(section)}
                    defaultSettingId={being.setting_id}
                    visibilityToggle
                  />
                </div>
              </details>
            ))}
            <details className="paper-fold">
              <summary>
                Текущая ситуация{" "}
                <span className="paper-fold__count">
                  · {chaptersOf("current_situation").length}
                </span>
              </summary>
              <div className="paper-fold__body">
                <ChapterList
                  ownerId={beingId}
                  ownerType="being"
                  apiBase="/setting-beings"
                  section="current_situation"
                  chapters={chaptersOf("current_situation")}
                  defaultSettingId={being.setting_id}
                  campaigns={campaigns}
                  visibilityToggle
                />
              </div>
            </details>

            {/* Справка: правится редко, за столом не нужна — свёрнута. */}
            <details className="paper-fold">
              <summary>Основное, статблоки, источники</summary>
              <div className="paper-fold__body">
                <EntityFieldsCard
                  key={`fields-${being.id}`}
                  fields={[
                    {
                      key: "name",
                      label: "Имя",
                      value: being.name,
                      required: true,
                    },
                    {
                      key: "short_name",
                      label: "Короткое имя для карты",
                      value: being.short_name ?? "",
                      title:
                        "Показывается вместо полного имени в подписи пина на карте локации",
                    },
                    {
                      key: "category",
                      label: "Категория",
                      value: being.category,
                      options: Object.entries(CATEGORY_LABELS).map(
                        ([value, label]) => ({ value, label }),
                      ),
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
                        : null,
                    );
                  }}
                  onSave={(v) =>
                    saveName({
                      name: v.name,
                      category: v.category,
                      short_name: v.short_name,
                    })
                  }
                  editExtras={
                    <>
                      <span className="editable-card-field-label">
                        На основе
                      </span>
                      <span className="muted">
                        Смена основы догрузит её статблок и описание отдельными
                        статьями. Уже написанное останется на месте — ничего не
                        переписывается.
                      </span>
                      <MonsterTemplatePicker
                        value={baseDraft}
                        onChange={setBaseDraft}
                      />
                      <span className="editable-card-field-label">
                        Сообщества
                      </span>
                      <label className="row">
                        <input
                          type="checkbox"
                          checked={showAllCommunities}
                          onChange={(e) =>
                            setShowAllCommunities(e.target.checked)
                          }
                        />
                        Показывать все сообщества (а не только выбранные)
                      </label>
                      {communities.length === 0 ? (
                        <span className="muted">
                          Сообществ в сеттинге ещё нет.
                        </span>
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
                                  Array.from(
                                    { length: 4 - row.length },
                                    (_, j) => <td key={`pad${j}`} />,
                                  )}
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
                  onSave={(aliases, name_original) =>
                    saveOrThrow({ aliases, name_original })
                  }
                />
                <StatblockList
                  ownerType="being"
                  ownerId={beingId}
                  ownerName={being.name}
                  settingId={being.setting_id}
                  soleOnPage
                />
                <CompendiumLinksCard
                  beingId={beingId}
                  links={being.compendium_links}
                />
                <PdfEntitySources kind="being" id={being.id} />
              </div>
            </details>
          </div>
        </div>
      )}

      {tab === "Связи" && (
        <div className="paper-groups">
          <details className="paper-fold" open>
            <summary>
              Где{" "}
              <span className="paper-fold__count">
                {being.locations.length}
              </span>
            </summary>
            <p className="muted">
              Места, где существо обитает или бывает: по ним оно попадает на
              карты и в списки локаций.
            </p>
            <div
              className={`drop-zone${locationsDragOver ? " drag-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setLocationsDragOver(true);
              }}
              onDragLeave={() => setLocationsDragOver(false)}
              onDrop={handleLocationDrop}
            >
              <ul className="paper-rows">
                {being.locations.map((l) => (
                  <li key={l.id}>
                    <span className="paper-rows__main">
                      <Link className="mention-link mention--loc" to={`/locations/${l.id}`}>
                        {l.name}
                      </Link>
                    </span>
                    <span className="paper-rows__sub">
                      {settingLocations.find((loc) => loc.id === l.id)?.kind}
                    </span>
                    <button
                      type="button"
                      className="comp-mini"
                      onClick={() => removeLocation(l.id)}
                    >
                      Убрать
                    </button>
                  </li>
                ))}
              </ul>
              {being.locations.length === 0 && (
                <EmptyState
                  title="Пока нигде не встречали"
                  hint="Перетащите локацию из поиска, выберите из списка или из мешка — существо появится на карте."
                />
              )}
            </div>
            <div className="row">
              <LocationCascadePicker
                locations={settingLocations}
                value={addLocationId}
                onChange={setAddLocationId}
              />
              <button
                type="button"
                onClick={addLocationViaCascade}
                disabled={!addLocationId}
              >
                + Место
              </button>
            </div>
          </details>

          <details className="paper-fold" open>
            <summary>
              С кем · что{" "}
              <span className="paper-fold__count">{relationCount}</span>
            </summary>
            <p className="muted">
              Отношения с другими существами, персонажами, фракциями, местами и
              предметами: союз, долг, страх, торговля.
            </p>
            <RelationsTab
              entityType="being"
              entityId={beingId}
              entityName={being.name}
              defaultSettingId={being.setting_id}
            />
          </details>

          <EntityParticipates entityType="being" entityId={beingId} />

          {scenes.length > 0 && (
            <details className="paper-fold" open>
              <summary>
                В приключениях{" "}
                <span className="paper-fold__count">{scenes.length}</span>
              </summary>
              <ul className="paper-rows">
                {scenes.map((s) => (
                  <li key={s.id}>
                    <span className="paper-rows__main">
                      <Link className="mention-link" to={`/scenes/${s.id}`}>
                        {s.name}
                      </Link>
                    </span>
                    <span className="paper-rows__sub">
                      {[s.arc_name, s.campaign_name]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {tab === "Хроника" && (
        <div className="chronicle">
          <section>
            <h2 className="paper-group__head">
              В мире{" "}
              <span className="paper-group__count">
                {being.important_dates.length}
              </span>
            </h2>
            <p className="muted">
              Важные даты — отмечаются на календаре сеттинга и его кампаний.
            </p>
            <ul className="paper-rows">
              {being.important_dates.map((d) => (
                <li key={d.id}>
                  <span className="paper-rows__main">
                    <strong>{d.title}</strong>
                  </span>
                  <span className="paper-rows__sub">
                    {formatImportantDate(
                      d,
                      calendar?.months ?? [],
                      calendar?.weekdays ?? [],
                    )}
                  </span>
                  <button
                    className="comp-mini"
                    aria-label={`Удалить «${d.title}»`}
                    onClick={() => removeImportantDate(d.id)}
                  >
                    <NavIcon name="delete" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="chronicle__add">
              <div className="row chronicle__line">
                <input
                  placeholder="Дата (напр. День рождения)"
                  value={dateTitle}
                  onChange={(e) => setDateTitle(e.target.value)}
                />
                <button
                  className="primary"
                  aria-label="Добавить дату"
                  title="Добавить дату"
                  onClick={addImportantDate}
                >
                  +
                </button>
              </div>
              <div className="row chronicle__line">
                <select
                  value={dateRecurrence}
                  onChange={(e) =>
                    setDateRecurrence(e.target.value as DateRecurrence)
                  }
                >
                  <option value="once">Разовое</option>
                  <option value="annual">Ежегодное</option>
                  <option value="monthly">Ежемесячное</option>
                </select>
                {dateRecurrence === "once" && (
                  <input
                    type="number"
                    placeholder="Год"
                    className="chronicle__num"
                    value={dateYear}
                    onChange={(e) => setDateYear(e.target.value)}
                  />
                )}
                {dateRecurrence !== "monthly" && (
                  <select
                    value={dateMonth}
                    onChange={(e) => setDateMonth(e.target.value)}
                  >
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
                  className="chronicle__num"
                  value={dateDay}
                  onChange={(e) => setDateDay(e.target.value)}
                />
              </div>
            </div>
          </section>
          <section>
            <h2 className="paper-group__head">
              В игре{" "}
              <span className="paper-group__count">{being.events.length}</span>
            </h2>
            <p className="muted">Сессии, где существо появлялось.</p>
            {being.events.length === 0 ? (
              <EmptyState
                title="За столом ещё не было"
                hint="Появится, когда существо отметят в сессии."
              />
            ) : (
              <ul className="paper-rows">
                {being.events.map((ev) => (
                  <li key={ev.id}>
                    <span className="paper-rows__main">
                      <strong>{ev.title}</strong>
                      {ev.description && (
                        <div className="paper-rows__sub">{ev.description}</div>
                      )}
                    </span>
                    <span className="paper-rows__sub">
                      {[ev.campaign_name, ev.session_date]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {ev.session_id && (
                      <Link
                        to={`/sessions/${ev.session_id}`}
                        className="comp-mini"
                      >
                        К сессии →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === "Галерея" && (
        <GalleryTab ownerType="being" ownerId={beingId} />
      )}

      {tab === "Упоминания" && (
        <MentionsTab entityType="being" entityId={beingId} />
      )}
    </EntityPage>
  );
}

// «В кампании X» (Q7, Q14): участие существа — поля контекста на главе
// «Текущая ситуация» этой кампании плюс её текст. У идущей сессии раскрыто,
// у остальных кампаний свёрнуто.
function Participation({
  chapter,
  live,
  settingId,
  affects,
}: {
  chapter: BeingChapter;
  live: boolean;
  settingId: number;
  affects: Affect[];
}) {
  const run = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BeingParticipation>({});
  const [content, setContent] = useState("");
  const fields = chapter.participation ?? {};
  const filled = PARTICIPATION_FIELDS.filter((f) => fields[f.key]?.trim());

  function startEdit() {
    setDraft(fields);
    setContent(chapter.content);
    setEditing(true);
  }

  async function save() {
    const done = await run(
      () =>
        write
          .put(`/setting-beings/chapters/${chapter.id}`, {
            participation: draft,
            content,
          })
          .then(() => true),
      { affects },
    );
    if (done) setEditing(false);
  }

  return (
    <details className="paper-fold participation" open={live || undefined}>
      <summary>
        В кампании «{chapter.campaign_name}»
        {live && <span className="participation__live">идёт сессия</span>}
      </summary>
      <div className="paper-fold__body">
        {editing ? (
          <div className="stack">
            {PARTICIPATION_FIELDS.map((f) => (
              <label key={f.key} className="stack">
                <span className="editable-card-field-label">{f.label}</span>
                <MentionTextarea
                  value={draft[f.key] ?? ""}
                  onChange={(v) =>
                    setDraft((prev) => ({ ...prev, [f.key]: v }))
                  }
                  rows={2}
                  autoGrow
                  defaultSettingId={settingId}
                />
              </label>
            ))}
            <label className="stack">
              <span className="editable-card-field-label">Заметка</span>
              <MentionTextarea
                value={content}
                onChange={setContent}
                rows={3}
                autoGrow
                defaultSettingId={settingId}
              />
            </label>
            <div className="participation__actions">
              <button type="button" className="primary" onClick={save}>
                Сохранить
              </button>
              <button type="button" onClick={() => setEditing(false)}>
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <>
            {filled.length > 0 ? (
              <dl className="participation__grid">
                {filled.map((f) => (
                  <div key={f.key}>
                    <dt className="paper-label">{f.label}</dt>
                    <dd>
                      <MentionText text={fields[f.key] ?? ""} />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span className="muted">
                Цель, план, что будет без вмешательства — пока не записаны.
              </span>
            )}
            {chapter.content.trim() && <MentionText text={chapter.content} />}
            <div className="participation__actions">
              <button type="button" className="comp-mini" onClick={startEdit}>
                Править участие
              </button>
            </div>
          </>
        )}
      </div>
    </details>
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
}: {
  beingId: number;
  links: CompendiumLink[];
}) {
  const run = useAction();

  async function add(entry: SearchResult | null) {
    if (!entry) return;
    await run(
      () =>
        write.post(`/setting-beings/${beingId}/compendium-links`, {
          compendium_entry_id: entry.id,
        }),
      {
        affects: beingAffects(beingId),
      },
    );
  }

  async function remove(entryId: number) {
    await run(
      () => write.del(`/setting-beings/${beingId}/compendium-links/${entryId}`),
      { affects: beingAffects(beingId) },
    );
  }

  return (
    <div className="card stack">
      <span className="paper-label">Записи компендиумов · {links.length}</span>
      <span className="muted">
        Монстры из компендиумов систем, соответствующие этому существу. Можно
        связать записи сразу из нескольких систем.
      </span>
      <MonsterTemplatePicker value={null} onChange={add} />
      <div className="stack">
        {links.map((l) => (
          <div key={l.id} className="row">
            <span className="paper-rows__main">
              <Link to={`/compendium/${l.id}`}>{l.name}</Link>
              {l.system_name && (
                <span className="muted"> · {l.system_name}</span>
              )}
            </span>
            <button
              className="comp-mini"
              aria-label={`Убрать «${l.name}»`}
              title="Убрать"
              onClick={() => remove(l.id)}
            >
              <NavIcon name="delete" />
            </button>
          </div>
        ))}
        {links.length === 0 && (
          <p className="muted">Связанных записей компендиума нет.</p>
        )}
      </div>
    </div>
  );
}
