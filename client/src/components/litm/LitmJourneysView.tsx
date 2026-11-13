import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { compendiumPaths } from "../../data/compendiumEntries";
import { useResource } from "../../data/hooks";
import type { CompendiumEntry } from "../../types";
import { Consequence, LitmRich } from "./LitmBook";
import { Paras } from "./LitmGrimoireView";
import { paras, plural } from "./litmBookText";
import { grimoireHref } from "./useGrimoire";
import { journeysOf, toggleStep, type Journey, type JourneyGroup, type Vignette } from "./litmJourneys";

const NO_ENTRIES: CompendiumEntry[] = [];
const NO_LINKS = { article: () => null, rule: () => null };
const GAPS = ["минуты", "часы", "дни", "недели"];

function VignetteCard({ v, step, onStep }: { v: Vignette; step?: number; onStep?: () => void }) {
  return (
    <div className={`lj-vc${v.blocksPath ? " lj-vc--block" : ""}${step ? " is-on" : ""}`}>
      <header>
        <h4>{v.name}</h4>
        {step !== undefined && step > 0 && <span className="lj-vc__n">шаг {step}</span>}
      </header>
      {v.threat && <p className="lj-vc__thr" title={v.nameEn || undefined}><LitmRich text={v.threat} /></p>}
      <ul className="lj-cons">{v.consequences.map((c, k) => <li key={k}><Consequence text={c} /></li>)}</ul>
      <div className="lj-vc__acts">
        {onStep && <button type="button" className="d-btn d-btn--sm d-btn--quiet" aria-pressed={!!step} onClick={onStep}>{step ? "Убрать из шагов" : "Шагом"}</button>}
        {v.blocksPath && <span className="lj-blk is-on">блокирует путь</span>}
      </div>
    </div>
  );
}

/** Полоса игры (доска Litm-Journey): шагов 1–6 или d6, время между шагами. */
function PlayStrip({ steps, setSteps, gap, setGap }: { steps: number; setSteps: (n: number) => void; gap: string; setGap: (g: string) => void }) {
  return (
    <div className="lj-play">
      <span className="lb-lbl">Шагов</span>
      <span className="lj-dice" role="radiogroup" aria-label="Число шагов">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={n === steps} className={n === steps ? "is-on" : ""} onClick={() => setSteps(n)}>{n}</button>
        ))}
      </span>
      <label className="lj-gap"><span className="lb-lbl">между шагами</span>
        <select value={gap} onChange={(e) => setGap(e.target.value)}>{GAPS.map((g) => <option key={g}>{g}</option>)}</select>
      </label>
      <span className="lj-play__note">Виньетка — одно Быстрое действие</span>
      <button type="button" className="d-btn d-btn--sm d-btn--quiet lj-play__roll" onClick={() => setSteps(1 + Math.floor(Math.random() * 6))}>Бросить d6</button>
    </div>
  );
}

