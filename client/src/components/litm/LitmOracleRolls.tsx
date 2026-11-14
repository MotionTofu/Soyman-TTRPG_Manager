import { Fragment, useContext, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DSeg } from "../DSeg";
import {
  DiceResult, OracleTable, OracleText, RollBar, RollButton,
} from "./LitmOracleParts";
import { OracleHistory, rollFrom, useOracleTable, type Picked } from "./useLitmOracle";

export interface OracleEffect { text: string; suggested?: string }
import { plainOracleText, throwDice, yesNoOutcome, type Action, type Consequences, type Conflict, type Question, type Revelation, type TableRow } from "./litmOracles";

export function QuestionOracle({ data, only }: { data: Question; only?: "yesNo" | "interpretive" }) {
  const record = useContext(OracleHistory);
  const [mode, setMode] = useState("yesNo");
  const [power, setPower] = useState(0);
  const [answer, setAnswer] = useState<{ roll: ReturnType<typeof throwDice>; total: number; key: string }>();
  const [question, setQuestion] = useState("");
  const [tableKey, setTableKey] = useState(data.interpretive.tables[0].key);
  const table = data.interpretive.tables.find((t) => t.key === tableKey) ?? data.interpretive.tables[0];
  const outcome = data.yesNo.outcomes.find((o) => o.key === answer?.key);
  function ask() {
    const roll = throwDice("2d6");
    const key = yesNoOutcome(roll.dice[0], roll.dice[1], power);
    const total = roll.value + power;
    setAnswer({ roll, total, key });
    record("Вопрос · да / нет", roll.dice.join(" + ") + " → " + total, [question.trim(), data.yesNo.outcomes.find((o) => o.key === key)?.name].filter(Boolean).join(" · "), true);
  }
  return <>
    {!only && <div className="lo-question-tabs"><DSeg label="Вид вопроса" items={[{ id: "yesNo", label: "Да / нет" }, { id: "interpretive", label: "Толкование" }]} value={mode} onChange={setMode} /></div>}
    {only !== "interpretive" && <section className={only || mode === "yesNo" ? "lo-question-pane is-active" : "lo-question-pane"}>
    <h4 className="lo-heading">Да или нет</h4>
    <p className="lo-prose"><OracleText text={data.yesNo.rule} en={data.yesNo.ruleEn} /></p>
    <RollBar>
      <input className="lo-question" aria-label="Вопрос да или нет" placeholder="Задайте вопрос (необязательно)" value={question} onChange={(e) => setQuestion(e.target.value)} />
      <span className="lo-control">Сила <span className="lo-power">
        <button type="button" aria-label="Уменьшить Силу" onClick={() => setPower(power - 1)}>−</button>
        <output aria-label="Сила">{power > 0 ? "+" + power : power}</output>
        <button type="button" aria-label="Увеличить Силу" onClick={() => setPower(power + 1)}>+</button>
      </span></span>
      <RollButton onClick={ask}>Бросить 2d6</RollButton>
      <DiceResult roll={answer?.roll} total={answer && String(answer.total)} />
      <strong role="status">{outcome && <OracleText text={outcome.name} en={outcome.nameEn} />}</strong>
    </RollBar>
    <div className="lo-outcomes">{data.yesNo.outcomes.map((o) => <div key={o.key} className={o === outcome ? "is-picked" : undefined}>
      <small>{o.range}</small><b><OracleText text={o.name} en={o.nameEn} /></b><OracleText text={o.text} en={o.textEn} />
    </div>)}</div>
    </section>}
    {only !== "yesNo" && <section className={only || mode === "interpretive" ? "lo-question-pane is-active" : "lo-question-pane"}>
    <h4 className="lo-heading">Толкование · d66</h4>
    <p className="lo-prose"><OracleText text={data.interpretive.rule} en={data.interpretive.ruleEn} /></p>
    <DSeg label="Таблица толкования" items={data.interpretive.tables.map((t) => ({ id: t.key, label: t.name, count: t.key === "symbol" ? t.rows.length : undefined }))} value={tableKey} onChange={setTableKey} />
    <Interpretation key={table.key} table={table} />
    </section>}
  </>;
}

