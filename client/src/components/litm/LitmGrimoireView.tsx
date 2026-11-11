import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { addToBag } from "../../bag";
import { compendiumPaths } from "../../data/compendiumEntries";
import { useResource } from "../../data/hooks";
import type { CompendiumEntry } from "../../types";
import { NavIcon } from "../NavIcons";
import { LitmRich, Tag, type GrimLinks } from "./LitmBook";
import { grimoireHref, useGrimoire } from "./useGrimoire";
import { plural, splitConsequence } from "./litmBookText";
import {
  EFFECT_NAMES, OUTCOMES, articleEffects, articleOutcome, grimoireOf, searchGrimoire,
  type GrimArticle, type GrimChapter, type GrimIntro,
} from "./litmGrimoire";

const NO_ENTRIES: CompendiumEntry[] = [];

/** Абзацы книги: «• …» — пункты списка, строка целиком **так** — подзаголовок. */
function Paras({ lines, grim }: { lines: string[]; grim: GrimLinks }) {
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (list.length) out.push(<ul key={`u${k}`} className="lg-ul">{list.map((t, i) => <li key={i}><LitmRich text={t} grim={grim} /></li>)}</ul>);
    list = [];
  };
  lines.forEach((line, i) => {
    if (line.startsWith("• ")) { list.push(line.slice(2)); return; }
    flush(i);
    const head = /^\*\*([^*]+)\*\*$/.exec(line.trim());
    out.push(head ? <h5 key={i} className="lg-h5">{head[1]}</h5> : <p key={i}><LitmRich text={line} grim={grim} /></p>);
  });
  flush(lines.length);
  return <>{out}</>;
}

/** Последствие: эффект из скобок в конце — хвостом через тире (доска Litm-Grimoire). */
function Cq({ text, grim }: { text: string; grim: GrimLinks }) {
  const { lead, effect } = splitConsequence(text.replace(/\.$/, ""));
  if (effect === null) return <LitmRich text={text} grim={grim} />;
  // «(**Заблокировано**)» — своя стрелка, без тире
  const named = /^\*\*[^*]+\*\*/.test(effect);
  return <><LitmRich text={lead} grim={grim} /> {named ? <LitmRich text={effect} grim={grim} /> : <span className="lb-eff"><LitmRich text={effect} grim={grim} /></span>}</>;
}

const paras = (text: string) => text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);

export function Effect({ k, tips }: { k: string; tips: Map<string, string> }) {
  return <span className={OUTCOMES.has(k) ? "lg-eff lg-eff--out" : "lg-eff"} title={tips.get(k)}>{EFFECT_NAMES[k] ?? k}</span>;
}

/** Вступление главы или подраздела — карточкой, сворачивается (Q4). */
function IntroCard({ title, titleEn, limits, sections, grim, closed }: GrimIntro & { grim: GrimLinks; closed?: boolean }) {
  const [open, setOpen] = useState(!closed);
  return (
    <section className={`lg-intro${open ? "" : " is-closed"}`} aria-label={title}>
      <header>
        <h3>{title}</h3>
        {titleEn && <span className="lb-orig">[{titleEn}]</span>}
        <button type="button" className="lb-back" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Свернуть ▴" : "Развернуть ▾"}</button>
      </header>
      {open && (
        <>
          {limits.length > 0 && <div className="lg-limits"><span className="lb-lbl">Пределы</span>{limits.map((l) => <span key={l} className="lg-limit">{l}</span>)}</div>}
          <div className="lg-intro__cols">
            {sections.map((s, i) => <div key={i}>{s.head && <h4>{s.head}</h4>}<Paras lines={s.text} grim={grim} /></div>)}
          </div>
        </>
      )}
    </section>
  );
}

/** Кнопки пульта у строк статьи (шторка «Гримуар», Q8): за успехом и последствием. */
export interface GrimActs {
  success: (text: string) => ReactNode;
  consequence: (text: string) => ReactNode;
}

