import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { addToBag } from "../../bag";
import { compendiumPaths } from "../../data/compendiumEntries";
import { useResource } from "../../data/hooks";
import type { CompendiumEntry } from "../../types";
import { NavIcon } from "../NavIcons";
import { LitmRich, Status, type GrimLinks } from "./LitmBook";
import { Paras } from "./LitmGrimoireView";
import { paras, plural } from "./litmBookText";
import { useRules } from "./useRules";
import { isCard, isTerm, searchRules, sectionText, type RuleArticle, type RuleGroup, type RuleSection, type RuleSidebar } from "./litmRules";

const NO_ENTRIES: CompendiumEntry[] = [];
const lines = (text: string) => text.split("\n").map((s) => s.trim()).filter(Boolean);

/** Английский текст книги — как есть, только курсив и полужирный. */
function En({ text }: { text: string }) {
  return <>{lines(text).map((line, i) => (
    <p key={i}>{line.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/).map((part, k) =>
      part.startsWith("**") ? <b key={k}>{part.slice(2, -2)}</b> : part.startsWith("*") && part.length > 2 ? <i key={k}>{part.slice(1, -1)}</i> : part)}</p>
  ))}</>;
}

/** Текст книги по разделам, английский рядом по кнопке: «Подробно» Справочника (решение 5г Q1),
 *  правила пути магии. Длинный — свёрнут, если не сказано иначе. */
export function BookText({ sections, page, grim, title = "Подробно", sub = "полный перевод книги", open: opened }: {
  sections: RuleSection[]; page?: string; grim: GrimLinks; title?: string; sub?: string; open?: boolean;
}) {
  const size = sections.reduce((n, s) => n + s.text.length, 0);
  const [open, setOpen] = useState(opened ?? size < 1500);
  const [en, setEn] = useState(false);
  if (!sections.length) return null;
  const hasEn = sections.some((s) => s.textEn);
  return (
    <section className={`lr-detail${open ? "" : " is-closed"}${en ? " is-en" : ""}`} aria-label={title}>
      <header>
        <h4>{title}<small>{sub}{page && ` · с. ${page}`}</small></h4>
        {open && hasEn && <button type="button" className="d-btn d-btn--sm" aria-pressed={en} onClick={() => setEn(!en)}>{en ? "Только русский" : "Английский рядом"}</button>}
        <button type="button" className="lb-back" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Свернуть ▴" : "Развернуть ▾"}</button>
      </header>
      {open && sections.map((s, i) => (
        <div key={i} className="lr-detail__sec">
          {(s.head || s.page) && <h5>{s.head}{s.headEn && <span className="lb-orig" lang="en">[{s.headEn}]</span>}{s.page && <small className="d-mono">с. {s.page}</small>}</h5>}
          <div className="lr-detail__cols">
            <div className="lg-text"><Paras lines={lines(s.text)} grim={grim} /></div>
            {en && <div className="lr-en" lang="en"><En text={s.textEn} /></div>}
          </div>
        </div>
      ))}
    </section>
  );
}

/** Врезки книги: заголовок, страница, текст. */
export function Sidebars({ items, grim }: { items: RuleSidebar[]; grim: GrimLinks }) {
  return <>{items.map((s, i) => (
    <aside key={i} className="lr-side">{(s.title || s.page) && <h5>{s.title}{s.page && <small className="d-mono">с. {s.page}</small>}</h5>}<Paras lines={lines(s.text)} grim={grim} /></aside>
  ))}</>;
}

/** Примеры статусов книги по группам (доска Litm-Rules). */
function Catalog({ group }: { group: RuleGroup }) {
  if (!group.catalog.length) return null;
  const n = group.catalog.reduce((k, c) => k + c.items.length, 0);
  return (
    <section className="lr-catalog">
      <h4 className="lr-heading">Примеры статусов<small>{n} из книги · {group.catalog.length} {plural(group.catalog.length, "группа", "группы", "групп")}</small></h4>
      <div className="lr-catalog__grid">
        {group.catalog.map((c) => (
          <div key={c.entry.id}><h5>{c.entry.name}</h5><div className="lb-tags">{c.items.map((s) => <Status key={s.id} name={s.name.replace(/-/g, " ")} />)}</div></div>
        ))}
      </div>
    </section>
  );
}

