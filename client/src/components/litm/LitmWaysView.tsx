import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { addToBag } from "../../bag";
import { compendiumPaths } from "../../data/compendiumEntries";
import { useResource } from "../../data/hooks";
import type { CompendiumEntry, SystemSection } from "../../types";
import { LitmRich, MightMark, Tag, type GrimLinks } from "./LitmBook";
import { Paras } from "./LitmGrimoireView";
import { BookText, Sidebars } from "./LitmRulesView";
import { isMight, norm, paras, plural } from "./litmBookText";
import { kitKey } from "./litmCompendium";
import { grimoireHref } from "./useGrimoire";
import { waysInTropes, waysOf, type MagicWay, type WayChapter } from "./litmWays";

const NO_ENTRIES: CompendiumEntry[] = [];
const NO_SECTIONS: SystemSection[] = [];
const strs = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

function bag(e: CompendiumEntry) {
  addToBag({ type: "compendium_entry", id: e.id, title: e.name, kind: e.kind, system_id: e.system_id, section_id: e.section_id });
}

/** Ссылки на правила Справочника по **Имени** и тропы системы. */
function useWayLinks(systemId: number) {
  const sections = useResource<SystemSection[]>(compendiumPaths.sections(systemId)).data ?? NO_SECTIONS;
  const rules = sections.find((s) => s.name === "Справочник");
  const tropesSec = sections.find((s) => s.kind === "trope");
  const ruleEntries = useResource<CompendiumEntry[]>(rules ? compendiumPaths.sectionEntries(systemId, rules.id) : null).data ?? NO_ENTRIES;
  const tropeEntries = useResource<CompendiumEntry[]>(tropesSec ? compendiumPaths.sectionEntries(systemId, tropesSec.id) : null).data ?? NO_ENTRIES;
  const grim = useMemo<GrimLinks>(() => {
    const byName = new Map(ruleEntries.map((e) => [norm(e.name), e.id]));
    return {
      article: () => null,
      rule: (name) => { const id = byName.get(norm(name)); return id !== undefined && rules ? grimoireHref(systemId, rules.id, id) : null; },
    };
  }, [ruleEntries, rules, systemId]);
  const tropes = useMemo(() => tropeEntries.filter((e) => e.kind === "trope"), [tropeEntries]);
  return { grim, tropes };
}

function KitCard({ kit, focus }: { kit: CompendiumEntry; focus: boolean }) {
  const d = kit.data ?? {};
  return (
    <div className={`lb-kit${focus ? " is-focus" : ""}`} id={`litm-kit-${kit.id}`}>
      <h4 className="lb-name">{kit.name}<small>{kit.name_original}</small></h4>
      {isMight(d.might) && <span><MightMark might={d.might} /></span>}
      {kit.description && <p className="lw-why">{kit.description}</p>}
      <div className="lb-tags">{strs(d.powerTags).map((t) => <Tag key={t}>{t}</Tag>)}</div>
      <div className="lb-tags lb-kit__weak">{strs(d.weaknessTags).map((t) => <Tag key={t} weak>{t}</Tag>)}</div>
      {typeof d.quest === "string" && d.quest && <p className="lb-kit__quest"><span>Квест</span>{d.quest}</p>}
      <div className="lb-kit__acts"><button type="button" className="d-btn d-btn--sm" onClick={() => bag(kit)}>В мешок</button></div>
    </div>
  );
}

