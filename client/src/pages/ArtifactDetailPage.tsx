import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { AliasesCard } from "../components/AliasesCard";
import { ArtifactCardEditor } from "../components/ArtifactCardEditor";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EditableTextCard } from "../components/EditableTextCard";
import { EntityFieldsCard } from "../components/EntityFieldsCard";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { MentionsTab } from "../components/MentionsTab";
import { GalleryTab } from "../components/GalleryTab";
import { ChapterList } from "../components/ChapterList";
import { useTabState } from "../hooks/useTabState";
import { useAlert, useConfirm } from "../hooks/useConfirm";
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
  const [alertDialog, showAlert] = useAlert();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [beings, setBeings] = useState<SettingBeing[]>([]);
  const [communities, setCommunities] = useState<SettingCommunity[]>([]);
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
    await api.post(`/artifacts/${artifactId}/avatar`, formData);
    setUploadingAvatar(false);
    refresh();
  }

  const avatarCrop = useImageCrop("square", handleAvatarChange);

  async function saveTags(tags: string[]) {
    await api.put(`/artifacts/${artifactId}`, { tags });
    refresh();
  }

  async function addImportantDate() {
    if (!dateTitle.trim() || !dateDay) return;
    await api.post(`/artifacts/${artifactId}/important-dates`, {
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
  }

  async function removeImportantDate(dateId: number) {
    const ok = await confirm({ message: "Удалить важную дату?", confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    await api.del(`/artifacts/important-dates/${dateId}`);
    refresh();
  }

  const [artifact, setArtifact] = useState<Artifact | null>(null);

  const refresh = useCallback(() => {
    const controller = new AbortController();
    api.get<Artifact>(`/artifacts/${artifactId}`, { signal: controller.signal })
      .then((a) => {
        setArtifact(a);
      })
      .catch((err) => {
        if (err.name !== "AbortError") throw err;
      });
    return () => controller.abort();
  }, [artifactId]);

  useEffect(() => {
    const cleanup = refresh();
    return cleanup;
  }, [refresh]);

  useEffect(() => {
    if (!artifact) return;
    api
      .get<Campaign[]>("/campaigns")
      .then((all) => setCampaigns(all.filter((c) => c.setting_id === artifact.setting_id)));
    api
      .get<SettingBeing[]>(`/setting-beings?setting_id=${artifact.setting_id}`)
      .then(setBeings);
    api
      .get<SettingCommunity[]>(`/setting-communities?setting_id=${artifact.setting_id}`)
      .then(setCommunities);
  }, [artifact?.setting_id]);

  const typeOptions = useMemo(() => {
    const list = itemTypeOptions(artifact?.item_class ?? "");
    const currentType = artifact?.item_type ?? "";
    return currentType && !list.includes(currentType) ? [currentType, ...list] : list;
  }, [artifact?.item_class, artifact?.item_type]);

  if (!artifact) {
    return (
      <div className="stack" aria-busy="true" aria-label="Загрузка артефакта">
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

  async function archiveArtifact() {
    if (!artifact) return;
    const ok = await confirm({ message: "Отправить артефакт в архив?", confirmLabel: "Архивировать", danger: true });
    if (!ok) return;
    try {
      await api.del(`/artifacts/${artifactId}`);
      navigate(`/settings/${artifact.setting_id}`);
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="stack">
      {confirmDialog}
      {alertDialog}
      <Breadcrumbs
        items={[
          {
            label: "Сокровищница",
            to: `/settings/${artifact.setting_id}?tab=${encodeURIComponent("Сокровищница")}`,
          },
          { label: artifact.name },
        ]}
      />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="stack" style={{ alignItems: "center" }}>
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
            {avatarCrop.modal}
          </div>
          <div>
            <div className="row" style={{ alignItems: "center" }}>
              <h1>{artifact.name}</h1>
              <EntityTypeChip type="artifact" />
              <GraphNeighbourhoodLink type="artifact" id={artifact.id} />
            </div>
            <TagChips tags={artifact.tags ?? []} onChange={saveTags} />
          </div>
        </div>
        <div className="entity-header-actions">
          <button className="danger" onClick={archiveArtifact}>
            <NavIcon name="archive" /> Архивировать
          </button>
        </div>
      </div>
      {artifact.file_path && <div className="muted">{artifact.file_path}</div>}

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => selectTab(t)}>
            {t}
          </button>
        ))}
      </div>

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
            onSave={async (v) => {
              await api.put(`/artifacts/${artifactId}`, { name: v.name, short_name: v.short_name });
              refresh();
            }}
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
                  onClick={async () => {
                    await api.put(`/artifacts/${artifactId}`, { owner_type: null, owner_id: null });
                    refresh();
                  }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="row" style={{ gap: 8 }}>
                <select
                  value=""
                  onChange={async (e) => {
                    const [type, idStr] = e.target.value.split(":");
                    const id = Number(idStr);
                    if (!type || !id) return;
                    await api.put(`/artifacts/${artifactId}`, { owner_type: type, owner_id: id });
                    refresh();
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
            onSave={async (v) => {
              await api.put(`/artifacts/${artifactId}`, { description: v });
              syncMentionLinks("artifact", artifactId, artifact.description, v);
              refresh();
            }}
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
            onSaveFields={async (v) => {
              await api.put(`/artifacts/${artifactId}`, {
                item_class: v.item_class || null,
                item_type: v.item_type || null,
                rarity: v.rarity || null,
              });
              refresh();
            }}
          />
          <EditableTextCard
            title="Сила / свойства"
            value={artifact.power}
            onSave={async (v) => {
              await api.put(`/artifacts/${artifactId}`, { power: v });
              syncMentionLinks("artifact", artifactId, artifact.power, v);
              refresh();
            }}
            rows={4}
            entityType="artifact"
            entityId={artifactId}
            defaultSettingId={artifact.setting_id}
            collapsible
          />
          <EditableTextCard
            title="История"
            value={artifact.history}
            onSave={async (v) => {
              await api.put(`/artifacts/${artifactId}`, { history: v });
              syncMentionLinks("artifact", artifactId, artifact.history, v);
              refresh();
            }}
            rows={4}
            entityType="artifact"
            entityId={artifactId}
            defaultSettingId={artifact.setting_id}
            collapsible
          />
          <EditableTextCard
            title="Секрет"
            value={artifact.secret}
            onSave={async (v) => {
              await api.put(`/artifacts/${artifactId}`, { secret: v });
              syncMentionLinks("artifact", artifactId, artifact.secret, v);
              refresh();
            }}
            rows={3}
            entityType="artifact"
            entityId={artifactId}
            defaultSettingId={artifact.setting_id}
            collapsible
          />
          <EditableTextCard
            title="Заметки"
            value={artifact.notes}
            onSave={async (v) => {
              await api.put(`/artifacts/${artifactId}`, { notes: v });
              syncMentionLinks("artifact", artifactId, artifact.notes, v);
              refresh();
            }}
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
              onChange={refresh}
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
          onSave={async (aliases, name_original) => {
            await api.put(`/artifacts/${artifactId}`, { aliases, name_original });
            refresh();
          }}
        />
      )}

      {tab === "Досье" && (
        <CompendiumLinksCard
          artifactId={artifactId}
          links={artifact.compendium_links ?? []}
          onChange={refresh}
        />
      )}

      {tab === "Отношения" && (
        <div className="card stack">
          <RelationsTab
            entityType="artifact"
            entityId={artifact.id}
            entityName={artifact.name}
            defaultSettingId={artifact.setting_id}
          />
        </div>
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
        <ArtifactCardEditor id={artifactId} onChange={refresh} />
      )}
    </div>
  );
}

// «Записи компендиумов» — маг. предметы систем, описывающие этот же предмет.
// Предмет приключения и запись справочника — одна вещь с двух сторон: в книге
// у «Кольца защиты разума» своя история и владелец, в компендиуме — правила.
// Связей может быть несколько: сеттинг водится сразу под две системы.
function CompendiumLinksCard({
  artifactId,
  links,
  onChange,
}: {
  artifactId: number;
  links: CompendiumLink[];
  onChange: () => void;
}) {
  async function add(entry: SearchResult | null) {
    if (!entry) return;
    await api.post(`/artifacts/${artifactId}/compendium-links`, { compendium_entry_id: entry.id });
    onChange();
  }

  async function remove(entryId: number) {
    await api.del(`/artifacts/${artifactId}/compendium-links/${entryId}`);
    onChange();
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
