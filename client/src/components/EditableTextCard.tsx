import { useState, type ReactNode } from "react";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import {
  EntityFieldInputs,
  hasEmptyRequired,
  toFieldValues,
  type EntityField,
  type EntityFieldValues,
} from "./EntityFieldsCard";

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
  // Поля профиля (имя и то, что стояло рядом с ним в шапке), которые правятся
  // вместе с текстом: показываются над textarea в режиме правки и уезжают тем
  // же «Сохранить». Так имени не нужна отдельная кнопка в шапке профиля.
  fields?: EntityField[];
  onSaveFields?: (values: EntityFieldValues) => Promise<unknown>;
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
  fields,
  onSaveFields,
}: Props) {
  const [editMode, setEditMode] = useState(() => !value);
  const [draft, setDraft] = useState(value);
  const [fieldValues, setFieldValues] = useState<EntityFieldValues>(() =>
    toFieldValues(fields ?? [])
  );

  function startEdit() {
    setDraft(value);
    setFieldValues(toFieldValues(fields ?? []));
    setEditMode(true);
  }

  function cancelEdit() {
    setDraft(value);
    setFieldValues(toFieldValues(fields ?? []));
    setEditMode(false);
  }

  async function handleSave() {
    if (fields && onSaveFields) {
      // Пустое имя молча не сохраняем — иначе сущность потеряет заголовок.
      if (hasEmptyRequired(fields, fieldValues)) return;
      await onSaveFields(fieldValues);
    }
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
          {fields && fields.length > 0 && (
            <EntityFieldInputs
              fields={fields}
              values={fieldValues}
              onChange={(key, v) => setFieldValues((prev) => ({ ...prev, [key]: v }))}
            />
          )}
          {/* Подпись у текста нужна только когда над ним есть другие поля —
              иначе заголовок карточки её уже дал. */}
          {fields && fields.length > 0 && <span className="editable-card-field-label">{title}</span>}
          {entityType && entityId ? (
            <MentionTextarea value={draft} onChange={setDraft} rows={rows} defaultSettingId={defaultSettingId} />
          ) : (
            <textarea rows={rows} value={draft} onChange={(e) => setDraft(e.target.value)} />
          )}
          <div className="row">
            <button className="primary" onClick={handleSave}>
              Сохранить
            </button>
            <button onClick={cancelEdit}>Отмена</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ whiteSpace: "pre-wrap" }}>
            {value ? <MentionText text={value} /> : <span className="muted">Пусто</span>}
          </div>
          <button onClick={startEdit} style={{ alignSelf: "flex-start" }}>
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
