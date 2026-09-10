import { useEffect, useState, type ReactNode } from "react";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { clearFieldDraft, loadFieldDraft, saveFieldDraft } from "../fieldDrafts";
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
  // Второе действие рядом с «Сохранить»: получает набранный текст и делает с
  // ним что-то ещё («сохранить и завершить сессию»). Отдельной кнопкой снаружи
  // это не сделать — черновик живёт внутри карточки, и кнопка под ней
  // сохранила бы прошлую версию текста.
  extraAction?: { label: string; onAct: (draft: string) => Promise<unknown> };
  inlineFooter?: ReactNode;
  // Ключ черновика. Задан — набранное переживает уход со страницы, закрытую
  // вкладку и перезагрузку: оно пишется в localStorage на каждое нажатие и
  // подхватывается при возврате. Включается там, где пишут посреди игры
  // (поля пульта), а не во всём приложении: иначе в хранилище копился бы
  // мусор по каждой сущности сеттинга.
  draftKey?: string;
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
  extraAction,
  inlineFooter,
  draftKey,
}: Props) {
  // Черновик, оставшийся с прошлого захода: он и открывает карточку в правке,
  // иначе набранный текст лежал бы невидимым под кнопкой «Редактировать».
  const [restored] = useState<string | null>(() => {
    if (!draftKey) return null;
    const stored = loadFieldDraft(draftKey);
    return stored != null && stored !== value ? stored : null;
  });
  const [draftRestored, setDraftRestored] = useState(restored != null);
  const [editMode, setEditMode] = useState(() => restored != null || !value);
  const [draftText, setDraftText] = useState(restored ?? value);
  const draft = draftText;

  // Единственная точка записи черновика: и ввод, и «Отмена», и открытие
  // правки идут через неё, поэтому хранилище не расходится с полем.
  function setDraft(next: string) {
    setDraftText(next);
    if (!draftKey) return;
    if (next === value) clearFieldDraft(draftKey);
    else saveFieldDraft(draftKey, next);
  }
  const [fieldValues, setFieldValues] = useState<EntityFieldValues>(() =>
    toFieldValues(fields ?? [])
  );
  const [expandedText, setExpandedText] = useState(false);

  // U-P2-3: Ctrl+S в режиме правки — как в Notion/Obsidian
  useEffect(() => {
    if (!editMode) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });

  function startEdit() {
    setDraftRestored(false);
    setDraft(value);
    setFieldValues(toFieldValues(fields ?? []));
    setEditMode(true);
  }

  function cancelEdit() {
    setDraftRestored(false);
    if (draftKey) clearFieldDraft(draftKey);
    setDraft(value);
    setFieldValues(toFieldValues(fields ?? []));
    setEditMode(false);
  }

  async function handleExtra() {
    if (!extraAction) return;
    await onSave(draft);
    if (entityType && entityId) syncMentionLinks(entityType, entityId, value, draft);
    await extraAction.onAct(draft);
    if (draftKey) clearFieldDraft(draftKey);
    setDraftRestored(false);
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
    if (draftKey) clearFieldDraft(draftKey);
    setDraftRestored(false);
    setEditMode(false);
  }

  const body = (
    <>
      {help && <span className="muted">{help}</span>}
      {draftRestored && editMode && (
        <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
          Черновик восстановлен — он не сохранён, пока не нажать «Сохранить».
        </span>
      )}
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
            {extraAction && (
              <>
                <span style={{ flex: 1 }} />
                <button onClick={handleExtra}>{extraAction.label}</button>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          {(() => {
            const isLong = value.length > 600 || value.split("\n").length > 8;
            const clampClass = isLong && !expandedText ? "editable-clamp" : "";
            return (
              <>
                <div className={clampClass} style={{ whiteSpace: "pre-wrap" }}>
                  {value ? <MentionText text={value} /> : <span className="muted">Пусто</span>}
                </div>
                {isLong && (
                  <button
                    type="button"
                    className="editable-clamp-toggle"
                    onClick={() => setExpandedText((v) => !v)}
                  >
                    {expandedText ? "Свернуть" : "Показать полностью"}
                  </button>
                )}
              </>
            );
          })()}
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <div className="row">
              <button onClick={startEdit}>Редактировать</button>
              {extraAction && (
                <>
                  <span style={{ flex: 1 }} />
                  <button onClick={() => extraAction.onAct(value)}>{extraAction.label}</button>
                </>
              )}
            </div>
            {inlineFooter && <div style={{ display: "flex", alignItems: "center" }}>{inlineFooter}</div>}
          </div>
        </>
      )}
      {children}
    </>
  );

  if (collapsible) {
    return (
      <details className="card" open={defaultOpen || draftRestored}>
        <summary className="campaign-overview-header">{title}</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          {body}
        </div>
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
