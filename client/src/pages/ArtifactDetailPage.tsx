import { CampaignChronicle } from "../components/campaign/CampaignProfileParts";
import { ProfileHero, ProfileBlock, ProfileText, ProfileEntityLink } from "../components/profiles/ProfileParts";
import { ProfileLinks } from "../components/profiles/ProfileLinks";
import { ProfileChronicle } from "../components/profiles/ProfileChronicle";
import { useProfileChronicleCount, useProfileNeighbours } from "../components/profiles/useProfileNeighbours";
import { useSettingCrumbs } from "../layout/useSettingCrumbs";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAction, useAfterWrite, useEntity, useResource, useSaveEntity, write } from "../data/hooks";
import { showSaveError } from "../data/notices";
import { settingPaths } from "../data/settingEntities";
import type { Affect } from "../data/entities";
import { AliasesCard } from "../components/AliasesCard";
import { EntityFieldsCard } from "../components/EntityFieldsCard";
import { EntityPage } from "../components/EntityPage";
import { PdfEntitySources } from "../components/PdfEntitySources";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { MentionText } from "../components/mentions/MentionText";
import { mentionTone, syncMentionLinks } from "../mentions";
import { MentionsTab } from "../components/MentionsTab";
import { GalleryTab } from "../components/GalleryTab";
import { ChapterList } from "../components/ChapterList";
import { useTabState } from "../hooks/useTabState";
import { useConfirm } from "../hooks/useConfirm";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { IMAGE_ACCEPT } from "../imageUpload";
import { useImageCrop } from "../hooks/useImageCrop";
import { ITEM_CLASSES, MAGIC_ITEM_RARITIES, itemTypeOptions } from "../compendium";
import { CompendiumEntryPicker } from "../components/MonsterTemplatePicker";
import type {
  Artifact,
  Campaign,
  CompendiumLink,
  EntityRelationsResponse,
  SearchResult,
  SettingBeing,
  SettingCommunity,
  SettingLocation } from "../types";
import { TagChips } from "../components/TagChips";
import { SecretSeal } from "../components/CreatureCard";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { LocationCascadePicker } from "../components/LocationCascadePicker";
import { toAliasesList } from "../utils/aliasesList";
import { DETAIL_ROUTES } from "../entityTypes";
import { PlayerVisibilityFact } from "../components/PlayerVisibilityFact";
import { CampaignRecords, ContextSwitch, EngagedCampaigns } from "../components/campaign/CampaignProfileParts";
import { campaignCrumbs, useCampaignContext, useOwnerRecords } from "../components/campaign/campaignProfile";
import { useCampaignEntityStateMenu } from "../components/campaign/useCampaignEntityStateMenu";
import { RECORD_ASPECTS } from "../entityRecords";

// Общий каркас профилей (разбор 2026-10-02, предмет Q1): «Отношения» и
// владелец с местом — во «Связях», важные даты — в «Хронике», «Карточка
// предмета» стала шапкой досье. Старые имена ведут на новые.
const TABS = ["Досье", "Связи", "Хроника", "Галерея", "Упоминания"] as const;
const TAB_ALIASES: Readonly<Record<string, string>> = {
  Отношения: "Связи",
  "Важные даты": "Хроника",
  "Карточка предмета": "Досье",
};

