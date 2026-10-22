import { useState } from "react";
import { write } from "../data/hooks";
import { afterWriteAnywhere } from "../data/imperative";
import { showSaveError } from "../data/notices";
import { statblockAffects } from "../data/statblocks";
import type { DndCreatureAction, DndCreatureData, InitiativeEntry } from "../types";
import { PoolRow } from "./CombatPools";
import type { NestActions } from "./CombatNest";
import type { NestState } from "./nestState";
import { useNestStatblock } from "./useNestCreature";

type ListKey = "actions" | "bonusActions" | "reactions" | "legendary";

/** Где в статблоке действие с этим именем — запас пишется прямо в него. */
function findAction(c: DndCreatureData, name: string): ListKey | null {
  for (const key of ["actions", "bonusActions", "reactions"] as const)
    if (c[key].some((a) => a.name === name)) return key;
  if (c.legendary?.actions.some((a) => a.name === name)) return "legendary";
  return null;
}

/**
 * Счётчики гнезда (Q59): «+ счётчик» — имя из действий статблока или своё,
 * сколько раз. «Запомнить в статблоке» — только для действия: запас
 * пишется в него (`uses`), и дальше его ведёт «Запасы» (MonsterPools) — у
 * существа бестиария это для всех таких. У персонажа галочки нет.
 */
export function NestCounters({
  entry,
  state,
  actions,
  creature,
}: {
  entry: InitiativeEntry;
  state: NestState;
  actions: NestActions;
  creature: DndCreatureData | null;
}) {
  const sb = useNestStatblock(entry);
  const [form, setForm] = useState<{ action: string; name: string; max: string; remember: boolean } | null>(null);
  const counters = state.counters ?? [];
  const free = creature
    ? [...creature.actions, ...creature.bonusActions, ...creature.reactions, ...(creature.legendary?.actions ?? [])]
        .filter((a) => a.name && !a.uses && !a.isMultiattack && !/^мультиатака/i.test(a.name.trim()))
        .map((a) => a.name)
    : [];
  const save = (label: string, next: NestState["counters"]) =>
    void actions.updateState(entry, label, { ...state, counters: next?.length ? next : undefined });

  async function remember(name: string, count: number) {
    if (!sb || !creature) return;
    const key = findAction(creature, name);
    if (!key) return;
    const withUses = (list: DndCreatureAction[]) =>
      list.map((a) => (a.name === name ? { ...a, uses: { kind: "day" as const, count } } : a));
    const patch =
      key === "legendary"
        ? { legendary: { ...creature.legendary, actions: withUses(creature.legendary.actions) } }
        : { [key]: withUses(creature[key]) };
    try {
      await write.put(`/statblocks/${sb.id}`, { contentPatch: patch });
      afterWriteAnywhere(statblockAffects(sb.owner_type, sb.owner_id));
    } catch (error) {
      showSaveError(`Запас «${name}» — ${error instanceof Error ? error.message : String(error)}`, () => remember(name, count));
    }
  }

  function add() {
    if (!form) return;
    const max = Number(form.max);
    const name = (form.action || form.name).trim();
    if (!name || !(max > 0)) return;
    setForm(null);
    if (form.action && form.remember && sb) void remember(name, max);
    else save(`Счётчик ${entry.name}`, [...counters, { name, max, used: 0 }]);
  }

  const rememberLabel =
    entry.entity_type === "compendium_entry" ? "Запомнить в статблоке — в бестиарий, для всех таких" : "Запомнить в статблоке существа";

  return (
    <div className="cm-sect">
      <div className="cm-sect__t">Счётчики</div>
      {counters.map((c, i) => (
        <div key={`${c.name}-${i}`} className="cm-counter">
          <PoolRow
            label={c.name}
            max={c.max}
            used={c.used}
            onChange={(used) => save(`Счётчик ${entry.name}`, counters.map((x, j) => (j === i ? { ...x, used } : x)))}
          />
          <button
            type="button"
            className="cm-x"
            aria-label={`Убрать счётчик «${c.name}»`}
            onClick={() => save(`Счётчик ${entry.name}`, counters.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      {form ? (
        <div className="cm-form">
          {free.length > 0 && (
            <select aria-label="Из статблока" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
              <option value="">— своё имя —</option>
              {free.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
          {!form.action && (
            <input
              type="text"
              autoFocus
              placeholder="Заряды посоха"
              aria-label="Имя счётчика"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          )}
          <label>
            Сколько{" "}
            <input type="number" min={1} value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} />
          </label>
          {form.action && sb && (
            <label>
              <input type="checkbox" checked={form.remember} onChange={(e) => setForm({ ...form, remember: e.target.checked })} />{" "}
              {rememberLabel}
            </label>
          )}
          <button type="button" className="cm-btn cm-btn--sm" onClick={add}>
            Добавить
          </button>
          <button type="button" className="cm-btn cm-btn--sm" onClick={() => setForm(null)}>
            Отмена
          </button>
        </div>
      ) : (
        <div>
          <button type="button" className="cm-addbtn" onClick={() => setForm({ action: "", name: "", max: "1", remember: false })}>
            + счётчик
          </button>
        </div>
      )}
    </div>
  );
}