/** Страница традиции по доске Litm-Way: эпиграф, суть, котёл, правила пути, вариант, наборы. */
function WayPage({ way, focusKit, back, grim, inTropes }: {
  way: MagicWay; focusKit: number | undefined; back: string; grim: GrimLinks; inTropes: string[];
}) {
  const e = way.entry;
  useEffect(() => {
    if (focusKit !== undefined) document.getElementById(`litm-kit-${focusKit}`)?.scrollIntoView({ block: "center" });
  }, [focusKit]);
  return (
    <article className="lb-art lw-way" aria-label={`Путь магии: ${e.name}`}>
      <div className="lb-crumbs"><Link className="lb-back" to={back}>← Пути магии</Link></div>
      <div className="lb-art__head">
        <h3>{e.name}{e.name_original && <span className="lb-orig">[{e.name_original}]</span>}</h3>
        <span className="d-end">
          <button type="button" className="d-btn d-btn--sm" onClick={() => bag(e)}>В мешок</button>
          <Link className="d-btn d-btn--sm" to={`/compendium/${e.id}`}>Править</Link>
        </span>
      </div>
      <div className="lb-file">
        <span className="lb-kind">Путь магии</span>
        <span>{way.kits.length} {plural(way.kits.length, "набор", "набора", "наборов")}</span>
        {inTropes.length > 0 && <span>в тропах: {inTropes.join(", ")}</span>}
        {way.page && <span>с. {way.page}</span>}
      </div>
      {way.epigraph && <p className="lw-epi" title={way.epigraphEn || undefined}>{way.epigraph}</p>}
      {e.description && <div className="lb-lead"><Paras lines={paras(e.description)} grim={grim} /></div>}
      {way.ingredients.length > 0 && (
        <div className="lw-ingr">
          <div className="lb-lbl">Ингредиенты котла<small>правила пути собраны из общих частей — «Волшебный котёл»</small></div>
          <div>{way.ingredients.map((i) => <span key={i.name} className="lw-ing">{i.name}{i.nameEn && <small>{i.nameEn}</small>}</span>)}</div>
        </div>
      )}
      <BookText key={e.id} sections={way.sections} page={way.page} grim={grim} title="Правила пути" sub="перевод книги" open />
      {way.sidebars.length > 0 && <div className="lw-sides"><Sidebars items={way.sidebars} grim={grim} /></div>}
      {way.variant && (
        <aside className="lw-variant">
          <h5>{way.variant.head}{way.variant.page && <small className="d-mono">с. {way.variant.page}</small>}</h5>
          <Paras lines={way.variant.text.split("\n").filter((s) => s.trim())} grim={grim} />
        </aside>
      )}
      {way.kits.length > 0 && (
        <section className="lw-kits">
          <div className="lb-lbl">Наборы пути<small>Theme Kits · тема героя «Магия», ступень — у набора</small></div>
          <div className="lb-kits">{way.kits.map((k) => <KitCard key={k.id} kit={k} focus={k.id === focusKit} />)}</div>
        </section>
      )}
      {way.page && <div className="lb-src">Legend in the Mist · том I · с. {way.page}</div>}
    </article>
  );
}

function ChapterPage({ chapter, back, grim }: { chapter: WayChapter; back: string; grim: GrimLinks }) {
  const e = chapter.entry;
  return (
    <article className="lb-art lw-way" aria-label={e.name}>
      <div className="lb-crumbs"><Link className="lb-back" to={back}>← Пути магии</Link></div>
      <div className="lb-art__head">
        <h3>{e.name}{e.name_original && <span className="lb-orig">[{e.name_original}]</span>}</h3>
        <span className="d-end"><Link className="d-btn d-btn--sm" to={`/compendium/${e.id}`}>Править</Link></span>
      </div>
      {e.description && <div className="lb-lead"><Paras lines={paras(e.description)} grim={grim} /></div>}
      {chapter.sidebars.length > 0 && <div className="lw-sides"><Sidebars items={chapter.sidebars} grim={grim} /></div>}
      <BookText key={e.id} sections={chapter.sections} page={chapter.page} grim={grim} title="Текст книги" sub="перевод" open />
      {!chapter.sections.length && <p className="lb-empty">Текст главы ещё не переведён — у неё пока нет принятой доски.</p>}
    </article>
  );
}

