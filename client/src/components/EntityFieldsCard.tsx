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
  pattern?: string;
  // Если задано — select вместо однострочного поля.
  options?: { value: string; label: string }[];
  // Если задано — обычное поле с подсказками: значение остаётся свободным
  // текстом, но совпадения подставляются из справочника (мировоззрение
  // существа книга пишет условиями — «любое не-доброе», — и загонять их в
  // жёсткий список нельзя).
  suggestions?: string[];
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
            <>
              <input
                value={values[f.key] ?? ""}
                placeholder={f.placeholder}
                pattern={f.pattern}
                list={f.suggestions?.length ? `field-suggestions-${f.key}` : undefined}
                onChange={(e) => onChange(f.key, e.target.value)}
              />
              {f.suggestions?.length ? (
                <datalist id={`field-suggestions-${f.key}`}>
                  {f.suggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              ) : null}
            </>
          )}
          {f.title && <span className="muted" style={{ fontSize: "var(--fs-micro)", lineHeight: "1.3" }}>{f.title}</span>}
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
  viewExtras,
  onEditStart,
  hideEmptyInView = false,
}: {
  title?: string;
  fields: EntityField[];
  onSave: (values: EntityFieldValues) => Promise<unknown>;
  // Разметка, которая правится вместе с полями (у существа — сообщества).
  editExtras?: ReactNode;
  // Разметка, которая только показывается (у существа бестиария — синонимы).
  viewExtras?: ReactNode;
  // Дать странице переинициализировать черновики своих editExtras.
  onEditStart?: () => void;
  // Прочерк вместо значения обещает механику, которой в системе может не
  // быть вовсе: размера и класса опасности нет ни у одного существа Legend
  // in the Mist. Там, где набор полей общий на все системы, незаполненное
  // честнее не показывать.
  hideEmptyInView?: boolean;
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
          {(hideEmptyInView ? fields.filter((f) => f.value.trim()) : fields).map((f) => (
            <div key={f.key} className="entity-field-row">
              <span className="muted">{f.label}</span>
              <span>
                {(f.options ? f.options.find((o) => o.value === f.value)?.label : f.value) || (
                  <span className="muted">—</span>
                )}
              </span>
            </div>
          ))}
          {viewExtras}
          <button onClick={startEdit} style={{ alignSelf: "flex-start" }}>
            Редактировать
          </button>
        </>
      )}
    </div>
  );
}
