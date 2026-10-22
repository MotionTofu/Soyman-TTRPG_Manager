import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DndCreatureView } from "../components/dnd/DndCreatureForm";
import { formatModifier } from "../components/dnd/AbilityScores";
import { rollDiceFormula } from "../components/dnd/diceRoll";
import type { DndCharacterData, DndCreatureData, InitiativeEntry } from "../types";
import {
  colorForCondition,
  concentrationDc,
  parseConditions,
  parseNestState,
  type NestFlag,
  type NestState,
} from "./nestState";
import { useNestCreature } from "./useNestCreature";
import { rollCreatureHp } from "./addToCombat";
import { CharacterPools, MonsterPools } from "./CombatPools";
import { NestCounters } from "./NestCounters";
import { useCharacterSheet, type CharacterSheetNest } from "./useCharacterSheet";
import { ABILITY_SHORT, dueOnDamage, durationLabel, type NestEffect } from "./effects";
import type { useCombat } from "./useCombat";

const UNCONSCIOUS = "Бессознательный";
/** Что умеет гнездо — действия режима над строкой (CombatMode.tsx). */
export interface NestActions {
  update: (entry: InitiativeEntry, label: string, fields: Partial<InitiativeEntry>) => Promise<boolean>;
  updateState: (entry: InitiativeEntry, label: string, state: NestState) => Promise<boolean>;
  setInitiative: (entry: InitiativeEntry, value: number | null) => void;
  /** Эффекты шага 3 — сквозь все гнёзда и листы (effectOps.ts). */
  effects: ReturnType<typeof useCombat>["effects"];
  openEffect: (entry: InitiativeEntry) => void;
  /** Все строки боя: на ком держится концентрация этого гнезда. */
  entries: InitiativeEntry[];
}

/** Ярлык над гнездом: номер в очереди и инициатива (Q44: пустая — «?» и бросок). */
function NestTab({
  entry,
  order,
  actions,
  rollable,
}: {
  entry: InitiativeEntry;
  order: number;
  actions: NestActions;
  rollable: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (entry.initiative == null ? "" : String(entry.initiative));
  function commit() {
    if (draft == null) return;
    const value = draft.trim() === "" ? null : Number(draft);
    setDraft(null);
    if (value === entry.initiative || (value != null && !Number.isFinite(value))) return;
    actions.setInitiative(entry, value);
  }
  function nudge(delta: number) {
    if (entry.initiative == null) return;
    actions.setInitiative(entry, entry.initiative + delta);
  }
  return (
    <div className={`cm-tab${entry.initiative == null && rollable ? " is-wait" : ""}`}>
      <span className="cm-tab__ord">№{order}</span>
      <button type="button" className="cm-ibtn" aria-label="Инициатива −1" onClick={() => nudge(-1)}>
        −
      </button>
      <input
        className="cm-init"
        type="number"
        aria-label="Инициатива"
        placeholder="?"
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(null);
        }}
      />
      <button type="button" className="cm-ibtn" aria-label="Инициатива +1" onClick={() => nudge(1)}>
        +
      </button>
      {entry.initiative == null && rollable && (
        <button
          type="button"
          className="cm-ibtn cm-tab__roll"
          title="Бросить к20 + модификатор инициативы"
          onClick={() => {
            const mod = entry.dex_modifier ?? 0;
            const value = rollDiceFormula(`1к20${mod >= 0 ? "+" : ""}${mod}`);
            if (value != null) actions.setInitiative(entry, value);
          }}
        >
          к20{formatModifier(entry.dex_modifier ?? 0)}
        </button>
      )}
    </div>
  );
}

function Flag({ flag }: { flag: NestFlag }) {
  if (flag === "now") return <span className="cm-flag cm-flag--now">Ходит</span>;
  if (flag === "next") return <span className="cm-flag cm-flag--next">Следующий</span>;
  if (flag === "wait") return <span className="cm-flag cm-flag--wait">Без инициативы · ход пропускается</span>;
  return null;
}

