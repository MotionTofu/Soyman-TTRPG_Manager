import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StatblockList } from "../components/StatblockList";
import { EntryImagesTab } from "../components/EntryImagesTab";
import { MentionsTab } from "../components/MentionsTab";
import { EditableTextCard } from "../components/EditableTextCard";
import { EntityFieldsCard, type EntityField } from "../components/EntityFieldsCard";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { useTabState } from "../hooks/useTabState";
import { api } from "../api/client";
import { KIND_DEFS, extractEnglishName } from "../compendium";
import type { CompendiumEntry, System } from "../types";

// «Изображения» — перед «Упоминаниями», как на странице существа: служебные
// обратные ссылки везде замыкают ряд.
const TABS = ["Досье", "Статблоки", "Изображения", "Упоминания"] as const;

// Страница записи транспорта — судна, повозки или поста экипажа. Записи
// компендиума обычно раскрываются прямо в разделе, но у транспорта, как и у
// существа, есть статблок (у поста экипажа — своя прочность и действия) и
// дети: посты одного судна. В строку раздела это не помещается.
export function VehicleDetailPage({
  entry,
  system,
  onChange,
}: {
  entry: CompendiumEntry;
  system: System | null;
  onChange: () => void;
}) {
  const entryId = entry.id;
  const navigate = useNavigate();
  const [tab, selectTab] = useTabState(TABS, "Досье", { Статблок: "Статблоки" });
  const [posts, setPosts] = useState<CompendiumEntry[]>([]);
  const isPost = entry.kind === "vehicle_post";

  useEffect(() => {
    if (isPost) return;
    api
      .get<CompendiumEntry[]>(`/systems/${entry.system_id}/entries?section_id=${entry.section_id}`)
      .then((all) => setPosts(all.filter((e) => e.parent_id === entryId).sort((a, b) => a.position - b.position)));
  }, [entryId, entry.section_id, entry.system_id, isPost]);

  const def = KIND_DEFS[entry.kind];

  const fields: EntityField[] = [
    { key: "name", label: "Название", value: entry.name, required: true },
    { key: "name_original", label: "Оригинальное название", value: entry.name_original ?? "" },
    ...(def?.fields ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      value: typeof entry.data[f.key] === "string" ? (entry.data[f.key] as string) : "",
      options: f.options
        ? [{ value: "", label: "—" }, ...f.options.map((o) => ({ value: o, label: o }))]
        : undefined,
    })),
  ];

  async function saveSummary(values: Record<string, string>) {
    const data: Record<string, unknown> = { ...entry.data };
    for (const f of def?.fields ?? []) {
      const next = (values[f.key] ?? "").trim();
      if (next) data[f.key] = next;
      else delete data[f.key];
    }
    // «[English]» в конце имени переносится в name_original (см. extractEnglishName):
    const { name, en } = extractEnglishName(values.name.trim());
    await api.put(`/systems/entries/${entryId}`, {
      name,
      name_original: values.name_original.trim() || en,
      data,
    });
    onChange();
  }

  async function saveDescription(value: string) {
    await api.put(`/systems/entries/${entryId}`, { description: value });
    onChange();
  }

  async function addPost() {
    const created = await api.post<CompendiumEntry>(`/systems/${entry.system_id}/entries`, {
      section_id: entry.section_id,
      parent_id: entryId,
      kind: "vehicle_post",
      name: "",
      level: null,
      data: {},
      description: "",
    });
    // Пустой пост открывается сразу на своей странице — имя задаётся в «Сводке».
    navigate(`/compendium/${created.id}`);
  }

  async function deletePost(post: CompendiumEntry) {
    if (!confirm(`Удалить пост экипажа «${post.name}»?`)) return;
    await api.del(`/systems/entries/${post.id}`);
    setPosts((prev) => prev.filter((e) => e.id !== post.id));
  }

  async function deleteShip() {
    if (isPost) return;
    const msg =
      posts.length > 0
        ? `Удалить судно «${entry.name}» и все посты экипажа (${posts.length})?`
        : `Удалить судно «${entry.name}»?`;
    if (!confirm(msg)) return;
    await api.del(`/systems/entries/${entryId}`);
    navigate(`/systems/${entry.system_id}`);
  }

  return (
    <div className="stack">
      <Breadcrumbs
        items={[
          { label: "Системы", to: "/systems" },
          ...(system ? [{ label: system.name, to: `/systems/${system.id}` }] : []),
          { label: entry.name },
        ]}
      />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <EntityTypeChip type="compendium_entry" />
          <h2 style={{ margin: 0 }}>{entry.name}</h2>
          <span className="muted">{def?.label ?? "Транспорт"}</span>
        </div>
        {!isPost && (
          <button className="danger" onClick={deleteShip}>
            Удалить
          </button>
        )}
      </div>

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
            key={`summary-${entryId}`}
            title="Сводка"
            fields={fields}
            hideEmptyInView
            onSave={saveSummary}
          />
          <EditableTextCard
            title="Описание"
            value={entry.description}
            onSave={saveDescription}
            rows={6}
            entityType="compendium_entry"
            entityId={entryId}
            collapsible
            defaultOpen
          />
          {!isPost && (
            <div className="card stack">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <h4 style={{ margin: 0 }}>Посты экипажа</h4>
                <button className="primary" onClick={addPost}>
                  + Пост экипажа
                </button>
              </div>
              <div className="stack">
                {posts.map((p) => (
                  <div key={p.id} className="row" style={{ justifyContent: "space-between" }}>
                    <Link to={`/compendium/${p.id}`}>{p.name}</Link>
                    <button className="comp-mini" title="Удалить пост" onClick={() => deletePost(p)}>
                      ✕
                    </button>
                  </div>
                ))}
                {posts.length === 0 && <p className="muted">Постов экипажа пока нет.</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "Статблоки" && (
        <StatblockList
          ownerType="compendium_entry"
          ownerId={entryId}
          ownerName={entry.name}
          ownerCreatureSize={(entry.data.size as string | undefined) || undefined}
        />
      )}

      {tab === "Изображения" && (
        <EntryImagesTab
          entryId={entryId}
          entryName={entry.name}
          entryKind={entry.kind}
          avatarUrl={entry.avatar_image_url ?? null}
          onChange={onChange}
        />
      )}

      {tab === "Упоминания" && <MentionsTab entityType="compendium_entry" entityId={entryId} />}
    </div>
  );
}
