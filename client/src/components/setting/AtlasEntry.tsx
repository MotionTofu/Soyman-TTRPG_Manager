import { useId, useState, type ReactNode } from "react";
import { ATLAS_CONTEXT_FIELDS, ATLAS_STATUS_OPTIONS, atlasStatusLabel, STRICTNESS_OPTIONS, strictnessLabel, type EntryField, type EntryType } from "../../settingWorld";
import type { SettingEntry } from "../../types";
import { MentionText } from "../mentions/MentionText";
import { MentionTextarea } from "../mentions/MentionTextarea";

type AtlasType = EntryType & { atlas: NonNullable<EntryType["atlas"]> };
export type AtlasDraft = Pick<SettingEntry, "title" | "content" | "fields"> & {
  related_entry_ids: number[];
  visible_to_players: boolean;
};

const STATUS_FIELD = { key: "status", label: "Степень установления" };
const atlasContext = (type: AtlasType) => type.atlas.context ?? ATLAS_CONTEXT_FIELDS;

function fieldValue(field: EntryField, raw: string | undefined) {
  if (field.key === "status") return atlasStatusLabel(raw);
  if (field.key === "strictness") return strictnessLabel(raw);
  return raw ?? "";
}

function FieldValues({ fields, values }: { fields: EntryField[]; values: Record<string, string> }) {
  const filled = fields.filter((field) => fieldValue(field, values[field.key]).trim());
  return filled.length ? (
    <dl>
      {filled.map((field) => (
        <div key={field.key}>
          <dt>{field.label}</dt>
          <dd><MentionText text={fieldValue(field, values[field.key])} /></dd>
        </div>
      ))}
    </dl>
  ) : <p className="muted">Пока пусто.</p>;
}

function AtlasDisclosure({ label, children }: { label: string; children: ReactNode }) {
  return <details className="set-atlas__details"><summary>{label}</summary>{children}</details>;
}

function previousFields(type: AtlasType, entry: SettingEntry | undefined) {
  const context = atlasContext(type);
  return type.fields.filter(
    (field) => entry?.fields[field.key]?.trim() &&
      !context.some(({ key }) => key === field.key) &&
      !type.atlas.details.some(({ key }) => key === field.key),
  );
}

