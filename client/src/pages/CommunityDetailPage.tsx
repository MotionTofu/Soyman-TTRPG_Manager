import { CampaignChronicle } from "../components/campaign/CampaignProfileParts";
import { MentionText } from "../components/mentions/MentionText";
import { ProfileHero, ProfileBlock, ProfileText, ProfileEntityLink, ProfileChapterRead } from "../components/profiles/ProfileParts";
import { ProfileLinks } from "../components/profiles/ProfileLinks";
import { ProfileChronicle } from "../components/profiles/ProfileChronicle";
import { useProfileChronicleCount, useProfileNeighbours } from "../components/profiles/useProfileNeighbours";
import { sessionPaths } from "../data/sessions";
import { useCampaignEntityStateMenu } from "../components/campaign/useCampaignEntityStateMenu";
import { useSettingCrumbs } from "../layout/useSettingCrumbs";
import { useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAction, useAfterWrite, useEntity, useResource, useSaveEntity, write } from "../data/hooks";
import { showSaveError } from "../data/notices";
import { settingPaths } from "../data/settingEntities";
import type { Affect } from "../data/entities";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { useUnloadTarget } from "../unloadTargets";
import { AliasesCard } from "../components/AliasesCard";
import { ChapterList } from "../components/ChapterList";
import { GalleryTab } from "../components/GalleryTab";
import { LinkDropZone, SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { EntityPage } from "../components/EntityPage";
import { PdfEntitySources } from "../components/PdfEntitySources";
import { EntityFieldsCard } from "../components/EntityFieldsCard";
import { FactionCard } from "../components/FactionCard";
import { FORCE_FIELDS } from "../beingForce";
import {
  CampaignRecords,
  ContextSwitch } from "../components/campaign/CampaignProfileParts";
import { SIDE_PROFILE_ASPECTS } from "../entityRecords";
import { campaignCrumbs, forceExtras, useCampaignContext, useOwnerRecords } from "../components/campaign/campaignProfile";
import { toAliasesList } from "../utils/aliasesList";
import { BeingQuickCreate } from "../components/BeingQuickCreate";
import { BeingEntityRowList } from "../components/BeingEntityRowList";
import { MentionsTab } from "../components/MentionsTab";
import { useTabState } from "../hooks/useTabState";
import { IMAGE_ACCEPT } from "../imageUpload";
import { useImageCrop } from "../hooks/useImageCrop";
import { TagChips } from "../components/TagChips";
import type {
  EntityRelationsResponse,
  SearchResult,
  SettingCommunityDetail,
  SettingLocation } from "../types";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { useConfirm } from "../hooks/useConfirm";
import { PlayerVisibilityFact } from "../components/PlayerVisibilityFact";

// Вкладки по общему каркасу профилей (разбор 2026-10-02): представители,
// места, вложенные и отношения — во «Связях», «Карточка фракции» стала шапкой
// досье, важные даты — в «Хронике». Старые имена ведут на новые.
const TABS = ["Досье", "Связи", "Хроника", "Галерея", "Упоминания"] as const;
const TAB_ALIASES: Readonly<Record<string, string>> = {
  Представители: "Связи",
  "Места обитания": "Связи",
  "Вложенные сообщества": "Связи",
  Отношения: "Связи",
  "Карточка фракции": "Досье",
};
// Главы сообщества — те же четыре раздела, что были; данные не трогаем.
const CHAPTER_SECTIONS = [
  ["goals", "Цели"],
  ["features", "Особенности"],
  ["history", "История"],
  ["current_situation", "Текущая ситуация"],
] as const;

export function CommunityDetailPage() {
  const [confirmDialog, confirm] = useConfirm();
  const { id } = useParams();
  const communityId = Number(id);
  const navigate = useNavigate();
  const { deleteWithUndo } = useUndoDelete();

  const communityState = useEntity<SettingCommunityDetail>("community", communityId);
  const community = communityState.data ?? null;
  const neighbours = useProfileNeighbours("community", communityId, community?.setting_id);
  const [linksRequest,setLinksRequest] = useState(0);
  const portraitInput = useRef<HTMLInputElement>(null);
  const live = useResource<{ campaign_id: number } | null>(sessionPaths.live()).data;
  const settingCrumbs = useSettingCrumbs(community?.setting_id);
  // Контекст кампании (ADR-0006): основа или «как оно в этой кампании».
  const ctx = useCampaignContext(community?.campaigns);
  const inCampaign = ctx.campaign;
  const chronicleCount = useProfileChronicleCount("community", communityId, community?.important_dates, inCampaign?.id);
  const campaignState = useCampaignEntityStateMenu(inCampaign?.id ?? null, "community", communityId);
  const records = useOwnerRecords(inCampaign?.id ?? null, "community", communityId);
  const locations =
    useResource<SettingLocation[]>(community ? settingPaths.inSetting("location", community.setting_id) : null).data ?? [];
  const { save } = useSaveEntity<SettingCommunityDetail>("community", communityId);
  const run = useAction();
  const afterWrite = useAfterWrite();
  const mine: Affect[] = [{ kind: "community", id: communityId }];
  const [tab, selectTab] = useTabState(TABS, "Досье", TAB_ALIASES);
  const relations = useResource<EntityRelationsResponse>(settingPaths.relations("community", communityId)).data;
  const [membersDragOver, setMembersDragOver] = useState(false);
  const [childName, setChildName] = useState("");
  const [locationsDragOver, setLocationsDragOver] = useState(false);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useUnloadTarget({
    label: "Представители",
    accepts: (item) => item.type === "being",
    drop: addMember,
  });
  useUnloadTarget({
    label: "Места обитания",
    accepts: (item) => item.type === "location",
    drop: addLocation,
  });

  async function handleThumbnailChange(file: File | null) {
    if (!file) return;
    setUploadingThumbnail(true);
    const form = new FormData();
    form.append("file", file);
    try {
      await run(() => write.post(`/setting-communities/${communityId}/thumbnail`, form, { timeoutMs: 60_000 }), { affects: mine });
    } finally {
      setUploadingThumbnail(false);
    }
  }
  const thumbnailCrop = useImageCrop("thumbnail", handleThumbnailChange);

  async function handleAvatarChange(file: File | null) {
    if (!file) return;
    setUploadingAvatar(true);
    const form = new FormData();
    form.append("file", file);
    try {
      await run(() => write.post(`/setting-communities/${communityId}/avatar`, form, { timeoutMs: 60_000 }), { affects: mine });
    } finally {
      setUploadingAvatar(false);
    }
  }
  const avatarCrop = useImageCrop("square", handleAvatarChange);

  if (communityState.error && !community) {
    return <LoadErrorCard message={<>Не удалось загрузить сообщество: {communityState.error}</>} onRetry={communityState.reload} />;
  }
  if (!community) return <ListSkeleton variant="paragraph" label="Загрузка сообщества" />;

  // Карточки полей держат правку открытой, пока сохранение не удалось: для
  // этого им нужна ошибка, а плашку показывает слой.
  async function saveOrThrow(patch: Partial<SettingCommunityDetail>) {
    if (!(await save(patch))) throw new Error("Не сохранилось");
  }

  async function saveName(name: string) {
    await saveOrThrow({ name });
  }

  function saveTags(tags: string[]) {
    void save({ tags });
  }

  async function archiveCommunity() {
    if (!community) return;
    if (!(await confirm({ message: "Отправить сообщество (и все вложенные) в архив?", confirmLabel: "Архивировать", danger: true })))
      return;
    // Без catch падение молчало, а `navigate` ниже не срабатывал.
    try {
      await deleteWithUndo({
        entityName: community.name,
        deleteFn: async () => {
          await write.del(`/setting-communities/${communityId}`);
          afterWrite([{ kind: "community" }]);
        },
        restoreFn: async () => {
          await write.put(`/setting-communities/${communityId}/restore`);
          afterWrite([{ kind: "community" }]);
        },
      });
    } catch (e) {
      showSaveError(`Не удалось архивировать «${community.name}»: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    navigate(
      community.parent_id
        ? `/communities/${community.parent_id}`
        : `/settings/${community.setting_id}?tab=${encodeURIComponent("Население")}`
    );
  }

  // Представитель виден с обеих сторон: здесь и в карточке существа.
  const memberAffects: Affect[] = [...mine, { kind: "being" }];

  async function removeMember(beingId: number) {
    await run(() => write.del(`/setting-communities/${communityId}/members/${beingId}`), { affects: memberAffects });
  }

  async function addMember(result: SearchResult) {
    if (result.type !== "being") return;
    await run(() => write.post(`/setting-communities/${communityId}/members`, { being_id: result.id }), { affects: memberAffects });
  }

  function handleMemberDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setMembersDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    addMember(JSON.parse(raw) as SearchResult);
  }

  async function addChild() {
    if (!childName.trim()) return;
    const body = { setting_id: community!.setting_id, parent_id: communityId, name: childName };
    // Без «Повторить»: повтор после потерянного ответа завёл бы второе сообщество.
    const done = await run(() => write.post("/setting-communities", body).then(() => true), {
      affects: [{ kind: "community" }],
      retry: false,
    });
    if (done) setChildName("");
  }

  // Место обитания видно с обеих сторон: здесь и у локации.
  const habitatAffects: Affect[] = [...mine, { kind: "location" }];

  async function addLocation(result: SearchResult) {
    if (result.type !== "location") return;
    await run(() => write.post(`/setting-communities/${communityId}/locations`, { location_id: result.id }), { affects: habitatAffects });
  }

  function handleLocationDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setLocationsDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    addLocation(JSON.parse(raw) as SearchResult);
  }

  async function removeLocation(locationId: number) {
    await run(() => write.del(`/setting-communities/${communityId}/locations/${locationId}`), { affects: habitatAffects });
  }

  const aliases = toAliasesList(community.aliases).filter((a) => a.trim());
  const chaptersOf = (section: string) => community.chapters.filter((c) => c.section === section);
  const allRelations = relations ? [...relations.outgoing, ...relations.incoming] : [];
  const linkCount = community.members.length + community.children.length + community.locations.length + allRelations.length;
  const populationTo = `/settings/${community.setting_id}?tab=${encodeURIComponent("Население")}&population=${encodeURIComponent("Сообщества")}`;

  async function saveDescription(value: string) {
    await saveOrThrow({ description: value });
  }

  return (
    <EntityPage
      profile={neighbours}
      crumbs={inCampaign ? campaignCrumbs(inCampaign, community.name) : [
        ...settingCrumbs,
        { label: "Население", to: populationTo },
        ...community.ancestors.map((a) => ({ label: a.name, to: `/communities/${a.id}` })),
        { label: community.name },
      ]}
      entityType="community"
      onIdentContextMenu={campaignState.onContextMenu}
      title={community.name}
      badges={campaignState.badge}
      // Под именем — другие названия, на месте мазка (макет, доска 27).
      meta={aliases.length > 0 ? aliases.join(" · ") : undefined}
      actions={[
        ...(!inCampaign ? [{ label: "Сменить портрет", onClick: () => portraitInput.current?.click() }] : []),
        { label: "Вложенное сообщество…", onClick: () => { selectTab("Связи");setLinksRequest((n) => n + 1); } },
        { label: "Архивировать", danger: true, onClick: archiveCommunity },
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
          {!inCampaign && <input ref={portraitInput} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => avatarCrop.onSelect(e.target.files?.[0] ?? null)} />}
        </>
      }
    >
      <ContextSwitch engaged={community.campaigns} campaign={inCampaign} onSelect={ctx.select} />
      {tab === "Досье" && <div className="profile-dossier">
        <ProfileHero type="community" name={community.name} createdAt={community.created_at} image={community.avatar_image_url} onGallery={() => selectTab("Галерея")}
          labels={<>{community.locations.map((l) => <ProfileEntityLink key={l.id} type="location" id={l.id} name={l.name} />)}{aliases.length > 0 && <span className="d-note">{aliases.join(" · ")}</span>}<TagChips profile tags={community.tags ?? []} onChange={inCampaign ? undefined : saveTags} /></>}>
          <FactionCard force={community.force ?? {}} secret={community.secret ?? ""} members={community.members} settingId={community.setting_id} onAllMembers={() => selectTab("Связи")} onSave={inCampaign ? undefined : (patch) => save(patch)} forceExtras={inCampaign ? forceExtras(records,community.setting_id) : undefined} />
        </ProfileHero>
        <PlayerVisibilityFact line targetType="setting_community" targetId={communityId} />
        {inCampaign ? <ProfileBlock title="Описание"><div className="profile-prose"><MentionText text={community.description ?? ""} /></div></ProfileBlock> : <ProfileText title="Описание" value={community.description ?? ""} onSave={saveDescription} defaultSettingId={community.setting_id} />}
        {(community.campaigns ?? []).map((c) => <details key={c.id} className="paper-fold" open={live?.campaign_id === c.id}><summary>В кампании «{c.name}»<small className="profile-fold-note">участие: цель · план · без вмешательства · если помочь</small>{live?.campaign_id !== c.id && <small className="profile-fold-state">свёрнуто — нет идущей сессии ▸</small>}</summary><div className="paper-fold__body"><button type="button" className="d-btn d-btn--sm" onClick={() => ctx.select(c.id)}>Контекст кампании ›</button>{inCampaign?.id === c.id && <CampaignRecords campaignId={c.id} settingId={community.setting_id} ownerType="community" ownerId={communityId} chains={records} title="Что изменилось" aspects={SIDE_PROFILE_ASPECTS} emptyKeys={FORCE_FIELDS.filter((f) => f.core && !community.force?.[f.key]?.trim()).map((f) => f.key)} />}</div></details>)}
        <div className="profile-columns profile-columns--three">
          {CHAPTER_SECTIONS.filter(([section]) => section !== "current_situation").map(([section,title]) => <ProfileBlock key={section} title={title} count={chaptersOf(section).length}>{inCampaign ? <ProfileChapterRead chapters={chaptersOf(section)} /> : <ChapterList profile ownerId={communityId} ownerType="community" apiBase="/setting-communities" section={section} chapters={chaptersOf(section)} defaultSettingId={community.setting_id} />}</ProfileBlock>)}
        </div>
        {!inCampaign && <details className="paper-fold"><summary>Справка<small className="profile-fold-note">основное · статьи · источники ▸</small></summary><div className="paper-fold__body">
                <EntityFieldsCard
                  key={`fields-${community.id}`}
                  fields={[{ key: "name", label: "Имя", value: community.name, required: true }]}
                  onSave={(v) => saveName(v.name)}
                />
                <AliasesCard
                  aliases={aliases}
                  nameOriginal={community.name_original ?? ""}
                  onSave={(next, name_original) => saveOrThrow({ aliases: next, name_original })}
                />
                <ProfileBlock title="Текущая ситуация"><ChapterList profile ownerId={communityId} ownerType="community" apiBase="/setting-communities" section="current_situation" chapters={chaptersOf("current_situation")} defaultSettingId={community.setting_id} /></ProfileBlock>
                <PdfEntitySources kind="community" id={community.id} />

        </div></details>}
      </div>}

      {tab === "Связи" && <ProfileLinks editRequest={linksRequest} type="community" id={communityId} name={community.name} settingId={community.setting_id} groups={[
        { title: "Кто", rows: [...community.members.map((b) => ({key:`being:${b.id}`,type:"being",id:b.id,name:b.name,actions:[{label:"Убрать отсюда",onClick:() => void removeMember(b.id)}]})),...community.children.map((c) => ({key:`child:${c.id}`,type:"community",id:c.id,name:c.name,note:"вложенное"}))] },
        { title: "Где", rows: community.locations.map((l) => ({key:`location:${l.id}`,type:"location",id:l.id,name:l.name,actions:[{label:"Убрать отсюда",onClick:() => void removeLocation(l.id)}]})) },
      ]} onEntityDrop={(e) => { if (e.type === "being") { void addMember(e); return true; } if (e.type === "location") { void addLocation(e); return true; } return false; }} tools={
        <div className="paper-groups">
          <details className="paper-fold" open>
            <summary>
              Кто <span className="paper-fold__count">{community.members.length}</span>
            </summary>
            <div className="paper-fold__body">
              <BeingQuickCreate
                settingId={community.setting_id}
                locations={locations}
                fixedCommunityIds={[communityId]}
                showLocationPicker
              />
              <div
                className={`drop-zone${membersDragOver ? " drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setMembersDragOver(true);
                }}
                onDragLeave={() => setMembersDragOver(false)}
                onDrop={handleMemberDrop}
              >
                <span className="muted">Перетащите существо из поиска сюда, чтобы добавить его в представители.</span>
              </div>
              {community.children.length > 0 && (
                <span className="muted">
                  Список включает представителей вложенных сообществ ({community.children.map((c) => c.name).join(", ")}).
                </span>
              )}
              <BeingEntityRowList
                beings={community.members}
                onDelete={removeMember}
                deleteLabel="Убрать отсюда"
                emptyLabel="Представителей пока нет."
                getFactionCount={(b) => b.community_count}
              />

              <span className="paper-label">Вложенные сообщества</span>
              <ul className="paper-rows">
                {community.children.map((c) => (
                  <li key={c.id}>
                    <span className="paper-rows__main">
                      <Link className="mention-link mention--com" to={`/communities/${c.id}`}>
                        {c.name}
                      </Link>
                    </span>
                    <span className="paper-rows__sub">{c.description}</span>
                  </li>
                ))}
              </ul>
              <div className="row">
                <input
                  placeholder="Название вложенного сообщества/народа/культуры"
                  value={childName}
                  onChange={(e) => setChildName(e.target.value)}
                />
                <button type="button" onClick={addChild} disabled={!childName.trim()}>
                  + Вложенное
                </button>
              </div>
            </div>
          </details>

          <details className="paper-fold" open>
            <summary>
              Где <span className="paper-fold__count">{community.locations.length}</span>
            </summary>
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
                {community.locations.map((l) => (
                  <li key={l.id}>
                    <span className="paper-rows__main">
                      <Link className="mention-link mention--loc" to={`/locations/${l.id}`}>
                        {l.name}
                      </Link>
                    </span>
                    <span className="paper-rows__sub">{locations.find((loc) => loc.id === l.id)?.kind}</span>
                    <button type="button" className="comp-mini" onClick={() => removeLocation(l.id)}>
                      Убрать
                    </button>
                  </li>
                ))}
              </ul>
              <span className="muted">Перетащите локацию из поиска, чтобы добавить место обитания.</span>
            </div>
          </details>

          <details className="paper-fold" open>
            <summary>
              С кем · что <span className="paper-fold__count">{allRelations.length}</span>
            </summary>
            <LinkDropZone entityType="community" entityId={communityId} title="Связанные сущности" />

          </details>

        </div>
      } />}

      {tab === "Хроника" && <ProfileChronicle type="community" gameContent={inCampaign && records.length > 0 ? <CampaignChronicle campaign={inCampaign} settingId={community.setting_id} chains={records} /> : undefined} recordCount={inCampaign ? records.length : 0} id={communityId} settingId={community.setting_id} campaignId={inCampaign?.id} dates={community.important_dates} />}

      {tab === "Галерея" && (
        <GalleryTab profile campaignId={inCampaign?.id}
          avatarUpload={{ previewUrl: community.avatar_image_url, uploading: uploadingAvatar, onSelect: avatarCrop.onSelect, modal: null }}
          ownerType="community"
          ownerId={communityId}
          thumbnailUpload={{
            previewUrl: community.thumbnail_image_url,
            uploading: uploadingThumbnail,
            onSelect: thumbnailCrop.onSelect,
            modal: thumbnailCrop.modal,
          }}
        />
      )}

      {tab === "Упоминания" && <MentionsTab entityType="community" entityId={communityId} />}
    </EntityPage>
  );
}
