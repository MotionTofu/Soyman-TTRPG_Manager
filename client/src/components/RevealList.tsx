// Список выводов — узловой дизайн за столом (гриллинг 2026-09-28, Q6/Q14/Q16).
//
// Мастеру за столом нужен не холст, а ответ «что партия уже может знать и
// куда ей идти»: строка на узел, отметка «не известен / известен / посещён»,
// «найдено N из M» и, по щелчку, ненайденные улики с местом. Один компонент
// на вкладке приключения и на Пульте.
//
// Вне кампании (Q27) — одна структура: ни отметок, ни галочек.

import { useState } from "react";
import { useAction, useResource, write } from "../data/hooks";
import { clueAffects } from "../data/canvas";
import { nodeLabel } from "../sceneKinds";
import type { ArcClue, ArcClueNode, ArcClues } from "../types";
import "./RevealList.css";

type Mark = "unknown" | "known" | "done";

const MARK_LABEL: Record<Mark, string> = { unknown: "не известен", known: "известен", done: "посещён" };

export function RevealList({
  arcId,
  campaignId,
  focusArcId = null,
}: {
  arcId: number;
  campaignId: number | null;
  /** Глава (или корень) текущей сцены: раскрыта только она, остальные свёрнуты. */
  focusArcId?: number | null;
}) {
  const act = useAction();
  const data = useResource<ArcClues>(`/story/arcs/${arcId}/clues${campaignId ? `?campaign_id=${campaignId}` : ""}`).data;
  const [open, setOpen] = useState<string | null>(null);
  // Свёрнутость главы — по щелчку Мастера; до щелчка решает focusArcId.
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  if (!data) return <p className="muted">Загрузка…</p>;

  const inCampaign = campaignId != null;
  const nameOf = (id: number | null) => data.nodes.find((n) => n.id === id)?.name ?? "?";
  // Предложенные, но не принятые улики за столом не существуют (Q29).
  const into = (type: "scene" | "secret", id: number) =>
    data.clues.filter((c) => c.target_type === type && c.target_id === id && !c.proposed);

  const setFound = (c: ArcClue, found: boolean) =>
    act(() => write.put(`/story/clues/${c.id}/state`, { campaign_id: campaignId, found }), { affects: clueAffects() });
  const arrived = (n: ArcClueNode) =>
    act(() => write.put(`/story/scenes/${n.shown_id}/state`, { campaign_id: campaignId, status: "done" }), {
      affects: clueAffects(),
    });

  const nodeMark = (n: ArcClueNode, clues: ArcClue[]): Mark =>
    n.visited ? "done" : n.role === "start" || clues.some((c) => c.found) ? "known" : "unknown";

  const clueRows = (key: string, clues: ArcClue[]) =>
    open === key && (
      <div className="reveal__sub">
        {clues.length === 0 && <span className="muted">Улик сюда нет.</span>}
        {clues.map((c) => (
          <label key={c.id} className={`reveal__clue${c.found ? " is-found" : ""}`}>
            {inCampaign && (
              <input type="checkbox" checked={c.found} onChange={(e) => void setFound(c, e.target.checked)} />
            )}
            <span className="reveal__clue-text">{c.text}</span>
            <span className="reveal__clue-meta">
              в: {nameOf(c.node_id)}
              {c.how && ` · ${c.how}`}
            </span>
          </label>
        ))}
      </div>
    );

  // right — короткое («1 / 3», «посещён») справа; note — длинное («проход из
  // «…»») второй строкой: справа оно наезжало на имя на телефоне.
  const row = (
    key: string,
    mark: Mark,
    name: string,
    label: string | null,
    right: string,
    clues: ArcClue[],
    secret = false,
    note: string | null = null
  ) => (
    <div key={key}>
      <button
        type="button"
        className={`reveal__row${open === key ? " is-open" : ""}${mark === "done" ? " is-done" : ""}`}
        aria-expanded={open === key}
        onClick={() => setOpen(open === key ? null : key)}
      >
        <span
          className={`reveal__mark reveal__mark--${inCampaign ? mark : "unknown"}${secret ? " reveal__mark--secret" : ""}`}
          title={inCampaign ? MARK_LABEL[mark] : undefined}
        />
        <span className="reveal__name">
          {name}
          {label && <span className="reveal__type">{label}</span>}
        </span>
        <span className="reveal__count">{right}</span>
        {note && <span className="reveal__note">{note}</span>}
      </button>
      {clueRows(key, clues)}
    </div>
  );

  const nodeRow = (n: ArcClueNode) => {
    const clues = into("scene", n.id);
    const found = clues.filter((c) => c.found).length;
    const mark = nodeMark(n, clues);
    let right: string;
    if (inCampaign && n.visited) right = "посещён";
    else if (clues.length === 0) right = n.role === "start" ? "старт" : n.passage_from.length ? "проход" : "нет улик";
    else right = inCampaign ? `${found} / ${clues.length}` : `улик ${clues.length}`;
    const note = n.passage_from.length ? `проход из «${n.passage_from.join("», «")}»` : null;
    // «Узел» — подпись по умолчанию, у непомеченных она только шумит.
    const label = n.node_type || n.role !== "normal" ? nodeLabel({ node_type: n.node_type, node_role: n.role }) : null;
    return row(`n${n.id}`, mark, n.name, label, right, clues, false, note);
  };

  // Посещённые — вниз: за столом важнее то, куда ещё не ходили.
  const sortNodes = (list: ArcClueNode[]) =>
    inCampaign ? [...list].sort((a, b) => Number(a.visited) - Number(b.visited)) : list;
  const reactive = data.nodes.filter((n) => n.role !== "proactive");
  const groups = [
    { key: "root", name: data.chapters.length ? "Без главы" : null, nodes: reactive.filter((n) => n.arc_id === data.root_arc_id) },
    ...data.chapters.map((c) => ({ key: `c${c.id}`, name: c.name, nodes: reactive.filter((n) => n.arc_id === c.id) })),
  ].filter((g) => g.nodes.length > 0);
  const focusKey =
    focusArcId == null ? null : focusArcId === data.root_arc_id ? "root" : groups.some((g) => g.key === `c${focusArcId}`) ? `c${focusArcId}` : null;
  const secrets = data.secrets.filter((t) => into("secret", t.id).length > 0);
  const proactive = data.nodes.filter((n) => n.role === "proactive");

  if (data.nodes.length === 0) return <p className="muted">В приключении пока нет сцен.</p>;

  return (
    <div className="reveal">
      {inCampaign && (
        <div className="reveal__legend">
          {(Object.keys(MARK_LABEL) as Mark[]).map((m) => (
            <span key={m}>
              <span className={`reveal__mark reveal__mark--${m}`} />
              {MARK_LABEL[m]}
            </span>
          ))}
        </div>
      )}

      {groups.map((g) => {
        const isFolded = folded[g.key] ?? (focusKey != null && groups.length > 1 && g.key !== focusKey);
        const done = inCampaign ? g.nodes.filter((n) => n.visited).length : null;
        return (
          <section key={g.key} className="reveal__group">
            <button
              type="button"
              className="reveal__group-head reveal__group-toggle"
              aria-expanded={!isFolded}
              onClick={() => setFolded((prev) => ({ ...prev, [g.key]: !isFolded }))}
            >
              <span>
                {isFolded ? "▸" : "▾"} {g.name ?? "Узлы"}
              </span>
              <span>
                {isFolded
                  ? done != null
                    ? `посещено ${done} / ${g.nodes.length}`
                    : `узлов ${g.nodes.length}`
                  : inCampaign
                    ? "найдено"
                    : ""}
              </span>
            </button>
            {!isFolded && sortNodes(g.nodes).map(nodeRow)}
          </section>
        );
      })}

      {secrets.length > 0 && (
        <section className="reveal__group">
          <div className="reveal__group-head">
            <span>Тайны</span>
          </div>
          {secrets.map((t) => {
            const clues = into("secret", t.id);
            const found = clues.filter((c) => c.found).length;
            const mark: Mark = t.revealed ? "done" : found > 0 ? "known" : "unknown";
            const right = inCampaign ? (t.revealed ? "раскрыта" : `${found} / ${clues.length}`) : `улик ${clues.length}`;
            return row(`s${t.id}`, mark, t.title, null, right, clues, true);
          })}
        </section>
      )}

      {proactive.length > 0 && (
        <section className="reveal__group">
          <div className="reveal__group-head">
            <span>Может прийти сам</span>
          </div>
          {proactive.map((n) => (
            <div key={n.id} className={`reveal__proactive${n.visited ? " is-done" : ""}`}>
              <span className="reveal__name">
                {n.name}
                {n.node_type && <span className="reveal__type">{nodeLabel({ node_type: n.node_type })}</span>}
              </span>
              {inCampaign &&
                (n.visited ? (
                  <span className="reveal__count">пришёл</span>
                ) : (
                  <button type="button" className="primary" onClick={() => void arrived(n)}>
                    Пришёл
                  </button>
                ))}
              {n.trigger && <span className="reveal__trigger">Когда: {n.trigger}</span>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
