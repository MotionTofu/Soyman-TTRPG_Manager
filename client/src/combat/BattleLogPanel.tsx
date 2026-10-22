import { useEffect, useState } from "react";
import { undoableIds, type BattleInfo, type BattleLogLine } from "./battleLog";
import type { useCombat } from "./useCombat";

/** Время сервера (UTC, «YYYY-MM-DD HH:MM:SS») — в миллисекунды. */
function serverTime(value: string): number {
  return Date.parse(`${value.replace(" ", "T")}Z`);
}

function clockText(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Тихий таймер боя у раунда (Q81): от «Старт», без паузы; перенос складывает сессии (Q82). */
export function BattleClock({ battle }: { battle: BattleInfo }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  const running = battle.running_since ? Math.max(0, (now - serverTime(battle.running_since)) / 1000) : 0;
  return (
    <span className="cm-clock" title="Сколько идёт бой — от «Старт», без паузы">
      {clockText(battle.seconds + running)}
    </span>
  );
}

function LogRow({ line, canUndo, busy, onUndo }: { line: BattleLogLine; canUndo: boolean; busy: boolean; onUndo: () => void }) {
  const time = new Date(serverTime(line.created_at)).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`cm-log__row cm-log__row--${line.kind}${line.undone ? " is-undone" : ""}`}>
      <span className="cm-log__t">
        {line.kind === "sheet" && <span className="cm-log__who">{line.author} · лист</span>}
        {line.text}
        {line.kind === "turn" && <span className="cm-log__time"> · {time}</span>}
        {line.sub && <span className="cm-log__sub">{line.sub}</span>}
      </span>
      <span className="cm-log__act">
        {canUndo && (
          <button type="button" className="cm-btn cm-btn--sm" disabled={busy} onClick={onUndo}>
            Отменить
          </button>
        )}
        {line.undone && <span className="cm-log__stamp">отменено</span>}
        {!line.undone && line.blocked && <span className="cm-log__blocked">{line.blocked}</span>}
      </span>
    </div>
  );
}

/**
 * Лог боя под полосой раунда (Q15, Q71): свёрнут — последнее событие и
 * «Отменить»; раскрыт — всё, новое сверху, заголовки ходов со временем (Q80).
 */
export function BattleLogPanel({ combat }: { combat: ReturnType<typeof useCombat> }) {
  const { battle, log } = combat;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  if (!battle) return null;
  const can = undoableIds(log);
  const last = [...log].reverse().find((l) => l.kind !== "turn" && !l.undone) ?? null;
  async function undo(line: BattleLogLine) {
    setBusy(line.id);
    try {
      await combat.undo(line);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="cm-log">
      <div className="cm-log__strip">
        <span className="cm-ui">Лог · {log.length}</span>
        <span className="cm-log__last">
          {last ? (last.kind === "sheet" ? `${last.author} · лист: ${last.text}` : last.text) : "пока пусто"}
        </span>
        {last && can.has(last.id) && (
          <button type="button" className="cm-btn cm-btn--sm" disabled={busy === last.id} onClick={() => void undo(last)}>
            Отменить
          </button>
        )}
        <button type="button" className="cm-btn cm-btn--sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Свернуть" : "Раскрыть"}
        </button>
      </div>
      {open && (
        <div className="cm-log__list" aria-label="Лог боя, новое сверху">
          {[...log].reverse().map((l) => (
            <LogRow key={l.id} line={l} canUndo={can.has(l.id)} busy={busy === l.id} onUndo={() => void undo(l)} />
          ))}
        </div>
      )}
    </div>
  );
}
