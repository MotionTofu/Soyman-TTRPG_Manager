import { useState, type MouseEvent } from "react";
import { journeyArrived, passStep, type LitmJourneyState, type LitmStepOutcome, type LitmVignette } from "@shared/litm/conflict";
import { useEntity } from "../../../data/hooks";
import type { CompendiumEntry, InitiativeEntry } from "../../../types";
import { Consequence, LitmRich } from "../LitmBook";
import { splitConsequence } from "../litmBookText";
import { journeyOf, vignetteGroupsOf, type Vignette } from "../litmJourneys";
import { actionLabel, consequenceTextActions, type ConsequenceAction } from "./consequence";
import { useLitmRibbon } from "./useLitmRibbon";
import "../litm-book.css";
import "./litm-pult.css";

const GAPS = ["минуты", "часы", "дни", "недели"];
const DICE = [1, 2, 3, 4, 5, 6];
const OUTCOME: Record<LitmStepOutcome, string> = { overcome: "✓ одолели", consequences: "✓ с последствиями", skip: "пропущен" };

type Change = (label: string, next: LitmJourneyState | null) => void;

/** Число шагов и время между ними (доска Litm-Pult-Journey, врезка 1). */
function JourneySetup({ journey, onChange }: { journey: LitmJourneyState; onChange: Change }) {
  const min = Math.max(1, journey.passed.length);
  const [steps, setSteps] = useState(Math.max(min, journey.steps || 3));
  const [gap, setGap] = useState(journey.gap || "часы");
  return (
    <div className="lp-jset">
      <span className="lp-mono">Шагов</span>
      <span className="lp-dice" role="radiogroup" aria-label="Число шагов">
        {DICE.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={n === steps} disabled={n < min} className={n === steps ? "is-on" : ""} onClick={() => setSteps(n)}>
            {n}
          </button>
        ))}
      </span>
      <button type="button" className="d-btn d-btn--sm d-btn--quiet" onClick={() => setSteps(Math.max(min, 1 + Math.floor(Math.random() * 6)))}>
        Бросить d6
      </button>
      <label className="lp-jset__gap">
        <span className="lp-mono">между шагами</span>
        <select value={gap} onChange={(e) => setGap(e.target.value)}>
          {GAPS.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </label>
      <button type="button" className="d-btn d-btn--sm d-btn--primary" onClick={() => onChange(`«${journey.name}»: ${steps} шагов, между шагами ${gap}`, { ...journey, steps, gap })}>
        В путь
      </button>
    </div>
  );
}

/**
 * Полоса путешествия над героями (пульт v2, Q3, Q7, Q13): пройденные шаги,
 * текущая виньетка на ленте, «Следующий шаг», после последнего — «Прибыли».
 * Теги местности и общие последствия — справкой.
 */