/** Хиты: поле «Урон / Лечение / Временные», Enter — урон (Q11). */
function HpView({
  cur,
  max,
  temp,
  onDamage,
  onHeal,
  onTemp,
}: {
  cur: number;
  max: number;
  temp: number;
  onDamage: (n: number) => void;
  onHeal: (n: number) => void;
  onTemp: (n: number) => void;
}) {
  const [amount, setAmount] = useState("");
  const value = Number(amount);
  const valid = amount !== "" && Number.isFinite(value) && value > 0;
  const apply = (fn: (n: number) => void) => {
    if (!valid) return;
    setAmount("");
    fn(value);
  };
  const pct = max > 0 ? Math.max(0, Math.min(100, (100 * cur) / max)) : 0;
  const tempPct = max > 0 ? Math.min(100 - pct, (100 * temp) / max) : 0;
  return (
    <div>
      <div className="cm-hp-row">
        <span className="cm-hp-cur">{cur}</span>
        <span className="cm-hp-max">/ {max}</span>
        {temp > 0 && <span className="cm-hp-temp">+{temp} врем.</span>}
      </div>
      <div className="cm-bar">
        <div className={`cm-bar__hp${pct <= 25 ? " is-low" : ""}`} style={{ width: `${pct}%` }} />
        {tempPct > 0 && <div className="cm-bar__temp" style={{ width: `${tempPct}%` }} />}
      </div>
      <div className="cm-hp-ctrl">
        <input
          className="cm-amt"
          type="number"
          min={1}
          aria-label="Сколько хитов"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply(onDamage);
          }}
        />
        <button type="button" className="cm-btn cm-btn--dmg" disabled={!valid} onClick={() => apply(onDamage)}>
          Урон
        </button>
        <button type="button" className="cm-btn" disabled={!valid} onClick={() => apply(onHeal)}>
          Лечение
        </button>
        <button type="button" className="cm-btn" disabled={!valid} onClick={() => apply(onTemp)}>
          Временные
        </button>
      </div>
    </div>
  );
}

/**
 * Урон не до нуля: испытание концентрации (Q26) и плашки повтора «при уроне»
 * (Q60) — одной записью состояния. null — менять нечего.
 */
function afterDamage(state: NestState, damage: number, concentrating: boolean): NestState | null {
  const due = dueOnDamage(state.effects ?? [], state.repeatDue ?? []);
  const repeatChanged = due.length !== (state.repeatDue?.length ?? 0);
  if (!concentrating && !repeatChanged) return null;
  return {
    ...state,
    ...(concentrating ? { concentrationCheck: concentrationDc(damage) } : {}),
    ...(repeatChanged ? { repeatDue: due } : {}),
  };
}

