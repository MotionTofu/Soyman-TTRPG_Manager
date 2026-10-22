import { useState, type ReactNode } from "react";
import { EntityPreviewModal } from "../components/EntityPreviewModal";
import { rollDiceFormula } from "../components/dnd/diceRoll";
import type { DndActionUses, DndCreatureAction, DndCreatureData, DndFeature, InitiativeEntry } from "../types";
import type { NestState } from "./nestState";
import type { CharacterSheetNest } from "./useCharacterSheet";

type Save = (label: string, state: NestState) => void;

/**
 * Ромбы запаса: залитый — есть, полый — потрачен. Щелчок по залитому тратит
 * один, по полому — возвращает один (поправить ошибку Мастера).
 */
function Pips({ max, used, onChange, label }: { max: number; used: number; onChange: (used: number) => void; label: string }) {
  const left = Math.max(0, max - used);
  return (
    <span className="cm-pips" role="group" aria-label={`${label}: осталось ${left} из ${max}`}>
      {Array.from({ length: max }, (_, i) => {
        const on = i < left;
        return (
          <button
            key={i}
            type="button"
            className={`cm-pip${on ? " is-on" : ""}`}
            aria-label={on ? `Потратить: ${label}` : `Вернуть: ${label}`}
            onClick={() => onChange(Math.min(max, Math.max(0, used + (on ? 1 : -1))))}
          />
        );
      })}
    </span>
  );
}

export function PoolRow({
  label,
  note,
  max,
  used,
  onChange,
}: {
  label: ReactNode;
  note?: string;
  max: number;
  used: number;
  onChange: (used: number) => void;
}) {
  return (
    <div className="cm-pool">
      <span className="cm-pool__l">
        {label}
        {note && <span className="cm-note-s"> · {note}</span>}
      </span>
      <Pips max={max} used={used} onChange={onChange} label={typeof label === "string" ? label : ""} />
      <span className="cm-pool__n">
        {Math.max(0, max - used)}/{max}
      </span>
    </div>
  );
}

type UsesRow = { name: string; uses: DndActionUses; where: string };

/** Всё, у чего есть запас: действия, бонусные, реакции и черты. */
function rowsWithUses(c: DndCreatureData): UsesRow[] {
  const rows: UsesRow[] = [];
  const add = (list: (DndCreatureAction | DndFeature)[], where: string) => {
    for (const a of list) if (a.uses && a.name) rows.push({ name: a.name, uses: a.uses, where });
  };
  add(c.traits, "черта");
  add(c.actions, "");
  add(c.bonusActions, "бонусное");
  add(c.reactions, "реакция");
  return rows;
}

/** Есть ли у существа хоть что-то, что в логове считается иначе (Q49). */
function hasLairCounts(c: DndCreatureData): boolean {
  return (
    !!c.legendary.resistanceLairCount ||
    !!c.legendary.actionPointsLair ||
    rowsWithUses(c).some((r) => r.uses.kind === "day" && !!r.uses.lairCount)
  );
}

/**
 * Запасы чудовища в гнезде (Q13): легендарная устойчивость, «N в день»,
 * перезарядка, заклинания «в день», легендарные действия. Состояние — в
 * строке инициативы; статблок существа не меняется.
 */
