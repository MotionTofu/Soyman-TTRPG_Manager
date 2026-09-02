import { useEffect, useState } from "react";
import { StatblockList } from "../components/StatblockList";
import { MentionsTab } from "../components/MentionsTab";
import { ChapterList } from "../components/ChapterList";
import { EditableTextCard } from "../components/EditableTextCard";
import { EntityFieldsCard, type EntityField } from "../components/EntityFieldsCard";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { CreatureCardEditor } from "../components/CreatureCardEditor";
import { EntryImagesTab } from "../components/EntryImagesTab";
import { useTabState } from "../hooks/useTabState";
import { api } from "../api/client";
import {
  CREATURE_SIZES,
  MECHANICS_ALIGNMENT_GROUP,
  MECHANICS_CREATURE_TYPE_GROUP,
  extractEnglishName,
} from "../compendium";
import type { CompendiumEntry, System, SystemSection } from "../types";

// «Упоминания» замыкают ряд вкладок на всех страницах приложения — это
// служебные обратные ссылки, а не содержимое записи; «Изображения» встают
// перед ними, последними среди содержательных.
const TABS = ["Статблоки", "Досье", "Карточка существа", "Изображения", "Упоминания"] as const;

interface MechanicsOption {
  id: number;
  name: string;
}

// Тип существа и мировоззрение живут в справочнике механик системы — там же,
// откуда их берёт редактор компендиума. Тип подставляется выбором (по нему
// работает фильтр раздела и он хранится ссылкой), мировоззрение — только
// подсказками к свободному тексту: книга пишет там условия, а не пункты.
async function loadCreatureLists(
  systemId: number
): Promise<{ types: MechanicsOption[]; alignments: string[] }> {
  const sections = await api.get<SystemSection[]>(`/systems/${systemId}/sections`);
  const mechSection = sections.find((s) => s.kind === "mechanics");
  if (!mechSection) return { types: [], alignments: [] };
  const entries = await api.get<CompendiumEntry[]>(
    `/systems/${systemId}/entries?section_id=${mechSection.id}`
  );
  const groupsByName = new Map(entries.filter((e) => e.parent_id === null).map((e) => [e.name, e]));
  const childrenOf = (groupName: string) => {
    const group = groupsByName.get(groupName);
    if (!group) return [];
    return entries
      .filter((e) => e.parent_id === group.id)
      .sort((a, b) => a.position - b.position)
      .map((e) => ({ id: e.id, name: e.name }));
  };
  return {
    types: childrenOf(MECHANICS_CREATURE_TYPE_GROUP),
    alignments: childrenOf(MECHANICS_ALIGNMENT_GROUP).map((o) => o.name),
  };
}