function Article({ a, group, prev, next, link, grim }: {
  a: RuleArticle; group: RuleGroup; prev: RuleArticle | null; next: RuleArticle | null;
  link: (id: number) => string; grim: GrimLinks;
}) {
  const e = a.entry;
  const side = a.sidebars.length > 0 || a.related.length > 0;
  const main: ReactNode = <>
    {e.description && <div className="lr-short"><Paras lines={paras(e.description)} grim={grim} /></div>}
    {a.steps.length > 0 && <>
      <h4 className="lr-heading">Как работает</h4>
      <ol className="lr-steps">{a.steps.map((s, i) => <li key={i}><span><LitmRich text={s} grim={grim} /></span></li>)}</ol>
    </>}
  </>;
  return (
    <article className="lb-art lr-art" aria-label={`Статья: ${e.name}`}>
      <div className="lb-crumbs"><Link className="lb-back" to={link(group.entry.id)}>← {group.entry.name}</Link></div>
      <div className="lb-art__head">
        <h3>{e.name}{e.name_original && <span className="lb-orig" lang="en">[{e.name_original}]</span>}</h3>
        <span className="d-end">
          <button type="button" className="d-btn d-btn--sm"
            onClick={() => addToBag({ type: "compendium_entry", id: e.id, title: e.name, kind: e.kind, system_id: e.system_id, section_id: e.section_id })}>
            В мешок
          </button>
        </span>
      </div>
      <div className="lb-file">
        <span className="lb-kind">{isTerm(a) ? "Термин" : isCard(a) ? (e.kind === "mechanic_consequence_item" ? "Последствие" : "Роль вызова") : "Правило"}</span>
        <span>{group.entry.name}</span>
        {a.page && <span>с. {a.page}</span>}
      </div>
      {side ? (
        <div className="lr-cols">
          <div>{main}</div>
          <div>
            <Sidebars items={a.sidebars} grim={grim} />
            {a.related.length > 0 && (
              <nav className="lr-related" aria-label="Связано">
                <h4 className="lr-heading">Связано</h4>
                {a.related.map((r) => {
                  const href = grim.rule(r.name, r.page);
                  const body = <>{r.name}{r.page && <small>{r.page}</small>}</>;
                  const key = `${r.name}:${r.page}`;
                  return href ? <Link key={key} to={href}>{body}</Link> : <span key={key}>{body}</span>;
                })}
              </nav>
            )}
          </div>
        </div>
      ) : <div className="lr-solo">{main}</div>}
      <Catalog group={group} />
      <BookText key={e.id} sections={a.sections} page={a.page} grim={grim} />
      <nav className="lg-pager" aria-label="Соседние статьи">
        {prev ? <Link to={link(prev.entry.id)}><small>← Раньше</small>{prev.entry.name}</Link> : <span />}
        {next ? <Link to={link(next.entry.id)} className="lg-pager__next"><small>Дальше →</small>{next.entry.name}</Link> : <span />}
      </nav>
      {a.page && <div className="lb-src">Legend in the Mist · с. {a.page}</div>}
    </article>
  );
}

