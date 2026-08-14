import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { AliasesCard } from "../components/AliasesCard";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { MentionsTab } from "../components/MentionsTab";
import { GalleryTab } from "../components/GalleryTab";
import { ChapterList } from "../components/ChapterList";
import { useTabState } from "../hooks/useTabState";
import { ITEM_CLASSES, MAGIC_ITEM_RARITIES, itemTypeOptions } from "../compendium";
import { CompendiumEntryPicker } from "../components/MonsterTemplatePicker";
import { GraphNeighbourhoodLink } from "../components/GraphNeighbourhoodLink";
import { RelationsTab } from "../components/RelationsTab";
import type { Artifact, CompendiumLink, SearchResult } from "../types";

const TABS = ["Досье", "Отношения", "Галерея", "Карточка предмета"] as const;

export function ArtifactDetailPage() {
  const { id } = useParams();
  const artifactId = Number(id);
  const navigate = useNavigate();

  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [form, setForm] = useState({
    name: "",
    short_name: "",
    description: "",
    owner: "",
    power: "",
    history: "",
    notes: "",
    item_class: "",
    item_type: "",
    rarity: "",
    requires_attunement: false,
  });
  const [editMode, setEditMode] = useState(false);
  const [tab, selectTab] = useTabState(TABS, "Досье");

  function refresh() {
    api.get<Artifact>(`/artifacts/${artifactId}`).then((a) => {
      setArtifact(a);
      setForm({
        name: a.name,
        short_name: a.short_name ?? "",
        description: a.description ?? "",
        owner: a.owner,
        power: a.power,
        history: a.history,
        notes: a.notes,
        item_class: a.item_class ?? "",
        item_type: a.item_type ?? "",
        rarity: a.rarity ?? "",
        requires_attunement: !!a.requires_attunement,
      });
    });
  }
  useEffect(refresh, [artifactId]);

  if (!artifact) return <p className="muted">Загрузка…</p>;

  async function save() {
    if (!artifact) return;
    await api.put(`/artifacts/${artifactId}`, form);
    syncMentionLinks("artifact", artifactId, artifact.power, form.power);
    syncMentionLinks("artifact", artifactId, artifact.history, form.history);
    syncMentionLinks("artifact", artifactId, artifact.notes, form.notes);
    setEditMode(false);
    refresh();
  }

  async function archiveArtifact() {
    if (!artifact) return;
    if (!confirm("Отправить артефакт в архив?")) return;
    await api.del(`/artifacts/${artifactId}`);
    navigate(`/settings/${artifact.setting_id}`);
  }

  // Тип, проставленный до разделения на роды (или руками при импорте), может
  // не значиться ни в одном списке — он добавляется к вариантам, иначе правка
  // досье молча стёрла бы его.
  const typeOptions = (() => {
    const list = itemTypeOptions(form.item_class);
    return form.item_type && !list.includes(form.item_type) ? [form.item_type, ...list] : list;
  })();

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ alignItems: "center" }}>
          <h1>{artifact.name}</h1>
          <GraphNeighbourhoodLink type="artifact" id={artifact.id} />
        </div>
        <div className="entity-header-actions">
          <button className="danger" onClick={archiveArtifact}>
            Архивировать
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

      {tab === "Досье" &&
        (editMode ? (
          <div className="card stack">
            <label>
              Название
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              Короткое имя для карты
              <input
                value={form.short_name}
                onChange={(e) => setForm({ ...form, short_name: e.target.value })}
                title="Показывается вместо полного имени в подписи пина на карте локации"
              />
            </label>
            <label>
              Владелец
              <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
            </label>
            <div className="row">
              <label>
                Род предмета
                <select
                  value={form.item_class}
                  onChange={(e) => {
                    const next = e.target.value;
                    // Тип, редкость и настройка вне выбранного рода не имеют
                    // смысла — сбрасываем их вместе с ним.
                    setForm({
                      ...form,
                      item_class: next,
                      item_type: itemTypeOptions(next).includes(form.item_type) ? form.item_type : "",
                      ...(next === "equipment" ? { rarity: "", requires_attunement: false } : {}),
                    });
                  }}
                >
                  <option value="">— не указан —</option>
                  {ITEM_CLASSES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Тип предмета
                <select
                  value={form.item_type}
                  onChange={(e) => setForm({ ...form, item_type: e.target.value })}
                >
                  <option value="">— не указан —</option>
                  {typeOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              {form.item_class !== "equipment" && (
                <>
                  <label>
                    Редкость
                    <select
                      value={form.rarity}
                      onChange={(e) => setForm({ ...form, rarity: e.target.value })}
                    >
                      <option value="">— не указана —</option>
                      {MAGIC_ITEM_RARITIES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="row" style={{ alignItems: "center", gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={form.requires_attunement}
                      onChange={(e) => setForm({ ...form, requires_attunement: e.target.checked })}
                    />
                    Требует настройки
                  </label>
                </>
              )}
            </div>
            <label>
              Короткое описание
              <MentionTextarea
                value={form.description}
                onChange={(v) => setForm({ ...form, description: v })}
                rows={2}
                defaultSettingId={artifact.setting_id}
              />
            </label>
            <label>
              Сила / свойства
              <MentionTextarea
                value={form.power}
                onChange={(v) => setForm({ ...form, power: v })}
                rows={4}
                defaultSettingId={artifact.setting_id}
              />
            </label>
            <label>
              История
              <MentionTextarea
                value={form.history}
                onChange={(v) => setForm({ ...form, history: v })}
                rows={4}
                defaultSettingId={artifact.setting_id}
              />
            </label>
            <label>
              Заметки
              <MentionTextarea
                value={form.notes}
                onChange={(v) => setForm({ ...form, notes: v })}
                rows={3}
                defaultSettingId={artifact.setting_id}
              />
            </label>
            <div className="row">
              <button className="primary" onClick={save}>
                Сохранить
              </button>
              <button onClick={() => setEditMode(false)}>Отмена</button>
            </div>
          </div>
        ) : (
          <div className="stack">
            <div className="card stack">
              {artifact.owner && (
                <div className="muted">
                  Владелец: <MentionText text={artifact.owner} />
                </div>
              )}
              {!!(
                artifact.item_class ||
                artifact.item_type ||
                artifact.rarity ||
                artifact.requires_attunement
              ) && (
                <div className="row" style={{ gap: 6 }}>
                  {artifact.item_class && (
                    <span className="badge tag">
                      {ITEM_CLASSES.find((c) => c.value === artifact.item_class)?.label ??
                        artifact.item_class}
                    </span>
                  )}
                  {artifact.item_type && <span className="badge tag">{artifact.item_type}</span>}
                  {artifact.rarity && <span className="badge tag">{artifact.rarity}</span>}
                  {!!artifact.requires_attunement && <span className="badge tag">Требует настройки</span>}
                </div>
              )}
              {artifact.description && (
                <div className="stack">
                  <strong>Короткое описание</strong>
                  <div style={{ whiteSpace: "pre-wrap" }}>
                    <MentionText text={artifact.description} />
                  </div>
                </div>
              )}
              {artifact.power && (
                <div>
                  <strong>Сила / свойства</strong>
                  <div style={{ whiteSpace: "pre-wrap" }}>
                    <MentionText text={artifact.power} />
                  </div>
                </div>
              )}
              {artifact.history && (
                <div>
                  <strong>История</strong>
                  <div style={{ whiteSpace: "pre-wrap" }}>
                    <MentionText text={artifact.history} />
                  </div>
                </div>
              )}
              {artifact.notes && (
                <div>
                  <strong>Заметки</strong>
                  <div style={{ whiteSpace: "pre-wrap" }}>
                    <MentionText text={artifact.notes} />
                  </div>
                </div>
              )}
              <button
                onClick={() => {
                  setForm({
                    name: artifact.name,
                    short_name: artifact.short_name ?? "",
                    description: artifact.description ?? "",
                    owner: artifact.owner,
                    power: artifact.power,
                    history: artifact.history,
                    notes: artifact.notes,
                    item_class: artifact.item_class ?? "",
                    item_type: artifact.item_type ?? "",
                    rarity: artifact.rarity ?? "",
                    requires_attunement: !!artifact.requires_attunement,
                  });
                  setEditMode(true);
                }}
                style={{ alignSelf: "flex-start" }}
              >
                Редактировать
              </button>
            </div>
            <ChapterList
              ownerId={artifactId}
              ownerType="artifact"
              apiBase="/artifacts"
              chapters={artifact.chapters}
              onChange={refresh}
              titlePrefix="Статья"
              addLabel="статью"
              defaultSettingId={artifact.setting_id}
            />
            <details className="stack">
              <summary>
                <strong className="entry-title">Упоминания</strong>
              </summary>
              <MentionsTab entityType="artifact" entityId={artifactId} />
            </details>
          </div>
        ))}

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

      {tab === "Карточка предмета" && (
        <div className="card stack">
          <p className="muted">
            Карточка предмета — скоро здесь появится компактная витрина для показа игрокам (пульт
            управления сессией и другие места).
          </p>
        </div>
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
