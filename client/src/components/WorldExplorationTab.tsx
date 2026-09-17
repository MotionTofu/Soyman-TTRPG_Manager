import { useState } from "react";
import { useAction, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import type { Affect } from "../data/entities";
import { useImageCrop } from "../hooks/useImageCrop";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import type { LegacyWorldExplorationEntry, Player, WorldExplorationKind } from "../types";
import { useConfirm } from "../hooks/useConfirm";

const KIND_TABS: { kind: WorldExplorationKind; label: string; addLabel: string; extraLabel: string | null }[] = [
  { kind: "being", label: "Существа", addLabel: "+ Добавить существо", extraLabel: "Место обитания" },
  { kind: "location", label: "Локации", addLabel: "+ Добавить локацию", extraLabel: "Обитатели" },
  { kind: "item", label: "Предметы", addLabel: "+ Добавить предмет", extraLabel: null },
  { kind: "event", label: "События", addLabel: "+ Добавить событие", extraLabel: null },
];

interface Props {
  campaignId: number;
}

// Старая картотека «Исследование Мира»: общая на всю партию, четыре подвкладки
// по типам. Живёт ТОЛЬКО в кампаниях, где владелец сам играет
// (`campaigns.role = 'player'`) — сервер это и проверяет
// (routes/worldExplorationEntries.ts). В кампаниях, которые владелец водит, те
// же строки принадлежат игрокам как личные путевые заметки, и мастеру не
// показываются вовсе: components/player/CharacterJournal.tsx.
export function WorldExplorationTab({ campaignId }: Props) {
  const [confirmDialog, confirm] = useConfirm();
  const [kind, setKind] = useState<WorldExplorationKind>("being");
  const run = useAction();
  const entries =
    useResource<LegacyWorldExplorationEntry[]>(`/world-exploration-entries?campaign_id=${campaignId}&kind=${kind}`).data ?? NO_ENTRIES;
  const selfPlayerId = useResource<Player>("/players/self").data?.id ?? null;
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const affects = explorationAffects(campaignId);

  async function addEntry() {
    if (!selfPlayerId) return;
    const created = await run(
      labelled("Новая запись", () =>
        write.post<LegacyWorldExplorationEntry>("/world-exploration-entries", {
          campaign_id: campaignId,
          player_id: selfPlayerId,
          kind,
          name: "",
        })
      ),
      { affects, retry: false }
    );
    if (created) setExpandedId(created.id);
  }

  async function removeEntry(id: number) {
    if (!(await confirm({ message: "Удалить запись?", confirmLabel: "Удалить", danger: true })))
      return;
    const done = await run(labelled("Удаление записи", () => write.del(`/world-exploration-entries/${id}`).then(() => true)), { affects });
    if (done && expandedId === id) setExpandedId(null);
  }

  const activeTab = KIND_TABS.find((t) => t.kind === kind)!;

  return (
    <div className="stack">
      {confirmDialog}
      <div className="tabs">
        {KIND_TABS.map((t) => (
          <button key={t.kind} className={kind === t.kind ? "active" : ""} onClick={() => setKind(t.kind)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid-cards">
        {entries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            extraLabel={activeTab.extraLabel}
            expanded={expandedId === entry.id}
            onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
            campaignId={campaignId}
            onRemove={() => removeEntry(entry.id)}
          />
        ))}
      </div>
      {entries.length === 0 && <p className="muted">Пока ничего не добавлено.</p>}

      <button onClick={addEntry} style={{ alignSelf: "flex-start" }} disabled={!selfPlayerId}>
        {activeTab.addLabel}
      </button>
    </div>
  );
}

function EntryCard({
  entry,
  extraLabel,
  expanded,
  onToggle,
  campaignId,
  onRemove,
}: {
  entry: LegacyWorldExplorationEntry;
  extraLabel: string | null;
  expanded: boolean;
  onToggle: () => void;
  campaignId: number;
  onRemove: () => void;
}) {
  const run = useAction();
  const [name, setName] = useState(entry.name);
  const [description, setDescription] = useState(entry.description);
  const [extraField, setExtraField] = useState(entry.extra_field);
  const [uploading, setUploading] = useState(false);

  // Сохраняется по уходу с поля; при отказе набранное остаётся в поле и
  // появляется плашка — раньше отказ уходил в никуда.
  async function save() {
    if (name === entry.name && description === entry.description && extraField === entry.extra_field) return;
    await run(
      labelled("Запись картотеки", () =>
        write.put(`/world-exploration-entries/${entry.id}`, { name, description, extra_field: extraField })
      ),
      { affects: explorationAffects(campaignId) }
    );
  }

  async function handleAvatarChange(file: File | null) {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      await run(
        labelled("Фото записи", () => write.post(`/world-exploration-entries/${entry.id}/avatar`, form, { timeoutMs: 120_000 })),
        { affects: explorationAffects(campaignId) }
      );
    } finally {
      setUploading(false);
    }
  }
  const avatarCrop = useImageCrop("square", handleAvatarChange);

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between", cursor: "pointer" }} onClick={onToggle}>
        <div className="row">
          {entry.avatar_image_url ? (
            <img src={entry.avatar_image_url} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} />
          ) : (
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--bg-elevated)" }} />
          )}
          <strong>{entry.name || "Без имени"}</strong>
        </div>
        <span className="muted">{expanded ? "▾" : "▸"}</span>
      </div>

      {expanded && (
        <div className="stack" onClick={(e) => e.stopPropagation()}>
          <label className="avatar-upload-label" title={IMAGE_HINT} style={{ alignSelf: "flex-start" }}>
            {entry.avatar_image_url ? (
              <img src={entry.avatar_image_url} alt="" style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover" }} />
            ) : (
              <div style={{ width: 80, height: 80, borderRadius: "50%", background: "var(--bg-elevated)" }} />
            )}
            <span className="avatar-upload-hint">{uploading ? "Загрузка…" : "Сменить фото"}</span>
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => avatarCrop.onSelect(e.target.files?.[0] ?? null)}
            />
          </label>
          {avatarCrop.modal}

          <label>
            Имя
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={save} />
          </label>
          <label>
            Описание
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={save} />
          </label>
          {extraLabel && (
            <label>
              {extraLabel}
              <input value={extraField} onChange={(e) => setExtraField(e.target.value)} onBlur={save} />
            </label>
          )}
          {entry.player_name && <span className="muted">Добавил(а): {entry.player_name}</span>}
          <button className="danger" onClick={onRemove} style={{ alignSelf: "flex-start" }}>
            Удалить
          </button>
        </div>
      )}
    </div>
  );
}

const NO_ENTRIES: LegacyWorldExplorationEntry[] = [];

/** Картотека кампании — все четыре подвкладки. */
function explorationAffects(campaignId: number): Affect[] {
  return [{ path: `/world-exploration-entries?campaign_id=${campaignId}` }];
}
