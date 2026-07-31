import { StatblockList } from "../components/StatblockList";
import { MentionsTab } from "../components/MentionsTab";
import { RelationsTab } from "../components/RelationsTab";
import { EditableTextCard } from "../components/EditableTextCard";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { useTabState } from "../hooks/useTabState";
import { api } from "../api/client";
import type { CompendiumEntry, System } from "../types";

const TABS = ["Статблок", "Досье", "Связи", "Упоминания"] as const;

// Standalone profile page for a Бестиарий compendium entry (a global monster
// template — not tied to any setting/location/faction, unlike a setting's
// own Being instances). Deliberately a smaller tab set than BeingDetailPage:
// Места обитания/Галерея don't fit here (no vault folder, no setting scope
// to be "in") — those stay properties of the setting-specific being, not the
// template it was created from.
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
  const [tab, selectTab] = useTabState(TABS, "Статблок");

  async function saveDescription(value: string) {
    await api.put(`/systems/entries/${entryId}`, { description: value });
    onChange();
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

      {tab === "Статблок" && (
        <StatblockList
          ownerType="compendium_entry"
          ownerId={entryId}
          ownerName={entry.name}
          ownerCreatureType={typeof entry.data.creatureType === "string" ? entry.data.creatureType : undefined}
          ownerCreatureSize={typeof entry.data.size === "string" ? entry.data.size : undefined}
        />
      )}

      {tab === "Досье" && (
        <EditableTextCard title="Описание" value={entry.description} onSave={saveDescription} rows={6} />
      )}

      {tab === "Связи" && (
        <RelationsTab entityType="compendium_entry" entityId={entryId} entityName={entry.name} />
      )}

      {tab === "Упоминания" && <MentionsTab entityType="compendium_entry" entityId={entryId} />}
    </div>
  );
}