function Interpretation({ table }: { table: Question["interpretive"]["tables"][number] }) {
  const { picked, select, roll } = useOracleTable(table.rows, "d66", "Вопрос · " + table.name, (r) => r.name ?? "");
  const columns = (row: TableRow) => [<Fragment key="meaning"><b><OracleText text={row.name ?? ""} en={row.nameEn} /></b>{row.text && <div><OracleText text={row.text} en={row.textEn} /></div>}</Fragment>];
  const midpoint = Math.ceil(table.rows.length / 2);
  return <>
    <RollBar>
      <RollButton onClick={roll}>Бросить d66</RollButton><DiceResult roll={picked?.dice} total={picked?.dice && String(picked.dice.value)} />
      <strong role="status">{picked?.row.name}</strong>
    </RollBar>
    {picked?.row.text && <p className="lo-prose"><OracleText text={picked.row.text} en={picked.row.textEn} /></p>}
    <div className="lo-two">{[table.rows.slice(0, midpoint), table.rows.slice(midpoint)].map((rows, i) =>
      <OracleTable key={i} rows={rows} columns={columns} columnNames={["d66", table.name]} selected={picked?.row} onPick={select} />)}</div>
  </>;
}

const SCALES = [{ id: "series", label: "Серия" }, { id: "adventure", label: "Приключение" }, { id: "scene", label: "Сцена" }];

export function ConflictOracle({ data, areaLink, saveScene, sceneLabel = "Сохранить как сцену" }: {
  data: Conflict; areaLink: (area: string) => string | undefined; saveScene?: (text: string) => void; sceneLabel?: string;
}) {
  const record = useContext(OracleHistory);
  const [scale, setScale] = useState("scene");
  const [active, setActive] = useState(0);
  const [concept, setConcept] = useState("");
  const [copied, setCopied] = useState(false);
  const [results, setResults] = useState<Record<number, Picked<TableRow>[] | "skip">>({});
  const col = data.columns[active];
  const next = data.columns.findIndex((_, i) => results[i] === undefined);
  function choose(index: number, picks: Picked<TableRow>[]) {
    if (!picks.length) return;
    setActive(index);
    setResults((prev) => ({ ...prev, [index]: picks }));
    record("Конфликт · " + data.columns[index].name, picks.map(({ dice, row }) => dice?.value ?? row.roll).join(" / "),
      picks.map(({ row }) => plainOracleText(row.text ?? "")).join(" · "), picks.some((p) => !!p.dice));
  }
  function entriesFor(index: number, row?: TableRow): Picked<TableRow>[] {
    const rows = data.columns[index].rows;
    const first = row ? { row } : rollFrom(rows, "d66");
    if (!first) return [];
    if (!first.row.again) return [first];
    const options = rows.filter((r) => !r.again);
    const another = () => {
      let pick = rollFrom(rows, "d66");
      while (pick?.row.again) pick = rollFrom(rows, "d66");
      return pick ?? { row: options[0] };
    };
    return [another(), another()];
  }
  function rollAll() {
    const pending = data.columns.flatMap((_, index) => results[index] === undefined ? [index] : []);
    for (const i of pending) choose(i, entriesFor(i));
  }
  const shown = results[active];
  const summary = data.columns.flatMap((_, i) => {
    const picks = results[i];
    return Array.isArray(picks) ? picks.map(({ row }) => plainOracleText(row.text ?? "")) : [];
  }).join(" ");
  const finalText = concept.trim() || summary;
  return <>
    <RollBar>
      <DSeg label="Масштаб конфликта" items={SCALES} value={scale} onChange={setScale} />
      <RollButton disabled={next < 0} onClick={() => choose(next, entriesFor(next))}>Бросить следующий</RollButton>
      <button type="button" className="d-btn d-btn--sm" disabled={next < 0} onClick={rollAll}>Все по очереди</button>
      <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={() => { setResults({}); setActive(0); setConcept(""); setCopied(false); }}>Начать заново</button>
    </RollBar>
    {scale === "series" && <p className="lo-prose"><OracleText text={data.scaleNote} en={data.scaleNoteEn} /></p>}
    <ol className="lo-steps">{data.columns.map((column, i) => {
      const picks = results[i];
      return <li key={column.key} className={i === active ? "is-active" : undefined}>
        <button type="button" className="d-btn d-btn--sm d-btn--ghost" aria-pressed={i === active} onClick={() => setActive(i)}>{column.name}</button>
        <span>{picks === "skip" ? "Пропущено" : picks?.map(({ row, dice }, j) => {
          const link = row.areaEn && areaLink(row.areaEn);
          return <span className="lo-conflict-result" key={j}>
            <DiceResult roll={dice} total={dice && String(dice.value)} /> <OracleText text={row.text ?? ""} en={row.textEn} />
            {row.note && <small><OracleText text={row.note} en={row.noteEn} /></small>}
            {link && <Link to={link}>{row.area} · {row.page}</Link>}
          </span>;
        })}</span>
        <span className="lo-actions">
          {picks === "skip" ? <button type="button" className="d-btn d-btn--sm" onClick={() => {
            setActive(i); setResults((prev) => { const copy = { ...prev }; delete copy[i]; return copy; });
          }}>Вернуть</button> : <>
            <button type="button" className="d-btn d-btn--sm" onClick={() => choose(i, entriesFor(i))}>{picks ? "Перебросить" : "Бросить d66"}</button>
            <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={() => setResults((prev) => ({ ...prev, [i]: "skip" }))}>Пропустить</button>
          </>}
        </span>
      </li>;
    })}</ol>
    <div className="lo-concept">
      <label htmlFor="lo-concept">Итог своими словами</label>
      <textarea id="lo-concept" value={concept} placeholder={summary || "Опишите, что происходит в сцене"} onChange={(e) => { setConcept(e.target.value); setCopied(false); }} />
      <div className="lo-actions">
        <button type="button" className="d-btn d-btn--sm" disabled={!finalText} onClick={async () => {
          try { await navigator.clipboard.writeText(finalText); setCopied(true); }
          catch { document.getElementById("lo-concept")?.focus(); }
        }}>{copied ? "Скопировано" : "Скопировать"}</button>
        {saveScene && <button type="button" className="d-btn d-btn--sm" disabled={!finalText} onClick={() => saveScene(finalText)}>{sceneLabel}</button>}
      </div>
    </div>
    <h4 className="lo-heading">{col.name} · d66</h4>
    <OracleTable rows={col.rows} columnNames={col.key === "location" ? ["d66", col.name, "Область книги"] : ["d66", col.name]}
      selected={Array.isArray(shown) ? shown.map(({ row }) => row) : undefined}
      columns={(r) => {
        const href = r.areaEn && areaLink(r.areaEn);
        return [
          <Fragment key="result"><OracleText text={r.text ?? ""} en={r.textEn} />{r.note && <small className="lo-secondary"><OracleText text={r.note} en={r.noteEn} /></small>}</Fragment>,
          ...(col.key === "location" ? [href ? <Link key="area" to={href}>{r.area} · {r.page}</Link> : null] : []),
        ];
      }}
      onPick={(r) => choose(active, entriesFor(active, r))} />
    <div className="lo-sr" role="status">{summary}</div>
  </>;
}

