import { useState, type DragEvent } from "react";
import { EntityParticipates } from "../components/EntityParticipates";
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
import { RelationsTab } from "../components/RelationsTab";
import { EntityPage } from "../components/EntityPage";
import { PdfEntitySources } from "../components/PdfEntitySources";
import { GraphNeighbourhoodLink } from "../components/GraphNeighbourhoodLink";
import { EntityFieldsCard } from "../components/EntityFieldsCard";
import { EditableTextCard } from "../components/EditableTextCard";
import { FactionCard } from "../components/FactionCard";
import { toAliasesList } from "../utils/aliasesList";
import { mentionTone } from "../mentions";
import { RELATION_TONE_LABELS } from "../relations";
import { DETAIL_ROUTES } from "../entityTypes";
import { BeingQuickCreate } from "../components/BeingQuickCreate";
import { BeingEntityRowList } from "../components/BeingEntityRowList";
import { MentionsTab } from "../components/MentionsTab";
import { useTabState } from "../hooks/useTabState";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { formatImportantDate } from "../inworldCalendar";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { useImageCrop } from "../hooks/useImageCrop";
import { TagChips } from "../components/TagChips";
import type {
  DateRecurrence,
  EntityRelationsResponse,
  SearchResult,
  SettingCommunityDetail,
  SettingLocation,
} from "../types";
import { NavIcon } from "../components/NavIcons";
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
  const [dateTitle, setDateTitle] = useState("");
  const [dateRecurrence, setDateRecurrence] = useState<DateRecurrence>("once");
  const [dateYear, setDateYear] = useState("");
  const [dateMonth, setDateMonth] = useState("");
  const [dateDay, setDateDay] = useState("");
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const calendar = useSettingCalendar(community?.setting_id);

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
    const done = await run(
      () => write.post(`/setting-communities/${communityId}/important-dates`, body).then(() => true),
      { affects: dateAffects, retry: false }
    );
    if (!done) return;
    setDateTitle("");
    setDateYear("");
    setDateMonth("");
    setDateDay("");
  }

  async function removeImportantDate(dateId: number) {
    if (!(await confirm({ message: "Удалить эту важную дату?", confirmLabel: "Удалить", danger: true })))
      return;
    await run(() => write.del(`/setting-communities/important-dates/${dateId}`), { affects: dateAffects });
  }

  const aliases = toAliasesList(community.aliases).filter((a) => a.trim());
  const chaptersOf = (section: string) => community.chapters.filter((c) => c.section === section);
  const allRelations = relations ? [...relations.outgoing, ...relations.incoming] : [];
  // Связь в обе стороны — одно имя в «С кем», а не два.
  const relationFacts = allRelations.filter(
    (r, i) => allRelations.findIndex((o) => o.other_type === r.other_type && o.other_id === r.other_id) === i,
  );
  const linkCount = community.members.length + community.children.length + community.locations.length + allRelations.length;
  const populationTo = `/settings/${community.setting_id}?tab=${encodeURIComponent("Население")}`;

  async function saveDescription(value: string) {
    await saveOrThrow({ description: value });
  }

  return (
    <EntityPage
      paper
      crumbs={[
        { label: "Население", to: populationTo },
        ...community.ancestors.map((a) => ({ label: a.name, to: `/communities/${a.id}` })),
        { label: community.name },
      ]}
      entityType="community"
      title={community.name}
      // Под именем — другие названия, на месте мазка (макет, доска 27).
      meta={aliases.length > 0 ? aliases.join(" · ") : undefined}
      actions={[
        { label: "Вложенное сообщество…", onClick: () => selectTab("Связи") },
        { label: "Архивировать", danger: true, onClick: archiveCommunity },
      ]}
      tabs={[
        "Досье",
        { id: "Связи", label: linkCount ? `Связи · ${linkCount}` : "Связи" },
        {
          id: "Хроника",
          label: community.important_dates.length ? `Хроника · ${community.important_dates.length}` : "Хроника",
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
      {tab === "Досье" && (
        <div className="dossier">
          <aside className="dossier__aside">
            <label className="dossier__portrait" title={IMAGE_HINT}>
              {community.avatar_image_url ? (
                <img src={community.avatar_image_url} alt={`Знак: ${community.name}`} />
              ) : (
                <span className="dossier__portrait-empty">Знак сообщества</span>
              )}
              <span className="dossier__portrait-hint">{uploadingAvatar ? "Загрузка…" : "Сменить знак"}</span>
              <input type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => avatarCrop.onSelect(e.target.files?.[0] ?? null)} />
            </label>
            <dl className="paper-facts">
              {community.locations.length > 0 && (
                <div>
                  <dt className="paper-label">Где</dt>
                  <dd>
                    {community.locations.map((l) => (
                      <Link key={l.id} className="mention-link mention--loc" to={`/locations/${l.id}`}>
                        {l.name}
                      </Link>
                    ))}
                  </dd>
                </div>
              )}
              {relationFacts.length > 0 && (
                <div>
                  <dt className="paper-label">С кем</dt>
                  <dd>
                    {relationFacts.map((r) => (
                      <span key={r.id}>
                        <Link
                          className={`mention-link mention--${mentionTone(r.other_type, r.other_id)}`}
                          to={`${DETAIL_ROUTES[r.other_type] ?? ""}/${r.other_id}`}
                        >
                          {r.other_name ?? "—"}
                        </Link>{" "}
                        <span className="paper-rows__sub">{r.label.trim() || RELATION_TONE_LABELS[r.tone].toLowerCase()}</span>
                      </span>
                    ))}
                  </dd>
                </div>
              )}
              <div>
                <dt className="paper-label">Входит в</dt>
                <dd>
                  {community.parent_id ? (
                    <Link className="mention-link mention--com" to={`/communities/${community.parent_id}`}>
                      {community.ancestors[community.ancestors.length - 1]?.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="paper-label">Теги</dt>
                <dd>
                  <TagChips tags={community.tags} onChange={saveTags} />
                </dd>
              </div>
              {/* Кому открыто — выдача с профиля (спека campaign-paper, Q34). */}
              <PlayerVisibilityFact targetType="setting_community" targetId={communityId} />
            </dl>
            <div className="dossier__search">
              <Link className="paper-more" to={populationTo}>
                В Населении ›
              </Link>
              <GraphNeighbourhoodLink type="community" id={community.id} />
            </div>
          </aside>

          <div className="dossier__main">
            <FactionCard
              force={community.force ?? {}}
              secret={community.secret ?? ""}
              members={community.members}
              settingId={community.setting_id}
              onSave={(patch) => save(patch)}
              onAllMembers={() => selectTab("Связи")}
            />

            <EditableTextCard
              title="Описание"
              value={community.description ?? ""}
              onSave={saveDescription}
              rows={4}
              entityType="community"
              entityId={communityId}
              defaultSettingId={community.setting_id}
              collapsible
              defaultOpen
            />

            {CHAPTER_SECTIONS.map(([section, title]) => (
              <details
                key={section}
                className="paper-fold"
                open={section !== "current_situation" && chaptersOf(section).length > 0}
              >
                <summary>
                  {title} <span className="paper-fold__count">· {chaptersOf(section).length}</span>
                </summary>
                <div className="paper-fold__body">
                  <ChapterList
                    ownerId={communityId}
                    ownerType="community"
                    apiBase="/setting-communities"
                    section={section}
                    chapters={chaptersOf(section)}
                    titlePrefix="Статья"
                    addLabel="статью"
                    defaultSettingId={community.setting_id}
                  />
                </div>
              </details>
            ))}

            {/* Справка: правится редко, за столом не нужна — свёрнута. */}
            <details className="paper-fold">
              <summary>Основное, источники</summary>
              <div className="paper-fold__body">
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
                <PdfEntitySources kind="community" id={community.id} />
              </div>
            </details>
          </div>
        </div>
      )}

      {tab === "Связи" && (
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
            <RelationsTab
              entityType="community"
              entityId={communityId}
              entityName={community.name}
              defaultSettingId={community.setting_id}
            />
          </details>
          <EntityParticipates entityType="community" entityId={communityId} />
        </div>
      )}

      {tab === "Хроника" && (
        <section>
          <h2 className="paper-group__head">
            В мире <span className="paper-group__count">{community.important_dates.length}</span>
          </h2>
          <p className="muted">Важные даты — отмечаются на календаре сеттинга и его кампаний.</p>
          <ul className="paper-rows">
            {community.important_dates.map((d) => (
              <li key={d.id}>
                <span className="paper-rows__main">
                  <strong>{d.title}</strong>
                </span>
                <span className="paper-rows__sub">
                  {formatImportantDate(d, calendar?.months ?? [], calendar?.weekdays ?? [])}
                </span>
                <button className="comp-mini" aria-label={`Удалить «${d.title}»`} onClick={() => removeImportantDate(d.id)}>
                  <NavIcon name="delete" />
                </button>
              </li>
            ))}
          </ul>
          <div className="chronicle__add">
            <div className="row chronicle__line">
              <input
                placeholder="Дата (напр. День основания)"
                value={dateTitle}
                onChange={(e) => setDateTitle(e.target.value)}
              />
              <button className="primary" aria-label="Добавить дату" title="Добавить дату" onClick={addImportantDate}>
                +
              </button>
            </div>
            <div className="row chronicle__line">
              <select value={dateRecurrence} onChange={(e) => setDateRecurrence(e.target.value as DateRecurrence)}>
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
                className="chronicle__num"
                value={dateDay}
                onChange={(e) => setDateDay(e.target.value)}
              />
            </div>
          </div>
        </section>
      )}

      {tab === "Галерея" && (
        <GalleryTab
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
