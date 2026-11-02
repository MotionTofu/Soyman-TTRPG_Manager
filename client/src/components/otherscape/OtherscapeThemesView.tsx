import { useMemo } from "react";
import { Link } from "react-router-dom";
import { searchableText } from "../../compendium";
import { addToBag } from "../../bag";
import { MentionText } from "../mentions/MentionText";
import type { CompendiumEntry } from "../../types";
import { groupLead, parseThemebook } from "./themebookPresentation";
import "./otherscape-views.css";

function kitWord(n: number): string {
  const tail = n % 100;
  if (tail >= 11 && tail <= 14) return "наборов";
  if (n % 10 === 1) return "набор";
  if (n % 10 >= 2 && n % 10 <= 4) return "набора";
  return "наборов";
}

/** «Темы персонажа» Otherscape — макет «Д» Roll-OS-Themes: три колонки
 *  типов силы со списком книг тем, ниже главный блок выбранной книги. */
export function OtherscapeThemesView({ entries, query, grouping = "might", selectedId, onSelect }: {
  entries: CompendiumEntry[];
  query: string;
  grouping?: "might" | "alpha";
  selectedId: number | undefined;
  onSelect: (id: number) => void;
}) {
  const children = useMemo(() => {
    const map = new Map<number | null, CompendiumEntry[]>();
    for (const e of entries) {
      const list = map.get(e.parent_id) ?? [];
      list.push(e);
      map.set(e.parent_id, list);
    }
    return map;
  }, [entries]);
  const needle = query.trim().toLocaleLowerCase("ru");
  const matches = (book: CompendiumEntry) => {
    if (!needle) return true;
    const pending = [book];
    const seen = new Set<number>();
    while (pending.length) {
      const entry = pending.pop()!;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      if (`${searchableText(entry)} ${(entry.description ?? "").toLocaleLowerCase("ru")}`.includes(needle)) return true;
      pending.push(...(children.get(entry.id) ?? []));
    }
    return false;
  };
  const groups = (children.get(null) ?? []).map((group) => ({
    group,
    books: (children.get(group.id) ?? []).filter(matches),
  }));
  const allBooks = groups.flatMap((g) => g.books);
  const columns = grouping === "alpha"
    ? [{ group: null, books: [...allBooks].sort((a, b) => a.name.localeCompare(b.name, "ru")) }]
    : groups;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  // Возврат из части книги в Каталог сохраняет ту же книгу.
  const book = allBooks.find((b) => {
    let current = selectedId === undefined ? undefined : byId.get(selectedId);
    const seen = new Set<number>();
    while (current && !seen.has(current.id)) {
      if (current.id === b.id) return true;
      seen.add(current.id);
      current = current.parent_id === null ? undefined : byId.get(current.parent_id);
    }
    return false;
  }) ?? allBooks[0];
  const bookGroup = book && groups.find((g) => g.group.id === book.parent_id)?.group;
  const kits = (b: CompendiumEntry) => {
    const kitGroup = (children.get(b.id) ?? []).find((c) => /theme kits/i.test(c.description ?? "") || c.name === "Готовые наборы");
    return kitGroup ? (children.get(kitGroup.id) ?? []).length : 0;
  };

  if (!allBooks.length) return <p className="muted">{needle ? "Ничего не найдено." : "Книг тем пока нет."}</p>;
  const info = book ? parseThemebook(book.description) : null;

  return (
    <div className="os-themes">
      <div className={`os-themes__cols${grouping === "alpha" ? " is-alpha" : ""}`}>
        {columns.map(({ group, books }) => (
          <section key={group?.id ?? "alpha"} className="os-col" aria-label={group?.name ?? "Темы по алфавиту"}>
            <header>
              <h2 className="d-plate">{group?.name ?? "А–Я"}</h2>
              {group && <p>{groupLead(group.description)}</p>}
            </header>
            {books.map((b) => {
              const n = kits(b);
              return (
                <button key={b.id} type="button" className={b.id === book?.id ? "active" : ""} aria-pressed={b.id === book?.id} onClick={() => onSelect(b.id)}>
                  {b.name}
                  {n > 0 && <span>{n} {kitWord(n)}</span>}
                </button>
              );
            })}
            {!books.length && <p className="os-col__empty">Не найдено.</p>}
          </section>
        ))}
      </div>
      {book && info && (
        <section className="d-focal os-book" aria-label={`Книга тем: ${book.name}`}>
          <div>
            <div className="d-mono">{[bookGroup?.name, "Themebook", book.name_original].filter(Boolean).join(" · ")}</div>
            <h3>{book.name}</h3>
            {info.concept ? <p>{info.concept}</p> : <MentionText text={book.description ?? ""} />}
            {info.question && (
              <div className="os-book__q">
                {info.question}
                {info.questionOriginal && <small>{info.questionOriginal}</small>}
              </div>
            )}
            {info.source && <div className="os-book__src"><MentionText text={info.source} /></div>}
          </div>
          <div className="os-book__parts">
            <h4 className="d-plate">Внутри</h4>
            {(children.get(book.id) ?? []).map((part) => {
              const n = (children.get(part.id) ?? []).length;
              return (
                <Link key={part.id} to={`/systems/${part.system_id}?section=${part.section_id}&entry=${part.id}&view=list`}>
                  {part.name}
                  {n > 0 && <span>{n}</span>}
                </Link>
              );
            })}
            <button
              type="button"
              className="d-btn d-btn--sm"
              onClick={() => addToBag({ type: "compendium_entry", id: book.id, title: book.name, kind: book.kind, system_id: book.system_id, section_id: book.section_id })}
            >
              В мешок
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