function JourneyPage({ j, back, backLabel }: { j: Journey; back: string; backLabel: string }) {
  const e = j.entry;
  const [steps, setSteps] = useState(3);
  const [gap, setGap] = useState("часы");
  const [picked, setPicked] = useState<number[]>([]);
  const changeSteps = (n: number) => { setSteps(n); setPicked((p) => p.slice(0, n)); };
  return (
    <article className="lb-art lj-art" aria-label={`Путешествие: ${e.name}`}>
      <div className="lb-crumbs"><Link className="lb-back" to={back}>← {backLabel}</Link></div>
      <div className="lb-art__head">
        <h3>{e.name}{e.name_original && <span className="lb-orig">[{e.name_original}]</span>}</h3>
      </div>
      <div className="lb-file">
        <span className="lb-kind">Путешествие</span>
        {j.kind && <span>{j.kind}</span>}
        <span>{j.vignettes.length} {plural(j.vignettes.length, "виньетка", "виньетки", "виньеток")}</span>
        {j.page && <span>с. {j.page}</span>}
      </div>
      {e.description && <div className="lb-lead"><Paras lines={paras(e.description)} grim={NO_LINKS} /></div>}
      {j.tags.length > 0 && (
        <>
          <div className="lb-lbl">Теги {j.kind === "Местность" ? "местности" : "путешествия"}</div>
          <div className="lb-tags lj-tags">{j.tags.map((t) => <span key={t} className="lb-ts">{t}</span>)}</div>
        </>
      )}
      <PlayStrip steps={steps} setSteps={changeSteps} gap={gap} setGap={setGap} />
      {j.consequences.length > 0 && (
        <>
          <div className="lb-lbl">Общие последствия<small>на любом шаге</small></div>
          <ul className="lj-cons lj-cons--common">{j.consequences.map((c, k) => <li key={k}><Consequence text={c} /></li>)}</ul>
        </>
      )}
      {j.benefits && <aside className="lj-benefit"><b>Выгода</b><LitmRich text={j.benefits} /></aside>}
      <section className="lj-sec">
        <h4 className="lb-lbl">Виньетки<small>Vignettes · {j.vignettes.length} · отметьте шаги — {picked.length} из {steps}, между шагами {gap}</small></h4>
        <div className="lj-grid">
          {j.vignettes.map((v, i) => (
            <VignetteCard key={v.name} v={v} step={picked.indexOf(i) + 1} onStep={() => setPicked((p) => toggleStep(p, i, steps))} />
          ))}
        </div>
      </section>
      {j.page && <div className="lb-src">Legend in the Mist · том II · с. {j.page}</div>}
    </article>
  );
}

function GroupPage({ g, back, link }: { g: JourneyGroup; back: string; link: (id: number) => string }) {
  const e = g.entry;
  const text = paras(e.description ?? "").filter((p) => !p.startsWith("Источник:"));
  return (
    <article className="lb-art lj-art" aria-label={e.name}>
      <div className="lb-crumbs"><Link className="lb-back" to={back}>← Путешествия</Link></div>
      <div className="lb-art__head"><h3>{e.name}{e.name_original && <span className="lb-orig">[{e.name_original}]</span>}</h3></div>
      {text.length > 0 && <div className={g.journeys.length ? "lb-lead" : "lj-rule"}><Paras lines={text} grim={NO_LINKS} /></div>}
      {g.journeys.length > 0 && <JourneyCards journeys={g.journeys} link={link} />}
      {g.vignetteGroups.map((vg) => (
        <section key={vg.name} className="lj-sec">
          <h4 className="lb-lbl">{vg.name}<small>{vg.nameEn} · {vg.vignettes.length}{vg.page && ` · с. ${vg.page}`}</small></h4>
          {vg.intro && <p className="lj-intro"><LitmRich text={vg.intro} /></p>}
          <div className="lj-grid">{vg.vignettes.map((v) => <VignetteCard key={v.name} v={v} />)}</div>
        </section>
      ))}
      {g.page && <div className="lb-src">Legend in the Mist · том II · с. {g.page}</div>}
    </article>
  );
}

function JourneyCards({ journeys, link }: { journeys: Journey[]; link: (id: number) => string }) {
  return (
    <div className="lj-cards">
      {journeys.map((j) => (
        <Link key={j.entry.id} to={link(j.entry.id)} className="lj-card">
          <h4>{j.entry.name}<small>{j.entry.name_original}</small></h4>
          {j.tags.length > 0 && <span className="lj-card__tags">{j.tags.join(" · ")}</span>}
          <span className="lj-card__n">{j.vignettes.length} {plural(j.vignettes.length, "виньетка", "виньетки", "виньеток")}{j.page && ` · с. ${j.page}`}</span>
        </Link>
      ))}
    </div>
  );
}

