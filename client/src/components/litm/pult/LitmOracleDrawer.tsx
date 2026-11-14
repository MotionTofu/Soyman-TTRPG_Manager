import { useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { DSeg } from "../../DSeg";
import { Modal } from "../../Modal";
import { compendiumPaths } from "../../../data/compendiumEntries";
import { readResource } from "../../../data/imperative";
import { resourceQuery, useAction, useResource, write } from "../../../data/hooks";
import { initiativePath } from "../../../combat/useCombat";
import { labelled } from "../../../data/notices";
import { linkAffects, linksPath, sessionPaths } from "../../../data/sessions";
import { statblockListPath } from "../../../data/statblocks";
import type { CompendiumEntry, InitiativeEntry, SessionNote, Statblock, SystemSection } from "../../../types";
import { BuilderOracle } from "../LitmOraclePreparation";
import { PremadeOracle, type OracleCardTarget } from "../LitmOraclePremade";
import { ActionOracle, ConflictOracle, ConsequenceOracle, QuestionOracle, RevelationOracle, type OracleEffect } from "../LitmOracleRolls";
import { challengeProfile, mightOf } from "../litmChallenge";
import { journeyOf } from "../litmJourneys";
import { ORACLE_INFO, oraclePath, oraclesOf, plainOracleText, type OracleKey } from "../litmOracles";
import { OracleHistory, OracleLanguage } from "../useLitmOracle";
import { consequenceActions } from "./consequence";
import type { GiveInitial } from "./LitmGiveStatus";
import type { LitmRibbon } from "./useLitmRibbon";
import { useLitmBook } from "./useLitmBook";
import "../litm-oracles.css";
import "./litm-oracle-drawer.css";

const MAIN_TABS = [
  { id: "yesNo", label: "Да / нет", short: "Да/нет" },
  { id: "interpretive", label: "Толкование", short: "Толков." },
  { id: "action", label: "Действие вызова", short: "Действие" },
  { id: "consequence", label: "Последствия", short: "Последствия" },
] as const;
const EXTRA_TABS = [
  { id: "conflict", label: "Конфликт" }, { id: "premade", label: "Готовый профиль" },
  { id: "builder", label: "Конструктор профиля" }, { id: "revelation", label: "Откровения" },
] as const;
type OracleTab = (typeof MAIN_TABS | typeof EXTRA_TABS)[number]["id"];
const TAB_ITEMS = MAIN_TABS.map(({ id, label, short }) => ({
  id,
  label: <><span className="lp-oracle__tab-long">{label}</span><span className="lp-oracle__tab-short">{short}</span></>,
}));
const EMPTY_SECTIONS: SystemSection[] = [];
const EMPTY_ENTRIES: CompendiumEntry[] = [];
const NOTE_PREFIX = "Оракул · ";

export function LitmOracleDrawer({ systemId, sessionId, campaignId, ribbon, spot, onGive, onClose }: {
  systemId: number; sessionId: number; campaignId?: number; ribbon: LitmRibbon;
  spot: { id: number; name: string } | null; onGive: (initial: GiveInitial) => void; onClose: () => void;
}) {
  const sections = useResource<SystemSection[]>(compendiumPaths.sections(systemId)).data ?? EMPTY_SECTIONS;
  const section = sections.find((s) => s.kind === "oracle");
  const rows = useResource<CompendiumEntry[]>(section ? compendiumPaths.sectionEntries(systemId, section.id) : null);
  const oracles = oraclesOf(rows.data ?? EMPTY_ENTRIES);
  const [tab, setTab] = useState<OracleTab>("yesNo");
  const [area, setArea] = useState<string | null>(null);
  const [english, setEnglish] = useState(false);
  const [pending, setPending] = useState(0);
  const noteQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [saved, setSaved] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const run = useAction();
  const notesPath = sessionPaths.notes(sessionId);
  const notes = useResource<{ notes: SessionNote[] }>(notesPath);
  const feed = (notes.data?.notes ?? []).filter((note) => note.text.startsWith(NOTE_PREFIX)).slice(-5).reverse();
  const key: OracleKey = tab === "yesNo" || tab === "interpretive" ? "question" : tab;
  const oracle = oracles.find((o) => o.data.key === key);
  const data = oracle?.data;
  const challengesId = sections.find((s) => s.kind === "monster")?.id;
  const extra = EXTRA_TABS.find((item) => item.id === tab);
  function choose(next: OracleTab) {
    setSaved("");
    if (next !== "premade") setArea(null);
    setTab(next);
    if (body.current) body.current.scrollTop = 0;
  }

  async function addNote(text: string) {
    setPending((n) => n + 1);
    try {
      const next = noteQueue.current.then(() => run(
        labelled("Запись Оракула на ленту", () => write.post<SessionNote>(notesPath, { text: NOTE_PREFIX + text })),
        { affects: [{ kind: "session", id: sessionId }], retry: false }
      ));
      noteQueue.current = next;
      return await next;
    } finally {
      setPending((n) => n - 1);
    }
  }

  function record(label: string, roll: string, result: string, rolled?: boolean) {
    if (rolled) void addNote(label + " [" + roll + "] · " + result);
  }

  function toFeed(text: string) {
    void addNote(text).then((note) => { if (note) setSaved("Записано в ленту сцены."); });
  }

  async function obstacle(entry: CompendiumEntry) {
    const linked = await run(labelled("Добавить в «Препятствия»", async () => {
      const existing = await readResource<{ to_type: string; to_id: number }[]>(linksPath("session", sessionId, "enemies"), { fresh: true });
      if (!existing.some((row) => row.to_type === "compendium_entry" && row.to_id === entry.id)) {
        await write.post("/links", {
          from_type: "session", from_id: sessionId, to_type: "compendium_entry", to_id: entry.id, section: "enemies", origin: "live",
        });
      }
      return true;
    }), { affects: [...linkAffects("session", sessionId), { path: sessionPaths.castUnion(sessionId) }], retry: false });
    if (linked) setSaved("«" + entry.name + "» в «Препятствиях».");
    return linked === true;
  }

  async function transfer({ entry, vignette }: OracleCardTarget): Promise<boolean> {
    if (vignette) {
      const journey = journeyOf(entry);
      const own = journey.vignettes.some((v) => v.name === vignette.name && v.nameEn === vignette.nameEn);
      const started = await ribbon.addVignette({ ...vignette, journeyId: own ? entry.id : null },
        own ? { entryId: entry.id, name: entry.name, kind: journey.kind, tags: journey.tags, consequences: journey.consequences } : undefined);
      if (started) setSaved("«" + vignette.name + "» на ленте Вызовов.");
      return started;
    }
    if (entry.kind !== "monster") return obstacle(entry);
    const ok = await run(() => ribbon.add({ type: "compendium_entry", id: entry.id, name: entry.name }),
      { affects: [{ path: initiativePath(sessionId) }], retry: false });
    if (ok) setSaved("«" + entry.name + "» на ленте Вызовов.");
    return ok === true;
  }

  function stayInside(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !section) return;
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest("a");
    if (!link || link.target === "_blank") return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || url.pathname !== "/systems/" + systemId || url.searchParams.get("section") !== String(section.id)) return;
    const target = oracles.find((o) => String(o.entry.id) === url.searchParams.get("entry"));
    if (!target || target.data.key === "question") return;
    event.preventDefault();
    setArea(url.searchParams.get("area"));
    choose(target.data.key);
  }

  function showEffect(effect: OracleEffect, challenge?: OracleChallenge) {
    const actions = consequenceActions(effect.text + (effect.suggested ? " " + effect.suggested : ""));
    const status = actions.find((action) => action.kind === "status");
    const example = challenge && !status ? /(?<!\*)\*([\p{L}-]+)\*(?!\*)/u.exec(effect.text) : null;
    const statusName = status?.name ?? example?.[1];
    const tier = status?.tier || challenge?.profile.rating || undefined;
    const self = status?.self ?? (example ? /получить\s*$/i.test(effect.text.slice(0, example.index)) : false);
    const scratch = actions.some((action) => action.kind === "scratch");
    const name = challenge?.row.name ?? "Оракул";
    const aspects = challenge?.profile.mightList.flatMap((m) => {
      const level = mightOf(m);
      return level && level !== "variable" ? [{ name: m.name, level }] : [];
    });
    const keys = self && challenge ? ["row:" + challenge.row.id] : spot ? ["hero:" + spot.id] : [];
    const grant = () => onGive({ keys, name: statusName, tier, source: { name, aspects } });
    return <div className="lo-actions lp-oracle__effects">
      <button type="button" className="d-btn d-btn--sm" onClick={grant} title={self ? challenge?.row.name : spot?.name}>
        {statusName && tier ? "Дать " + statusName + "-" + tier + "…" : "Дать статус…"}
      </button>
      {scratch && <button type="button" className="d-btn d-btn--sm" onClick={() => onGive({ keys, source: { name, aspects }, tags: "scratch" })}>Вычеркнуть тег…</button>}
      <button type="button" className="d-btn d-btn--sm d-btn--ghost" disabled={pending > 0}
        onClick={() => toFeed(name + " · " + plainOracleText(effect.text))}>В ленту</button>
    </div>;
  }

  return <Modal className="litm-book lp-oracle" ariaLabel="Оракул" onClose={onClose} autoFocus={false}>
    <header className="lp-oracle__head">
      <h2>Оракул</h2>
      <span className="lp-mono">Бросок ложится в ленту</span>
      {section && <Link className="d-btn d-btn--sm d-btn--ghost" target="_blank" rel="noopener" to={oraclePath(systemId, section.id, oracle?.entry.id)}>Открыть в справочнике ↗</Link>}
    </header>
    <div className="lp-oracle__tabs">
      <DSeg label="Оракулы пульта" items={TAB_ITEMS} value={MAIN_TABS.find((item) => item.id === tab)?.id} onChange={choose} />
      <select className="d-select" aria-label="Ещё оракулы" value="" onChange={(e) => {
        const found = EXTRA_TABS.find((item) => item.id === e.target.value);
        if (found) choose(found.id);
      }}>
        <option value="" disabled>Ещё</option>
        {EXTRA_TABS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </div>
    <div className="lo lp-oracle__body" ref={body} onClickCapture={stayInside}>
      <div className="lp-oracle__tools">
        <label className="lo-check"><input type="checkbox" checked={english} onChange={(event) => setEnglish(event.target.checked)} /> Английский рядом</label>
        <span role="status">{saved}</span>
      </div>
      {rows.loading && <p role="status">Загружаем Оракулы…</p>}
      {rows.error && <p role="alert">Не удалось загрузить Оракулы. <button type="button" className="d-btn d-btn--sm" onClick={rows.reload}>Повторить</button></p>}
      {!rows.loading && !rows.error && (!section || !data) && <p>Этот Оракул пока отсутствует в справочнике системы.</p>}
      <OracleLanguage.Provider value={english}><OracleHistory.Provider value={record}>
        {extra && oracle && <><h3 className="lo-heading">{oracle.entry.name}</h3><p className="lo-prose">{ORACLE_INFO[extra.id].summary}</p></>}
        {data?.key === "question" && <QuestionOracle key={tab} data={data} only={tab === "interpretive" ? "interpretive" : "yesNo"} />}
        {data?.key === "action" && <SceneAction data={data} systemId={systemId} ribbon={ribbon} renderResult={showEffect} />}
        {data?.key === "consequence" && <ConsequenceOracle data={data} renderResult={showEffect} />}
        {data?.key === "conflict" && <ConflictOracle data={data} sceneLabel="Итог в ленту"
          saveScene={(text) => toFeed("Конфликт · " + text)}
          areaLink={(name) => {
            const premade = oracles.find((item) => item.data.key === "premade");
            return section && premade ? oraclePath(systemId, section.id, premade.entry.id, name) : undefined;
          }} />}
        {data?.key === "premade" && <PremadeOracle key={area ?? ""} data={data} systemId={systemId} sections={sections} initialArea={area} isGM onTransfer={transfer} />}
        {data?.key === "builder" && <BuilderOracle data={data} systemId={systemId} challengesId={challengesId} campaignId={campaignId} isGM onSavedToScene={obstacle} />}
        {data?.key === "revelation" && <RevelationOracle data={data} />}
      </OracleHistory.Provider></OracleLanguage.Provider>
      <section className="lp-oracle__feed" aria-label="В ленте сцены · оракул">
        <h3 className="lo-heading">В ленте сцены · оракул</h3>
        {pending > 0 && <p role="status">Записываем в ленту…</p>}
        {feed.length > 0 && <ul>{feed.map((note) => <li key={note.id}>{note.text.slice(NOTE_PREFIX.length)}</li>)}</ul>}
        {!pending && !feed.length && <p>Здесь появятся броски Оракула и добавленные итоги.</p>}
      </section>
    </div>
  </Modal>;
}

