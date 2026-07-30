import { useState, type ReactNode } from "react";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";

interface Props {
  title: string;
  help?: string;
  value: string;
  onSave: (value: string) => Promise<unknown>;
  rows?: number;
  // When provided, enables @-mention autocomplete and keeps the link graph
  // in sync with mentions typed into this field.
  entityType?: string;
  entityId?: number;
  // Forwarded to MentionTextarea — preselects "Сеттинг" in the @-mention
  // modal's "Создать новую сущность" flow when this card's own context has
  // an obvious one (a location/being/community/setting page).
  defaultSettingId?: number;
  // Renders the card as a <details> disclosure instead of an always-open
  // div, and allows nesting extra content (e.g. a subsection) below the
  // text field/button. Off by default so existing call sites are unchanged.
  collapsible?: boolean;
  defaultOpen?: boolean;
  children?: ReactNode;
}

export function EditableTextCard({
  title,
  help,
  value,
  onSave,
  rows = 5,
  entityType,
  entityId,
  defaultSettingId,
  collapsible,
  defaultOpen = false,
  children,
}: Props) {
  const [editMode, setEditMode] = useState(() => !value);
  const [draft, setDraft] = useState(value);

  async function handleSave() {
    await onSave(draft);
    if (entityType && entityId) {
      syncMentionLinks(entityType, entityId, value, draft);
    }
    setEditMode(false);
  }

  const body = (
    <>
      {help && <span className="muted">{help}</span>}
      {editMode ? (
        <>
          {entityType && entityId ? (
            <MentionTextarea value={draft} onChange={setDraft} rows={rows} defaultSettingId={defaultSettingId} />
          ) : (
            <textarea rows={rows} value={draft} onChange={(e) => setDraft(e.target.value)} />
          )}
          <div className="row">
            <button className="primary" onClick={handleSave}>
              Сохранить
            </button>
            <button onClick={() => setEditMode(false)}>Отмена</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ whiteSpace: "pre-wrap" }}>
            {value ? <MentionText text={value} /> : <span className="muted">Пусто</span>}
          </div>
          <button onClick={() => setEditMode(true)} style={{ alignSelf: "flex-start" }}>
            Редактировать
          </button>
        </>
      )}
      {children}
    </>
  );

  if (collapsible) {
    return (
      <details className="card stack" open={defaultOpen}>
        <summary>
          <strong className="entry-title">{title}</strong>
        </summary>
        {body}
      </details>
    );
  }

  return (
    <div className="card stack">
      <h3>{title}</h3>
      {body}
    </div>
  );
}
