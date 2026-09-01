// «Другие названия» — синонимы имени сущности и её название в оригинале.
//
// Нужно там, где один и тот же район книги в разных переводах зовётся «Морской
// округ» и «Приморский район»: по этим полям его находит поиск и узнаёт импорт
// следующей книги, а склейка на экране импорта дописывает сюда новый вариант
// сама.

import { useState } from "react";

interface Props {
  /** С сервера может прийти и массивом, и JSON-строкой из базы. */
  aliases: string[] | string;
  nameOriginal: string;
  /** Подпись под заголовком: у личностей уместнее «Известен также как». */
  title?: string;
  /** Подсказка под заголовком — видна всегда, даже когда есть алиасы. */
  help?: string;
  onSave: (aliases: string[], nameOriginal: string) => Promise<void> | void;
}

function toList(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function AliasesCard({
  aliases: rawAliases,
  nameOriginal,
  title = "Другие названия",
  help,
  onSave,
}: Props) {
  const aliases = toList(rawAliases);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");

  function start() {
    setText(aliases.join(", "));
    setOriginal(nameOriginal);
    setEditing(true);
  }

  async function save() {
    const next = text
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    await onSave(next, original.trim());
    setEditing(false);
  }

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>{title}</h3>
        {!editing && <button onClick={start}>Редактировать</button>}
      </div>
      {help && <span className="muted">{help}</span>}

      {editing ? (
        <div className="stack">
          <label className="stack" style={{ gap: 4 }}>
            <span className="muted">Синонимы через запятую</span>
            <input value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span className="muted">Название в оригинале</span>
            <input
              value={original}
              onChange={(e) => setOriginal(e.target.value)}
              placeholder="Sea Ward"
            />
          </label>
          <div className="row">
            <button className="primary" onClick={() => void save()}>
              Сохранить
            </button>
            <button onClick={() => setEditing(false)}>Отмена</button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {aliases.map((alias) => (
            <span key={alias} className="badge tag">
              {alias}
            </span>
          ))}
          {nameOriginal && <span className="muted">в оригинале: {nameOriginal}</span>}
          {!aliases.length && !nameOriginal && (
            <span className="muted">
              Пусто. Здесь живут другие переводы и написания имени — по ним работает поиск и
              сверка при импорте книги.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
