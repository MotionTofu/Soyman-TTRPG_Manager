import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentUser } from "../../api/currentUser";
import { compendiumPaths } from "../../data/compendiumEntries";
import { useResource } from "../../data/hooks";
import type { CompendiumEntry, SystemSection } from "../../types";
import { OracleText } from "./LitmOracleParts";
import { OracleHistory, OracleLanguage } from "./useLitmOracle";
import { ActionOracle, ConflictOracle, ConsequenceOracle, QuestionOracle, RevelationOracle } from "./LitmOracleRolls";
import { BuilderOracle, SaveOracleScene } from "./LitmOraclePreparation";
import { PremadeOracle } from "./LitmOraclePremade";
import { ORACLE_INFO, oraclePath, oraclesOf } from "./litmOracles";
import "./litm-oracles.css";

const EMPTY_ENTRIES: CompendiumEntry[] = [];
const EMPTY_SECTIONS: SystemSection[] = [];

type Recent = { label: string; roll: string; result: string };

function readHistory(key: string): Recent[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is Recent =>
      item && typeof item.label === "string" && typeof item.roll === "string" && typeof item.result === "string").slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function LitmOraclesToc({ systemId, sectionId, selectedId }: {
  systemId: number; sectionId: number; selectedId?: number;
}) {
  const entries = useResource<CompendiumEntry[]>(compendiumPaths.sectionEntries(systemId, sectionId)).data ?? EMPTY_ENTRIES;
  return <div className="litm-book litm-book--toc lg-toc">
    {oraclesOf(entries).map(({ entry }) => <Link key={entry.id} className={"lg-toc__ch" + (entry.id === selectedId ? " is-on" : "")}
      aria-current={entry.id === selectedId ? "page" : undefined} to={oraclePath(systemId, sectionId, entry.id)}>
      <span>{entry.name}</span>
    </Link>)}
  </div>;
}

export function LitmOraclesView(props: { systemId: number; sectionId: number; entries: CompendiumEntry[]; selectedId?: number }) {
  const { user, loading } = useCurrentUser();
  if (loading) return <p className="lb-empty">Загрузка Оракулов…</p>;
  const storageKey = "soyman.litm.oracles." + (user?.id ?? "local") + "." + props.systemId;
  return <Oracles key={storageKey} {...props} storageKey={storageKey} isGM={user?.role === "gm"} />;
}

