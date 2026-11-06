import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addToBag } from "../../bag";
import type { CompendiumEntry } from "../../types";
import { DSeg } from "../DSeg";
import { NavIcon } from "../NavIcons";
import { MightMark, Tag } from "./LitmBook";
import { isMight, MIGHT_NAMES, norm, plural, type LitmMight } from "./litmBookText";

const LEADS: Record<LitmMight, string> = {
  origin: "Скромный человек против сурового мира: корни, близкие, ремесло.",
  adventure: "Герой, о котором говорят: влияние, знания, чудесные вещи.",
  greatness: "Легенда, меняющая мир: судьба, власть, мастерство, чудовищность.",
  variable: "Ступень выбирает игрок, беря тему.",
};
const LETTERS = "ABCDEFGHIJ";

interface Improvement { name: string; name_original?: string; text: string; text_en?: string }
const strs = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

function bag(e: CompendiumEntry) {
  addToBag({ type: "compendium_entry", id: e.id, title: e.name, kind: e.kind, system_id: e.system_id, section_id: e.section_id });
}

/** «Темы» LitM — доски Litm-Themes и Litm-Theme: каталог колонками по
 *  Могуществу, поиск по тегу набора; тема — готовые наборы или вопросы. */
export function LitmThemesView({ entries, selectedId, onSelect }: {
  systemId: number;
  entries: CompendiumEntry[];
  selectedId: number | undefined;
  onSelect: (id: number | undefined) => void;
}) {
  const { levels, books, kitsOf, byId, fellowship } = useMemo(() => {
    const byId = new Map(entries.map((e) => [e.id, e]));
    const kids = new Map<number, CompendiumEntry[]>();
    for (const e of entries) if (e.parent_id !== null) {
      const l = kids.get(e.parent_id) ?? [];
      l.push(e);
      kids.set(e.parent_id, l);
    }
    const byPos = (a: CompendiumEntry, b: CompendiumEntry) => a.position - b.position || a.id - b.id;
    for (const l of kids.values()) l.sort(byPos);
    const levels = entries.filter((e) => e.parent_id === null && isMight(e.data?.level)).sort(byPos);
    const books = entries.filter((e) => e.kind === "themebook");
    const kitsOf = (id: number) => (kids.get(id) ?? []).filter((k) => k.kind === "theme_kit");
    const fellowship = entries.find((e) => e.parent_id === null && e.name_original === "Fellowship");
    return { levels, books, kitsOf, byId, fellowship };
  }, [entries]);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"kits" | "questions">("kits");
  const needle = norm(query.trim());

  const selected = selectedId !== undefined ? byId.get(selectedId) : undefined;
  const book = selected?.kind === "themebook" ? selected
    : selected?.kind === "theme_kit" && selected.parent_id !== null ? byId.get(selected.parent_id) : undefined;

  if (book) return <ThemePage book={book} kits={kitsOf(book.id)} level={book.parent_id !== null ? byId.get(book.parent_id) : undefined}
    focusKit={selected?.kind === "theme_kit" ? selected.id : undefined} mode={mode} setMode={setMode} onSelect={onSelect} />;
  if (selected && selected === fellowship) return <FellowshipPage entry={selected} onBack={() => onSelect(undefined)} />;

  const kitHits = needle
    ? books.flatMap((b) => kitsOf(b.id).map((k) => {
      const tags = [...strs(k.data?.powerTags), ...strs(k.data?.weaknessTags)].filter((t) => norm(t).includes(needle));
      const named = norm(`${k.name} ${k.name_original}`).includes(needle);
      return { k, b, tags, hit: named || tags.length > 0 };
    })).filter((x) => x.hit)
    : [];
  const bookHit = (b: CompendiumEntry) => !needle || norm(`${b.name} ${b.name_original}`).includes(needle) || kitHits.some((x) => x.b.id === b.id);
  const kitTotal = books.reduce((n, b) => n + kitsOf(b.id).length, 0);

  return (
    <div className="lb-themes">
      <div className="lb-head">
        <h2>Темы</h2>
        <span className="d-mono">{books.length} {plural(books.length, "тема", "темы", "тем")} · {kitTotal} {plural(kitTotal, "набор", "набора", "наборов")}</span>
      </div>
      <div className="lb-bar">
        <label className="d-field">
          <NavIcon name="search" />
          <input type="search" aria-label="Поиск темы, набора или тега" placeholder="Найти тему, набор или тег…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="lb-mcols">
        {levels.map((lv) => {
          const might = lv.data.level as LitmMight;
          const list = books.filter((b) => b.parent_id === lv.id && bookHit(b));
          return (
            <section key={lv.id} className={`lb-mcol lb-mcol--${might}`}>
              <header>
                <h3><MightMark might={might} label="" />{lv.name}</h3>
                <p>{LEADS[might]}</p>
              </header>
              {list.map((b) => {
                const n = kitsOf(b.id).length;
                return (
                  <button key={b.id} type="button" className="lb-mrow" onClick={() => onSelect(b.id)}>
                    <span className="lb-name">{b.name}<small>{b.name_original}</small></span>
                    <i>{b.name_original === "Magic" && !n ? "пути магии ›" : n}</i>
                  </button>
                );
              })}
              {!list.length && <p className="lb-empty lb-mcol__empty">Нет совпадений</p>}
            </section>
          );
        })}
      </div>
      {fellowship && !needle && (
        <div className="lb-fellow">
          <div>
            <h3 className="lb-name">{fellowship.name}<span className="lb-orig">[{fellowship.name_original}]</span></h3>
            <p>Тема всей группы героев — одна на Содружество, не берётся в темы героя.</p>
          </div>
          <button type="button" className="d-btn d-btn--sm" onClick={() => onSelect(fellowship.id)}>Открыть</button>
        </div>
      )}
      {needle && kitHits.length > 0 && (
        <div className="lb-hits">
          <div className="lb-lbl">Наборы по запросу «{query.trim()}»<small>{kitHits.length}</small></div>
          {kitHits.map(({ k, b, tags }) => (
            <button key={k.id} type="button" className="lb-hit" onClick={() => onSelect(k.id)}>
              <span className="lb-name">{k.name}<small>{k.name_original}</small></span>
              <span className="lb-tags">{tags.map((t) => <Tag key={t} weak={strs(k.data?.weaknessTags).includes(t)}>{t}</Tag>)}</span>
              <span className="d-mono">{b.name} · набор</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemePage({ book, kits, level, focusKit, mode, setMode, onSelect }: {
  book: CompendiumEntry;
  kits: CompendiumEntry[];
  level: CompendiumEntry | undefined;
  focusKit: number | undefined;
  mode: "kits" | "questions";
  setMode: (m: "kits" | "questions") => void;
  onSelect: (id: number | undefined) => void;
}) {
  const d = book.data ?? {};
  const might = isMight(d.might) ? d.might : undefined;
  const concept = strs(d.conceptQuestions);
  const pq = strs(d.powerQuestions);
  const pqEn = strs(d.powerQuestionsEn);
  const wq = strs(d.weaknessQuestions);
  const wqEn = strs(d.weaknessQuestionsEn);
  const ideas = strs(d.questIdeas);
  const imps = (Array.isArray(d.improvements) ? d.improvements : []) as Improvement[];
  return (
    <article className="lb-theme" aria-label={`Тема: ${book.name}`}>
      <nav className="lb-crumbs">
        <button type="button" className="lb-back" onClick={() => onSelect(undefined)}>← Темы</button>
        {level && <span>/ {level.name}</span>}
      </nav>
      <div className="lb-theme__head">
        <h2>{book.name}<span className="lb-orig">[{book.name_original}]</span></h2>
        <span className="d-end">
          {might && <MightMark might={might} />}
          <button type="button" className="d-btn d-btn--sm" onClick={() => bag(book)}>В мешок</button>
          <Link className="d-btn d-btn--sm" to={`/compendium/${book.id}`}>Править</Link>
        </span>
      </div>
      {typeof d.subtitle === "string" && d.subtitle && <div className="lb-sub">{d.subtitle}</div>}
      {book.description && <p className="lb-lead">{book.description}</p>}
      {concept.length > 0 && <ul className="lb-concept">{concept.map((q) => <li key={q}>{q}</li>)}</ul>}
      <div className="lb-bar">
        <DSeg label="Как собрать тему" value={mode} onChange={setMode}
          items={[{ id: "kits", label: `Взять готовый набор · ${kits.length}` }, { id: "questions", label: "Собрать по вопросам" }]} />
        <span className="d-mono">{mode === "kits" ? "набор — 9 тегов силы, 4 слабости и квест" : "по одному ответу на вопрос — тег"}</span>
      </div>
      {mode === "kits" ? (
        kits.length ? (
          <div className="lb-kits">
            {kits.map((k) => <KitCard key={k.id} kit={k} focus={k.id === focusKit} />)}
          </div>
        ) : <p className="lb-empty">Готовых наборов у этой темы нет{book.name_original === "Magic" ? " — наборы магии лежат в разделе «Пути магии»." : "."}</p>
      ) : (
        <div className="lb-qcols">
          <div>
            <div className="lb-lbl">Вопросы для тегов силы<small>Power Tag Questions</small></div>
            {pq.map((q, i) => <div key={i} className="lb-qa"><b>{LETTERS[i]}</b><p>{q}{pqEn[i] && <small>{pqEn[i]}</small>}</p></div>)}
          </div>
          <div>
            <div className="lb-lbl">Вопросы для тегов слабости<small>Weakness Tag Questions</small></div>
            {wq.map((q, i) => <div key={i} className="lb-qa"><b>{LETTERS[i]}</b><p>{q}{wqEn[i] && <small>{wqEn[i]}</small>}</p></div>)}
            {ideas.length > 0 && (
              <>
                <div className="lb-lbl lb-gap">Идеи квестов<small>Quest Ideas</small></div>
                <ul className="lb-ideas">{ideas.map((q) => <li key={q}>{q}</li>)}</ul>
              </>
            )}
          </div>
        </div>
      )}
      {imps.length > 0 && (
        <div className="lb-imps">
          <div className="lb-lbl">Особые улучшения<small>Special Improvements · {imps.length}</small></div>
          {imps.map((m) => (
            <div key={m.name} className="lb-imp">
              <b className="lb-name">{m.name}{m.name_original && <small>{m.name_original}</small>}</b>
              <p>{m.text}</p>
            </div>
          ))}
        </div>
      )}
      {typeof d.page === "string" && d.page && <div className="lb-src">Legend in the Mist · том I · с. {d.page}</div>}
    </article>
  );
}

function KitCard({ kit, focus }: { kit: CompendiumEntry; focus: boolean }) {
  const d = kit.data ?? {};
  return (
    <div className={`lb-kit${focus ? " is-focus" : ""}`} id={`litm-kit-${kit.id}`}>
      <h4 className="lb-name">{kit.name}<small>{kit.name_original}</small></h4>
      <div className="lb-tags">{strs(d.powerTags).map((t) => <Tag key={t}>{t}</Tag>)}</div>
      <div className="lb-tags lb-kit__weak">{strs(d.weaknessTags).map((t) => <Tag key={t} weak>{t}</Tag>)}</div>
      {typeof d.quest === "string" && d.quest && <p className="lb-kit__quest"><span>Квест</span>{d.quest}</p>}
      <div className="lb-kit__acts"><button type="button" className="d-btn d-btn--sm" onClick={() => bag(kit)}>В мешок</button></div>
    </div>
  );
}

function FellowshipPage({ entry, onBack }: { entry: CompendiumEntry; onBack: () => void }) {
  return (
    <article className="lb-theme" aria-label="Содружество">
      <nav className="lb-crumbs"><button type="button" className="lb-back" onClick={onBack}>← Темы</button></nav>
      <div className="lb-theme__head">
        <h2>{entry.name}<span className="lb-orig">[{entry.name_original}]</span></h2>
        <span className="d-end"><MightMark might="variable" label={MIGHT_NAMES.variable} /></span>
      </div>
      <p className="lb-lead">Тема всей группы героев — одна на Содружество, не берётся в темы героя.</p>
      {entry.description && <p className="lb-legacy">{entry.description}</p>}
    </article>
  );
}