interface OracleChallenge {
  row: InitiativeEntry;
  profile: ReturnType<typeof challengeProfile>;
}

function SceneAction({ data, systemId, ribbon, renderResult }: {
  data: Parameters<typeof ActionOracle>[0]["data"]; systemId: number; ribbon: LitmRibbon;
  renderResult: (effect: OracleEffect, challenge?: OracleChallenge) => ReactNode;
}) {
  const id = useId();
  const book = useLitmBook(systemId);
  const rows = ribbon.challenges.filter((row) => !ribbon.stateOf(row).vignette);
  const entities = rows.filter((row) => row.entity_type === "being" && row.entity_id != null);
  const sheets = useQueries({ queries: entities.map((row) => resourceQuery<Statblock[]>(statblockListPath("being", row.entity_id!))) });
  const settingProfiles = new Map(entities.map((row, index) => [row.id, sheets[index].data?.find((s) => s.format === "litm_challenge")]));
  const choices = rows.flatMap((row) => {
    const fromBook = row.entity_type === "compendium_entry" ? book.find((item) => item.entry.id === row.entity_id)?.profile : undefined;
    const sheet = settingProfiles.get(row.id);
    const profile = fromBook ?? (sheet ? challengeProfile({ name: row.name, name_original: "", description: "", data: {} }, sheet) : null);
    return profile ? [{ row, profile }] : [];
  });
  const [picked, setPicked] = useState<number | null>(null);
  const current = picked === 0 ? undefined : choices.find(({ row }) => row.id === picked) ?? choices[0];
  return <>
    {choices.length > 0 && <div className="lo-control lp-oracle__source">
      <label htmlFor={id}>Вызов в сцене</label>
      <select id={id} className="d-select" value={current?.row.id ?? 0} onChange={(event) => setPicked(Number(event.target.value))}>
        {choices.map(({ row, profile }) => <option key={row.id} value={row.id}>{row.name}{profile.roles.length ? " · " + profile.roles.join(" / ") : ""}</option>)}
        <option value={0}>Выбрать роль вручную</option>
      </select>
      {current && current.profile.rating > 0 && <span className="lp-mono">Рейтинг {current.profile.rating}</span>}
    </div>}
    <ActionOracle key={current?.row.id ?? "manual"} data={data} source={current?.row.name} sceneRoles={current?.profile.roles}
      renderResult={(effect) => renderResult(effect, current)} />
  </>;
}
