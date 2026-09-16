import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAction, useAfterWrite, useEntity, useResource, useSaveEntity, write } from "../data/hooks";
import { showSaveError } from "../data/notices";
import { settingPaths } from "../data/settingEntities";
import type { Affect } from "../data/entities";
import { AliasesCard } from "../components/AliasesCard";
import { ArtifactCardEditor } from "../components/ArtifactCardEditor";
import { EditableTextCard } from "../components/EditableTextCard";
import { EntityFieldsCard } from "../components/EntityFieldsCard";
import { EntityPage } from "../components/EntityPage";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
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
import type { Artifact, Campaign, CompendiumLink, DateRecurrence, SearchResult, SettingBeing, SettingCommunity } from "../types";
import { NavIcon } from "../components/NavIcons";
import { TagChips } from "../components/TagChips";

const TABS = ["Досье", "Отношения", "Галерея", "Важные даты", "Карточка предмета"] as const;

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
  const [tab, selectTab] = useTabState(TABS, "Досье");

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

  return (
    <EntityPage
      crumbs={[
        {
          label: "Сокровищница",
          to: `/settings/${artifact.setting_id}?tab=${encodeURIComponent("Сокровищница")}`,
        },
        { label: artifact.name },
      ]}
      entityType="artifact"
      title={artifact.name}
      avatar={
        <label className="avatar-upload-label" title={IMAGE_HINT}>
          {artifact.avatar_image_url ? (
            <img src={artifact.avatar_image_url} alt="" className="being-avatar" />
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
      }
      badges={<GraphNeighbourhoodLink type="artifact" id={artifact.id} />}
      meta={
        <>
          <TagChips tags={artifact.tags ?? []} onChange={saveTags} />
          {artifact.file_path && <div>{artifact.file_path}</div>}
        </>
      }
      actions={[{ label: "Архивировать", danger: true, onClick: archiveArtifact }]}
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
            key={`fields-${artifact.id}`}
            fields={[
              { key: "name", label: "Название", value: artifact.name, required: true },
              {
                key: "short_name",
                label: "Короткое имя для карты",
                value: artifact.short_name ?? "",
                title: "Показывается вместо полного имени в подписи пина на карте локации",
              },
            ]}
            onSave={(v) => saveOrThrow({ name: v.name, short_name: v.short_name })}
          />
          <div className="card stack">
            <h3>Владелец</h3>
            {artifact.owner_entity ? (
              <div className="row" style={{ alignItems: "center", gap: 8 }}>
                <Link to={`/${artifact.owner_entity.type === "being" ? "beings" : "communities"}/${artifact.owner_entity.id}`}>
                  {artifact.owner_entity.name}
                </Link>
                <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
                  {artifact.owner_entity.type === "being" ? "Существо" : "Сообщество"}
                </span>
                <button
                  onClick={() => setOwner(null, null)}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="row" style={{ gap: 8 }}>
                <select
                  value=""
                  onChange={(e) => {
                    const [type, idStr] = e.target.value.split(":");
                    const id = Number(idStr);
                    if (!type || !id) return;
                    setOwner(type, id);
                  }}
                >
                  <option value="">Выбрать…</option>
                  {beings.length > 0 && <optgroup label="Существа">
                    {beings.map((b) => (
                      <option key={`being:${b.id}`} value={`being:${b.id}`}>{b.name}</option>
                    ))}
                  </optgroup>}
                  {communities.length > 0 && <optgroup label="Сообщества">
                    {communities.map((c) => (
                      <option key={`community:${c.id}`} value={`community:${c.id}`}>{c.name}</option>
                    ))}
                  </optgroup>}
                </select>
              </div>
            )}
          </div>
          <EditableTextCard
            title="Короткое описание"
            value={artifact.description}
            onSave={(v) => saveText("description", artifact.description, v)}
            rows={2}
            entityType="artifact"
            entityId={artifactId}
            defaultSettingId={artifact.setting_id}
            collapsible
            defaultOpen
            fields={[
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
                  ]
                : []),
            ]}
            onSaveFields={(v) =>
              saveOrThrow({
                item_class: v.item_class || null,
                item_type: v.item_type || null,
                rarity: v.rarity || null,
              })
            }
          />
          <EditableTextCard
            title="Сила / свойства"
            value={artifact.power}
            onSave={(v) => saveText("power", artifact.power, v)}
            rows={4}
            entityType="artifact"
            entityId={artifactId}
            defaultSettingId={artifact.setting_id}
            collapsible
          />
          <EditableTextCard
            title="История"
            value={artifact.history}
            onSave={(v) => saveText("history", artifact.history, v)}
            rows={4}
            entityType="artifact"
            entityId={artifactId}
            defaultSettingId={artifact.setting_id}
            collapsible
          />
          <EditableTextCard
            title="Секрет"
            value={artifact.secret}
            onSave={(v) => saveText("secret", artifact.secret, v)}
            rows={3}
            entityType="artifact"
            entityId={artifactId}
            defaultSettingId={artifact.setting_id}
            collapsible
          />
          <EditableTextCard
            title="Заметки"
            value={artifact.notes}
            onSave={(v) => saveText("notes", artifact.notes, v)}
            rows={3}
            entityType="artifact"
            entityId={artifactId}
            defaultSettingId={artifact.setting_id}
            collapsible
          />
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
            <details className="stack">
              <summary>
                <strong className="entry-title">Упоминания</strong>
              </summary>
              <MentionsTab entityType="artifact" entityId={artifactId} />
            </details>
          </div>
      )}

      {tab === "Досье" && (
        <AliasesCard
          aliases={artifact.aliases ?? []}
          nameOriginal={artifact.name_original ?? ""}
          onSave={(aliases, name_original) => saveOrThrow({ aliases, name_original })}
        />
      )}

      {tab === "Досье" && (
        <CompendiumLinksCard
          artifactId={artifactId}
          links={artifact.compendium_links ?? []}
        />
      )}

      {tab === "Отношения" && (
        <RelationsTab
          entityType="artifact"
          entityId={artifact.id}
          entityName={artifact.name}
          defaultSettingId={artifact.setting_id}
        />
      )}

      {tab === "Галерея" && <GalleryTab ownerType="artifact" ownerId={artifactId} />}

      {tab === "Важные даты" && (
        <div className="card stack">
          <span className="muted">
            Эти даты отмечаются на календаре сеттинга и переносятся в календари связанных с ним
            кампаний.
          </span>
          <div className="row">
            <input
              placeholder="Название (напр. День находки)"
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
            {(artifact.important_dates ?? []).map((d) => (
              <div key={d.id} className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  <strong>{d.title}</strong> — {formatImportantDate(d, [], [])}
                </span>
                <button className="danger" onClick={() => removeImportantDate(d.id)}>
                  ✕
                </button>
              </div>
            ))}
            {(!artifact.important_dates || artifact.important_dates.length === 0) && (
              <p className="muted">Важных дат пока нет.</p>
            )}
          </div>
        </div>
      )}

      {tab === "Карточка предмета" && (
        <ArtifactCardEditor id={artifactId} />
      )}
    </EntityPage>
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
