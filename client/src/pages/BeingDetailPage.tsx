import { CampaignChronicle } from "../components/campaign/CampaignProfileParts";
import { useCampaignEntityStateMenu } from "../components/campaign/useCampaignEntityStateMenu";
import { BEING_CATEGORY_LABELS } from "../beingCategories";
import { useSettingCrumbs } from "../layout/useSettingCrumbs";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
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
import { MentionText } from "../components/mentions/MentionText";
import { EntityPage } from "../components/EntityPage";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { EntityFieldsCard } from "../components/EntityFieldsCard";
import { useTabState } from "../hooks/useTabState";
import { useImageCrop } from "../hooks/useImageCrop";
import { IMAGE_ACCEPT } from "../imageUpload";
import { TagChips } from "../components/TagChips";
import { LocationCascadePicker } from "../components/LocationCascadePicker";
import { ProfileText as EditableTextCard, ProfileHero, ProfileEntityLink, ProfileBlock } from "../components/profiles/ProfileParts";
import { ProfileLinks } from "../components/profiles/ProfileLinks";
import { ProfileChronicle, mergeProfileWorld, type ProfileWorldEvent } from "../components/profiles/ProfileChronicle";
import type { ChronicleNow } from "../components/chronicle/time";
import { ProfileStatblock } from "../components/profiles/ProfileStatblock";
import { MonsterTemplatePicker } from "../components/MonsterTemplatePicker";
import { NavIcon } from "../components/NavIcons";
import { useConfirm } from "../hooks/useConfirm";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { CampaignMove } from "../components/campaign/CampaignMove";
import { rememberOpenedBeing } from "../populationRecent";
import type {
  BeingChapter,
  CompendiumLink,
  Campaign,
  EntityRelationsResponse,
  LiveSession,
  SearchResult,
  SettingBeingDetail,
  SettingCommunity,
  SettingLocation,
} from "../types";
import { PlayerVisibilityFact } from "../components/PlayerVisibilityFact";
import {
  CampaignRecords,
  ContextSwitch,
} from "../components/campaign/CampaignProfileParts";
import { SIDE_PROFILE_ASPECTS } from "../entityRecords";
import {
  campaignCrumbs,
  forceExtras,
  useCampaignContext,
  useOwnerRecords,
} from "../components/campaign/campaignProfile";

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
  const settingCrumbs = useSettingCrumbs(settingId);
  // Контекст кампании (ADR-0006): основа или «как она в этой кампании».
  const ctx = useCampaignContext(being?.campaigns);
  const inCampaign = ctx.campaign;
  const campaignState = useCampaignEntityStateMenu(inCampaign?.id ?? null, "being", beingId);
  const records = useOwnerRecords(inCampaign?.id ?? null, "being", beingId);
  const world = useResource<{ events: ProfileWorldEvent[]; now: ChronicleNow | null }>(being ? `/links/profile-chronicle?type=being&id=${beingId}${inCampaign ? `&campaign_id=${inCampaign.id}` : ""}` : null).data;
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
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const [editingCard, setEditingCard] = useState(false);

  const avatarCrop = useImageCrop("square", handleAvatarChange);
  const [confirmDialog, confirm] = useConfirm();
  const { deleteWithUndo } = useUndoDelete();
  const mine: Affect[] = beingAffects(beingId);
  const { save, saving } = useSaveEntity<SettingBeingDetail>("being", beingId, {
    affects: mine.slice(1),
  });
  const run = useAction();
  const afterWrite = useAfterWrite();

  // Соседи по сеттингу — для prev/next навигации (U-P0-1). Тот же список
  // существ сеттинга, что у «Связей» и «Населения», — из кэша слоя.
  const settingBeings = useResource<{ id: number; name: string }[]>(
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
      (c) => c.section === section && matches("", c.title, c.content),
    );
  const scenes = being.scenes ?? [];
  const relationCount = relations
    ? relations.outgoing.length + relations.incoming.length
    : 0;
  const linkCount = being.locations.length + relationCount + scenes.length;
  const chronicleCount = mergeProfileWorld(being.important_dates,world?.events ?? [],world?.now ?? null).length + being.events.filter((e) => !inCampaign || e.campaign_id === inCampaign.id).length;
  const isBestiary = being.category === "bestiary";

  return (
    <EntityPage
      profile={{ id: beingId, previous: neighbourIds.prev ? { href: `/beings/${neighbourIds.prev}`, name: settingBeings?.find((b) => b.id === neighbourIds.prev)?.name ?? "Предыдущее" } : undefined, next: neighbourIds.next ? { href: `/beings/${neighbourIds.next}`, name: settingBeings?.find((b) => b.id === neighbourIds.next)?.name ?? "Следующее" } : undefined }}
      crumbs={inCampaign ? campaignCrumbs(inCampaign, being.name) : [
        ...settingCrumbs,
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
      onIdentContextMenu={campaignState.onContextMenu}
      title={being.name}
      badges={
        <>
          {campaignState.badge}
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
        { label: "Показать в графе", onClick: () => navigate(`/graph/world?focus=being:${beingId}&depth=2`) },
        ...(!inCampaign ? [{ label: uploadingAvatar ? "Загрузка…" : "Сменить портрет", onClick: () => avatarInput.current?.click() }] : []),
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
          {campaignState.menu}
          {confirmDialog}
          {avatarCrop.modal}
          {!inCampaign && <input ref={avatarInput} type="file" hidden accept={IMAGE_ACCEPT} onChange={(e) => avatarCrop.onSelect(e.target.files?.[0] ?? null)} />}
        </>
      }
    >
      <ContextSwitch
        engaged={being.campaigns}
        campaign={inCampaign}
        onSelect={ctx.select}
      />
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

      {tab === "Досье" && <div className="profile-dossier">
        <ProfileHero type="being" name={being.name} subtype={isBestiary ? "Бестиарий" : "Личность"} createdAt={being.created_at} image={being.avatar_image_url} onGallery={() => selectTab("Галерея")}
          labels={<><span className="gch">{BEING_CATEGORY_LABELS[being.category]}</span>{campaignState.badge}{being.locations.map((l) => <ProfileEntityLink key={l.id} type="location" id={l.id} name={l.name} />)}{being.communities.map((c) => <ProfileEntityLink key={c.id} type="community" id={c.id} name={c.name} />)}{!inCampaign && <TagChips tags={being.tags} onChange={saveTags} />}</>}>
          {editingCard && !inCampaign ? <CreatureCardEditor type="being" id={beingId} inline forceInitiallyOpen={isBestiary} settingId={being.setting_id} onDone={() => setEditingCard(false)} /> : <CreatureCardLoader type="being" id={beingId} variant="page" embedded hideProfileButton forceExtras={inCampaign ? forceExtras(records,being.setting_id) : undefined} onEdit={!inCampaign ? () => setEditingCard(true) : undefined} />}
        </ProfileHero>
        <PlayerVisibilityFact line targetType="setting_being" targetId={beingId} />
        {isBestiary && <ProfileStatblock id={beingId} name={being.name} settingId={being.setting_id} compendiumId={being.base_monster_id ?? being.compendium_links[0]?.id} />}
        {(being.campaigns ?? []).map((c) => <details key={c.id} className="paper-fold" open={live?.campaign_id === c.id}>
          <summary>В кампании «{c.name}»</summary>
          <button type="button" className="d-btn d-btn--sm" onClick={() => ctx.select(c.id)}>Контекст кампании ›</button>
          {inCampaign?.id === c.id && <><CampaignMove being={being} campaignId={c.id} live={live?.campaign_id === c.id} affects={mine} /><CampaignRecords campaignId={c.id} settingId={being.setting_id} ownerType="being" ownerId={beingId} chains={records} title="Что изменилось" aspects={SIDE_PROFILE_ASPECTS} /></>}
          <ChapterList profile ownerId={beingId} ownerType="being" apiBase="/setting-beings" section="current_situation" chapters={being.chapters.filter((ch) => ch.section === "current_situation" && ch.campaign_id === c.id)} defaultSettingId={being.setting_id} campaigns={campaigns} visibilityToggle />
        </details>)}
        {inCampaign ? <ProfileBlock title="Описание"><MentionText text={being.description} /></ProfileBlock> : <EditableTextCard title="Описание" value={being.description} onSave={saveDescription} emptyLabel="Опишите существо так, как его увидят игроки." entityType="being" entityId={beingId} defaultSettingId={being.setting_id} />}
        {isBestiary ? <details className="paper-fold"><summary>Главы</summary><div className="profile-columns">
          {([['history','История'],['behavior','Поведение']] as const).map(([section,title]) => <ProfileBlock key={section} title={title} count={chaptersOf(section).length}><ChapterList profile ownerId={beingId} ownerType="being" apiBase="/setting-beings" section={section} chapters={chaptersOf(section)} defaultSettingId={being.setting_id} visibilityToggle /></ProfileBlock>)}
        </div></details> : <div className="profile-columns">
          {([['history','История'],['behavior','Поведение']] as const).map(([section,title]) => <ProfileBlock key={section} title={title} count={chaptersOf(section).length}><ChapterList profile ownerId={beingId} ownerType="being" apiBase="/setting-beings" section={section} chapters={chaptersOf(section)} defaultSettingId={being.setting_id} visibilityToggle /></ProfileBlock>)}
        </div>}
        {being.chapters.some((c) => c.section === "current_situation" && !c.campaign_id) && <details className="paper-fold"><summary>Текущая ситуация</summary><ChapterList profile ownerId={beingId} ownerType="being" apiBase="/setting-beings" section="current_situation" chapters={being.chapters.filter((c) => c.section === "current_situation" && !c.campaign_id)} defaultSettingId={being.setting_id} campaigns={campaigns} visibilityToggle /></details>}
            {/* Справка: правится редко, за столом не нужна — свёрнута. */}
            <details className="paper-fold">
              <summary>Справка</summary>
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
                      options: Object.entries(BEING_CATEGORY_LABELS).map(
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
                {!isBestiary && <StatblockList
                  ownerType="being"
                  ownerId={beingId}
                  ownerName={being.name}
                  settingId={being.setting_id}
                  soleOnPage
                />}
                <CompendiumLinksCard
                  beingId={beingId}
                  links={being.compendium_links}
                />
                <PdfEntitySources kind="being" id={being.id} />
              </div>
            </details>
      </div>}

      {tab === "Связи" && <ProfileLinks type="being" id={beingId} name={being.name} settingId={being.setting_id} onEntityDrop={(r) => { if(r.type === "location") { void addLocation(r); return true; } return false; }} groups={[
        { title: "Где", rows: being.locations.map((l) => ({ key:`habitat:${l.id}`,type:"location",id:l.id,name:l.name,note:settingLocations.find((x) => x.id === l.id)?.kind,actions:[{label:"Убрать место",danger:true,onClick:() => void removeLocation(l.id)}] })) },
        { title: "С кем", rows: [] }, { title: "Что", rows: [] },
        { title: "В приключениях", rows: scenes.map((s) => ({ key:`scene:${s.id}`,type:"scene",id:s.id,name:s.name,note:[s.arc_name,s.campaign_name].filter(Boolean).join(" · ") })) },
      ]} tools={<div className={`drop-zone${locationsDragOver ? " drag-over" : ""}`} onDragOver={(e) => { e.preventDefault(); setLocationsDragOver(true); }} onDragLeave={() => setLocationsDragOver(false)} onDrop={handleLocationDrop}>
        <h3>Где обитает</h3><div className="row"><LocationCascadePicker locations={settingLocations} value={addLocationId} onChange={setAddLocationId} /><button type="button" onClick={addLocationViaCascade} disabled={!addLocationId}>+ Место</button></div>
      </div>} />}

      {tab === "Хроника" && <ProfileChronicle type="being" gameContent={inCampaign && records.length > 0 ? <CampaignChronicle campaign={inCampaign} settingId={being.setting_id} chains={records} /> : undefined} recordCount={inCampaign ? records.length : 0} id={beingId} settingId={being.setting_id} campaignId={inCampaign?.id} dates={being.important_dates} gameEvents={being.events} />}

      {tab === "Галерея" && (
        <GalleryTab profile ownerType="being" ownerId={beingId} avatarUpload={!inCampaign ? { previewUrl:being.avatar_image_url,uploading:uploadingAvatar,onSelect:avatarCrop.onSelect,modal:null } : undefined} />
      )}

      {tab === "Упоминания" && (
        <MentionsTab entityType="being" entityId={beingId} />
      )}
    </EntityPage>
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
