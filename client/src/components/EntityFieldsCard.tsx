import { useState, type ReactNode } from "react";

// Поля профиля, которые раньше правились кнопкой «Редактировать» в шапке
// сущности: имя и то, что стоит рядом с ним (тип локации, категория
// существа, короткое имя для карты). Теперь они живут в теле профиля —
// либо отдельной карточкой (EntityFieldsCard), либо вместе с описанием
// (см. EditableTextCard, у него те же поля через проп fields).
export interface EntityField {
  key: string;
  label: string;
  value: string;
  // Пустым не сохраняем (имя): иначе сущность останется без заголовка.
  required?: boolean;
  placeholder?: string;
  title?: string;
  // Если задано — select вместо однострочного поля.
  options?: { value: string; label: string }[];
}

export type EntityFieldValues = Record<string, string>;

export function toFieldValues(fields: EntityField[]): EntityFieldValues {
  return Object.fromEntries(fields.map((f) => [f.key, f.value]));
}

export function hasEmptyRequired(fields: EntityField[], values: EntityFieldValues): boolean {
  return fields.some((f) => f.required && !(values[f.key] ?? "").trim());
}

export function EntityFieldInputs({
  fields,
  values,
  onChange,
}: {
  fields: EntityField[];
  values: EntityFieldValues;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <>
      {fields.map((f) => (
        <label key={f.key} className="stack editable-card-field" title={f.title}>
          <span>{f.label}</span>
          {f.options ? (
            <select value={values[f.key] ?? ""} onChange={(e) => onChange(f.key, e.target.value)}>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={values[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          )}
        </label>
      ))}
    </>
  );
}

// Карточка «Основное» для профилей, у которых нет карточки описания, куда
// эти поля можно было бы подселить.
export function EntityFieldsCard({
  title = "Основное",
  fields,
  onSave,
  editExtras,
  onEditStart,
}: {
  title?: string;
  fields: EntityField[];
  onSave: (values: EntityFieldValues) => Promise<unknown>;
  // Разметка, которая правится вместе с полями (у существа — сообщества).
  editExtras?: ReactNode;
  // Дать странице переинициализировать черновики своих editExtras.
  onEditStart?: () => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [values, setValues] = useState<EntityFieldValues>(() => toFieldValues(fields));

  function startEdit() {
    setValues(toFieldValues(fields));
    onEditStart?.();
    setEditMode(true);
  }

  async function save() {
    if (hasEmptyRequired(fields, values)) return;
    await onSave(values);
    setEditMode(false);
  }

  return (
    <div className="card stack">
      <h3>{title}</h3>
      {editMode ? (
        <>
          <EntityFieldInputs
            fields={fields}
            values={values}
            onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
          />
          {editExtras}
          <div className="row">
            <button className="primary" onClick={save}>
              Сохранить
            </button>
            <button
              onClick={() => {
                setValues(toFieldValues(fields));
                setEditMode(false);
              }}
            >
              Отмена
            </button>
          </div>
        </>
      ) : (
        <>
          {fields.map((f) => (
            <div key={f.key} className="entity-field-row">
              <span className="muted">{f.label}</span>
              <span>
                {(f.options ? f.options.find((o) => o.value === f.value)?.label : f.value) || (
                  <span className="muted">—</span>
                )}
              </span>
            </div>
          ))}
          <button onClick={startEdit} style={{ alignSelf: "flex-start" }}>
            Редактировать
          </button>
        </>
      )}
    </div>
  );
}
