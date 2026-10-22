import { useEffect, useMemo, useState } from "react";
import type { DndCheck, DndEffect } from "@shared/dnd/effects";
import { abilityModifier } from "../components/dnd/AbilityScores";
import { loadDndSpellIndex } from "../components/dnd/dndCompendium";
import type { CompendiumEntry, DndAbilityKey, DndCreatureAction, DndCreatureData } from "../types";
import {
  ABILITY_SHORT,
  REPEAT_AT_LABELS,
  abilityKey,
  actionDuration,
  durationLabel,
  spellDuration,
  type EffectDuration,
  type NestEffect,
} from "./effects";
import { parseNestState } from "./nestState";
import { isDead, type useCombat } from "./useCombat";
import { useCharacterSheet } from "./useCharacterSheet";
import { useNestCreature } from "./useNestCreature";

type Combat = ReturnType<typeof useCombat>;

/** Что накладывается — заклинание, действие чудовища или «своё» (Q51, Q62–Q63). */
interface Source {
  key: string;
  name: string;
  entryId: number | null;
  duration: EffectDuration;
  conc: boolean;
  conditions: string[];
  ac: number;
  repeat: NestEffect["repeat"];
  meta: string;
}

const NO_SPELLS: CompendiumEntry[] = [];

const bareName = (name: string) => name.replace(/\s*\[.*$/, "").trim().toLowerCase();

type OwnDraft = { name: string; rounds: string; rep: boolean; ability: DndAbilityKey; dc: string; at: keyof typeof REPEAT_AT_LABELS };

/** СЛ заклинателя: лист персонажа или статблок (готовое число 5.5 либо 8 + БМ + мод). */
function creatureDc(c: DndCreatureData | null): number | null {
  if (!c) return null;
  if (c.spellcasting.saveDC) return c.spellcasting.saveDC;
  const ab = c.spellcasting.ability;
  return ab ? 8 + (c.challenge.proficiencyBonus ?? 0) + abilityModifier(c.abilities[ab]) : null;
}

function spellSource(e: CompendiumEntry, dc: number | null): Source | null {
  const d = e.data as { duration?: string; concentration?: boolean; effects?: DndEffect[]; checks?: DndCheck[] };
  const duration = spellDuration(d.duration);
  if (!duration) return null;
  const conditions = (d.effects ?? [])
    .filter((x) => x.type === "condition" && x.condition?.name)
    .map((x) => x.condition!.name);
  const save = (d.checks ?? []).find((c) => c.type === "save");
  const ability = abilityKey(save?.saveAbility);
  const ac = (d.effects ?? []).reduce((n, x) => n + (x.type === "defense" && !x.acBase && typeof x.flat === "number" ? x.flat : 0), 0);
  return {
    key: `s${e.id}`,
    name: e.name,
    entryId: e.id,
    duration,
    conc: !!d.concentration,
    conditions,
    ac,
    repeat: save?.repeat?.length && ability ? { ability, dc, at: save.repeat } : null,
    meta: [d.duration, conditions.join(", ")].filter(Boolean).join(" · "),
  };
}

function actionSource(a: DndCreatureAction, i: number, dc: number | null): Source {
  const conditions = (a.inflicts?.conditions ?? []).map((c) => c.name);
  const ability = (a.saveAbility || null) as DndAbilityKey | null;
  const duration = actionDuration(a.inflicts?.duration);
  const saveDc = a.saveDC ?? dc;
  return {
    key: `a${i}`,
    name: a.name,
    entryId: null,
    duration,
    conc: false,
    conditions,
    ac: 0,
    repeat: a.inflicts?.repeat?.length && ability ? { ability, dc: saveDc, at: a.inflicts.repeat } : null,
    meta: [
      conditions.join(", "),
      "rounds" in duration ? durationLabel(duration) : a.inflicts?.duration ? durationLabel(duration) : "",
      ability ? `${ABILITY_SHORT[ability]} СЛ ${saveDc ?? "?"}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/**
 * «+ эффект» (Q51–Q56, Q62–Q63): заклинатель — тот, чей ход; поиск по
 * заклинаниям с длительностью; блок «От хода» — действия ходящего существа,
 * что накладывают; «Своё» с повтором; цели — чипами остальных гнёзд.
 */
export function EffectWindow({
  combat,
  originId,
  systemId,
  onClose,
}: {
  combat: Combat;
  originId: number;
  systemId: number | null;
  onClose: () => void;
}) {
  const fighters = combat.turnOrder.filter((e) => e.kind === "creature" && !isDead(e));
  const [casterId, setCasterId] = useState(() =>
    fighters.some((e) => e.id === combat.currentId) ? combat.currentId! : originId
  );
  const caster = fighters.find((e) => e.id === casterId) ?? fighters[0];
  const [targets, setTargets] = useState<number[]>([originId]);
  const [q, setQ] = useState("");
  const [pickKey, setPickKey] = useState<string | null>(null);
  const [rounds, setRounds] = useState("");
  const [condOn, setCondOn] = useState(true);
  const [own, setOwn] = useState<OwnDraft>({ name: "", rounds: "", rep: false, ability: "wis", dc: "", at: "turn_end" });
  const [busy, setBusy] = useState(false);

  const [spells, setSpells] = useState<CompendiumEntry[]>(NO_SPELLS);
  useEffect(() => {
    if (systemId) void loadDndSpellIndex(systemId).then(setSpells);
  }, [systemId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sheet = useCharacterSheet(caster);
  const creature = useNestCreature(caster);
  const dc = sheet?.spellDc ?? creatureDc(creature);
  const concNow = sheet ? sheet.data.concentration : parseNestState(caster).concentration;

  // Действия ходящего, что накладывают или требуют спасброска (Q63).
  const actions = useMemo(() => {
    if (!creature) return [];
    const list = [
      ...creature.actions,
      ...creature.bonusActions,
      ...creature.reactions,
      ...(creature.legendary?.actions ?? []),
    ];
    return list
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => !a.isMultiattack && (a.inflicts?.conditions.length || a.saveAbility))
      .map(({ a, i }) => actionSource(a, i, dc));
  }, [creature, dc]);

  // Заклинания: без поиска — известные заклинателю; с поиском — все с длительностью.
  // По id записи, а где его нет — по имени без английского хвоста («Языки [Tongues]»).
  const known = useMemo(() => {
    const list: { name: string; entryId?: number | null }[] = sheet
      ? [...sheet.data.cantrips, ...sheet.data.spellsByLevel.flat()]
      : (creature?.spellcasting.spells ?? []);
    return {
      ids: new Set(list.map((s) => s.entryId).filter((id): id is number => typeof id === "number")),
      names: new Set(list.map((s) => bareName(s.name)).filter(Boolean)),
    };
  }, [sheet, creature]);
  const spellRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: Source[] = [];
    for (const e of spells) {
      const mine = known.ids.has(e.id) || known.names.has(bareName(e.name));
      if (needle ? !e.name.toLowerCase().includes(needle) : !mine) continue;
      const s = spellSource(e, dc);
      if (s) out.push(s);
      if (out.length >= 40) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [spells, q, known, dc]);

  const ownSource: Source | null = own.name.trim()
    ? {
        key: "own",
        name: own.name.trim(),
        entryId: null,
        duration: { rounds: Number(own.rounds) > 0 ? Number(own.rounds) : 10 },
        conc: false,
        conditions: [],
        ac: 0,
        repeat: own.rep ? { ability: own.ability, dc: Number(own.dc) > 0 ? Number(own.dc) : dc, at: [own.at] } : null,
        meta: "своё",
      }
    : null;

  const src =
    pickKey === "own" ? ownSource : [...actions, ...spellRows].find((s) => s.key === pickKey) ?? null;
  const counted = src && "rounds" in src.duration;
  const roundsValue = counted ? (Number(rounds) > 0 ? Number(rounds) : (src.duration as { rounds: number }).rounds) : null;
  const pcTargets = fighters.filter((f) => targets.includes(f.id) && f.entity_type === "character").map((f) => f.name);
  const canApply = !!src && targets.length > 0 && !busy;

  function pick(key: string) {
    setPickKey(key);
    setRounds("");
    setCondOn(true);
  }

  async function apply() {
    if (!src || !canApply || !caster) return;
    setBusy(true);
    const ok = await combat.effects.apply({
      name: src.name,
      entryId: src.entryId,
      casterId: caster.id,
      casterName: caster.name,
      duration: roundsValue != null ? { rounds: roundsValue } : src.duration,
      conc: src.conc,
      conditions: condOn ? src.conditions : [],
      ac: src.ac,
      repeat: src.repeat,
      targets,
    });
    setBusy(false);
    if (ok) onClose();
  }

  const origin = fighters.find((f) => f.id === originId);

  return (
    <div className="cm-layer" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="cm-fx" role="dialog" aria-label="Наложить эффект">
        <div className="cm-fx__h">
          <span className="cm-ui">+ эффект</span>
          <span>гнездо: {origin?.name ?? "—"}</span>
          <button type="button" className="cm-x" aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="cm-fx__b">
          <div className="cm-fx__row">
            <label className="cm-fx__field">
              Заклинатель
              <select
                value={caster.id}
                onChange={(e) => {
                  setCasterId(Number(e.target.value));
                  setPickKey(null);
                }}
              >
                {fighters.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted">{dc != null ? `СЛ спасброска ${dc} · ${sheet ? "из листа" : "из статблока"}` : "СЛ не известна"}</span>
          </div>
          <input
            className="cm-fx__search"
            type="text"
            autoFocus
            placeholder="Заклинание: Опутывание, Щит веры…"
            aria-label="Поиск заклинания"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <div className="cm-fx__list">
            {actions.length > 0 && (
              <>
                <div className="cm-pk-h">От хода: {caster.name}</div>
                {actions.map((s) => (
                  <button key={s.key} type="button" className={`cm-pk-it${pickKey === s.key ? " is-on" : ""}`} onClick={() => pick(s.key)}>
                    {s.name}
                    <small>{s.meta}</small>
                  </button>
                ))}
              </>
            )}
            <div className="cm-pk-h">{q.trim() ? "Заклинания с длительностью" : `Заклинания ${caster.name}`}</div>
            {spellRows.map((s) => (
              <button key={s.key} type="button" className={`cm-pk-it${pickKey === s.key ? " is-on" : ""}`} onClick={() => pick(s.key)}>
                {s.name}
                <small>{s.meta}</small>
              </button>
            ))}
            {spellRows.length === 0 && (
              <div className="cm-pk-empty">{q.trim() ? "Ничего с длительностью" : "Известных нет — начните вводить имя"}</div>
            )}
            <div className="cm-pk-h">Своё</div>
            <div className={`cm-fx__own${pickKey === "own" ? " is-on" : ""}`}>
              <input
                type="text"
                placeholder="Название: Яд в жале"
                aria-label="Своё: название"
                value={own.name}
                onChange={(e) => {
                  setOwn({ ...own, name: e.target.value });
                  setPickKey("own");
                }}
              />
              <label>
                <input
                  type="number"
                  min={1}
                  placeholder="10"
                  aria-label="Своё: раунды"
                  value={own.rounds}
                  onChange={(e) => {
                    setOwn({ ...own, rounds: e.target.value });
                    setPickKey("own");
                  }}
                />{" "}
                р.
              </label>
              <label>
                <input type="checkbox" checked={own.rep} onChange={(e) => setOwn({ ...own, rep: e.target.checked })} /> повтор
              </label>
              {own.rep && (
                <>
                  <select aria-label="Спасбросок" value={own.ability} onChange={(e) => setOwn({ ...own, ability: e.target.value as DndAbilityKey })}>
                    {(Object.keys(ABILITY_SHORT) as DndAbilityKey[]).map((k) => (
                      <option key={k} value={k}>
                        {ABILITY_SHORT[k]}
                      </option>
                    ))}
                  </select>
                  <label>
                    СЛ{" "}
                    <input
                      type="number"
                      min={1}
                      placeholder={dc != null ? String(dc) : ""}
                      value={own.dc}
                      onChange={(e) => setOwn({ ...own, dc: e.target.value })}
                    />
                  </label>
                  <select aria-label="Когда" value={own.at} onChange={(e) => setOwn({ ...own, at: e.target.value as OwnDraft["at"] })}>
                    {(Object.keys(REPEAT_AT_LABELS) as OwnDraft["at"][]).map((k) => (
                      <option key={k} value={k}>
                        {REPEAT_AT_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </div>

          {src && (
            <div className="cm-fx__det">
              <div className="cm-fx__row">
                <b className="cm-fx__name">{src.name}</b>
                {src.conc && <span className="muted">концентрация</span>}
              </div>
              {counted ? (
                <label className="cm-fx__field">
                  Отсчёт
                  <input
                    className="cm-fx__num"
                    type="number"
                    min={1}
                    value={rounds || String(roundsValue)}
                    onChange={(e) => setRounds(e.target.value)}
                  />
                  р. · тикает в начале хода заклинателя
                </label>
              ) : (
                <span className="cm-fx__field">
                  {"until" in src.duration && src.duration.until === "rest"
                    ? "Час и дольше: в бою — до его конца, на листе — до долгого отдыха"
                    : `Длительность: ${durationLabel(src.duration as NestEffect)}`}
                </span>
              )}
              {src.conditions.length > 0 && (
                <label className="cm-fx__field">
                  <input type="checkbox" checked={condOn} onChange={(e) => setCondOn(e.target.checked)} /> + {src.conditions.join(", ")}
                </label>
              )}
              {src.repeat && (
                <div className="cm-fx__field">
                  Повтор: <b>{ABILITY_SHORT[src.repeat.ability]} СЛ {src.repeat.dc ?? "?"}</b> ·{" "}
                  {src.repeat.at.map((a) => REPEAT_AT_LABELS[a]).join(" и ")}
                </div>
              )}
              {src.conc && concNow && (
                <div className="cm-fx__warn">
                  {caster.name} концентрируется на «{concNow}» — оно снимется со всех целей.
                </div>
              )}
              {pcTargets.length > 0 && src.entryId != null && (
                <div className="muted">{pcTargets.join(", ")}: запишется в лист, в «Наложено на меня».</div>
              )}
            </div>
          )}

          <div className="cm-fx__row">
            <span className="cm-ui">Цели</span>
            {fighters.map((f) => {
              const on = targets.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`cm-pk-chip${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => setTargets(on ? targets.filter((t) => t !== f.id) : [...targets, f.id])}
                >
                  {f.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="cm-fx__foot">
          <button type="button" className="cm-btn" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="cm-btn cm-btn--primary" disabled={!canApply} onClick={apply}>
            Наложить{targets.length ? ` · ${fighters.filter((f) => targets.includes(f.id)).map((f) => f.name).join(", ")}` : ""}
          </button>
        </div>
      </section>
    </div>
  );
}