export function ActionOracle({ data, initialRole, sceneRoles, source, renderResult }: {
  data: Action; initialRole?: string; sceneRoles?: string[]; source?: string; renderResult?: (effect: OracleEffect) => ReactNode;
}) {
  const matches = data.roles.filter((role) => sceneRoles?.includes(role.role));
  const roles = matches.length ? matches : data.roles;
  const [key, setKey] = useState(roles.find((r) => r.role === initialRole)?.roleEn ?? roles[0].roleEn);
  const role = roles.find((r) => r.roleEn === key) ?? roles[0];
  return <>
    <DSeg items={roles.map((r) => ({ id: r.roleEn, label: r.role }))} value={role.roleEn} onChange={setKey} label="Роль Вызова" />
    <ActionTable key={role.roleEn} role={role} source={source} renderResult={renderResult} />
  </>;
}

function ActionTable({ role, source, renderResult }: {
  role: Action["roles"][number]; source?: string; renderResult?: (effect: OracleEffect) => ReactNode;
}) {
  const rows = useMemo(() => role.actions.flatMap((a) => a.consequences.map((c) => ({ ...c, action: a }))), [role]);
  const { picked, select, roll } = useOracleTable(rows, "d6", "Действие вызова · " + (source ? source + " · " : "") + role.role, (r) => r.text);
  const selected = rows.find((r) => r.roll === picked?.row.roll);
  return <>
    <RollBar>
      <RollButton onClick={roll}>Бросить d6</RollButton><DiceResult roll={picked?.dice} />
      <span role="status">{selected && <><b>{selected.action.name ? selected.action.name + " · " : ""}</b><OracleText text={selected.text} en={selected.textEn} /></>}</span>
    </RollBar>
    {selected && renderResult?.({ text: selected.text })}
    <OracleTable rows={rows} columnNames={["d6", "Действие и угроза", "Последствие"]} selected={selected} onPick={select}
      columns={(r) => [<Fragment key="action"><b><OracleText text={r.action.name} en={r.action.nameEn} /></b><small className="lo-secondary"><OracleText text={r.action.threat} en={r.action.threatEn} /></small></Fragment>,
        <OracleText key="consequence" text={r.text} en={r.textEn} />]} />
  </>;
}

