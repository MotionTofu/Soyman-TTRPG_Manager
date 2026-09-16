import { useState, type DragEvent } from "react";
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
import { GraphNeighbourhoodLink } from "../components/GraphNeighbourhoodLink";
import { EntityFieldsCard } from "../components/EntityFieldsCard";
import { BeingQuickCreate } from "../components/BeingQuickCreate";
import { BeingEntityRowList } from "../components/BeingEntityRowList";
import { MentionsTab } from "../components/MentionsTab";
import { useTabState } from "../hooks/useTabState";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { formatImportantDate } from "../inworldCalendar";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { useImageCrop } from "../hooks/useImageCrop";
import { TagChips } from "../components/TagChips";
import { loadThumbnailStyles } from "../thumbnailStyles";
import type { DateRecurrence, SearchResult, SettingCommunityDetail, SettingLocation } from "../types";
import { NavIcon } from "../components/NavIcons";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { useConfirm } from "../hooks/useConfirm";

const TABS = [
  "Досье",
  "Представители",
  "Места обитания",
  "Вложенные сообщества",
  "Отношения",
  "Галерея",
  "Карточка фракции",
  "Упоминания",
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
  const [tab, selectTab] = useTabState(TABS, "Досье");
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
  const thumbnailStyles = loadThumbnailStyles();

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

  return (
    <EntityPage
      crumbs={[
        {
          label: "Население",
          to: `/settings/${community.setting_id}?tab=${encodeURIComponent("Население")}`,
        },
        ...community.ancestors.map((a) => ({ label: a.name, to: `/communities/${a.id}` })),
        { label: community.name },
      ]}
      entityType="community"
      title={community.name}
      avatar={
        <label className="avatar-upload-label" title={IMAGE_HINT}>
          {community.avatar_image_url ? (
            <img src={community.avatar_image_url} alt="" className="community-avatar" />
          ) : (
            <div className="community-avatar roster-avatar-placeholder" />
          )}
          <span className="avatar-upload-hint">{uploadingAvatar ? "Загрузка…" : "Сменить фото"}</span>
          <input
            type="file"
            accept={IMAGE_ACCEPT}
            style={{ display: "none" }}
            onChange={(e) => avatarCrop.onSelect(e.target.files?.[0] ?? null)}
          />
        </label>
      }
      badges={<GraphNeighbourhoodLink type="community" id={community.id} />}
      meta={<TagChips tags={community.tags} onChange={saveTags} />}
      // Имя правится карточкой «Основное» во вкладке «Досье».
      actions={[{ label: "Архивировать", danger: true, onClick: archiveCommunity }]}
      tabs={TABS}
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
        <div className="stack">
          <EntityFieldsCard
            key={`fields-${community.id}`}
            fields={[{ key: "name", label: "Имя", value: community.name, required: true }]}
            onSave={(v) => saveName(v.name)}
          />
          {/* Синонимы имени стояли на вкладке «Отношения», где их никто не
              искал: у локации и личности они в досье, здесь теперь тоже. */}
          <AliasesCard
            aliases={community.aliases ?? []}
            nameOriginal={community.name_original ?? ""}
            onSave={(aliases, name_original) => saveOrThrow({ aliases, name_original })}
          />
          <details className="card">
            <summary className="sb-section" style={{ margin: 0 }}>
              История
            </summary>
            <div className="stack">
              <ChapterList
                ownerId={communityId}
                ownerType="community"
                apiBase="/setting-communities"
                section="history"
                chapters={community.chapters.filter((c) => c.section === "history")}
                titlePrefix="Статья"
                addLabel="статью"
                defaultSettingId={community.setting_id}
              />
              <details className="card">
                <summary className="sb-section" style={{ margin: 0 }}>
                  Важные даты
                </summary>
                <div className="stack">
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
                    <select
                      value={dateRecurrence}
                      onChange={(e) => setDateRecurrence(e.target.value as DateRecurrence)}
                    >
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
                    {community.important_dates.map((d) => (
                      <div key={d.id} className="row" style={{ justifyContent: "space-between" }}>
                        <span>
                          <strong>{d.title}</strong> — {formatImportantDate(d, calendar?.months ?? [], calendar?.weekdays ?? [])}
                        </span>
                        <button className="comp-mini" onClick={() => removeImportantDate(d.id)}>
                          ✕
                        </button>
                      </div>
                    ))}
                    {community.important_dates.length === 0 && <p className="muted">Важных дат пока нет.</p>}
                  </div>
                </div>
              </details>
            </div>
          </details>
          <details className="card">
            <summary className="sb-section" style={{ margin: 0 }}>
              Текущая ситуация
            </summary>
            <ChapterList
              ownerId={communityId}
              ownerType="community"
              apiBase="/setting-communities"
              section="current_situation"
              chapters={community.chapters.filter((c) => c.section === "current_situation")}
              titlePrefix="Статья"
              addLabel="статью"
              defaultSettingId={community.setting_id}
            />
          </details>
          <details className="card">
            <summary className="sb-section" style={{ margin: 0 }}>
              Цели
            </summary>
            <ChapterList
              ownerId={communityId}
              ownerType="community"
              apiBase="/setting-communities"
              section="goals"
              chapters={community.chapters.filter((c) => c.section === "goals")}
              titlePrefix="Статья"
              addLabel="статью"
              defaultSettingId={community.setting_id}
            />
          </details>
          <details className="card">
            <summary className="sb-section" style={{ margin: 0 }}>
              Особенности
            </summary>
            <ChapterList
              ownerId={communityId}
              ownerType="community"
              apiBase="/setting-communities"
              section="features"
              chapters={community.chapters.filter((c) => c.section === "features")}
              titlePrefix="Статья"
              addLabel="статью"
              defaultSettingId={community.setting_id}
            />
          </details>
        </div>
      )}

      {tab === "Представители" && (
        <div className="card stack">
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
            <span className="muted">Перетащите существо из поиска сюда, чтобы добавить его в участники.</span>
          </div>
          {community.children.length > 0 && (
            <span className="muted">
              Список включает участников вложенных сообществ ({community.children.map((c) => c.name).join(", ")}).
            </span>
          )}
          <BeingEntityRowList
            beings={community.members}
            onDelete={removeMember}
            deleteLabel="Убрать отсюда"
            emptyLabel="Участников пока нет."
            getFactionCount={(b) => b.community_count}
          />
        </div>
      )}

      {tab === "Вложенные сообщества" && (
        <div className="card stack">
          <div className="row">
            <input
              placeholder="Название вложенного сообщества/народа/культуры"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
            />
            <button className="primary" onClick={addChild}>
              Добавить
            </button>
          </div>
          <div className="grid-cards">
            {community.children.map((c) => (
              <Link key={c.id} to={`/communities/${c.id}`} className="card">
                <h3>{c.name}</h3>
                {c.description && <div className="muted">{c.description}</div>}
              </Link>
            ))}
            {community.children.length === 0 && (
              <p className="muted">Вложенных сообществ пока нет.</p>
            )}
          </div>
        </div>
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
          <div className="entity-row-list">
            {community.locations.map((l) => {
              // The community detail endpoint only returns {id, name} for
              // habitats — cross-reference the setting's full location list
              // (already loaded for the drop-zone picker) for thumbnail/kind.
              const full = locations.find((loc) => loc.id === l.id);
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
            {community.locations.length === 0 && <p className="muted">Мест обитания пока нет.</p>}
          </div>
        </div>
      )}

      {tab === "Отношения" && (
        <div className="stack">
          <LinkDropZone entityType="community" entityId={communityId} title="Связанные сущности" />
          <RelationsTab
            entityType="community"
            entityId={communityId}
            entityName={community.name}
            defaultSettingId={community.setting_id}
          />
        </div>
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

      {tab === "Карточка фракции" && (
        <div className="card stack">
          <p className="muted">
            Карточка фракции — скоро здесь появится компактная витрина для показа игрокам (пульт
            управления сессией и другие места).
          </p>
        </div>
      )}

      {tab === "Упоминания" && <MentionsTab entityType="community" entityId={communityId} />}
    </EntityPage>
  );
}