function Rows({ articles, selectedId, link }: { articles: RuleArticle[]; selectedId?: number; link: (id: number) => string }) {
  return (
    <ul className="lg-rows">
      {articles.map((a) => (
        <li key={a.entry.id}>
          <Link to={link(a.entry.id)} className={`lg-row${a.entry.id === selectedId ? " is-on" : ""}`} aria-current={a.entry.id === selectedId ? "page" : undefined}>
            <span>{a.entry.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Страница группы: роли и Последствия карточками, словарь списком, статьи строками. */
function GroupPage({ group, link, grim }: { group: RuleGroup; link: (id: number) => string; grim: GrimLinks }) {
  const g = group.entry;
  const cards = group.articles.filter(isCard);
  const terms = group.articles.filter(isTerm);
  const rest = group.articles.filter((a) => !isCard(a) && !isTerm(a));
  return (
    <section className="lg-chapter lr-group">
      <h3>{g.name}{g.name_original && <span className="lb-orig" lang="en">[{g.name_original}]</span>}</h3>
      {g.description && <div className="lb-lead"><Paras lines={paras(g.description)} grim={grim} /></div>}
      {rest.length > 0 && <Rows articles={rest} link={link} />}
      {cards.length > 0 && (
        <div className="lr-cards">
          {cards.map((a) => {
            const threats = sectionText(a, "Угрозы"), cons = sectionText(a, "Последствия");
            return (
              <Link key={a.entry.id} to={link(a.entry.id)} className="lr-card">
                <h4>{a.entry.name}{a.entry.name_original && <small>{a.entry.name_original}</small>}</h4>
                {a.entry.description && <p><LitmRich text={a.entry.description} /></p>}
                {threats && <><div className="lr-card__k">Угрозы</div><p><LitmRich text={threats} /></p></>}
                {cons && <><div className="lr-card__k">Последствия</div><p><LitmRich text={cons} /></p></>}
                {a.page && <div className="lr-card__n">с. {a.page}</div>}
              </Link>
            );
          })}
        </div>
      )}
      {terms.length > 0 && (
        <dl className="lr-terms">
          {terms.map((a) => (
            <Fragment key={a.entry.id}>
              <dt><Link to={link(a.entry.id)}>{a.entry.name}</Link>{a.entry.name_original && <span className="lb-orig">[{a.entry.name_original}]</span>}</dt>
              <dd><LitmRich text={a.sections[0].text} grim={grim} /></dd>
            </Fragment>
          ))}
        </dl>
      )}
      <Catalog group={group} />
    </section>
  );
}

function groupOf(groups: RuleGroup[], id: number | undefined): RuleGroup | null {
  if (id === undefined) return null;
  return groups.find((g) => g.entry.id === id || g.articles.some((a) => a.entry.id === id)
    || g.catalog.some((c) => c.entry.id === id || c.items.some((s) => s.id === id))) ?? null;
}

export function RulePage({ book, selectedId, grim = book.grim }: {
  book: ReturnType<typeof useRules>;
  selectedId: number;
  grim?: GrimLinks;
}) {
  const { groups, articles, link } = book;
  const group = groupOf(groups, selectedId);
  if (!group) return null;
  const at = articles.findIndex((a) => a.entry.id === selectedId);
  return at < 0 ? <GroupPage group={group} link={link} grim={grim} /> : (
    <Article a={articles[at]} group={group} prev={articles[at - 1] ?? null} next={articles[at + 1] ?? null} link={link} grim={grim} />
  );
}

/** Оглавление Справочника под пунктом раздела в оглавлении системы (как у Гримуара). */
export function LitmRulesToc({ systemId, sectionId, selectedId }: { systemId: number; sectionId: number; selectedId: number | undefined }) {
  const entries = useResource<CompendiumEntry[]>(compendiumPaths.sectionEntries(systemId, sectionId)).data ?? NO_ENTRIES;
  const { groups, link } = useRules(systemId, sectionId, entries);
  const openId = groupOf(groups, selectedId)?.entry.id;
  return (
    <div className="litm-book litm-book--toc lg-toc lr-toc">
      {groups.map((g) => (
        <div key={g.entry.id} className={g.entry.id === openId ? "is-open" : ""}>
          <Link to={link(g.entry.id)} className={`lg-toc__ch${g.entry.id === selectedId ? " is-on" : ""}`}>
            <span>{g.entry.name}</span><b>{g.articles.length} {g.entry.id === openId ? "▴" : "▾"}</b>
          </Link>
          {g.entry.id === openId && <Rows articles={g.articles} selectedId={selectedId} link={link} />}
        </div>
      ))}
    </div>
  );
}

/** «Справочник» LitM: поиск, оглавление групп, статья по доске «Статусы» с «Подробно». */
export function LitmRulesView({ systemId, sectionId, entries, selectedId }: {
  systemId: number;
  sectionId: number;
  entries: CompendiumEntry[];
  selectedId: number | undefined;
}) {
  const book = useRules(systemId, sectionId, entries);
  const { groups, articles, link } = book;
  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchRules(articles, query), [articles, query]);
  const group = groupOf(groups, selectedId);
  return (
    <div className="lg lr">
      <div className="lb-head">
        <h2>Справочник</h2>
        <span className="lg-count">{articles.length} {plural(articles.length, "статья", "статьи", "статей")} · {groups.length} {plural(groups.length, "группа", "группы", "групп")}</span>
      </div>
      <div className="lb-bar">
        <label className="d-field">
          <NavIcon name="search" />
          <input type="search" aria-label="Найти правило" placeholder="Найти правило или термин: «Предел», «спотлайт», «привал»…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      {query.trim() ? (
        <div className="lb-hits">
          {hits.map((h) => (
            <Link key={h.article.entry.id} className="lb-hit lg-hit" to={link(h.article.entry.id)} onClick={() => setQuery("")}>
              <span className="lb-name">{h.article.entry.name}<small>{groups.find((g) => g.entry.id === h.article.groupId)?.entry.name}</small></span>
              <span className="lg-hit__phrase">{h.phrase ?? ""}</span>
              <span />
            </Link>
          ))}
          {!hits.length && <p className="lb-empty">Ничего не найдено.</p>}
        </div>
      ) : group && selectedId !== undefined ? (
        <RulePage book={book} selectedId={selectedId} />
      ) : (
        <div className="lg-contents">
          {groups.map((g) => {
            const many = g.articles.length > 15;
            return (
              <section key={g.entry.id}>
                <h3><Link to={link(g.entry.id)} className="lg-contents-link">{g.entry.name}</Link></h3>
                {many
                  ? <Link className="lg-row" to={link(g.entry.id)}>{g.articles.length} {plural(g.articles.length, "запись", "записи", "записей")} →</Link>
                  : <Rows articles={g.articles} link={link} />}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
