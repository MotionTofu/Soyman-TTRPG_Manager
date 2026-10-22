import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { dataKeys } from "../data/entities";
import { useAction, useEntity, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { useSoundEngineOptional } from "../sound/engine";
import type { InitiativeEntry, SessionDetail } from "../types";
import { parseNestState, startOfTurn, type NestState } from "./nestState";
import { setCombatModeOpen, setEndedEffects } from "./combatModeStore";
import { endedLines } from "./effects";
import {
  composeSheetEdits,
  planApply,
  planBreakConcentration,
  planEndCombat,
  planRemove,
  planTurn,
  type ApplyInput,
  type EffectPlan,
} from "./effectOps";
import { patchCharacterSheet } from "./sheetWrite";

const NO_ENTRIES: InitiativeEntry[] = [];

/** Очередь хода сессии — тот же путь, что задевает сигнал `initiative-updated`. */
export function initiativePath(sessionId: number): string {
  return `/initiative-entries?session_id=${sessionId}`;
}

export function patchRow(id: number, fields: Partial<InitiativeEntry>) {
  return (rows: InitiativeEntry[]) => rows.map((e) => (e.id === id ? { ...e, ...fields } : e));
}

export function isDead(entry: InitiativeEntry): boolean {
  return entry.dead === true || entry.dead === 1;
}

// Порядок хода: инициатива, при равенстве — ловкость, затем имя и id.
//
// Finite sentinel, not -Infinity: subtracting two -Infinity values (both
// entries with no initiative set yet) produces NaN, and Array.sort treats a
// NaN comparator result as "equal", silently skipping the dex/name
// tie-breakers below and leaving entries in insertion order.
const NO_INITIATIVE = -1_000_000;
export function byInitiative(a: InitiativeEntry, b: InitiativeEntry): number {
  const initDiff = (b.initiative ?? NO_INITIATIVE) - (a.initiative ?? NO_INITIATIVE);
  if (initDiff !== 0) return initDiff;
  const dexDiff = b.dex_modifier - a.dex_modifier;
  if (dexDiff !== 0) return dexDiff;
  const nameDiff = a.name.localeCompare(b.name, "ru");
  if (nameDiff !== 0) return nameDiff;
  return a.id - b.id;
}

/** Ходит ли строка: жива и с инициативой (Q44 — без числа ход пропускается). */
function takesTurn(entry: InitiativeEntry): boolean {
  return !isDead(entry) && entry.initiative != null;
}

/**
 * Бой сессии: очередь, раунд, чей ход. Общий для трекера в правой панели и
 * боевого режима пульта — «Следующий» в любом из них идёт через одну
 * автоматику начала хода (Q26).
 */
export function useCombat(sessionId: number) {
  const client = useQueryClient();
  const run = useAction();
  const sound = useSoundEngineOptional();
  const entriesPath = initiativePath(sessionId);
  // Очередь и сессия — под ключами слоя. Игрок назвал свою инициативу —
  // сигнал `initiative-updated` задевает этот путь (data/syncAffects.ts), и
  // оба экземпляра видят одно и то же.
  const entries = useResource<InitiativeEntry[]>(entriesPath).data ?? NO_ENTRIES;
  const session = useEntity<SessionDetail>("session", sessionId).data ?? null;

  /**
   * Правка очереди: строки меняются на экране сразу, при отказе возвращаются
   * прежние и появляется плашка. Без `patch` — ждать ответа (создание: id
   * строки знает только сервер).
   */
  async function change(
    label: string,
    send: () => Promise<unknown>,
    options?: { patch?: (rows: InitiativeEntry[]) => InitiativeEntry[]; retry?: boolean }
  ): Promise<boolean> {
    const key = dataKeys.resource(entriesPath);
    let previous: InitiativeEntry[] | undefined;
    if (options?.patch) {
      await client.cancelQueries({ queryKey: key });
      previous = client.getQueryData<InitiativeEntry[]>(key);
      if (previous) client.setQueryData(key, options.patch(previous));
    }
    const done = await run(labelled(label, () => send().then(() => true)), {
      affects: [{ path: entriesPath }],
      retry: options?.retry,
    });
    if (!done && previous) client.setQueryData(key, previous);
    return done === true;
  }

  /**
   * Поля строки — сразу на экране, отказ возвращает прежнее. Состояния в
   * строке лежат JSON-строкой, а сервер принимает массив — переводится здесь.
   */
  function updateEntry(entry: InitiativeEntry, label: string, fields: Partial<InitiativeEntry>) {
    const body: Record<string, unknown> = { ...fields };
    if (typeof fields.conditions === "string") body.conditions = JSON.parse(fields.conditions);
    return change(label, () => write.put(`/initiative-entries/${entry.id}`, body), {
      patch: patchRow(entry.id, fields),
    });
  }

  /** Состояние гнезда (nestState.ts): шлётся объектом, в кэше лежит строкой. */
  function updateState(entry: InitiativeEntry, label: string, state: NestState) {
    return change(label, () => write.put(`/initiative-entries/${entry.id}`, { state }), {
      patch: patchRow(entry.id, { state: JSON.stringify(state) }),
    });
  }

  const sorted = useMemo(() => {
    const alive = entries.filter((e) => !isDead(e)).sort(byInitiative);
    const dead = entries.filter((e) => isDead(e)).sort(byInitiative);
    return [...alive, ...dead];
  }, [entries]);

  const aliveSorted = useMemo(() => sorted.filter((e) => !isDead(e)), [sorted]);

  // Порядок хода с мёртвыми НА СВОИХ МЕСТАХ. `sorted` сдвигает их в конец —
  // по нему нельзя понять, кто ходит после погибшего, а именно это и нужно,
  // когда бойца убили в его же ход.
  const turnOrder = useMemo(() => [...entries].sort(byInitiative), [entries]);

  /** Бой и чей ход: кнопки откликаются сразу, отказ возвращает прежнее. */
  async function setCombat(active: boolean, turnEntryId: number | null, round?: number): Promise<boolean> {
    const key = dataKeys.entity("session", sessionId);
    await client.cancelQueries({ queryKey: key });
    const previous = client.getQueryData<SessionDetail>(key);
    if (previous) {
      client.setQueryData<SessionDetail>(key, {
        ...previous,
        // Как пишет сервер: без раунда — первый, вне боя — ноль.
        combat_active: active ? 1 : 0,
        combat_turn_entry_id: turnEntryId,
        combat_round: active ? Math.max(1, Math.floor(round ?? 1)) : 0,
      });
    }
    const done = await run(
      labelled(active ? "Ход в бою" : "Бой не завершился", () =>
        write.put(`/sessions/${sessionId}/combat`, { active, turn_entry_id: turnEntryId, round }).then(() => true)
      ),
      { affects: [{ kind: "session", id: sessionId, card: true }] }
    );
    if (!done && previous) client.setQueryData(key, previous);
    return done === true;
  }

  /**
   * Боевая тема сессии (Q34): на экране сразу, при отказе — прежняя. Идёт бой
   * — музыка переключается тут же; «из набора» (null) — тема набора.
   */
  async function setTheme(id: number | null): Promise<boolean> {
    const key = dataKeys.entity("session", sessionId);
    await client.cancelQueries({ queryKey: key });
    const previous = client.getQueryData<SessionDetail>(key);
    if (previous) client.setQueryData<SessionDetail>(key, { ...previous, battle_playlist_id: id });
    const done = await run(
      labelled("Боевая тема", () => write.put(`/sessions/${sessionId}`, { battle_playlist_id: id }).then(() => true)),
      { affects: [{ kind: "session", id: sessionId, card: true }] }
    );
    if (!done) {
      if (previous) client.setQueryData(key, previous);
      return false;
    }
    const theme = id ?? sound?.state.data?.battle?.id ?? null;
    if (session?.combat_active && theme) sound?.enterCombat(theme);
    return true;
  }

  /**
   * Правки эффектов (effectOps.ts): строки очереди — одной правкой, сразу на
   * экране; листы персонажей — патчами следом.
   */
  async function commitPlan(label: string, plan: EffectPlan): Promise<boolean> {
    const ids = new Set([...plan.states.keys(), ...plan.fields.keys()]);
    let done = true;
    if (ids.size) {
      done = await change(
        label,
        async () => {
          for (const id of ids) {
            const fields = plan.fields.get(id);
            const body: Record<string, unknown> = { ...fields };
            if (typeof fields?.conditions === "string") body.conditions = JSON.parse(fields.conditions);
            const state = plan.states.get(id);
            if (state) body.state = state;
            await write.put(`/initiative-entries/${id}`, body);
          }
        },
        {
          patch: (rows) =>
            rows.map((e) => {
              if (!ids.has(e.id)) return e;
              const state = plan.states.get(e.id);
              return { ...e, ...plan.fields.get(e.id), ...(state ? { state: JSON.stringify(state) } : {}) };
            }),
        }
      );
    }
    for (const [characterId, edits] of plan.sheets) void patchCharacterSheet(characterId, label, composeSheetEdits(edits));
    return done;
  }

  /**
   * Ход перешёл к строке (Q26, Q53, Q57, Q60): конец хода уходящего, отсчёт
   * эффектов, плашки повтора, затем автоматика начала её хода.
   */
  function beginTurn(entry: InitiativeEntry, fromId: number | null) {
    const { plan, expired } = planTurn(entries, fromId, entry.id);
    const { state, changed } = startOfTurn(plan.states.get(entry.id) ?? parseNestState(entry));
    if (changed) plan.states.set(entry.id, state);
    setEndedEffects(sessionId, endedLines(expired, (id) => entries.find((e) => e.id === id)?.name ?? "?"));
    void commitPlan(`Начало хода ${entry.name}`, plan);
  }

  const effects = {
    apply: (input: ApplyInput) => commitPlan(`Эффект «${input.name}»`, planApply(entries, input)),
    remove: (entry: InitiativeEntry, effectId: string, label: string) =>
      commitPlan(label, planRemove(entries, entry.id, effectId)),
    breakConcentration: (caster: InitiativeEntry) =>
      commitPlan(`Концентрация ${caster.name}`, planBreakConcentration(entries, caster)),
  };

  // Кто может ходить: с числом. Если чисел нет ни у кого (трекер без бросков
  // — так им пользовались до режима), ходят все живые по порядку, как раньше.
  const turnTakers = useMemo(() => {
    const ready = turnOrder.filter(takesTurn);
    return ready.length > 0 ? ready : turnOrder.filter((e) => !isDead(e));
  }, [turnOrder]);

  async function startCombat() {
    const first = turnTakers[0];
    if (!first) return;
    if (!(await setCombat(true, first.id, 1))) return;
    setCombatModeOpen(sessionId, true);
    beginTurn(first, null);
    // Переключение идёт через движок пульта, а не напрямую в плеер: он
    // запоминает, что играло до боя, и показывает в пульте, что Бэкграунд
    // сменил трекер инициативы, а не Мастер.
    // Тема сессии главнее темы набора: сессионную выбирают под конкретный
    // вечер, а набор заготовлен на всю кампанию.
    const theme = session?.battle_playlist_id ?? sound?.state.data?.battle?.id ?? null;
    if (theme) sound?.enterCombat(theme);
  }

  /** «Конец боя» (Q58): эффекты боя и счётчики гнёзд уходят, долгие остаются на листе. */
  async function stopCombat() {
    if (!(await setCombat(false, null))) return;
    setEndedEffects(sessionId, []);
    void commitPlan("Конец боя: эффекты", planEndCombat(entries));
    setCombatModeOpen(sessionId, false);
    // Бой кончился — возвращаем то, что играло до него.
    sound?.exitCombat();
  }

  // Шаг по очереди хода. Считаем от места текущего в ПОЛНОМ порядке, а не
  // среди ходящих: убитый в свой же ход из списка живых выпадает, и поиск по
  // нему давал −1 — «Следующий» отдавал второго в очереди, а не того, кто
  // идёт за погибшим.
  function step(delta: 1 | -1) {
    if (turnTakers.length === 0) return;
    const allowed = new Set(turnTakers.map((e) => e.id));
    const current = session?.combat_turn_entry_id ?? null;
    const from = current == null ? -1 : turnOrder.findIndex((e) => e.id === current);
    // Строку удалили целиком — места в порядке не осталось, начинаем с края.
    if (from === -1) {
      const edge = delta === 1 ? turnTakers[0] : turnTakers[turnTakers.length - 1];
      void setCombat(true, edge.id);
      if (delta === 1) beginTurn(edge, null);
      return;
    }
    const n = turnOrder.length;
    const round = session?.combat_round || 1;
    for (let k = 1; k <= n; k++) {
      const raw = from + delta * k;
      const candidate = turnOrder[((raw % n) + n) % n];
      if (!allowed.has(candidate.id)) continue;
      // Раунд считается по переходу через край очереди, а не по числу шагов:
      // мёртвые пропускаются, и «сколько ходов прошло» с раундом не совпадает.
      const wrapped = raw < 0 || raw >= n;
      void setCombat(true, candidate.id, wrapped ? Math.max(1, round + delta) : round);
      // Назад — исправление ошибки Мастера, а не новый ход: ничего не
      // возвращается и не бросается.
      if (delta === 1) beginTurn(candidate, current);
      return;
    }
  }

  const currentId = session?.combat_active ? session.combat_turn_entry_id : null;

  return {
    entries,
    session,
    sorted,
    aliveSorted,
    turnOrder,
    turnTakers,
    currentId,
    change,
    updateEntry,
    updateState,
    setCombat,
    setTheme,
    startCombat,
    stopCombat,
    step,
    effects,
  };
}
