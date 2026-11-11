import { useState } from "react";
import {
  HERO_LIMIT,
  STATUS_MAX_TIER,
  formatStatus,
  giveStatus,
  heroCondition,
  parseStatusTag,
  reduceStatus,
  sameStatus,
  statusTier,
  type LitmStatus,
} from "@shared/litm/status";

const BOXES = Array.from({ length: STATUS_MAX_TIER }, (_, i) => i + 1);

/** «ранен-2», «ранен 2», «*ранен-2*»; без уровня — 1. */
function parseInput(text: string): { name: string; tier: number } | null {
  const t = text.trim().replace(/\s+(\d)$/, "-$1");
  if (!t) return null;
  return parseStatusTag(t) ?? { name: t.replace(/\*/g, "").trim(), tier: 1 };
}

/**
 * Статусы героя карточками учёта (доска Litm-Sheet-Status, Q5/Q7/Q9 пульта LitM).
 * Клетка — дать статус этого уровня по правилу сложения; «−» ослабляет на 1,
 * «✕» снимает. Пятая клетка — предел героя, шестая — необратимое.
 */
export function LitmStatusCards({
  statuses,
  onChange,
  compact,
}: {
  statuses: LitmStatus[];
  /** Операция над списком, а не готовый список: пульт применяет её к свежему
   *  листу (игрок может править тот же лист в ту же минуту). */
  onChange: (update: (list: LitmStatus[]) => LitmStatus[]) => void;
  /** Карточка героя на пульте: без рамки и шапки «Статусы». */
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const { overcome, beyond } = heroCondition(statuses);

  function add() {
    const s = parseInput(draft);
    if (!s) return;
    onChange((list) => giveStatus(list, s.name, s.tier));
    setDraft("");
  }

  return (
    <div className={compact ? "stack litm-status-block is-compact" : "card stack litm-status-block"}>
      {!compact && (
        <div className="litm-status-head">
          <strong>Статусы</strong>
          <span className="muted">предел {HERO_LIMIT}</span>
        </div>
      )}
      {beyond ? (
        <div className="litm-status-down">Необратимо: {formatStatus(beyond)} — гибель или превращение</div>
      ) : overcome ? (
        <div className="litm-status-down">Повержен: {formatStatus(overcome)}</div>
      ) : null}
      {statuses.length === 0 && <span className="muted">Статусов нет</span>}
      {statuses.map((s) => {
        const tier = statusTier(s.marks);
        return (
          <div key={s.name} className="litm-status-row">
            <span className="litm-status-name">{s.name}</span>
            <span className="litm-status-boxes">
              {BOXES.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`litm-status-box${s.marks.includes(k) ? " is-on" : ""}${k === HERO_LIMIT ? " is-limit" : ""}${k === STATUS_MAX_TIER ? " is-fatal" : ""}`}
                  aria-label={`${s.name}: дать уровень ${k}`}
                  title={`Дать ${s.name}-${k}`}
                  onClick={() => onChange((list) => giveStatus(list, s.name, k))}
                />
              ))}
            </span>
            <b className="litm-status-tier">{tier}</b>
            <button type="button" className="litm-status-act" aria-label={`Ослабить ${s.name} на 1`} title="Ослабить на 1" onClick={() => onChange((list) => reduceStatus(list, s.name, 1))}>
              −
            </button>
            <button type="button" className="litm-status-act" aria-label={`Снять ${s.name}`} title="Снять" onClick={() => onChange((list) => list.filter((x) => !sameStatus(x.name, s.name)))}>
              ✕
            </button>
          </div>
        );
      })}
      <span className="litm-tag litm-tag-add">
        <input
          value={draft}
          placeholder="статус-уровень, напр. ранен-2"
          aria-label="Новый статус"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add} aria-label="Дать статус">
          +
        </button>
      </span>
    </div>
  );
}