export function Article({ a, chapter, prev, next, link, grim, tips, acts }: {
  a: GrimArticle; chapter: GrimChapter; prev: GrimArticle | null; next: GrimArticle | null;
  link: (id: number) => string; grim: GrimLinks; tips: Map<string, string>; acts?: GrimActs;
}) {
  const e = a.entry;
  const effects = articleEffects(a).filter((k) => !OUTCOMES.has(k));
  const outcome = articleOutcome(a);
  const play = a.powerPlus.length > 0 || a.powerMinus.length > 0 || a.success.length > 0 || a.feats.length > 0 || a.consequences.length > 0;
  return (
    <article className="lb-art lg-art" aria-label={`Статья: ${e.name}`}>
      <div className="lb-crumbs"><Link className="lb-back" to={link(chapter.entry.id)}>← {chapter.entry.name}{a.sub && ` · ${a.sub}`}</Link></div>
      <div className="lb-art__head">
        <h3>{e.name}<span className="lb-orig">[{e.name_original}]</span></h3>
        <span className="d-end">
          <button type="button" className="d-btn d-btn--sm"
            onClick={() => addToBag({ type: "compendium_entry", id: e.id, title: e.name, kind: e.kind, system_id: e.system_id, section_id: e.section_id })}>
            В мешок
          </button>
          <Link className="d-btn d-btn--sm" to={`/compendium/${e.id}`}>Править</Link>
        </span>
      </div>
      <div className="lb-file">
        <span className="lb-kind">{a.see ? "→ см." : "Статья Гримуара"}</span>
        <span>{chapter.entry.name}</span>
        {a.sub && <span>{a.sub}</span>}
        {effects.length > 0 && <span className="lg-file-effs">{effects.map((k) => <Effect key={k} k={k} tips={tips} />)}</span>}
        {outcome && <span>{outcome}</span>}
      </div>
      {a.examples.length > 0 && <p className="lg-examples">{a.examples.map((x, i) => <Fragment key={i}>{i > 0 && <span aria-hidden> · </span>}{x}</Fragment>)}</p>}
      {play ? (
        <div className="lg-cols">
          <div>
            <div className="lb-lbl lg-colhead">Как разыграть<small>Explanation · Power</small></div>
            <div className="lg-text"><Paras lines={paras(e.description)} grim={grim} /></div>
            {a.powerPlus.length > 0 && (
              <div className="lg-power lg-power--plus"><b aria-hidden>+</b><div><div className="lb-tags">{a.powerPlus.map((t) => <Tag key={t}>{t}</Tag>)}</div><div className="lb-lbl">Помогает</div></div></div>
            )}
            {a.powerMinus.length > 0 && (
              <div className="lg-power lg-power--minus"><b aria-hidden>−</b><div><div className="lb-tags">{a.powerMinus.map((t) => <Tag key={t} weak>{t}</Tag>)}</div><div className="lb-lbl">Мешает</div></div></div>
            )}
          </div>
          <div>
            <div className="lb-lbl lg-colhead">Что выходит<small>Success · Extra Feats · Consequences</small></div>
            {a.success.map((s, i) => (
              <p key={i} className="lg-success">{s.effects.map((k) => <Effect key={k} k={k} tips={tips} />)} <LitmRich text={s.text} grim={grim} />{acts?.success(s.text)}</p>
            ))}
            {a.feats.length > 0 && <><div className="lb-lbl lg-sub">Доп. подвиги</div><ul className="lg-dia lg-dia--full">{a.feats.map((t, i) => <li key={i}><LitmRich text={t} grim={grim} /></li>)}</ul></>}
            {a.consequences.length > 0 && <><div className="lb-lbl lg-sub">Последствия</div><ul className="lg-dia">{a.consequences.map((t, i) => <li key={i}><Cq text={t} grim={grim} />{acts?.consequence(t)}</li>)}</ul></>}
          </div>
        </div>
      ) : (
        <div className="lg-text lg-text--wide"><Paras lines={paras(e.description)} grim={grim} /></div>
      )}
      {a.sections.map((s, i) => <section key={i} className="lg-section">{s.head && <h4>{s.head}</h4>}<div className="lg-text"><Paras lines={s.text} grim={grim} /></div></section>)}
      {a.lists.length > 0 && (
        <div className="lg-lists">
          {a.lists.map((l) => (
            <section key={l.name}><h4>{l.name}{l.nameEn && <small>{l.nameEn}</small>}</h4><ul className="lg-dia">{l.items.map((t, i) => <li key={i}><Cq text={t} grim={grim} /></li>)}</ul></section>
          ))}
        </div>
      )}
      {a.effects.length > 0 && (
        <div className="lg-effects">
          {a.effects.map((f) => <div key={f.key}><Effect k={f.key} tips={tips} /><p><LitmRich text={f.text} grim={grim} /></p></div>)}
        </div>
      )}
      {a.notes.length > 0 && <aside className="lg-notes"><div className="lb-lbl">На полях</div>{a.notes.map((n, i) => <p key={i}><LitmRich text={n} grim={grim} /></p>)}</aside>}
      <nav className="lg-pager" aria-label="Соседние статьи">
        {prev ? <Link to={link(prev.entry.id)}><small>← Раньше</small>{prev.entry.name}</Link> : <span />}
        {next ? <Link to={link(next.entry.id)} className="lg-pager__next"><small>Дальше →</small>{next.entry.name}</Link> : <span />}
      </nav>
      {a.page !== null && <div className="lb-src">Гримуар действий · с. {a.page}</div>}
    </article>
  );
}