export function ConsequenceOracle({ data, renderResult }: {
  data: Consequences; renderResult?: (effect: OracleEffect) => ReactNode;
}) {
  const { picked, select, roll } = useOracleTable(data.rows, "d66", "Последствия", (r) => r.name);
  const record = useContext(OracleHistory);
  const [specific, setSpecific] = useState<Picked<Consequences["rows"][number]["specific"][number]>>();
  function refine() {
    if (!picked) return;
    const next = rollFrom(picked.row.specific, "d6");
    if (!next) return;
    setSpecific(next);
    record("Последствия · " + picked.row.name, String(next.dice?.value), plainOracleText(next.row.text), true);
  }
  return <>
    <RollBar>
      <RollButton onClick={() => { setSpecific(undefined); roll(); }}>Бросить d66</RollButton>
      <DiceResult roll={picked?.dice} total={picked?.dice && String(picked.dice.value)} />
      <b role="status">{picked?.row.name}</b>
      <button type="button" className="d-btn d-btn--sm" disabled={!picked} onClick={refine}>Уточнить d6</button>
      <DiceResult roll={specific?.dice} />
      {specific && <span role="status"><OracleText text={specific.row.text} en={specific.row.textEn} /></span>}
    </RollBar>
    {picked && renderResult?.({
      text: picked.row.name + " · " + (specific?.row.text ?? picked.row.text),
      suggested: picked.row.effect,
    })}
    <OracleTable rows={data.rows} columnNames={["d66", "Последствие действия", "Точнее · d6"]} selected={picked?.row}
      onPick={(r) => { setSpecific(undefined); select(r); }} className="lo-conseq"
      columns={(r) => [<Fragment key="summary"><b><OracleText text={r.name} en={r.nameEn} /></b>
        <div><OracleText text={r.text} en={r.textEn} /></div><small className="lo-secondary"><OracleText text={r.effect} en={r.effectEn} /></small></Fragment>,
        <div key="specific" className="lo-specific">{r.specific.map((s) => <button key={s.roll} type="button" className={s === specific?.row ? "is-picked" : undefined}
          onClick={() => { if (r !== picked?.row) select(r); setSpecific({ row: s }); record("Последствия · " + r.name, s.roll, plainOracleText(s.text)); }}>
          <small>{s.roll}</small> <OracleText text={s.text} en={s.textEn} /></button>)}</div>]} />
  </>;
}

const ACTS = [{ id: "act1", label: "I" }, { id: "act2", label: "II" }, { id: "act3", label: "III" }] as const;
export function RevelationOracle({ data }: { data: Revelation }) {
  const [act, setAct] = useState<(typeof ACTS)[number]["id"]>("act1");
  return <RevelationTable key={act} data={data} act={act} setAct={setAct} />;
}

function RevelationTable({ data, act, setAct }: {
  data: Revelation; act: (typeof ACTS)[number]["id"]; setAct: (act: (typeof ACTS)[number]["id"]) => void;
}) {
  const label = ACTS.find((a) => a.id === act)?.label;
  const { picked, select, roll } = useOracleTable(data.rows, "d66", "Откровения · акт " + label, (r) => r[act]);
  return <>
    <RollBar>
      <DSeg label="Акт" items={ACTS} value={act} onChange={setAct} />
      <RollButton onClick={roll}>Бросить d66</RollButton>
      <DiceResult roll={picked?.dice} total={picked?.dice && String(picked.dice.value)} />
      <span role="status">{picked && <OracleText text={picked.row[act]} en={picked.row[`${act}En`]} />}</span>
    </RollBar>
    <OracleTable rows={data.rows} columnNames={["d66", ...ACTS.map((a) => <span key={a.id} className={act === a.id ? "lo-current" : "lo-other"}>Акт {a.label}</span>)]}
      className="lo-revelation" selected={picked?.row} onPick={select} columns={(r) => ACTS.map((a) =>
        <div key={a.id} className={act === a.id ? "lo-current" : "lo-other"}><OracleText text={r[a.id]} en={r[`${a.id}En`]} /></div>)} />
  </>;
}