/** Хиты чудовища и персонажа без листа — в строке инициативы, как в трекере. */
function RowHitPoints({
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
  const max = entry.max_hp;
  const cur = entry.current_hp ?? max;
  const temp = entry.temp_hp ?? 0;
  // Двойник — не персонаж: на нуле уходит в корешок, как чудовище.
  const isCharacter = entry.entity_type === "character" && !state.double;

  if (max == null || cur == null) {
    const canRoll = !!creature && (!!(creature.hitPoints.diceCount && creature.hitPoints.dieSize) || !!creature.hitPoints.formula);
    return (
      <div className="cm-hp-none">
        <span className="muted">Хиты не заданы</span>
        {canRoll && (
          <button
            type="button"
            className="cm-btn cm-btn--sm"
            onClick={() => {
              const rolled = rollCreatureHp(creature!.hitPoints);
              if (rolled != null) actions.update(entry, `Хиты ${entry.name}`, { max_hp: rolled, current_hp: rolled });
            }}
          >
            Бросить хиты
          </button>
        )}
      </div>
    );
  }

  function damage(value: number) {
    const fromTemp = Math.min(temp, value);
    const left = Math.max(0, cur! - (value - fromTemp));
    const fields: Partial<InitiativeEntry> = { temp_hp: temp - fromTemp, current_hp: left };
    const conditions = parseConditions(entry.conditions);
    if (left === 0) {
      // 0 хитов (Q26, Q54): концентрация срывается вместе с её эффектами;
      // чудовище — в корешок, персонаж — «Бессознательный».
      if (state.concentration || state.concentrationCheck) void actions.effects.breakConcentration(entry);
      if (isCharacter) {
        if (!conditions.includes(UNCONSCIOUS)) fields.conditions = JSON.stringify([...conditions, UNCONSCIOUS]);
      } else {
        fields.dead = true;
      }
    } else {
      const next = afterDamage(state, value, !!state.concentration);
      if (next) void actions.updateState(entry, `Урон ${entry.name}: концентрация, повтор`, next);
    }
    void actions.update(entry, `Урон ${entry.name}`, fields);
  }

  function heal(value: number) {
    const fields: Partial<InitiativeEntry> = { current_hp: Math.min(max!, cur! + value) };
    // Лечение из 0 — снова в сознании (Q26).
    if (cur === 0) {
      const conditions = parseConditions(entry.conditions);
      if (conditions.includes(UNCONSCIOUS))
        fields.conditions = JSON.stringify(conditions.filter((c) => c !== UNCONSCIOUS));
    }
    void actions.update(entry, `Лечение ${entry.name}`, fields);
  }

  return (
    <HpView
      cur={cur}
      max={max}
      temp={temp}
      onDamage={damage}
      onHeal={heal}
      // Временные не складываются — остаётся большее.
      onTemp={(value) => void actions.update(entry, `Временные хиты ${entry.name}`, { temp_hp: Math.max(temp, value) })}
    />
  );
}

/**
 * Хиты персонажа — в ЛИСТЕ (Q28), по правилам листа (SheetVitals): максимум —
 * сохранённый плюс временный, лечение с нуля сбрасывает спасброски от
 * смерти. Строка инициативы получает копию — по ней трекер рисует полосу.
 */
function SheetHitPoints({
  entry,
  sheet,
  state,
  actions,
}: {
  entry: InitiativeEntry;
  sheet: CharacterSheetNest;
  state: NestState;
  actions: NestActions;
}) {
  const { cur, maxHp, temp, data } = sheet;
  const mirror = (current: number, tempHp: number) =>
    void actions.update(entry, `Хиты ${entry.name} в очереди`, { current_hp: current, max_hp: maxHp, temp_hp: tempHp });

  function damage(value: number) {
    const fromTemp = Math.min(temp, value);
    const left = Math.max(0, cur - (value - fromTemp));
    const fields: Partial<DndCharacterData> = { hitPointsTemp: String(temp - fromTemp), hitPointsCurrent: String(left) };
    if (left === 0) {
      // 0 хитов (Q26, Q54): концентрация срывается вместе с её эффектами,
      // «Бессознательный» на лист.
      if (data.concentration) {
        fields.concentration = "";
        void actions.effects.breakConcentration(entry);
      } else if (state.concentrationCheck != null) {
        void actions.updateState(entry, `Концентрация ${entry.name}`, { ...state, concentrationCheck: undefined });
      }
      if (!data.conditions.includes(UNCONSCIOUS)) fields.conditions = [...data.conditions, UNCONSCIOUS];
    } else {
      const next = afterDamage(state, value, !!data.concentration);
      if (next) void actions.updateState(entry, `Урон ${entry.name}: концентрация, повтор`, next);
    }
    sheet.patch(`Урон ${entry.name}`, fields);
    mirror(left, temp - fromTemp);
  }

  function heal(value: number) {
    const healed = maxHp > 0 ? Math.min(cur + value, maxHp) : cur + value;
    const fields: Partial<DndCharacterData> = { hitPointsCurrent: String(healed) };
    if (cur <= 0 && healed > 0) {
      fields.deathSaveSuccesses = 0;
      fields.deathSaveFailures = 0;
      if (data.conditions.includes(UNCONSCIOUS)) fields.conditions = data.conditions.filter((c) => c !== UNCONSCIOUS);
    }
    sheet.patch(`Лечение ${entry.name}`, fields);
    mirror(healed, temp);
  }

  function addTemp(value: number) {
    const next = Math.max(temp, value);
    sheet.patch(`Временные хиты ${entry.name}`, { hitPointsTemp: String(next) });
    mirror(cur, next);
  }

  return <HpView cur={cur} max={maxHp} temp={temp} onDamage={damage} onHeal={heal} onTemp={addTemp} />;
}

/** Состояния и эффекты на бойце (Q53, Q56): состояние от эффекта помечено им и уходит вместе с ним. */
function Conditions({
  conditions,
  onChange,
  options,
  effects,
  onRemoveEffect,
  onAddEffect,
}: {
  conditions: string[];
  onChange: (next: string[]) => void;
  options: string[];
  effects: NestEffect[];
  onRemoveEffect: (e: NestEffect) => void;
  onAddEffect: () => void;
}) {
  const free = options.filter((o) => !conditions.includes(o));
  const fromEffect = (c: string) => effects.find((e) => e.conditions?.includes(c));
  return (
    <div className="cm-sect">
      <div className="cm-sect__t">Состояния и эффекты</div>
      <div className="cm-chips">
        {conditions.map((c) => {
          const src = fromEffect(c);
          return (
            <span key={c} className="cm-cond" title={src ? `Уйдёт вместе с «${src.name}»` : undefined}>
              <i style={{ background: colorForCondition(c) }} />
              {c}
              {src && <small>← {src.name}</small>}
              <button type="button" aria-label={`Снять «${c}»`} onClick={() => onChange(conditions.filter((x) => x !== c))}>
                ✕
              </button>
            </span>
          );
        })}
        {effects.map((e) => (
          <span
            key={e.id}
            className="cm-cond cm-cond--eff"
            title={e.repeat ? `Повтор: ${ABILITY_SHORT[e.repeat.ability]} СЛ ${e.repeat.dc ?? "?"}` : e.conc ? `Концентрация: ${e.casterName}` : undefined}
          >
            {e.name} <small>{e.casterName} · {durationLabel(e)}</small>
            <button type="button" aria-label={`Снять «${e.name}»`} onClick={() => onRemoveEffect(e)}>
              ✕
            </button>
          </span>
        ))}
        {free.length > 0 && (
          <select
            className="cm-add"
            aria-label="Добавить состояние"
            value=""
            onChange={(e) => {
              if (e.target.value) onChange([...conditions, e.target.value]);
            }}
          >
            <option value="">+ состояние</option>
            {free.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="cm-addbtn" onClick={onAddEffect}>
          + эффект
        </button>
      </div>
    </div>
  );
}

/** Плашка «Повтор» (Q60): «Прошёл» снимает эффект с цели, «Провалил» — только плашку. */
function RepeatPlaques({ entry, state, actions }: { entry: InitiativeEntry; state: NestState; actions: NestActions }) {
  const due = (state.effects ?? []).filter((e) => e.repeat && state.repeatDue?.includes(e.id));
  return (
    <>
      {due.map((e) => (
        <div key={e.id} className="cm-notice">
          <span>
            Повтор: <b>{e.name}</b> ({e.casterName}) — {ABILITY_SHORT[e.repeat!.ability]} СЛ {e.repeat!.dc ?? "?"}
          </span>
          <button
            type="button"
            className="cm-btn cm-btn--sm"
            onClick={() => actions.effects.remove(entry, e.id, `${entry.name}: «${e.name}» прошёл`)}
          >
            Прошёл
          </button>
          <button
            type="button"
            className="cm-btn cm-btn--sm"
            onClick={() =>
              actions.updateState(entry, `Повтор ${entry.name}`, {
                ...state,
                repeatDue: (state.repeatDue ?? []).filter((id) => id !== e.id),
              })
            }
          >
            Провалил
          </button>
        </div>
      ))}
    </>
  );
}

/** Спасброски от смерти — на листе, пока персонаж на нуле (Q26). */
function DeathSaves({ sheet, name }: { sheet: CharacterSheetNest; name: string }) {
  const { deathSaveSuccesses: ok, deathSaveFailures: bad } = sheet.data;
  const row = (field: "deathSaveSuccesses" | "deathSaveFailures", filled: number, label: string) => (
    <span className="cm-ds__row">
      <span className="cm-ui">{label}</span>
      {[0, 1, 2].map((i) => (
        <button
          key={i}
          type="button"
          className={`cm-pip${i < filled ? " is-on" : ""}`}
          aria-label={`${label}: ${i + 1}`}
          onClick={() => sheet.patch(`Спасброски ${name}`, { [field]: i < filled ? i : i + 1 })}
        />
      ))}
    </span>
  );
  return (
    <div className="cm-ds">
      <b className="cm-ui">Спасброски от смерти</b>
      {row("deathSaveSuccesses", ok, "успех")}
      {row("deathSaveFailures", bad, "провал")}
    </div>
  );
}

function defensesText(c: DndCreatureData): string {
  return [
    c.damageVulnerabilities.length ? `уязвимость: ${c.damageVulnerabilities.join(", ")}` : "",
    c.damageResistances.length ? `сопротивление: ${c.damageResistances.join(", ")}` : "",
    c.damageImmunities.length ? `иммунитет: ${c.damageImmunities.join(", ")}` : "",
    c.conditionImmunities.length ? `не бывает: ${c.conditionImmunities.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function subtitle(entry: InitiativeEntry, creature: DndCreatureData | null): string {
  if (entry.entity_type === "character") return "персонаж";
  const where = entry.entity_type === "compendium_entry" ? "бестиарий" : entry.entity_type === "being" ? "сеттинг" : "своё";
  const cr = creature?.challenge.rating;
  return cr ? `ОП ${cr} · ${where}` : where;
}

/** Гнездо бойца: трекеры сверху, ниже полный статблок (Q9). */
export function FighterNest({
  entry,
  order,
  flag,
  actions,
  conditionOptions,
  children,
}: {
  entry: InitiativeEntry;
  order: number;
  flag: NestFlag;
  actions: NestActions;
  conditionOptions: string[];
  children?: ReactNode;
}) {
  const creature = useNestCreature(entry);
  const sheet = useCharacterSheet(entry);
  const state = parseNestState(entry);
  const active = flag === "now";
  const effects = state.effects ?? [];
  // КЗ персонажа с листом уже несёт «Наложено на меня»; чудовищу и двойнику
  // прибавка эффектов — здесь, с разбором «15 + 2 Щит веры» (Q56).
  const baseAc = state.double ? state.double.ac : sheet ? sheet.ac : (creature?.armorClass.value ?? null);
  const acBonus = sheet ? [] : effects.filter((e) => e.ac);
  const ac = baseAc == null ? null : baseAc + acBonus.reduce((n, e) => n + e.ac!, 0);
  const acWhy = acBonus.length ? `${baseAc} ${acBonus.map((e) => `+ ${e.ac} ${e.name}`).join(" ")}` : "";
  const defenses = creature ? defensesText(creature) : "";
  const concentrating = sheet ? sheet.data.concentration : state.concentration;
  const concTargets = concentrating
    ? actions.entries
        .filter((r) => (parseNestState(r).effects ?? []).some((e) => e.conc && e.casterId === entry.id && e.name === concentrating))
        .map((r) => r.name)
    : [];
  const breakConcentration = () => void actions.effects.breakConcentration(entry);
  const removeEffect = (e: NestEffect) => void actions.effects.remove(entry, e.id, `${entry.name}: снят «${e.name}»`);

  return (
    <section
      className={`cm-nest${active ? " is-active" : ""}${flag === "wait" ? " is-wait" : ""}`}
      data-nest={entry.id}
      aria-label={entry.name}
    >
      <NestTab entry={entry} order={order} actions={actions} rollable />
      <Flag flag={flag} />
      <div className="cm-trk">
        <div className="cm-head">
          <div className="cm-head__t">
            <div className="cm-name">{entry.name}</div>
            <div className="cm-sub">
              {state.double ? (
                "двойник · копия листа"
              ) : sheet ? (
                <>
                  персонаж · ПВ {sheet.passivePerception} ·{" "}
                  <Link to={`/characters/${entry.entity_id}/sheet`}>лист</Link>
                </>
              ) : (
                subtitle(entry, creature)
              )}
            </div>
            {acWhy && (
              <div className="cm-acwhy">
                <b>КЗ {ac}</b> = {acWhy}
              </div>
            )}
          </div>
          <button
            type="button"
            className={`cm-react${state.reactionSpent ? " is-spent" : ""}`}
            title={state.reactionSpent ? "Реакция потрачена — вернётся в начале своего хода" : "Реакция есть — щелчок тратит"}
            aria-pressed={!!state.reactionSpent}
            onClick={() =>
              actions.updateState(entry, `Реакция ${entry.name}`, { ...state, reactionSpent: !state.reactionSpent })
            }
          >
            <i />
            <span>Реакция</span>
          </button>
          <div className={`cm-ac${acWhy ? " is-up" : ""}`} title={acWhy ? `Класс защиты: ${acWhy}` : "Класс защиты"}>
            <span className="cm-ac__n">{ac ?? "—"}</span>
            <span className="cm-ac__l">КЗ</span>
          </div>
        </div>

        {sheet ? (
          <SheetHitPoints entry={entry} sheet={sheet} state={state} actions={actions} />
        ) : (
          <RowHitPoints entry={entry} state={state} actions={actions} creature={creature} />
        )}

        {sheet && sheet.cur <= 0 && sheet.maxHp > 0 && <DeathSaves sheet={sheet} name={entry.name} />}

        {defenses && (
          <div className="cm-def">
            <b>Защита</b> {defenses}
          </div>
        )}

        {state.concentrationCheck != null && (
          <div className="cm-notice">
            <span>
              Концентрация{concentrating ? ` на «${concentrating}»` : ""}: испытание Телосложения,{" "}
              <b>СЛ {state.concentrationCheck}</b>
            </span>
            <button
              type="button"
              className="cm-btn cm-btn--sm"
              onClick={() =>
                actions.updateState(entry, `Концентрация ${entry.name}`, { ...state, concentrationCheck: undefined })
              }
            >
              Удержал
            </button>
            <button type="button" className="cm-btn cm-btn--sm" onClick={breakConcentration}>
              Сорвалась
            </button>
          </div>
        )}

        <RepeatPlaques entry={entry} state={state} actions={actions} />

        {concentrating && state.concentrationCheck == null && (
          <div className="cm-conc">
            Концентрируется: <b>{concentrating}</b>
            {concTargets.length > 0 && <> — {concTargets.join(", ")}</>}
            <button type="button" className="cm-x" aria-label="Сорвать концентрацию" title="Сорвалась: снять со всех целей" onClick={breakConcentration}>
              ✕
            </button>
          </div>
        )}

        <Conditions
          conditions={sheet ? sheet.data.conditions : parseConditions(entry.conditions)}
          onChange={(next) =>
            sheet
              ? sheet.patch(`Состояния ${entry.name}`, { conditions: next })
              : void actions.update(entry, `Состояния ${entry.name}`, { conditions: JSON.stringify(next) })
          }
          options={conditionOptions}
          effects={effects}
          onRemoveEffect={removeEffect}
          onAddEffect={() => actions.openEffect(entry)}
        />

        <NestCounters entry={entry} state={state} actions={actions} creature={sheet ? null : creature} />

        {sheet && (
          <>
            <div className="cm-pool">
              <span className="cm-pool__l">Истощение</span>
              <button
                type="button"
                className="cm-ibtn"
                aria-label="Истощение −1"
                disabled={sheet.data.exhaustion <= 0}
                onClick={() => sheet.patch(`Истощение ${entry.name}`, { exhaustion: sheet.data.exhaustion - 1 })}
              >
                −
              </button>
              <span className="cm-pool__n">{sheet.data.exhaustion} / 6</span>
              <button
                type="button"
                className="cm-ibtn"
                aria-label="Истощение +1"
                disabled={sheet.data.exhaustion >= 6}
                onClick={() => sheet.patch(`Истощение ${entry.name}`, { exhaustion: sheet.data.exhaustion + 1 })}
              >
                +
              </button>
            </div>
            <CharacterPools sheet={sheet} name={entry.name} />
          </>
        )}

        {creature &&
          (creature.review?.length ? (
            <div className="cm-def">
              Статблок требует разбора — запасы, легендарное и перезарядку режим по нему не считает.
            </div>
          ) : (
            <MonsterPools
              entry={entry}
              creature={creature}
              state={state}
              save={(label, next) => void actions.updateState(entry, label, next)}
            />
          ))}

        {children}
      </div>

      {creature && (
        <div className="cm-sb">
          <DndCreatureView value={creature} foldSections={!active} />
        </div>
      )}
    </section>
  );
}

/** Повергнутый — корешок на своём месте (Q18). */
export function StubNest({ entry, order, actions }: { entry: InitiativeEntry; order: number; actions: NestActions }) {
  return (
    <section className="cm-stub" data-nest={entry.id} aria-label={`${entry.name}, повержен`}>
      <div className="cm-tab">
        <span className="cm-tab__ord">№{order}</span>
        <span className="cm-tab__init">{entry.initiative ?? "?"}</span>
      </div>
      <div className="cm-stub__name">{entry.name}</div>
      <span className="cm-stub__mark">Повержен</span>
      <button
        type="button"
        className="cm-btn cm-btn--sm"
        onClick={() => actions.update(entry, `«${entry.name}» не вернулся`, { dead: false })}
      >
        Вернуть
      </button>
    </section>
  );
}

/** Логово, окружение, своё событие — узкое гнездо с заметкой (Q4). */
export function NoteNest({
  entry,
  order,
  flag,
  actions,
  lairCreatures,
}: {
  entry: InitiativeEntry;
  order: number;
  flag: NestFlag;
  actions: NestActions;
  lairCreatures: InitiativeEntry[];
}) {
  const state = parseNestState(entry);
  const [note, setNote] = useState(state.note ?? "");
  useEffect(() => setNote(state.note ?? ""), [state.note]);
  return (
    <section
      className={`cm-lair${flag === "now" ? " is-active" : ""}`}
      data-nest={entry.id}
      aria-label={entry.name}
    >
      <NestTab entry={entry} order={order} actions={actions} rollable={false} />
      <Flag flag={flag === "wait" ? null : flag} />
      <div className="cm-trk">
        <div className="cm-name">{entry.name}</div>
        {entry.kind === "lair" && (
          <>
            <div className="cm-lair__acts">
              {lairCreatures.map((e) => (
                <LairActionsOf key={e.id} entry={e} />
              ))}
            </div>
            {/* Видна, только когда блок выше пуст (combat.css, :empty). */}
            <span className="cm-lair__none muted">У существ в этом бою действий логова нет — заметка Мастера:</span>
          </>
        )}
        <label className="cm-sect">
          <span className="cm-sect__t">Заметка</span>
          <textarea
            className="cm-note"
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (note !== (state.note ?? "")) void actions.updateState(entry, `Заметка «${entry.name}»`, { ...state, note });
            }}
          />
        </label>
      </div>
    </section>
  );
}

/** Действия логова существа в бою — из его статблока (Q4). */
function LairActionsOf({ entry }: { entry: InitiativeEntry }) {
  const creature = useNestCreature(entry);
  const lair = creature?.legendary.lairEnabled ? creature.legendary.lairActions : [];
  if (lair.length === 0) return null;
  return (
    <div className="cm-sect">
      <div className="cm-sect__t">{entry.name}</div>
      {lair.map((a, i) => (
        <div key={i} className="cm-lair__act">
          {a.name && <b>{a.name}. </b>}
          {a.description}
        </div>
      ))}
    </div>
  );
}