/** Оглавление «Путешествий» под пунктом раздела: группы, открытая — с путешествиями. */
export function LitmJourneysToc({ systemId, sectionId, selectedId }: { systemId: number; sectionId: number; selectedId: number | undefined }) {
  const entries = useResource<CompendiumEntry[]>(compendiumPaths.sectionEntries(systemId, sectionId)).data ?? NO_ENTRIES;
  const groups = useMemo(() => journeysOf(entries), [entries]);
  const link = (id: number) => grimoireHref(systemId, sectionId, id);
  const open = groups.find((g) => g.entry.id === selectedId || g.journeys.some((j) => j.entry.id === selectedId));
  return (
    <div className="litm-book litm-book--toc lg-toc">
      {groups.map((g) => {
        const n = g.journeys.length || g.vignetteGroups.reduce((s, x) => s + x.vignettes.length, 0);
        return (
          <div key={g.entry.id} className={g === open ? "is-open" : ""}>
            <Link to={link(g.entry.id)} className={`lg-toc__ch${g.entry.id === selectedId ? " is-on" : ""}`}>
              <span>{g.entry.name}</span>{n > 0 && <b>{n}{g.journeys.length ? (g === open ? " ▴" : " ▾") : ""}</b>}
            </Link>
            {g === open && g.journeys.length > 0 && (
              <ul className="lg-rows">
                {g.journeys.map((j) => (
                  <li key={j.entry.id}>
                    <Link to={link(j.entry.id)} className={`lg-row${j.entry.id === selectedId ? " is-on" : ""}`} aria-current={j.entry.id === selectedId ? "page" : undefined}>
                      <span>{j.entry.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** «Путешествия» LitM по доскам Litm-Journey: правило, группы карточками, путешествие с шагами и виньетками. */
export function LitmJourneysView({ systemId, sectionId, entries, selectedId }: {
  systemId: number;
  sectionId: number;
  entries: CompendiumEntry[];
  selectedId: number | undefined;
}) {
  const groups = useMemo(() => journeysOf(entries), [entries]);
  const link = (id: number) => grimoireHref(systemId, sectionId, id);
  const back = `/systems/${systemId}?section=${sectionId}`;
  const total = groups.reduce((n, g) => n + g.journeys.length, 0);
  const group = groups.find((g) => g.entry.id === selectedId);
  const owner = groups.find((g) => g.journeys.some((j) => j.entry.id === selectedId));
  const journey = owner?.journeys.find((j) => j.entry.id === selectedId);
  return (
    <div className="lg lj">
      <div className="lb-head">
        <h2>Путешествия</h2>
        <span className="d-mono">{total} {plural(total, "путешествие", "путешествия", "путешествий")}</span>
      </div>
      {journey && owner ? (
        <JourneyPage key={journey.entry.id} j={journey} back={link(owner.entry.id)} backLabel={owner.entry.name} />
      ) : group ? (
        <GroupPage g={group} back={back} link={link} />
      ) : (
        <div className="lj-contents">
          {groups.filter((g) => !g.journeys.length && !g.vignetteGroups.length).map((g) => (
            <Link key={g.entry.id} to={link(g.entry.id)} className="lw-intro">
              <b>{g.entry.name}</b>{g.entry.description && <span><LitmRich text={paras(g.entry.description)[0] ?? ""} /></span>}
            </Link>
          ))}
          {groups.filter((g) => g.journeys.length).map((g) => (
            <section key={g.entry.id}>
              <h3><Link to={link(g.entry.id)}>{g.entry.name}</Link><small>{g.journeys.length}</small></h3>
              <JourneyCards journeys={g.journeys} link={link} />
            </section>
          ))}
          {groups.filter((g) => g.vignetteGroups.length).map((g) => (
            <Link key={g.entry.id} to={link(g.entry.id)} className="lw-intro">
              <b>{g.entry.name}</b>
              <span>{g.vignetteGroups.map((x) => `${x.name} · ${x.vignettes.length}`).join(" — ")}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
