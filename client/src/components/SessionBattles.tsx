import { useState } from "react";
import { useResource } from "../data/hooks";
import { plural } from "../sceneKinds";
import { battleLogPath, sessionBattlesPath, type BattleLogLine, type BattleSummary } from "../combat/battleLog";

const NO_BATTLES: BattleSummary[] = [];

function timeOf(b: BattleSummary, sessionId: number): string {
  if (b.spans.length > 1) return b.spans.map((s) => `сессия ${s.number}: ${s.minutes} мин`).join(", ");
  const own = b.spans.find((s) => s.session_id === sessionId);
  return own ? `${own.minutes} мин` : "";
}

function statusOf(b: BattleSummary): string | null {
  if (b.carried_to != null) return `продолжится · сессия ${b.carried_to}`;
  if (b.carry_pending) return "продолжится в следующей сессии";
  if (!b.ended) return "идёт";
  return null;
}

/** Полный лог боя — только Мастеру (Q22): новое сверху, ходы заголовками. */
function BattleFullLog({ battleId }: { battleId: number }) {
  const log = useResource<BattleLogLine[]>(battleLogPath(battleId)).data;
  if (!log) return <div className="muted">Загрузка…</div>;
  return (
    <ol className="sp-battle-log">
      {[...log].reverse().map((l) => (
        <li key={l.id} className={`sp-battle-log__row is-${l.kind}${l.undone ? " is-undone" : ""}`}>
          {l.kind === "sheet" && <span className="muted">{l.author} · лист: </span>}
          {l.text}
          {l.sub && <span className="muted"> — {l.sub}</span>}
          {l.undone && <span className="muted"> · отменено</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * «Бои вечера» в «Итогах» (Q21, Q22, Q73, Q83): строка на бой — раунды,
 * время, повергнутые, урон по сторонам; у Мастера раскрывается в полный лог.
 * Видна, как только был бой, даже посреди вечера.
 */
export function SessionBattles({ sessionId, isPlayer }: { sessionId: number; isPlayer: boolean }) {
  const battles = useResource<BattleSummary[]>(sessionBattlesPath(sessionId)).data ?? NO_BATTLES;
  const [open, setOpen] = useState<number | null>(null);
  if (battles.length === 0) return null;
  return (
    <div className="card stack sp-battles">
      <div className="row sp-notes__head">
        <span className="sp-title">Бои вечера</span>
        <span className="muted">{isPlayer ? "полный лог видит только Мастер" : "строка раскрывается в полный лог"}</span>
      </div>
      {battles.map((b) => {
        const status = statusOf(b);
        const defeated = b.defeated.length ? `повержены: ${b.defeated.join(", ")}` : "без повергнутых";
        const meta = [
          b.carried_from != null ? `продолжение из сессии ${b.carried_from}` : "",
          defeated,
          isPlayer ? "" : `партия нанесла ${b.dealt}, получила ${b.taken}`,
        ]
          .filter(Boolean)
          .join(" · ");
        const rounds = `${b.rounds} ${plural(b.rounds, "раунд", "раунда", "раундов")}`;
        return (
          <div key={b.id} className="sp-battle">
            <button
              type="button"
              className="sp-battle__row"
              disabled={isPlayer}
              aria-expanded={open === b.id}
              onClick={() => setOpen(open === b.id ? null : b.id)}
            >
              <span className="sp-battle__name">{b.name}</span>
              <span className="sp-battle__tag">{[rounds, timeOf(b, sessionId)].filter(Boolean).join(" · ")}</span>
              {status && <span className="sp-battle__tag is-carry">{status}</span>}
              <span className="sp-battle__meta">{meta}</span>
            </button>
            {!isPlayer && open === b.id && <BattleFullLog battleId={b.id} />}
          </div>
        );
      })}
    </div>
  );
}