export function ArtifactDetailPage() {
  const { id } = useParams();
  const artifactId = Number(id);
  const navigate = useNavigate();
  const [confirmDialog, confirm] = useConfirm();
  const { deleteWithUndo } = useUndoDelete();
  const artifactState = useEntity<Artifact>("artifact", artifactId);
  const artifact = artifactState.data ?? null;
  const settingId = artifact?.setting_id ?? null;
  const neighbours = useProfileNeighbours("artifact", artifactId, settingId);
  const portraitInput = useRef<HTMLInputElement>(null);
  const ctx = useCampaignContext(artifact?.campaigns);
  const inCampaign = ctx.campaign;
  const chronicleCount = useProfileChronicleCount("artifact", artifactId, artifact?.important_dates, inCampaign?.id);
  const campaignState = useCampaignEntityStateMenu(inCampaign?.id ?? null, "artifact", artifactId);
  const records = useOwnerRecords(inCampaign?.id ?? null, "artifact", artifactId);
  const settingCrumbs = useSettingCrumbs(settingId);
  const { save } = useSaveEntity<Artifact>("artifact", artifactId);
  const run = useAction();
  const afterWrite = useAfterWrite();
  const mine: Affect[] = [{ kind: "artifact", id: artifactId }];
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const allCampaigns = useResource<Campaign[]>(settingPaths.campaigns()).data;
  const campaigns = useMemo(() => (allCampaigns ?? []).filter((c) => c.setting_id === settingId), [allCampaigns, settingId]);
  const beings = useResource<SettingBeing[]>(settingId ? settingPaths.inSetting("being", settingId) : null).data ?? [];
  const communities = useResource<SettingCommunity[]>(settingId ? settingPaths.inSetting("community", settingId) : null).data ?? [];
  const [tab, selectTab] = useTabState(TABS, "Досье", TAB_ALIASES);
  const locations = useResource<SettingLocation[]>(settingId ? settingPaths.inSetting("location", settingId) : null).data ?? [];
  const relations = useResource<EntityRelationsResponse>(settingPaths.relations("artifact", artifactId)).data;
  const relationCount = relations ? relations.outgoing.length + relations.incoming.length : 0;
  const referenceRef = useRef<HTMLDetailsElement>(null);

  async function handleAvatarChange(file: File | null) {
    if (!file) return;
    setUploadingAvatar(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      await run(() => write.post(`/artifacts/${artifactId}/avatar`, formData, { timeoutMs: 60_000 }), { affects: mine });
    } finally {
      setUploadingAvatar(false);
    }
  }

  const avatarCrop = useImageCrop("square", handleAvatarChange);

  // Карточки полей держат правку открытой, пока сохранение не удалось: для
  // этого им нужна ошибка, а плашку показывает слой.
  async function saveOrThrow(patch: Partial<Artifact>) {
    if (!(await save(patch))) throw new Error("Не сохранилось");
  }

  // Текстовое поле с упоминаниями: ссылки на упомянутых пересобираются только
  // после того, как текст действительно сохранился.
  async function saveText(field: "description" | "power" | "history" | "secret" | "notes", before: string, value: string) {
    await saveOrThrow({ [field]: value });
    syncMentionLinks("artifact", artifactId, before, value);
  }

  function saveTags(tags: string[]) {
    void save({ tags });
  }

  // Владелец видит предмет у себя в карточке.
  const ownerAffects: Affect[] = [...mine, { kind: "being" }, { kind: "community" }];

  function setOwner(owner_type: string | null, owner_id: number | null) {
    void run(() => write.put(`/artifacts/${artifactId}`, { owner_type, owner_id }), { affects: ownerAffects });
  }

  // Место предмета видно и у локации.
  function setLocation(location_id: number | null) {
    void run(() => write.put(`/artifacts/${artifactId}`, { location_id }), { affects: [...mine, { kind: "location" }] });
  }

  const typeOptions = useMemo(() => {
    const list = itemTypeOptions(artifact?.item_class ?? "");
    const currentType = artifact?.item_type ?? "";
    return currentType && !list.includes(currentType) ? [currentType, ...list] : list;
  }, [artifact?.item_class, artifact?.item_type]);

  if (artifactState.error && !artifact) {
    return <LoadErrorCard message={<>Не удалось загрузить артефакт: {artifactState.error}</>} onRetry={artifactState.reload} />;
  }

  if (!artifact) {
    return <ListSkeleton variant="paragraph" label="Загрузка артефакта" />;
  }

  async function archiveArtifact() {
    if (!artifact) return;
    const ok = await confirm({ message: "Отправить артефакт в архив?", confirmLabel: "Архивировать", danger: true });
    if (!ok) return;
    try {
      await deleteWithUndo({
        entityName: artifact.name,
        deleteFn: async () => {
          await write.del(`/artifacts/${artifactId}`);
          afterWrite([{ kind: "artifact" }]);
        },
        restoreFn: async () => {
          await write.put(`/artifacts/${artifactId}/restore`);
          afterWrite([{ kind: "artifact" }]);
        },
      });
      navigate(`/settings/${artifact.setting_id}`);
    } catch (e) {
      showSaveError(`Не удалось архивировать «${artifact.name}»: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const importantDates = artifact.important_dates ?? [];
  const classLabel = ITEM_CLASSES.find((c) => c.value === artifact.item_class)?.label;
  const identTags = [classLabel, artifact.item_type, artifact.rarity, artifact.item_class === "equipment" ? null : artifact.requires_attunement ? "требует настройки" : "без настройки"].filter(
    (t): t is string => !!t && !!t.trim(),
  );
  const aliases = toAliasesList(artifact.aliases).filter((a) => a.trim());
  const ownerTo = artifact.owner_entity ? `${DETAIL_ROUTES[artifact.owner_entity.type] ?? ""}/${artifact.owner_entity.id}` : null;
  const ownerName = artifact.owner_entity?.name ?? artifact.owner?.trim() ?? "";
  const links = artifact.compendium_links ?? [];
  const treasuryTo = `/settings/${artifact.setting_id}?tab=${encodeURIComponent("Сокровищница")}`;

  function openReference() {
    if (referenceRef.current) {
      referenceRef.current.open = true;
      referenceRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  const textCard = (field: "description" | "history" | "notes", title: string, rows: number, emptyLabel: string) => (
    <ProfileText
      key={`${field}-${artifact.id}`}
      title={title}
      value={artifact[field]}
      onSave={(v) => saveText(field, artifact[field], v)}
      rows={rows}
      entityType="artifact"
      entityId={artifactId}
      defaultSettingId={artifact.setting_id}
      emptyLabel={emptyLabel}
    />
  );

  return (
    <EntityPage
      profile={neighbours}
      crumbs={inCampaign ? campaignCrumbs(inCampaign, artifact.name) : [...settingCrumbs, { label: "Сокровищница", to: treasuryTo }, { label: artifact.name }]}
      entityType="artifact"
      onIdentContextMenu={campaignState.onContextMenu}
      title={artifact.name}
      badges={campaignState.badge}
      // Под именем — род, тип, редкость метками, на месте мазка (Q3).
      meta={
        <span className="paper-ident-tags">
          {identTags.length > 0 ? (
            identTags.map((t) => (
              <span key={t} className="badge tag">
                {t}
              </span>
            ))
          ) : inCampaign ? null : (
            <button type="button" className="badge tag setting-genres__add" onClick={openReference}>
              + род предмета
            </button>
          )}
          {aliases.length > 0 && <span>{aliases.join(" · ")}</span>}
        </span>
      }
      actions={[...(!inCampaign ? [{ label: "Сменить картинку", onClick: () => portraitInput.current?.click() }] : []), { label: "Архивировать", danger: true, onClick: archiveArtifact }]}
      tabs={[
        "Досье",
        { id: "Связи", label: relationCount + (ownerName ? 1 : 0) + (artifact.location ? 1 : 0) ? `Связи · ${relationCount + (ownerName ? 1 : 0) + (artifact.location ? 1 : 0)}` : "Связи" },
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
      <ContextSwitch engaged={artifact.campaigns} campaign={inCampaign} onSelect={ctx.select} />
      {tab === "Досье" && <div className="profile-dossier">
        <ProfileHero type="artifact" name={artifact.name} createdAt={artifact.created_at} image={artifact.avatar_image_url} onGallery={() => selectTab("Галерея")} labels={<>
          {!artifact.item_class && !inCampaign && <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={openReference}>+ род предмета</button>}
          {identTags.map((t) => <span key={t} className="gch">{t}</span>)}
          <TagChips profile tags={artifact.tags ?? []} onChange={inCampaign ? undefined : saveTags} />
        </>}>
<ArtifactHead
              power={artifact.power}
              secret={artifact.secret}
              ownerName={ownerName}
              ownerTo={ownerTo}
              location={artifact.location ?? null}
              settingId={artifact.setting_id}
              ownerType={artifact.owner_entity?.type}
              readOnly={!!inCampaign}
              onSave={async (patch) => {
                const ok = await save(patch);
                if (ok) {
                  syncMentionLinks("artifact", artifactId, artifact.power, patch.power);
                  syncMentionLinks("artifact", artifactId, artifact.secret, patch.secret);
                }
                return ok;
              }}
            />
        </ProfileHero>
        <PlayerVisibilityFact line targetType="setting_artifact" targetId={artifactId} />
        {inCampaign ? <ProfileBlock title="Описание"><div className="profile-prose"><MentionText text={artifact.description} /></div></ProfileBlock> : textCard("description","Описание",3,"Опишите предмет так, как его увидят игроки.")}
        {inCampaign ? <details className="paper-fold"><summary>В кампании «{inCampaign.name}»<small className="profile-fold-note">записи: владелец · свойства · заметки</small><small className="profile-fold-state">свёрнуто ▸</small></summary><div className="paper-fold__body"><CampaignRecords campaignId={inCampaign.id} settingId={artifact.setting_id} ownerType="artifact" ownerId={artifactId} chains={records} title="Сейчас в кампании" aspects={RECORD_ASPECTS.artifact.map((a) => a.key)} emptyKeys={RECORD_ASPECTS.artifact.map((a) => a.key).filter((k) => k !== "note")} /></div></details> : <EngagedCampaigns campaigns={artifact.campaigns} onOpen={ctx.select} />}
        <div className="profile-columns">{inCampaign ? <><ProfileBlock title="История"><MentionText text={artifact.history} /></ProfileBlock><ProfileBlock title="Заметки"><MentionText text={artifact.notes} /></ProfileBlock></> : <>{textCard("history","История",4,"Как предмет оказался здесь?")}{textCard("notes","Заметки",3,"Добавьте заметку о предмете.")}</>}</div>
        <ProfileBlock title="Правила" count={links.length}><CompendiumLinksCard artifactId={artifactId} links={links} readOnly={!!inCampaign} /></ProfileBlock>
        {!inCampaign && <details className="paper-fold" ref={referenceRef}><summary>Справка<small className="profile-fold-note">основное · статьи · источники ▸</small></summary><div className="paper-fold__body">
                <EntityFieldsCard
                  key={`fields-${artifact.id}`}
                  fields={[
                    { key: "name", label: "Название", value: artifact.name, required: true },
                    {
                      key: "short_name",
                      label: "Короткое имя для карты",
                      value: artifact.short_name ?? "",
                      title: "Показывается вместо полного имени в подписи пина на карте локации",
                    },
                    {
                      key: "item_class",
                      label: "Род предмета",
                      value: artifact.item_class ?? "",
                      options: [{ value: "", label: "— не указан —" }, ...ITEM_CLASSES.map((c) => ({ value: c.value, label: c.label }))],
                    },
                    {
                      key: "item_type",
                      label: "Тип предмета",
                      value: artifact.item_type ?? "",
                      options: [{ value: "", label: "— не указан —" }, ...typeOptions.map((t) => ({ value: t, label: t }))],
                    },
                    ...(artifact.item_class !== "equipment"
                      ? [
                          {
                            key: "rarity",
                            label: "Редкость",
                            value: artifact.rarity ?? "",
                            options: [{ value: "", label: "— не указана —" }, ...MAGIC_ITEM_RARITIES.map((r) => ({ value: r, label: r }))],
                          },
                          {
                            key: "requires_attunement",
                            label: "Настройка",
                            value: artifact.requires_attunement ? "1" : "",
                            options: [
                              { value: "", label: "не нужна" },
                              { value: "1", label: "требует настройки" },
                            ],
                          },
                        ]
                      : []),
                  ]}
                  onSave={(v) =>
                    saveOrThrow({
                      name: v.name,
                      short_name: v.short_name,
                      item_class: v.item_class || null,
                      item_type: v.item_type || null,
                      ...(artifact.item_class !== "equipment"
                        ? { rarity: v.rarity || null, requires_attunement: v.requires_attunement === "1" }
                        : {}),
                    })
                  }
                />
                <AliasesCard
                  aliases={aliases}
                  nameOriginal={artifact.name_original ?? ""}
                  onSave={(next, name_original) => saveOrThrow({ aliases: next, name_original })}
                />

                <PdfEntitySources kind="artifact" id={artifact.id} />

          <ProfileBlock title="Статьи" count={artifact.chapters.length}><ChapterList profile ownerId={artifactId} ownerType="artifact" apiBase="/artifacts" chapters={artifact.chapters} defaultSettingId={artifact.setting_id} campaigns={campaigns} /></ProfileBlock>
        </div></details>}
      </div>}

      {tab === "Связи" && <ProfileLinks type="artifact" id={artifactId} name={artifact.name} settingId={artifact.setting_id} groups={[
        { title: "У кого · где", rows: [...(artifact.owner_entity ? [{key:"owner",type:artifact.owner_entity.type,id:artifact.owner_entity.id,name:ownerName,note:"владелец"}] : []),...(artifact.location ? [{key:"location",type:"location",id:artifact.location.id,name:artifact.location.name,note:"находится"}] : [])] },
      ]} onEntityDrop={(e) => { if(e.type === "being" || e.type === "community") { setOwner(e.type,e.id);return true; } if(e.type === "location") { setLocation(e.id);return true; } return false; }} tools={
          <details className="paper-fold" open>
            <summary>У кого · где</summary>
            <div className="paper-fold__body">
              <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="paper-label">У кого</span>
                {artifact.owner_entity && ownerTo ? (
                  <>
                    <Link
                      className={`mention-link mention--${mentionTone(artifact.owner_entity.type, artifact.owner_entity.id)}`}
                      to={ownerTo}
                    >
                      {artifact.owner_entity.name}
                    </Link>
                    <button type="button" className="comp-mini" onClick={() => setOwner(null, null)}>
                      Убрать
                    </button>
                  </>
                ) : (
                  <select
                    value=""
                    aria-label="Владелец"
                    onChange={(e) => {
                      const [type, idStr] = e.target.value.split(":");
                      const id = Number(idStr);
                      if (!type || !id) return;
                      setOwner(type, id);
                    }}
                  >
                    <option value="">{artifact.owner?.trim() ? `${artifact.owner} — выбрать из мира…` : "Выбрать…"}</option>
                    {beings.length > 0 && (
                      <optgroup label="Существа">
                        {beings.map((b) => (
                          <option key={`being:${b.id}`} value={`being:${b.id}`}>
                            {b.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {communities.length > 0 && (
                      <optgroup label="Сообщества">
                        {communities.map((c) => (
                          <option key={`community:${c.id}`} value={`community:${c.id}`}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
              </div>
              <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="paper-label">Где</span>
                <LocationCascadePicker
                  locations={locations}
                  value={artifact.location?.id ?? null}
                  onChange={(id) => setLocation(id)}
                />
              </div>
            </div>
          </details>


      } />}

      {tab === "Хроника" && <ProfileChronicle type="artifact" gameContent={inCampaign && records.length > 0 ? <CampaignChronicle campaign={inCampaign} settingId={artifact.setting_id} chains={records} /> : undefined} recordCount={inCampaign ? records.length : 0} id={artifactId} settingId={artifact.setting_id} campaignId={inCampaign?.id} dates={importantDates} />}

      {tab === "Галерея" && <GalleryTab profile campaignId={inCampaign?.id} ownerType="artifact" ownerId={artifactId} avatarUpload={{ previewUrl: artifact.avatar_image_url, uploading: uploadingAvatar, onSelect: avatarCrop.onSelect, modal: null }} />}

      {tab === "Упоминания" && <MentionsTab entityType="artifact" entityId={artifactId} />}
    </EntityPage>
  );
}

// Шапка «За столом» (разбор 2026-10-02, Q2): что предмет делает, у кого он и
// где, секрет за сургучом. Двигателя силы нет — вещь ничего не хочет.
// Правка — тут же, как у существа и сообщества.
function ArtifactHead({
  power,
  secret,
  ownerName,
  ownerTo,
  ownerType,
  readOnly = false,
  location,
  settingId,
  onSave,
}: {
  power: string;
  secret: string;
  ownerName: string;
  ownerTo: string | null;
  ownerType?: string;
  readOnly?: boolean;
  location: { id: number; name: string } | null;
  settingId: number;
  onSave: (patch: { power: string; secret: string }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [powerDraft, setPowerDraft] = useState("");
  const [secretDraft, setSecretDraft] = useState("");
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setPowerDraft(power);
    setSecretDraft(secret);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try {
      if (await onSave({ power: powerDraft, secret: secretDraft })) setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="creature-card-editor is-inline">
        <div className="card stack">
          <span className="editable-card-field-label">Сила / свойства</span>
          <MentionTextarea value={powerDraft} onChange={setPowerDraft} rows={4} autoGrow defaultSettingId={settingId} />
          <span className="editable-card-field-label">Секрет</span>
          <MentionTextarea value={secretDraft} onChange={setSecretDraft} rows={2} autoGrow defaultSettingId={settingId} />
          <div className="row">
            <button type="button" className="primary" onClick={save} disabled={saving}>
              {saving ? "Сохраняю…" : "Сохранить"}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving}>
              Отмена
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <article className="creature-card paper-scope creature-card--page is-embedded creature-card--d d-focal">
      <div className="creature-card__head">
        <span className="creature-card__head-label">За столом</span>
        {!readOnly && <button type="button" className="creature-card__edit" onClick={startEdit}>Править</button>}
      </div>
      {power.trim() ? (
        <div className="artifact-head__power"><span className="d-note">Сила и свойства</span>
          <MentionText text={power} />
        </div>
      ) : (
        <div className="creature-card__empty">
          Что предмет делает — пока не записано.{" "}
          {!readOnly && <button type="button" className="creature-card__more" onClick={startEdit}>Заполнить</button>}
        </div>
      )}
      {(ownerName || location) && <div className="artifact-head__where"><span className="d-note">У кого · где</span><div>
        {ownerName && (ownerTo ? <ProfileEntityLink type={ownerType ?? "being"} id={Number(ownerTo.split("/").pop())} name={ownerName} to={ownerTo} /> : ownerName)}
        {ownerName && location && " · "}{location && <ProfileEntityLink type="location" id={location.id} name={location.name} />}
      </div></div>}
      {secret.trim() ? <SecretSeal text={secret} /> : <div className="profile-secret-empty"><span>Секрет · пусто</span>{!readOnly && <button type="button" className="creature-card__more" onClick={startEdit}>+ добавить</button>}</div>}
    </article>
  );
}

// «Записи компендиумов» — маг. предметы систем, описывающие этот же предмет.
// Предмет приключения и запись справочника — одна вещь с двух сторон: в книге
// у «Кольца защиты разума» своя история и владелец, в компендиуме — правила.
// Связей может быть несколько: сеттинг водится сразу под две системы.
function CompendiumLinksCard({ artifactId, links, readOnly = false }: { artifactId: number; links: CompendiumLink[]; readOnly?: boolean }) {
  const [adding, setAdding] = useState(false);
  const run = useAction();
  const affects: Affect[] = [{ kind: "artifact", id: artifactId }];

  async function add(entry: SearchResult | null) {
    if (!entry) return;
    await run(() => write.post(`/artifacts/${artifactId}/compendium-links`, { compendium_entry_id: entry.id }), { affects });
  }

  async function remove(entryId: number) {
    await run(() => write.del(`/artifacts/${artifactId}/compendium-links/${entryId}`), { affects });
  }

  return (
    <div className="stack">
        {!readOnly && !adding && <button type="button" className="d-btn d-btn--sm" onClick={() => setAdding(true)}>+ Из компендиума</button>}
        {adding && <CompendiumEntryPicker
          value={null}
          onChange={add}
          kind="magic_item"
          placeholder="Найти в компендиуме…"
          selectedLabel="Выбрано"
        />}
        <div className="stack">
          {links.map((l) => (
            <div key={l.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>
                <Link to={`/compendium/${l.id}`}>{l.name}</Link>
                {l.system_name && <span className="muted"> · {l.system_name}</span>}
              </span>
              {!readOnly && <button className="d-btn d-btn--sm d-btn--ghost" aria-label={`Убрать ${l.name}`} onClick={() => remove(l.id)}>Убрать</button>}
            </div>
          ))}
          {links.length === 0 && <p className="muted">Связанных записей компендиума нет.</p>}
        </div>
    </div>
  );
}