// Standalone profile page for a Бестиарий compendium entry (a global monster
// template — not tied to any setting/location/faction, unlike a setting's
// own Being instances). Deliberately a smaller tab set than BeingDetailPage:
// Места обитания/Галерея don't fit here (no vault folder, no setting scope
// to be "in") — those stay properties of the setting-specific being, not the
// template it was created from. «Отношения» тоже нет: у шаблона системы
// связей с сущностями сеттинга не бывает, а если такое существо нужно с
// кем-то связать — связывают его версию в сеттинге.
export function MonsterDetailPage({
  entry,
  system,
  onChange,
}: {
  entry: CompendiumEntry;
  system: System | null;
  onChange: () => void;
}) {
  const entryId = entry.id;
  // Сохранённая ссылка на «Статблок» должна открывать «Статблоки», а не
  // молча падать на вкладку по умолчанию — здесь это одна и та же вкладка.
  const [tab, selectTab] = useTabState(TABS, "Статблоки", { Статблок: "Статблоки" });
  const [lists, setLists] = useState<{ types: MechanicsOption[]; alignments: string[] }>({
    types: [],
    alignments: [],
  });
  const [aliasDraft, setAliasDraft] = useState("");

  useEffect(() => {
    if (!system) return;
    loadCreatureLists(system.id).then(setLists);
  }, [system?.id]);

  async function saveDescription(value: string) {
    await api.put(`/systems/entries/${entryId}`, { description: value });
    onChange();
  }

  const creatureType = entry.data?.creature_type as MechanicsOption | undefined;
  const size = typeof entry.data.size === "string" ? entry.data.size : "";
  const ac = typeof entry.data.ac === "string" ? entry.data.ac : "";
  const hp = typeof entry.data.hp === "string" ? entry.data.hp : "";
  const speed = typeof entry.data.speed === "string" ? entry.data.speed : "";
  const alignment = typeof entry.data.alignment === "string" ? entry.data.alignment : "";
  const aliases = entry.aliases ?? [];
  const isPhb = system?.code === "phb";

  // Класс опасности в сводку не входит: он — механика конкретных правил и
  // живёт в статблоке и в фильтрах раздела. Сводка — лор существа, то, что
  // переживает перекладывание на другую систему.
  // П1.3 — Размер — механика D&D, у LitM его нет: не показываем поле вовсе, а не «пусто».
  const fields: EntityField[] = [
    { key: "name", label: "Имя", value: entry.name, required: true },
    { key: "name_original", label: "Оригинальное название", value: entry.name_original ?? "" },
    {
      key: "short_name",
      label: "Короткое имя для карты",
      value: entry.short_name ?? "",
      title: "Показывается вместо полного имени в подписи пина, если запись поставили на карту локации",
    },
    {
      key: "creature_type",
      label: "Тип существа",
      value: creatureType?.name ?? "",
      options: [
        { value: "", label: "—" },
        ...lists.types.map((t) => ({ value: t.name, label: t.name })),
      ],
    },
    ...(isPhb
      ? [
          {
            key: "size",
            label: "Размер",
            value: size,
            options: [{ value: "", label: "—" }, ...CREATURE_SIZES.map((s) => ({ value: s, label: s }))],
          } as EntityField,
          { key: "ac", label: "КД", value: ac } as EntityField,
          { key: "hp", label: "Хиты", value: hp } as EntityField,
          { key: "speed", label: "Скорость", value: speed } as EntityField,
        ]
      : []),
    {
      key: "alignment",
      label: "Мировоззрение",
      value: alignment,
      suggestions: lists.alignments,
    },
  ];

  async function saveSummary(values: Record<string, string>) {
    const nextAliases = aliasDraft
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const type = lists.types.find((t) => t.name === values.creature_type);
    const data: Record<string, unknown> = { ...entry.data };
    if (values.size) data.size = values.size;
    else delete data.size;
    if ((values.ac ?? "").trim()) data.ac = values.ac.trim();
    else delete data.ac;
    if ((values.hp ?? "").trim()) data.hp = values.hp.trim();
    else delete data.hp;
    if ((values.speed ?? "").trim()) data.speed = values.speed.trim();
    else delete data.speed;
    if (values.alignment.trim()) data.alignment = values.alignment.trim();
    else delete data.alignment;
    if (type) data.creature_type = type;
    // Тип, который после переименования в справочнике не резолвится в
    // механики, не стирается молча: он остаётся {name}-снапшотом, как тип
    // существа вне словаря, и продолжает попадать в фильтры и группы по
    // имени (та же философия, что у сводки бестиария).
    else if (values.creature_type.trim()) data.creature_type = { name: values.creature_type.trim() };
    else delete data.creature_type;
    // «[English]» в конце имени переносится в name_original (см. extractEnglishName):
    // оригинал не нужно заносить дважды, а имя перестаёт носить скобки на виду.
    const { name, en } = extractEnglishName(values.name.trim());
    await api.put(`/systems/entries/${entryId}`, {
      name,
      name_original: values.name_original.trim() || en,
      short_name: values.short_name.trim(),
      aliases: nextAliases,
      data,
    });
    onChange();
  }

  const chapters = entry.chapters ?? [];

  return (
    <div className="stack">
      <Breadcrumbs
        items={[
          { label: "Системы", to: "/systems" },
          ...(system ? [{ label: system.name, to: `/systems/${system.id}` }] : []),
          { label: entry.name },
        ]}
      />
      <div className="row" style={{ alignItems: "center", gap: 8 }}>
        <EntityTypeChip type="compendium_entry" />
        <h2 style={{ margin: 0 }}>{entry.name}</h2>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => selectTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Статблоки" && (
        <StatblockList
          ownerType="compendium_entry"
          ownerId={entryId}
          ownerName={entry.name}
          ownerCreatureType={creatureType?.name}
          ownerCreatureSize={size || undefined}
          ownerCreatureCR={typeof entry.data?.cr === "string" ? entry.data.cr : undefined}
          ownerCreatureAC={ac || undefined}
          ownerCreatureHP={hp || undefined}
          ownerCreatureSpeed={speed || undefined}
        />
      )}

      {tab === "Досье" && (
        <div className="stack">
          <EntityFieldsCard
            key={`summary-${entryId}`}
            title="Сводка"
            fields={fields}
            hideEmptyInView
            onEditStart={() => setAliasDraft(aliases.join(", "))}
            onSave={saveSummary}
            editExtras={
              <label className="stack editable-card-field">
                <span>Другие названия</span>
                <input
                  value={aliasDraft}
                  placeholder="через запятую"
                  onChange={(e) => setAliasDraft(e.target.value)}
                />
              </label>
            }
            viewExtras={
              aliases.length > 0 ? (
                <div className="entity-field-row">
                  <span className="muted">Другие названия</span>
                  <span>{aliases.join(", ")}</span>
                </div>
              ) : null
            }
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
          <details className="card">
            <summary className="sb-section" style={{ margin: 0 }}>
              История
            </summary>
            <ChapterList
              ownerId={entryId}
              ownerType="compendium_entry"
              apiBase="/systems/entries"
              section="history"
              chapters={chapters.filter((c) => c.section === "history")}
              onChange={onChange}
            />
          </details>
          <details className="card">
            <summary className="sb-section" style={{ margin: 0 }}>
              Поведение
            </summary>
            <ChapterList
              ownerId={entryId}
              ownerType="compendium_entry"
              apiBase="/systems/entries"
              section="behavior"
              chapters={chapters.filter((c) => c.section === "behavior")}
              onChange={onChange}
            />
          </details>
        </div>
      )}

      {tab === "Карточка существа" && (
        <CreatureCardEditor type="compendium_entry" id={entryId} onChange={onChange} />
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