export function LitmJourneyBar({
  journey,
  current,
  onChange,
  onCamp,
  onMenu,
}: {
  journey: LitmJourneyState;
  /** Виньетка этого путешествия на ленте — текущий шаг. */
  current: string | null;
  onChange: Change;
  onCamp: () => void;
  onMenu: (e: MouseEvent, items: { label: string; danger?: boolean; onClick: () => void }[]) => void;
}) {
  const j = journey;
  if (journeyArrived(j)) {
    return (
      <section className="lp-journey lp-journey--done litm-book" aria-label="Путешествие окончено">
        <b className="lp-journey__arrived">Прибыли</b>
        <span>
          {j.name} · {j.passed.length} {j.passed.length === 1 ? "шаг" : j.passed.length < 5 ? "шага" : "шагов"}
        </span>
        <span className="lp-end">
          <button type="button" className="d-btn d-btn--sm d-btn--primary" onClick={onCamp}>
            Привал?
          </button>
          <button type="button" className="lp-x" aria-label="Убрать полосу путешествия" onClick={() => onChange(`«${j.name}» убрано с пульта`, null)}>
            ✕
          </button>
        </span>
      </section>
    );
  }
  const cells = j.steps > 0 ? Array.from({ length: j.steps }, (_, k) => k) : [];
  const effects = j.consequences.map((c) => splitConsequence(c).effect ?? c);
  return (
    <section className="lp-journey litm-book" aria-label={`Путешествие: ${j.name}`}>
      <div className="lp-journey__t">
        <span className="lp-mono">Путешествие{j.kind && ` · ${j.kind}`}</span>
        <b>{j.name}</b>
      </div>
      {j.steps === 0 ? (
        <JourneySetup journey={j} onChange={onChange} />
      ) : (
        <div className="lp-steps">
          {cells.map((k) => {
            const done = j.passed[k];
            const now = k === j.passed.length;
            return (
              <div key={k} className={`lp-jstep${done ? " is-done" : now ? " is-now" : ""}`}>
                <small>
                  Шаг {k + 1}
                  {done ? ` · ${OUTCOME[done.outcome]}` : now && current ? " · на ленте" : ""}
                </small>
                <b className={done || (now && current) ? "" : "is-empty"}>{done ? done.name : now && current ? current : "виньетка не выбрана"}</b>
                {k < cells.length - 1 && <i className="lp-jstep__gap">{j.gap}</i>}
              </div>
            );
          })}
          <div className="lp-jstep lp-jstep--goal">
            <small>Цель</small>
            <b>Прибыли</b>
          </div>
        </div>
      )}
      <span className="lp-end">
        {j.steps > 0 && (
          <button
            type="button"
            className="d-btn d-btn--sm"
            title="Засчитать шаг без виньетки"
            onClick={() => onChange(`«${j.name}»: шаг ${j.passed.length + 1} пройден`, passStep(j, current ?? "—", "skip"))}
          >
            Следующий шаг
          </button>
        )}
        <button
          type="button"
          className="lp-ib"
          aria-label="Путешествие: действия"
          onClick={(e) =>
            onMenu(e, [
              ...(j.steps > 0 ? [{ label: "Число шагов и время…", onClick: () => onChange(`«${j.name}»: число шагов`, { ...j, steps: 0 }) }] : []),
              { label: "Закончить путешествие", danger: true, onClick: () => onChange(`«${j.name}» прервано`, null) },
            ])
          }
        >
          ⋯
        </button>
      </span>
      {(j.tags.length > 0 || effects.length > 0) && (
        <div className="lp-journey__ref">
          {j.tags.length > 0 && <span className="lp-mono">Теги местности</span>}
          {j.tags.map((t) => (
            <span key={t} className="lb-tg">
              {t}
            </span>
          ))}
          {effects.length > 0 && <span className="lp-mono lp-journey__sep">Общие последствия · на любом шаге</span>}
          {effects.map((c, i) => (
            <span key={i} className="lp-journey__eff">
              <LitmRich text={c} />
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/** Гнездо-виньетка (Q6): угроза и последствия копией, без пределов; «Одолели» / «Пройдено с последствиями» (Q7). */
export function LitmVignetteNest({
  row,
  v,
  journey,
  onAction,
  onPass,
  onMenu,
}: {
  row: InitiativeEntry;
  v: LitmVignette;
  /** Идущее путешествие — для номера шага; null — шагов нет. */
  journey: LitmJourneyState | null;
  onAction: (a: ConsequenceAction, e: MouseEvent, edit: boolean) => void;
  onPass: (outcome: Exclude<LitmStepOutcome, "skip">) => void;
  onMenu: (e: MouseEvent) => void;
}) {
  const running = journey && !journeyArrived(journey) ? journey : null;
  const step = running ? running.passed.length + 1 : 0;
  const last = running && running.steps > 0 && step >= running.steps;
  return (
    <article className="lp-nest lp-vig litm-book" data-nest={row.id}>
      <span className="lp-vig__k">
        Виньетка{step > 0 && running!.steps > 0 ? ` · шаг ${step} из ${running!.steps}` : ""}
        {running ? ` · ${running.name}` : ""}
      </span>
      <div className="lp-nh">
        <h3 className="lb-name">
          {row.name}
          {v.nameEn && <small className="lb-orig">{v.nameEn}</small>}
        </h3>
        <span className="lp-nh__end">
          <button type="button" className="lp-ib" aria-label={`Действия: ${row.name}`} onClick={onMenu}>
            ⋯
          </button>
        </span>
      </div>
      <div className="lp-mono">Одно Быстрое действие · без пределов</div>
      {v.threat && (
        <div className="lp-block">
          <div className="lb-lbl">Угроза</div>
          <p className="lp-vig__thr">
            <LitmRich text={v.threat} />
          </p>
        </div>
      )}
      {v.consequences.length > 0 && (
        <div className="lp-block lb-thr lp-thr">
          <div className="lb-lbl">
            Последствия<small>нажатие — выполнить · ПКМ — «Дать статус»</small>
          </div>
          <ul>
            {v.consequences.map((c, k) => {
              const actions = consequenceTextActions(c);
              return (
                <li key={k}>
                  <Consequence text={c} />
                  {actions.length > 0 && (
                    <span className="lp-acts">
                      {actions.map((a, i) => (
                        <button
                          key={i}
                          type="button"
                          className="lp-act"
                          title="Нажатие — выполнить · ПКМ — открыть «Дать статус»"
                          onClick={(e) => onAction(a, e, false)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onAction(a, e, true);
                          }}
                        >
                          → {actionLabel(a)}
                        </button>
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="lp-vig__foot">
        <button type="button" className="d-btn d-btn--sm d-btn--primary" onClick={() => onPass("overcome")}>
          Одолели{running ? (last ? " · прибыли" : running.steps > 0 ? ` · шаг ${step + 1} →` : "") : ""}
        </button>
        <button
          type="button"
          className="d-btn d-btn--sm"
          disabled={v.blocksPath}
          title={v.blocksPath ? "Заблокировано — путь перекрыт, дальше только «Одолели»" : undefined}
          onClick={() => onPass("consequences")}
        >
          Пройдено с последствиями
        </button>
      </div>
    </article>
  );
}

function toVignette(v: Vignette, journeyId: number | null): LitmVignette {
  return { name: v.name, nameEn: v.nameEn, threat: v.threat, consequences: v.consequences, blocksPath: v.blocksPath, journeyId };
}

/**
 * Путешествие или общие дорожные виньетки в «Препятствиях» (пульт v2, Q5):
 * запись книги разворачивается в виньетки с «На ленту»; пройденные и та,
 * что на ленте, отмечены.
 */
export function LitmObstacleVignettes({ sessionId, entryId }: { sessionId: number; entryId: number }) {
  const entry = useEntity<CompendiumEntry>("compendium_entry", entryId).data;
  const ribbon = useLitmRibbon(sessionId);
  const [groupIndex, setGroupIndex] = useState(0);
  if (!entry) return null;
  const journey = journeyOf(entry);
  const groups = vignetteGroupsOf(entry);
  const own = journey.vignettes.length > 0;
  const list = own ? journey.vignettes : (groups[groupIndex]?.vignettes ?? []);
  const j = ribbon.scene.journey;
  const mine = own && j && j.entryId === entryId ? j : null;
  const onRibbon = new Set(
    ribbon.challenges.flatMap((r) => {
      const v = ribbon.stateOf(r).vignette;
      return v ? [`${v.journeyId}:${v.name}`] : [];
    })
  );
  const total = own ? journey.vignettes.length : groups.reduce((n, g) => n + g.vignettes.length, 0);
  return (
    <div className="lp-ov litm-book">
      <div className="lp-ov__h lp-mono">
        {own ? `Путешествие${journey.kind ? ` · ${journey.kind}` : ""}` : `Группой · ${groups.length} наборов`} · {total} виньеток
        {mine && mine.steps > 0 && !journeyArrived(mine) && ` · идёт: шаг ${mine.passed.length + 1} из ${mine.steps}`}
        {mine && journeyArrived(mine) && " · прибыли"}
      </div>
      {!own && (
        <div className="lp-ov__seg" role="tablist">
          {groups.map((g, i) => (
            <button key={g.name} type="button" role="tab" aria-selected={i === groupIndex} className={i === groupIndex ? "is-on" : ""} onClick={() => setGroupIndex(i)}>
              {g.name}
              <small>{g.vignettes.length}</small>
            </button>
          ))}
        </div>
      )}
      {list.map((v) => {
        const key = `${own ? entryId : null}:${v.name}`;
        const passed = mine ? mine.passed.findIndex((p) => p.name === v.name) : -1;
        const there = onRibbon.has(key);
        return (
          <div key={v.name} className={`lp-ov__row${passed >= 0 ? " is-done" : there ? " is-now" : ""}`}>
            <b>{v.name}</b>
            <span className="lp-ov__thr">
              <LitmRich text={v.threat} />
            </span>
            {passed >= 0 ? (
              <span className="lp-mono">✓ шаг {passed + 1}</span>
            ) : there ? (
              <span className="lp-mono">на ленте</span>
            ) : (
              <button
                type="button"
                className="to-init"
                title="На ленту вызовов"
                onClick={() =>
                  void ribbon.addVignette(
                    toVignette(v, own ? entryId : null),
                    own ? { entryId, name: entry.name, kind: journey.kind, tags: journey.tags, consequences: journey.consequences } : undefined
                  )
                }
              >
                На ленту
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
