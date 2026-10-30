import { useState } from "react";
import { useAction, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import type { Affect } from "../data/entities";
import { useImageCrop } from "../hooks/useImageCrop";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import type { LegacyWorldExplorationEntry, Player, WorldExplorationKind } from "../types";
import { useConfirm } from "../hooks/useConfirm";
import { TypeGlyph } from "./TypeGlyph";
import "./campaign/campaign-d.css";

const KIND_TABS: { kind: WorldExplorationKind; label: string; addLabel: string; extraLabel: string | null; glyph: string }[] = [
  { kind: "being", label: "Существа", addLabel: "+ Добавить существо", extraLabel: "Место обитания", glyph: "being" },
  { kind: "location", label: "Локации", addLabel: "+ Добавить локацию", extraLabel: "Обитатели", glyph: "location" },
  { kind: "item", label: "Предметы", addLabel: "+ Добавить предмет", extraLabel: null, glyph: "artifact" },
  { kind: "event", label: "События", addLabel: "+ Добавить событие", extraLabel: null, glyph: "setting_event" },
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

  // В «Д» — как «Путевые заметки» у Мастера (макет Party-Journals): виды
  // колонкой слева со знаком типа, записи строками справа.
  return (
    <div className="exploration">
      {confirmDialog}
      <div className="d-head">
        <div>
          <h2>Исследование мира</h2>
          <div className="d-head__sub">общая картотека партии</div>
        </div>
        <div className="d-head__acts">
          <button type="button" className="d-btn d-btn--primary" onClick={addEntry} disabled={!selfPlayerId}>
            {activeTab.addLabel}
          </button>
        </div>
      </div>
      <div className="campaign-journals">
        <nav className="campaign-col" aria-label="Разделы картотеки">
          <h3 className="d-plate">Разделы</h3>
          {KIND_TABS.map((t) => (
            <button key={t.kind} type="button" className={kind === t.kind ? "is-on" : ""} aria-pressed={kind === t.kind} onClick={() => setKind(t.kind)}>
              <TypeGlyph type={t.glyph} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <section>
          <div className="d-gh">
            <h3 className="d-plate">{activeTab.label}</h3>
            <span className="d-note">{entries.length}</span>
          </div>
          {entries.length === 0 ? (
            <p className="muted">Пока ничего не добавлено.</p>
          ) : (
            <ul className="exploration__list">
              {entries.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  glyph={activeTab.glyph}
                  extraLabel={activeTab.extraLabel}
                  expanded={expandedId === entry.id}
                  onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  campaignId={campaignId}
                  onRemove={() => removeEntry(entry.id)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function EntryCard({
  entry,
  glyph,
  extraLabel,
  expanded,
  onToggle,
  campaignId,
  onRemove,
}: {
  entry: LegacyWorldExplorationEntry;
  glyph: string;
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
    <li className={expanded ? "is-open" : ""}>
      <button type="button" className="exploration__head" aria-expanded={expanded} onClick={onToggle}>
        <span className="exploration__pic">
          {entry.avatar_image_url ? <img src={entry.avatar_image_url} alt="" /> : <TypeGlyph type={glyph} />}
        </span>
        <span className="exploration__name">
          <b>{entry.name || "Без имени"}</b>
          {!expanded && entry.description && <span>{entry.description}</span>}
        </span>
        {extraLabel && entry.extra_field && <span className="d-mono">{entry.extra_field}</span>}
      </button>

      {expanded && (
        <div className="exploration__form">
          <label className="avatar-upload-label exploration__photo" title={IMAGE_HINT}>
            {entry.avatar_image_url ? <img src={entry.avatar_image_url} alt="" /> : <TypeGlyph type={glyph} />}
            <span className="avatar-upload-hint">{uploading ? "Загрузка…" : "Сменить фото"}</span>
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => avatarCrop.onSelect(e.target.files?.[0] ?? null)}
            />
          </label>
          {avatarCrop.modal}
          <div className="exploration__fields">
            <label>
              <span className="d-mono">Имя</span>
              <input className="d-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} />
            </label>
            <label>
              <span className="d-mono">Описание</span>
              <textarea className="d-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={save} />
            </label>
            {extraLabel && (
              <label>
                <span className="d-mono">{extraLabel}</span>
                <input className="d-input" value={extraField} onChange={(e) => setExtraField(e.target.value)} onBlur={save} />
              </label>
            )}
            <div className="exploration__acts">
              {entry.player_name && <span className="d-note">добавил(а): {entry.player_name}</span>}
              <button type="button" className="d-btn d-btn--sm d-btn--quiet" onClick={onRemove}>
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

const NO_ENTRIES: LegacyWorldExplorationEntry[] = [];

/** Картотека кампании — все четыре подвкладки. */
function explorationAffects(campaignId: number): Affect[] {
  return [{ path: `/world-exploration-entries?campaign_id=${campaignId}` }];
}