/** Строки статей главы: имя и эффекты глаголами; отсылки — «→ см.» (Q6). */
export function ArticleRows({ chapter, selectedId, link }: { chapter: GrimChapter; selectedId?: number; link: (id: number) => string }) {
  let sub = "";
  return (
    <ul className="lg-rows">
      {chapter.articles.map((a) => {
        const head = a.sub && a.sub !== sub ? a.sub : null;
        sub = a.sub;
        const effs = articleEffects(a).map((k) => EFFECT_NAMES[k] ?? k);
        return (
          <Fragment key={a.entry.id}>
            {head && <li className="lg-rows__sub">{head}</li>}
            <li>
              <Link to={link(a.entry.id)} className={`lg-row${a.see ? " is-see" : ""}${a.entry.id === selectedId ? " is-on" : ""}`}
                aria-current={a.entry.id === selectedId ? "page" : undefined}>
                <span>{a.entry.name}{a.see && <i> → см.</i>}</span>
                {effs.length > 0 && <small>{effs.join(" · ")}</small>}
              </Link>
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}

/** Оглавление Гримуара под пунктом раздела в оглавлении системы (доска Litm-Grimoire). */
export function LitmGrimoireToc({ systemId, sectionId, selectedId }: { systemId: number; sectionId: number; selectedId: number | undefined }) {
  const entries = useResource<CompendiumEntry[]>(compendiumPaths.sectionEntries(systemId, sectionId)).data ?? NO_ENTRIES;
  const chapters = useMemo(() => grimoireOf(entries), [entries]);
  const link = (id: number) => grimoireHref(systemId, sectionId, id);
  const openId = chapters.find((c) => c.entry.id === selectedId || c.articles.some((a) => a.entry.id === selectedId))?.entry.id;
  return (
    <div className="litm-book litm-book--toc lg-toc">
      {chapters.map((c) => (
        <div key={c.entry.id} className={c.entry.id === openId ? "is-open" : ""}>
          <Link to={link(c.entry.id)} className={`lg-toc__ch${c.entry.id === selectedId ? " is-on" : ""}`}>
            <span>{c.entry.name}</span><b>{c.articles.length} {c.entry.id === openId ? "▴" : "▾"}</b>
          </Link>
          {c.entry.id === openId && <ArticleRows chapter={c} selectedId={selectedId} link={link} />}
        </div>
      ))}
    </div>
  );
}

/** «Гримуар действий» LitM: поиск по указателю, вступление главы карточкой, статья
 *  двумя колонками «Как разыграть | Что выходит» (решения Q1–Q9 2026-11-11). */
export function LitmGrimoireView({ systemId, sectionId, entries, selectedId }: {
  systemId: number;
  sectionId: number;
  entries: CompendiumEntry[];
  selectedId: number | undefined;
}) {
  const { chapters, articles, grim, tips, link } = useGrimoire(systemId, sectionId, entries);

  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchGrimoire(articles, query), [articles, query]);
  const indexSize = articles.reduce((n, a) => n + a.index.length, 0);

  const at = articles.findIndex((a) => a.entry.id === selectedId);
  const article = at >= 0 ? articles[at] : null;
  const chapter = chapters.find((c) => c.entry.id === (article ? article.chapterId : selectedId)) ?? null;
  const subText = article && chapter?.subs.find((s) => s.name === article.sub && s.text.length);

  return (
    <div className="lg">
      <div className="lb-head">
        <h2>Гримуар действий</h2>
        <span className="d-mono">{articles.length} {plural(articles.length, "статья", "статьи", "статей")} · {chapters.length} {plural(chapters.length, "раздел", "раздела", "разделов")} · указатель {indexSize} {plural(indexSize, "строка", "строки", "строк")}</span>
      </div>
      <div className="lb-bar">
        <label className="d-field">
          <NavIcon name="search" />
          <input type="search" aria-label="Найти действие" placeholder="Найти действие: «обезоружить», «подкупить», «выследить»…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      {query.trim() ? (
        <div className="lb-hits">
          {hits.map((h) => (
            <Link key={h.article.entry.id} className="lb-hit lg-hit" to={link(h.article.entry.id)} onClick={() => setQuery("")}>
              <span className="lb-name">{h.article.entry.name}<small>{chapters.find((c) => c.entry.id === h.article.chapterId)?.entry.name}</small></span>
              <span className="lg-hit__phrase">{h.phrase ?? ""}</span>
              <span className="lg-file-effs">{articleEffects(h.article).filter((k) => !OUTCOMES.has(k)).map((k) => <Effect key={k} k={k} tips={tips} />)}</span>
            </Link>
          ))}
          {!hits.length && <p className="lb-empty">Ничего не найдено.</p>}
        </div>
      ) : article && chapter ? (
        <>
          {/* над статьёй вступление свёрнуто — иначе статья уходит под длинную карточку */}
          {chapter.intro && <IntroCard key={chapter.entry.id} {...chapter.intro} grim={grim} closed />}
          {subText && <IntroCard key={subText.name} title={subText.name} titleEn={subText.nameEn} limits={[]} sections={[{ head: "", text: subText.text }]} grim={grim} closed />}
          <Article a={article} chapter={chapter} prev={articles[at - 1] ?? null} next={articles[at + 1] ?? null} link={link} grim={grim} tips={tips} />
        </>
      ) : chapter ? (
        <section className="lg-chapter">
          <h3>{chapter.entry.name}<span className="lb-orig">[{chapter.entry.name_original}]</span></h3>
          {chapter.entry.description && <div className="lb-lead"><Paras lines={paras(chapter.entry.description)} grim={grim} /></div>}
          {chapter.intro && <IntroCard {...chapter.intro} grim={grim} />}
          {chapter.subs.filter((s) => s.text.length).map((s) => <IntroCard key={s.name} title={s.name} titleEn={s.nameEn} limits={[]} sections={[{ head: "", text: s.text }]} grim={grim} />)}
          <ArticleRows chapter={chapter} link={link} />
        </section>
      ) : (
        <div className="lg-contents">
          {chapters.map((c) => (
            <section key={c.entry.id}>
              <h3><Link to={link(c.entry.id)}>{c.entry.name}</Link>{c.page !== null && <small className="d-mono">с. {c.page}</small>}</h3>
              <ArticleRows chapter={c} link={link} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
