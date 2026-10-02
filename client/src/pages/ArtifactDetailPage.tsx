import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAction, useAfterWrite, useEntity, useResource, useSaveEntity, write } from "../data/hooks";
import { showSaveError } from "../data/notices";
import { settingPaths } from "../data/settingEntities";
import type { Affect } from "../data/entities";
import { AliasesCard } from "../components/AliasesCard";
import { EditableTextCard } from "../components/EditableTextCard";
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
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { useImageCrop } from "../hooks/useImageCrop";
import { ITEM_CLASSES, MAGIC_ITEM_RARITIES, itemTypeOptions } from "../compendium";
import { CompendiumEntryPicker } from "../components/MonsterTemplatePicker";
import { GraphNeighbourhoodLink } from "../components/GraphNeighbourhoodLink";
import { RelationsTab } from "../components/RelationsTab";
import { formatImportantDate } from "../inworldCalendar";
import type {
  Artifact,
  Campaign,
  CompendiumLink,
  DateRecurrence,
  EntityRelationsResponse,
  SearchResult,
  SettingBeing,
  SettingCommunity,
  SettingLocation,
} from "../types";
import { NavIcon } from "../components/NavIcons";
import { TagChips } from "../components/TagChips";
import { SecretSeal } from "../components/CreatureCard";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { LocationCascadePicker } from "../components/LocationCascadePicker";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { toAliasesList } from "../utils/aliasesList";
import { DETAIL_ROUTES } from "../entityTypes";
import { PlayerVisibilityFact } from "../components/PlayerVisibilityFact";

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
  const { save } = useSaveEntity<Artifact>("artifact", artifactId);
  const run = useAction();
  const afterWrite = useAfterWrite();
  const mine: Affect[] = [{ kind: "artifact", id: artifactId }];
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const allCampaigns = useResource<Campaign[]>(settingPaths.campaigns()).data;
  const campaigns = useMemo(() => (allCampaigns ?? []).filter((c) => c.setting_id === settingId), [allCampaigns, settingId]);
  const beings = useResource<SettingBeing[]>(settingId ? settingPaths.inSetting("being", settingId) : null).data ?? [];
  const communities = useResource<SettingCommunity[]>(settingId ? settingPaths.inSetting("community", settingId) : null).data ?? [];
  const [dateTitle, setDateTitle] = useState("");
  const [dateRecurrence, setDateRecurrence] = useState<DateRecurrence>("once");
  const [dateYear, setDateYear] = useState("");
  const [dateMonth, setDateMonth] = useState("");
  const [dateDay, setDateDay] = useState("");
  const [tab, selectTab] = useTabState(TABS, "Досье", TAB_ALIASES);
  const locations = useResource<SettingLocation[]>(settingId ? settingPaths.inSetting("location", settingId) : null).data ?? [];
  const relations = useResource<EntityRelationsResponse>(settingPaths.relations("artifact", artifactId)).data;
  const relationCount = relations ? relations.outgoing.length + relations.incoming.length : 0;
  const calendar = useSettingCalendar(settingId ?? undefined);
  const months = calendar?.months ?? [];
  const weekdays = calendar?.weekdays ?? [];
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
      () => write.post(`/artifacts/${artifactId}/important-dates`, body).then(() => true),
      { affects: dateAffects, retry: false }
    );
    if (!done) return;
    setDateTitle("");
    setDateYear("");
    setDateMonth("");
    setDateDay("");
  }

  async function removeImportantDate(dateId: number) {
    const ok = await confirm({ message: "Удалить важную дату?", confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    await run(() => write.del(`/artifacts/important-dates/${dateId}`), { affects: dateAffects });
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
  const identTags = [classLabel, artifact.item_type, artifact.rarity, artifact.requires_attunement ? "требует настройки" : null].filter(
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
    <EditableTextCard
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
      paper
      crumbs={[{ label: "Сокровищница", to: treasuryTo }, { label: artifact.name }]}
      entityType="artifact"
      title={artifact.name}
      // Под именем — род, тип, редкость метками, на месте мазка (Q3).
      meta={
        <span className="paper-ident-tags">
          {identTags.length > 0 ? (
            identTags.map((t) => (
              <span key={t} className="badge tag">
                {t}
              </span>
            ))
          ) : (
            <button type="button" className="badge tag setting-genres__add" onClick={openReference}>
              + род предмета
            </button>
          )}
          {aliases.length > 0 && <span>{aliases.join(" · ")}</span>}
        </span>
      }
      actions={[{ label: "Архивировать", danger: true, onClick: archiveArtifact }]}
      tabs={[
        "Досье",
        { id: "Связи", label: relationCount + (ownerName ? 1 : 0) + (artifact.location ? 1 : 0) ? `Связи · ${relationCount + (ownerName ? 1 : 0) + (artifact.location ? 1 : 0)}` : "Связи" },
        {
          id: "Хроника",
          label: importantDates.length ? `Хроника · ${importantDates.length}` : "Хроника",
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
              {artifact.avatar_image_url ? (
                <img src={artifact.avatar_image_url} alt={artifact.name} />
              ) : (
                <span className="dossier__portrait-empty">Картинка предмета</span>
              )}
              <span className="dossier__portrait-hint">{uploadingAvatar ? "Загрузка…" : "Сменить картинку"}</span>
              <input type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => avatarCrop.onSelect(e.target.files?.[0] ?? null)} />
            </label>
            <dl className="paper-facts">
              {ownerName && (
                <div>
                  <dt className="paper-label">У кого</dt>
                  <dd>
                    {ownerTo && artifact.owner_entity ? (
                      <Link
                        className={`mention-link mention--${mentionTone(artifact.owner_entity.type, artifact.owner_entity.id)}`}
                        to={ownerTo}
                      >
                        {ownerName}
                      </Link>
                    ) : (
                      ownerName
                    )}
                  </dd>
                </div>
              )}
              {artifact.location && (
                <div>
                  <dt className="paper-label">Где</dt>
                  <dd>
                    <Link className="mention-link mention--loc" to={`/locations/${artifact.location.id}`}>
                      {artifact.location.name}
                    </Link>
                  </dd>
                </div>
              )}
              {links.length > 0 && (
                <div>
                  <dt className="paper-label">Правила</dt>
                  <dd>
                    {links.map((l) => (
                      <Link key={l.id} className="paper-more" to={`/compendium/${l.id}`}>
                        {l.name}
                        {l.system_name ? ` · ${l.system_name}` : ""} ›
                      </Link>
                    ))}
                  </dd>
                </div>
              )}
              <div>
                <dt className="paper-label">Теги</dt>
                <dd>
                  <TagChips tags={artifact.tags ?? []} onChange={saveTags} />
                </dd>
              </div>
              {/* Кому открыто — выдача с профиля (спека campaign-paper, Q34). */}
              <PlayerVisibilityFact targetType="setting_artifact" targetId={artifactId} />
            </dl>
            <div className="dossier__search">
              <Link className="paper-more" to={treasuryTo}>
                В Сокровищнице ›
              </Link>
              <GraphNeighbourhoodLink type="artifact" id={artifact.id} />
            </div>
          </aside>

          <div className="dossier__main">
            <ArtifactHead
              power={artifact.power}
              secret={artifact.secret}
              ownerName={ownerName}
              ownerTo={ownerTo}
              location={artifact.location ?? null}
              settingId={artifact.setting_id}
              onSave={async (patch) => {
                const ok = await save(patch);
                if (ok) {
                  syncMentionLinks("artifact", artifactId, artifact.power, patch.power);
                  syncMentionLinks("artifact", artifactId, artifact.secret, patch.secret);
                }
                return ok;
              }}
            />

            {textCard("description", "Описание", 3, "описание")}
            {textCard("history", "История", 4, "история предмета")}
            {textCard("notes", "Заметки", 3, "заметка")}

            <details className="paper-fold" open={artifact.chapters.length > 0}>
              <summary>
                Статьи <span className="paper-fold__count">· {artifact.chapters.length}</span>
              </summary>
              <div className="paper-fold__body">
                <ChapterList
                  ownerId={artifactId}
                  ownerType="artifact"
                  apiBase="/artifacts"
                  chapters={artifact.chapters}
                  titlePrefix="Статья"
                  addLabel="статью"
                  defaultSettingId={artifact.setting_id}
                  campaigns={campaigns}
                />
              </div>
            </details>

            {/* Справка: правится редко, за столом не нужна — свёрнута. */}
            <details className="paper-fold" ref={referenceRef}>
              <summary>Основное, компендиум, источники</summary>
              <div className="paper-fold__body">
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
                <CompendiumLinksCard artifactId={artifactId} links={links} />
                <PdfEntitySources kind="artifact" id={artifact.id} />
              </div>
            </details>
          </div>
        </div>
      )}

      {tab === "Связи" && (
        <div className="paper-groups">
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

          <details className="paper-fold" open>
            <summary>
              С кем · что <span className="paper-fold__count">{relationCount}</span>
            </summary>
            <RelationsTab
              entityType="artifact"
              entityId={artifact.id}
              entityName={artifact.name}
              defaultSettingId={artifact.setting_id}
            />
          </details>
        </div>
      )}

      {tab === "Хроника" && (
        <section>
          <h2 className="paper-group__head">
            В мире <span className="paper-group__count">{importantDates.length}</span>
          </h2>
          <p className="muted">Важные даты — отмечаются на календаре сеттинга и его кампаний.</p>
          <ul className="paper-rows">
            {importantDates.map((d) => (
              <li key={d.id}>
                <span className="paper-rows__main">
                  <strong>{d.title}</strong>
                </span>
                <span className="paper-rows__sub">{formatImportantDate(d, months, weekdays)}</span>
                <button className="comp-mini" aria-label={`Удалить «${d.title}»`} onClick={() => removeImportantDate(d.id)}>
                  <NavIcon name="delete" />
                </button>
              </li>
            ))}
          </ul>
          <div className="chronicle__add">
            <div className="row chronicle__line">
              <input
                placeholder="Дата (напр. День находки)"
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
                  {months.map((m) => (
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

      {tab === "Галерея" && <GalleryTab ownerType="artifact" ownerId={artifactId} />}

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
  location,
  settingId,
  onSave,
}: {
  power: string;
  secret: string;
  ownerName: string;
  ownerTo: string | null;
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
    <article className="creature-card paper-scope creature-card--page is-embedded">
      <div className="creature-card__head">
        <span className="creature-card__head-label">За столом</span>
        <button type="button" className="creature-card__edit" onClick={startEdit}>
          Править
        </button>
      </div>
      {power.trim() ? (
        <div className="artifact-head__power">
          <MentionText text={power} />
        </div>
      ) : (
        <div className="creature-card__empty">
          Что предмет делает — пока не записано.{" "}
          <button type="button" className="creature-card__more" onClick={startEdit}>
            Заполнить
          </button>
        </div>
      )}
      {(ownerName || location) && (
        <div className="faction-card__faces">
          {ownerName && (
            <>
              <span className="creature-card__head-label">У кого</span>{" "}
              {ownerTo ? (
                <Link className="mention-link" to={ownerTo}>
                  {ownerName}
                </Link>
              ) : (
                ownerName
              )}{" "}
            </>
          )}
          {location && (
            <>
              <span className="creature-card__head-label">Где</span>{" "}
              <Link className="mention-link mention--loc" to={`/locations/${location.id}`}>
                {location.name}
              </Link>
            </>
          )}
        </div>
      )}
      {secret.trim() && <SecretSeal text={secret} />}
    </article>
  );
}

// «Записи компендиумов» — маг. предметы систем, описывающие этот же предмет.
// Предмет приключения и запись справочника — одна вещь с двух сторон: в книге
// у «Кольца защиты разума» своя история и владелец, в компендиуме — правила.
// Связей может быть несколько: сеттинг водится сразу под две системы.
function CompendiumLinksCard({ artifactId, links }: { artifactId: number; links: CompendiumLink[] }) {
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
    <details className="card">
      <summary className="sb-section" style={{ margin: 0 }}>
        Записи компендиумов {links.length > 0 && `(${links.length})`}
      </summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <span className="muted">
          Маг. предметы из компендиумов систем, соответствующие этому предмету. Правила живут
          там, история и владелец — здесь.
        </span>
        <CompendiumEntryPicker
          value={null}
          onChange={add}
          kind="magic_item"
          placeholder="Найти в компендиуме…"
          selectedLabel="Выбрано"
        />
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