export function MonsterPools({
  entry,
  creature,
  state,
  save,
}: {
  entry: InitiativeEntry;
  creature: DndCreatureData;
  state: NestState;
  save: Save;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const lair = !!state.inLair;
  const uses = state.uses ?? {};
  const setUse = (key: string, used: number) => save(`Запас ${entry.name}`, { ...state, uses: { ...uses, [key]: used } });

  const leg = creature.legendary;
  const resistanceMax = leg.resistanceEnabled
    ? (lair && leg.resistanceLairCount ? leg.resistanceLairCount : leg.resistanceCount) ?? 0
    : 0;
  const pointsMax = leg.actionsEnabled ? (lair && leg.actionPointsLair ? leg.actionPointsLair : leg.actionPoints) ?? 0 : 0;
  const pointsUsed = state.legendaryUsed ?? 0;
  const locked = state.legendaryLocked ?? [];

  const rows = rowsWithUses(creature);
  const daily = rows.filter((r) => r.uses.kind !== "recharge");
  const recharge = rows.filter((r) => r.uses.kind === "recharge");

  const sc = creature.spellcasting;
  const spells = sc.enabled ? sc.spells : [];
  const atWill = spells.filter((s) => s.frequency === "atwill");
  const perDay = spells.filter((s) => s.frequency === "perday");
  const slots = sc.enabled ? sc.slots.filter((s) => s.slots > 0) : [];

  const spellHead = [sc.saveDC != null ? `СЛ ${sc.saveDC}` : "", "в день"].filter(Boolean).join(" · ");
  const link = (name: string, entryId?: number) =>
    entryId ? (
      <button type="button" className="cm-link" onClick={() => setPreview(entryId)}>
        {name}
      </button>
    ) : (
      name
    );

  return (
    <>
      {hasLairCounts(creature) && (
        <label className="cm-lairtoggle">
          <input
            type="checkbox"
            checked={lair}
            onChange={(e) => save(`Логово ${entry.name}`, { ...state, inLair: e.target.checked })}
          />
          Бой в логове — запасы «в логове»
        </label>
      )}

      {resistanceMax > 0 && (
        <div className="cm-sect">
          <div className="cm-sect__t">Легендарная устойчивость</div>
          <PoolRow
            label="Провал → успех"
            max={resistanceMax}
            used={state.resistanceUsed ?? 0}
            onChange={(n) => save(`Легендарная устойчивость ${entry.name}`, { ...state, resistanceUsed: n })}
          />
        </div>
      )}

      {daily.length > 0 && (
        <div className="cm-sect">
          <div className="cm-sect__t">Запасы</div>
          {daily.map((r) => {
            const max =
              r.uses.kind === "day" ? (lair && r.uses.lairCount ? r.uses.lairCount : r.uses.count) : 1;
            const note = [r.where, r.uses.kind === "rest" ? (r.uses.rest === "short" ? "до отдыха" : "до долгого отдыха") : ""]
              .filter(Boolean)
              .join(", ");
            return (
              <PoolRow
                key={r.name}
                label={r.name}
                note={note || undefined}
                max={max}
                used={uses[r.name] ?? 0}
                onChange={(n) => setUse(r.name, n)}
              />
            );
          })}
        </div>
      )}

      {recharge.map((r) => {
        const min = r.uses.kind === "recharge" ? r.uses.min : 6;
        const rs = state.recharge?.[r.name];
        const ready = rs?.ready ?? true;
        const range = min >= 6 ? "6" : `${min}–6`;
        const setRecharge = (next: { ready: boolean; min: number; roll?: number }) =>
          save(`Перезарядка ${entry.name}`, { ...state, recharge: { ...state.recharge, [r.name]: next } });
        return (
          <div key={r.name} className={`cm-rech${ready ? " is-ready" : ""}`}>
            <span className="cm-rech__t">
              <b>{r.name}</b> · перезарядка {range}
              <br />
              {ready ? "готово" : `не готово${rs?.roll ? ` · выпало ${rs.roll}` : ""} — бросок в начале хода`}
            </span>
            {ready ? (
              <button type="button" className="cm-btn cm-btn--sm" onClick={() => setRecharge({ ready: false, min })}>
                Применить
              </button>
            ) : (
              <button
                type="button"
                className="cm-btn cm-btn--sm"
                onClick={() => {
                  const roll = rollDiceFormula("1к6") ?? 1;
                  setRecharge({ ready: roll >= min, min, roll });
                }}
              >
                Бросить к6
              </button>
            )}
          </div>
        );
      })}

      {(perDay.length > 0 || atWill.length > 0 || slots.length > 0) && (
        <div className="cm-sect">
          <div className="cm-sect__t">
            Заклинания <span className="cm-note-s">{spellHead}</span>
          </div>
          {perDay.map((s) => {
            const key = `заклинание:${s.name}`;
            return (
              <PoolRow
                key={key}
                label={link(s.name, s.entryId)}
                note={s.description || undefined}
                max={s.perDayCount ?? 1}
                used={uses[key] ?? 0}
                onChange={(n) => setUse(key, n)}
              />
            );
          })}
          {slots.map((s) => {
            const key = `ячейка:${s.level}`;
            return (
              <PoolRow
                key={key}
                label={`${s.level} круг`}
                max={s.slots}
                used={uses[key] ?? 0}
                onChange={(n) => setUse(key, n)}
              />
            );
          })}
          {atWill.length > 0 && (
            <div className="cm-unl">
              <span className="cm-note-s">Неограниченно: </span>
              {atWill.map((s, i) => (
                <span key={s.name}>
                  {i > 0 && ", "}
                  {link(s.name, s.entryId)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {pointsMax > 0 && (
        <div className="cm-sect">
          <div className="cm-sect__t">
            Легендарные действия{" "}
            <Pips
              max={pointsMax}
              used={pointsUsed}
              label="Очки легендарных действий"
              onChange={(n) => save(`Легендарные действия ${entry.name}`, { ...state, legendaryUsed: n })}
            />
          </div>
          <span className="cm-note-s">после хода другого существа · вернутся в начале своего</span>
          {leg.actions.map((a) => {
            const isLocked = !!a.oncePerTurn && locked.includes(a.name);
            const cost = a.cost || 1;
            return (
              <div key={a.name} className="cm-la">
                <span className="cm-la__t">
                  <b>{a.name}</b>
                  {cost > 1 && ` · ${cost} очка`}
                  {isLocked && <span className="cm-la__lock"> · до своего хода</span>}
                </span>
                <button
                  type="button"
                  className="cm-btn cm-btn--sm"
                  disabled={isLocked || pointsMax - pointsUsed < cost}
                  onClick={() =>
                    save(`Легендарное действие ${entry.name}`, {
                      ...state,
                      legendaryUsed: pointsUsed + cost,
                      legendaryLocked: a.oncePerTurn ? [...locked, a.name] : locked,
                    })
                  }
                >
                  Совершить
                </button>
              </div>
            );
          })}
        </div>
      )}

      {preview !== null && (
        <EntityPreviewModal type="compendium_entry" id={preview} onClose={() => setPreview(null)} />
      )}
    </>
  );
}

/**
 * Ячейки и классовые запасы персонажа — из листа и в лист (Q28). Тратятся
 * теми же полями, что на листе: `spellSlotsUsed`, `pactSlotsUsed`,
 * `resourceUsed`.
 */
export function CharacterPools({ sheet, name }: { sheet: CharacterSheetNest; name: string }) {
  const { data, slots, pact, pools } = sheet;
  const slotRows = slots.map((max, i) => ({ level: i + 1, max })).filter((s) => s.max > 0);
  if (slotRows.length === 0 && !pact?.count && pools.length === 0) return null;
  return (
    <>
      {(slotRows.length > 0 || !!pact?.count) && (
        <div className="cm-sect">
          <div className="cm-sect__t">Ячейки заклинаний</div>
          {slotRows.map((s) => (
            <PoolRow
              key={s.level}
              label={`${s.level} круг`}
              max={s.max}
              used={data.spellSlotsUsed[s.level - 1] ?? 0}
              onChange={(n) => {
                const next = [...data.spellSlotsUsed];
                while (next.length < 9) next.push(0);
                next[s.level - 1] = n;
                sheet.patch(`Ячейки ${name}`, { spellSlotsUsed: next });
              }}
            />
          ))}
          {!!pact?.count && (
            <PoolRow
              label={`Договор, ${pact.circle} круг`}
              note="короткий отдых"
              max={pact.count}
              used={data.pactSlotsUsed ?? 0}
              onChange={(n) => sheet.patch(`Ячейки договора ${name}`, { pactSlotsUsed: n })}
            />
          )}
        </div>
      )}
      {pools.length > 0 && (
        <div className="cm-sect">
          <div className="cm-sect__t">Запасы</div>
          {pools.map((r) => (
            <PoolRow
              key={r.key}
              label={r.label}
              note={r.recharge === "short" ? "короткий отдых" : undefined}
              max={r.max}
              used={data.resourceUsed[r.key] ?? 0}
              onChange={(n) => sheet.patch(`Запас ${name}`, { resourceUsed: { ...data.resourceUsed, [r.key]: n } })}
            />
          ))}
        </div>
      )}
    </>
  );
}