function Oracles({ systemId, sectionId, entries, selectedId, storageKey, isGM }: {
  systemId: number; sectionId: number; entries: CompendiumEntry[]; selectedId?: number; storageKey: string; isGM: boolean;
}) {
  const [search] = useSearchParams();
  const [history, setHistory] = useState(() => readHistory(storageKey));
  const [bilingual, setBilingual] = useState(false);
  const [scene, setScene] = useState("");
  const sections = useResource<SystemSection[]>(compendiumPaths.sections(systemId)).data ?? EMPTY_SECTIONS;
  const rulesSection = sections.find((s) => s.name === "Справочник");
  const rules = useResource<CompendiumEntry[]>(rulesSection ? compendiumPaths.sectionEntries(systemId, rulesSection.id) : null).data ?? EMPTY_ENTRIES;
  const rule = rules.find((e) => e.name_original === "Playing with the Oracle" || e.name === "Игра с оракулом");
  const ruleLink = rule ? oraclePath(systemId, rule.section_id, rule.id) : undefined;
  const oracles = oraclesOf(entries);
  const oracle = oracles.find(({ entry }) => entry.id === selectedId);
  const data = oracle?.data;
  const home = oraclePath(systemId, sectionId);
  const link = (key: typeof oracles[number]["data"]["key"], area?: string) => {
    const entry = oracles.find((o) => o.data.key === key)?.entry;
    return entry && oraclePath(systemId, sectionId, entry.id, area);
  };
  function record(label: string, roll: string, result: string) {
    setHistory((previous) => [{ label, roll, result }, ...previous].slice(0, 12));
  }
  // История принадлежит аккаунту в этом браузере и не отправляется в кампанию.
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(history)); } catch { /* storage may be disabled */ }
  }, [history, storageKey]);
  const recent = <RecentRolls values={history} clear={() => setHistory([])} />;
  if (!oracle || !data) return <div className="lo">
    <div className="lb-head"><h2>Оракулы</h2><span className="lg-count">{oracles.length} оракулов · соло, кооп и за столом</span></div>
    {oracles.length > 0 && <>
      <div className="lo-how">
        <div><h3>Толкуйте ответ</h3><p>Используйте результат как подсказку и решите, что он значит в вашей истории.</p></div>
        <div><h3>d6 и d66</h3><p>d6 — одна кость. Для d66 первая кость даёт десятки, вторая — единицы. Можно выбрать строку таблицы вручную.</p></div>
        <div><h3>Соло, кооп и за столом</h3><p>Оракул подсказывает, какая сцена следующая и что делает Вызов.</p></div>
      </div>
      <div className="lo-layout">
        <div className="lo-cards">{oracles.map(({ entry, data: o }) => <Link key={entry.id} to={oraclePath(systemId, sectionId, entry.id)} className="lo-index-card">
          <h3>{entry.name}<small lang="en">{entry.name_original}</small></h3>
          <p>{ORACLE_INFO[o.key].summary}</p>
          <footer><span>{ORACLE_INFO[o.key].dice}</span><b>с. {o.page} ›</b></footer>
        </Link>)}
          {ruleLink && <Link to={ruleLink} className="lo-index-card lo-rule-card">
            <h3>{rule?.name}<small lang="en">{rule?.name_original}</small></h3>
            <p>Порядок игры в одиночку и в коопе.</p>
            <footer><span>Статья Справочника</span><b>с. {String(rule?.data?.page ?? "B238")} ›</b></footer>
          </Link>}
        </div>
        {recent}
      </div>
    </>}
  </div>;
  const area = search.get("area");
  return <OracleLanguage.Provider value={bilingual}><OracleHistory.Provider value={record}>
    <div className="lo">
      <article className="lo-page" aria-label={oracle.entry.name}>
        <div className="lo-top">
          <Link to={home} className="lb-back">← Оракулы</Link>
          <label className="lo-check"><input type="checkbox" checked={bilingual} onChange={(e) => setBilingual(e.target.checked)} /> Английский рядом</label>
        </div>
        <div className="lb-art__head"><h3>{oracle.entry.name}<span className="lb-orig" lang="en">[{oracle.entry.name_original}]</span></h3></div>
        <div className="lb-file"><span className="lb-kind">Оракул</span><span>{ORACLE_INFO[data.key].dice}</span><span>с. {data.page}</span></div>
        {oracle.entry.description && <p className="lo-prose"><OracleText text={oracle.entry.description} en={data.leadEn} /></p>}
        {data.key === "question" && <QuestionOracle data={data} />}
        {data.key === "conflict" && <ConflictOracle data={data} areaLink={(name) => link("premade", name)} saveScene={isGM ? setScene : undefined} />}
        {data.key === "premade" && <PremadeOracle key={area ?? ""} data={data} systemId={systemId} sections={sections} initialArea={area} isGM={isGM} />}
        {data.key === "builder" && <BuilderOracle data={data} systemId={systemId} challengesId={sections.find((s) => s.kind === "monster")?.id} actionPath={link("action")} isGM={isGM} />}
        {data.key === "action" && <ActionOracle data={data} initialRole={search.get("role") ?? undefined} />}
        {data.key === "consequence" && <><ConsequenceOracle data={data} />{link("action") && <p><Link to={link("action") ?? home}>Оракул «Действие вызова»</Link></p>}</>}
        {data.key === "revelation" && <><RevelationOracle data={data} />{link("conflict") && <p><Link to={link("conflict") ?? home}>Оракул «Конфликт»</Link></p>}</>}
      </article>
      {recent}
      <nav className="lo-other-oracles" aria-label="Оракулы">
        {oracles.filter((o) => o !== oracle).map(({ entry }) => <Link key={entry.id} to={oraclePath(systemId, sectionId, entry.id)}>{entry.name}</Link>)}
        {ruleLink && <Link to={ruleLink}>Игра с оракулом</Link>}
      </nav>
    </div>
    {scene && isGM && <SaveOracleScene systemId={systemId} text={scene} onClose={() => setScene("")} />}
  </OracleHistory.Provider></OracleLanguage.Provider>;
}

function RecentRolls({ values, clear }: { values: Recent[]; clear: () => void }) {
  return <aside className="lo-recent">
    <details open>
      <summary>Последние броски</summary>
      {!values.length ? <p>Здесь появятся ваши результаты.</p> : <>
        <ul>{values.map((r, i) => <li key={i}><small>{r.label}</small><b>{r.roll}</b><span>{r.result}</span></li>)}</ul>
        <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={clear}>Очистить</button>
      </>}
    </details>
  </aside>;
}