export function AtlasEntryEditor({
  type, entry, settingId, peers, onSave, onCancel,
}: {
  type: AtlasType;
  entry?: SettingEntry;
  settingId: number;
  peers: SettingEntry[];
  onSave: (draft: AtlasDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const labelId = useId();
  const [draft, setDraft] = useState<AtlasDraft>(() => ({
    title: entry?.title ?? "",
    content: entry?.content ?? "",
    fields: { ...entry?.fields },
    related_entry_ids: entry?.related_entry_ids ?? [],
    visible_to_players: !!entry?.visible_to_players,
  }));
  const [saving, setSaving] = useState(false);
  const previous = previousFields(type, entry);

  function setField(key: string, value: string) {
    setDraft((current) => ({ ...current, fields: { ...current.fields, [key]: value } }));
  }

  function editFields(fields: EntryField[], compact = false) {
    return (
      <div className={compact ? "set-atlas__fields" : "setting-world__form"}>
        {fields.map(({ key, label }) => (
          <label key={key} htmlFor={labelId + key}>
            <span className="paper-label">{label}</span>
            {key === "strictness" ? (
              <select id={labelId + key} value={draft.fields[key] ?? ""} onChange={(event) => setField(key, event.target.value)}>
                <option value="">Не указана</option>
                {STRICTNESS_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            ) : (
              <MentionTextarea id={labelId + key} value={draft.fields[key] ?? ""} onChange={(value) => setField(key, value)} rows={2} defaultSettingId={settingId} />
            )}
          </label>
        ))}
      </div>
    );
  }

  return (
    <form className="set-open setting-world__form" onSubmit={async (event) => {
      event.preventDefault();
      const title = draft.title.trim() || entry?.title || "";
      if (saving || (!entry && !title)) return;
      setSaving(true);
      try {
        await onSave({ ...draft, title });
      } finally {
        setSaving(false);
      }
    }}>
      <label>
        <span className="paper-label">Название</span>
        <input required={!entry} value={draft.title} onChange={(event) => {
          const title = event.target.value;
          setDraft((current) => ({ ...current, title }));
        }} />
      </label>
      <label htmlFor={labelId + "content"}>
        <span className="paper-label">{type.key === "diegetic_doc" ? "Текст документа" : "Описание"}</span>
        <MentionTextarea id={labelId + "content"} value={draft.content} onChange={(content) => setDraft((current) => ({ ...current, content }))} rows={3} defaultSettingId={settingId} />
      </label>
      <AtlasDisclosure label="Контекст записи">
        <div className="setting-world__form">
          <label>
            <span className="paper-label">{STATUS_FIELD.label}</span>
            <select value={draft.fields.status ?? ""} onChange={(event) => setField("status", event.target.value)}>
              <option value="">Не указан</option>
              {ATLAS_STATUS_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {editFields(atlasContext(type), true)}
          {peers.length > 0 && (
            <fieldset className="set-atlas__links">
              <legend className="paper-label">Связанные записи</legend>
              {peers.map((peer) => (
                <label key={peer.id} className="setting-world__toggle">
                  <input
                    type="checkbox"
                    checked={draft.related_entry_ids.includes(peer.id)}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setDraft((current) => ({
                        ...current,
                        related_entry_ids: checked
                          ? [...current.related_entry_ids, peer.id]
                          : current.related_entry_ids.filter((id) => id !== peer.id),
                      }));
                    }}
                  />
                  {peer.title || "Без названия"}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      </AtlasDisclosure>
      <AtlasDisclosure label="Подробности">{editFields(type.atlas.details)}</AtlasDisclosure>
      {previous.length > 0 && <AtlasDisclosure label="Поля прежней анкеты">{editFields(previous)}</AtlasDisclosure>}
      {type.key === "activity" && (
        <label className="setting-world__toggle">
          <input
            type="checkbox"
            checked={draft.fields.promised === "1"}
            onChange={(event) => setField("promised", event.target.checked ? "1" : "")}
          />
          Показывать в паспорте сеттинга
        </label>
      )}
      <label className="setting-world__toggle">
        <input
          type="checkbox"
          checked={draft.visible_to_players}
          onChange={(event) => {
            const visible_to_players = event.target.checked;
            setDraft((current) => ({ ...current, visible_to_players }));
          }}
        />
        Показать запись игрокам
      </label>
      <div className="row">
        <button type="submit" className="d-btn d-btn--sm" disabled={saving || (!entry && !draft.title.trim())}>Сохранить</button>
        <button type="button" className="d-btn d-btn--sm d-btn--quiet" onClick={onCancel} disabled={saving}>Отмена</button>
      </div>
    </form>
  );
}

export function AtlasEntryRead({
  type, entry, peers, onJump, onEdit,
}: {
  type: AtlasType;
  entry: SettingEntry;
  peers: SettingEntry[];
  onJump: (entry: SettingEntry) => void;
  onEdit: () => void;
}) {
  const previous = previousFields(type, entry);
  const linked = peers.filter((peer) => entry.related_entry_ids?.includes(peer.id));
  return (
    <div className="set-open set-atlas__read">
      {entry.content.trim() && <div className="set-atlas__content"><MentionText text={entry.content} /></div>}
      {type.key === "activity" && entry.fields.promised === "1" && <p className="d-note">Входит в обещание сеттинга</p>}
      {linked.length > 0 && (
        <div className="set-atlas__related">
          <span className="set-atlas__related-label">Связи</span>
          {linked.map((peer) => (
            <button key={peer.id} type="button" className="set-atlas__related-link" onClick={() => onJump(peer)}>
              {peer.title || "Без названия"}
            </button>
          ))}
        </div>
      )}
      <AtlasDisclosure label="Контекст записи"><FieldValues fields={[STATUS_FIELD, ...atlasContext(type)]} values={entry.fields} /></AtlasDisclosure>
      <AtlasDisclosure label="Подробности"><FieldValues fields={type.atlas.details} values={entry.fields} /></AtlasDisclosure>
      {previous.length > 0 && (
        <AtlasDisclosure label="Поля прежней анкеты"><FieldValues fields={previous} values={entry.fields} /></AtlasDisclosure>
      )}
      <div className="set-open__ft">
        <button type="button" className="d-btn d-btn--sm" onClick={onEdit}>Править</button>
        <span className="d-note">{entry.visible_to_players ? "Видно игрокам" : "Только Мастеру"}</span>
      </div>
    </div>
  );
}