/** Строки раздела в порядке книги: главы и пути с числом наборов. */
function WayRows({ ways, chapters, selectedId, link }: {
  ways: MagicWay[]; chapters: WayChapter[]; selectedId?: number; link: (id: number) => string;
}) {
  const rows = [...chapters.map((c) => ({ e: c.entry, n: 0 })), ...ways.map((w) => ({ e: w.entry, n: w.kits.length }))]
    .sort((a, b) => a.e.position - b.e.position || a.e.id - b.e.id);
  return (
    <ul className="lg-rows">
      {rows.map(({ e, n }) => (
        <li key={e.id}>
          <Link to={link(e.id)} className={`lg-row${e.id === selectedId ? " is-on" : ""}`} aria-current={e.id === selectedId ? "page" : undefined}>
            <span>{e.name}</span>{n > 0 && <small>{n} {plural(n, "набор", "набора", "наборов")}</small>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Оглавление «Путей магии» под пунктом раздела (доска Litm-Way). */
export function LitmWaysToc({ systemId, sectionId, selectedId }: { systemId: number; sectionId: number; selectedId: number | undefined }) {
  const entries = useResource<CompendiumEntry[]>(compendiumPaths.sectionEntries(systemId, sectionId)).data ?? NO_ENTRIES;
  const { ways, chapters } = useMemo(() => waysOf(entries), [entries]);
  const way = ways.find((w) => w.kits.some((k) => k.id === selectedId));
  return (
    <div className="litm-book litm-book--toc lg-toc">
      <WayRows ways={ways} chapters={chapters} selectedId={way?.entry.id ?? selectedId} link={(id) => grimoireHref(systemId, sectionId, id)} />
    </div>
  );
}

/** «Пути магии» LitM: восемь традиций книги с наборами и общие главы. */
export function LitmWaysView({ systemId, sectionId, entries, selectedId }: {
  systemId: number;
  sectionId: number;
  entries: CompendiumEntry[];
  selectedId: number | undefined;
}) {
  const { ways, chapters } = useMemo(() => waysOf(entries), [entries]);
  const { grim, tropes } = useWayLinks(systemId);
  const link = (id: number) => grimoireHref(systemId, sectionId, id);
  const back = `/systems/${systemId}?section=${sectionId}`;
  const way = ways.find((w) => w.entry.id === selectedId || w.kits.some((k) => k.id === selectedId));
  const chapter = chapters.find((c) => c.entry.id === selectedId);
  const kitsTotal = ways.reduce((n, w) => n + w.kits.length, 0);
  return (
    <div className="lg lw">
      <div className="lb-head">
        <h2>Пути магии</h2>
        <span className="d-mono">{ways.length} {plural(ways.length, "путь", "пути", "путей")} · {kitsTotal} {plural(kitsTotal, "набор", "набора", "наборов")}</span>
      </div>
      {way ? (
        <WayPage key={way.entry.id} way={way} focusKit={way.entry.id === selectedId ? undefined : selectedId} back={back} grim={grim}
          inTropes={waysInTropes(way, tropes, kitKey)} />
      ) : chapter ? (
        <ChapterPage chapter={chapter} back={back} grim={grim} />
      ) : (
        <>
          {chapters.filter((c) => c.sections.length).map((c) => (
            <Link key={c.entry.id} to={link(c.entry.id)} className="lw-intro">
              <b>{c.entry.name}</b>{c.entry.description && <span><LitmRich text={c.entry.description.split("\n")[0]} /></span>}
            </Link>
          ))}
          <div className="lw-grid">
            {ways.map((w) => (
              <Link key={w.entry.id} to={link(w.entry.id)} className="lw-card">
                <h4>{w.entry.name}<small>{w.entry.name_original}</small></h4>
                {w.epigraph && <p className="lw-card__epi">{w.epigraph}</p>}
                <div className="lw-card__kits">{w.kits.map((k) => k.name).join(" · ")}</div>
              </Link>
            ))}
          </div>
          {chapters.filter((c) => !c.sections.length).length > 0 && (
            <div className="lw-more">
              {chapters.filter((c) => !c.sections.length).map((c) => (
                <Link key={c.entry.id} to={link(c.entry.id)}><b>{c.entry.name}</b>{c.entry.description && <span>{c.entry.description.split("\n")[0]}</span>}</Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
