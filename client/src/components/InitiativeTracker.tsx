import { useEffect, useMemo, useState, type DragEvent } from "react";
import { api } from "../api/client";
import { useSoundEngineOptional } from "../sound/engine";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { useUnloadTarget } from "../unloadTargets";
import { NavIcon } from "./NavIcons";
import { parseDndStatblock } from "./EntityPreviewModal";
import { abilityModifier, formatModifier } from "./dnd/AbilityScores";
import { rollDiceFormula } from "./dnd/diceRoll";
import { findDndSystemId, loadDndMechanicsGroup } from "./dnd/dndCompendium";
import { fetchCreatureCard } from "./CreatureCard";
import { loadUseEpithets, INITIATIVE_EPITHETS } from "../initiativeTrackerPrefs";
import { deriveSheet, creatureInitiativeModifier } from "@shared/dnd/derive";
import { useConfirm } from "../hooks/useConfirm";
import type {
  InitiativeKind,
  DndCharacterData,
  DndCreatureData,
  DndCreatureHitPoints,
  InitiativeEntry,
  SearchResult,
  SessionDetail,
  Statblock,
} from "../types";

const ACCEPT_TYPES = ["being", "character", "compendium_entry"];

// Строки, которые ходят в инициативе, но никем не являются.
//
// Умолчания взяты из книги: логово ходит на 20, окружение — в начале раунда,
// а «начало раунда» в списке инициативы и выражается сверхвысоким числом.
// Отдельного флага «в начале раунда» нет намеренно: он потребовал бы своего
// правила сортировки и своего объяснения за столом, а 999 встаёт наверх сам и
// правится тем же двойным щелчком, что у всех.
const SPECIAL_ROWS: { kind: InitiativeKind; name: string; initiative: number }[] = [
  { kind: "lair", name: "Действие логова", initiative: 20 },
  { kind: "environment", name: "Действие окружения", initiative: 999 },
];

// Same 10-color palette used nowhere else yet — deterministic per condition
// name (hash → index) so a given condition always gets the same chip color
// across entries and re-renders, without needing a color field in the
// compendium (conditions are plain name+description mechanic_item entries).
const CONDITION_COLORS = [
  "#c0392b", "#c9a227", "#2f8f7a", "#4a90a4", "#8a5fb0",
  "#c97b4a", "#5c8f3a", "#a35fa0", "#3a6fa0", "#a0503a",
];
function colorForCondition(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return CONDITION_COLORS[Math.abs(hash) % CONDITION_COLORS.length];
}

function parseConditions(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// Порядок хода: инициатива, при равенстве — ловкость, затем имя и id.
//
// Finite sentinel, not -Infinity: subtracting two -Infinity values (both
// entries with no initiative set yet) produces NaN, and Array.sort treats a
// NaN comparator result as "equal", silently skipping the dex/name
// tie-breakers below and leaving entries in insertion order.
const NO_INITIATIVE = -1_000_000;
function byInitiative(a: InitiativeEntry, b: InitiativeEntry): number {
  const initDiff = (b.initiative ?? NO_INITIATIVE) - (a.initiative ?? NO_INITIATIVE);
  if (initDiff !== 0) return initDiff;
  const dexDiff = b.dex_modifier - a.dex_modifier;
  if (dexDiff !== 0) return dexDiff;
  const nameDiff = a.name.localeCompare(b.name, "ru");
  if (nameDiff !== 0) return nameDiff;
  return a.id - b.id;
}

function isDead(entry: InitiativeEntry): boolean {
  return entry.dead === true || entry.dead === 1;
}

function rollCreatureHp(hp: DndCreatureHitPoints): number | null {
  if (hp.diceCount && hp.dieSize) {
    const bonus = hp.bonus ?? 0;
    const formula = `${hp.diceCount}к${hp.dieSize}${bonus >= 0 ? "+" : ""}${bonus}`;
    return rollDiceFormula(formula);
  }
  if (hp.formula) return rollDiceFormula(hp.formula);
  return null;
}

interface Props {
  sessionId: number;
}

export function InitiativeTracker({ sessionId }: Props) {
  const [confirmDialog, confirm] = useConfirm();
  const [resettingRolls, setResettingRolls] = useState(false);
  const [entries, setEntries] = useState<InitiativeEntry[]>([]);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [addingCustom, setAddingCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customInit, setCustomInit] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [rollingId, setRollingId] = useState<number | null>(null);
  const [rollingInitiative, setRollingInitiative] = useState(false);
  const [hpErrorId, setHpErrorId] = useState<number | null>(null);
  const [confirmRerollId, setConfirmRerollId] = useState<number | null>(null);
  const [hpEditId, setHpEditId] = useState<number | null>(null);
  const [hpAmount, setHpAmount] = useState("");
  const [conditionPickerFor, setConditionPickerFor] = useState<number | null>(null);
  const [conditionOptions, setConditionOptions] = useState<{ id: number; name: string }[]>([]);
  const [roleMap, setRoleMap] = useState<Map<number, { roles: string[]; tactics: string[] }>>(new Map());
  const sound = useSoundEngineOptional();

  function load() {
    api.get<InitiativeEntry[]>(`/initiative-entries?session_id=${sessionId}`).then(setEntries);
  }
  function loadSession() {
    api.get<SessionDetail>(`/sessions/${sessionId}`).then(setSession);
  }
  useEffect(load, [sessionId]);
  useEffect(loadSession, [sessionId]);
  // Игрок назвал или сбросил свою инициативу — очередь перечитывается.
  //
  // Подписка внутри компонента, а не снаружи пропсом: трекер смонтирован
  // дважды (карточка в колонке пульта и панель поиска, находка №4 аудита
  // пульта), состояние у экземпляров независимое. Событие окна получают оба,
  // и разойтись им нечем — независимо от того, починят ли двойное
  // монтирование.
  useEffect(() => {
    function onUpdated(e: Event) {
      const detail = (e as CustomEvent<{ sessionId?: number }>).detail;
      if (detail?.sessionId != null && detail.sessionId !== sessionId) return;
      load();
    }
    window.addEventListener("initiative-updated", onUpdated);
    return () => window.removeEventListener("initiative-updated", onUpdated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  useEffect(() => {
    findDndSystemId().then((systemId) => {
      if (!systemId) return;
      loadDndMechanicsGroup(systemId, "Состояния").then(setConditionOptions);
    });
  }, []);

  // Роли из карточки существа — за столом видно «Танковый · Контроль» без открытия карточки (C3)
  useEffect(() => {
    let cancelled = false;
    const cache = new Map<string, { roles: string[]; tactics: string[] }>();
    // Копируем уже известные, чтобы не перетирать
    roleMap.forEach((v, k) => {
      const e = entries.find((en) => en.id === k);
      if (e && e.entity_type && e.entity_id) cache.set(`${e.entity_type}-${e.entity_id}`, v);
    });
    const toFetch = entries.filter((e) => e.entity_type && e.entity_id && (e.entity_type === "being" || e.entity_type === "compendium_entry"));
    if (toFetch.length === 0) return;
    (async () => {
      const next = new Map(roleMap);
      for (const e of toFetch) {
        const key = `${e.entity_type}-${e.entity_id}`;
        if (cache.has(key)) {
          next.set(e.id, cache.get(key)!);
          continue;
        }
        try {
          const card = await fetchCreatureCard(e.entity_type as string, e.entity_id as number);
          const roles = card.combat_roles.length ? card.combat_roles : card.inherited?.combat_roles ?? [];
          const tactics = card.tactics.length ? card.tactics : card.inherited?.tactics ?? [];
          const value = { roles: roles.slice(0, 2), tactics };
          cache.set(key, value);
          next.set(e.id, value);
        } catch {
          cache.set(key, { roles: [], tactics: [] });
        }
      }
      if (!cancelled) setRoleMap(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  // Resolves everything a dropped/re-rolled entity needs from its dnd
  // statblock in one fetch — the initiative modifier (roll, tie-break and the
  // number shown next to the row) and hit points (creatures roll from
  // hit-dice fields via diceRoll.ts; characters already carry a flat max-HP
  // number, nothing to roll).
  //
  // Модификатор инициативы, а НЕ голая Ловкость. У существа 5.5 инициатива
  // объявлена своим числом («Инициатива +5 (15)»), и оно не обязано совпадать
  // с модификатором Ловкости: `initiativeBonus` в статблоке для этого и
  // заведён, но до сих пор не читался ни здесь, ни где-либо ещё — трекер
  // бросал по Ловкости и молча игнорировал заполненное поле. У персонажа
  // число берётся из общего правила листа (`deriveSheet`), а не считается
  // здесь заново.
  async function resolveStatblockInfo(
    type: string,
    id: number
  ): Promise<{ initiativeModifier: number; maxHp: number | null; currentHp: number | null }> {
    const empty = { initiativeModifier: 0, maxHp: null, currentHp: null };
    if (type !== "being" && type !== "character" && type !== "compendium_entry") return empty;
    try {
      const rows = await api.get<Statblock[]>(`/statblocks?owner_type=${type}&owner_id=${id}`);
      const dnd = rows.find((s) => s.format === "dnd_character" || s.format === "dnd_creature");
      if (!dnd) return empty;
      const parsed = parseDndStatblock(dnd);
      if (dnd.format === "dnd_creature") {
        const creature = parsed as DndCreatureData;
        const initiativeModifier = creatureInitiativeModifier(creature);
        const max = rollCreatureHp(creature.hitPoints);
        return { initiativeModifier, maxHp: max, currentHp: max };
      }
      const character = parsed as DndCharacterData;
      // Прибавки от умений сюда не доедут: лист хранит у умения только имя и
      // `entryId`, а эффекты подставляет справочник при отрисовке чарника
      // (`resolveFeature`). Трекер справочник не грузит, поэтому число здесь —
      // Ловкость с ручной поправкой и истощением. Сегодня это точно (записей
      // с разметкой под инициативу в справочнике ноль); когда разметка
      // появится, за числом придётся идти на сервер.
      const initiativeModifier = deriveSheet(character).initiative.value;
      const max = Number(character.hitPointMax) || null;
      return { initiativeModifier, maxHp: max, currentHp: max };
    } catch {
      return empty;
    }
  }

  function pickName(baseName: string): string {
    const sameBase = entries.filter(
      (e) => e.name === baseName || e.name.endsWith(` ${baseName}`)
    );
    if (sameBase.length === 0) return baseName;
    if (!loadUseEpithets()) return `${baseName} (${sameBase.length + 1})`;
    const usedEpithets = new Set(
      sameBase
        .map((e) => (e.name === baseName ? null : e.name.slice(0, -(baseName.length + 1))))
        .filter((e): e is string => e !== null)
    );
    const available = INITIATIVE_EPITHETS.filter((ep) => !usedEpithets.has(ep));
    if (available.length === 0) return `${baseName} (${sameBase.length + 1})`;
    const epithet = available[Math.floor(Math.random() * available.length)];
    return `${epithet} ${baseName}`;
  }

  async function addToInitiative(result: SearchResult) {
    if (!ACCEPT_TYPES.includes(result.type)) return;
    const [info, name] = await Promise.all([
      resolveStatblockInfo(result.type, result.id),
      Promise.resolve(pickName(result.title)),
    ]);
    await api.post("/initiative-entries", {
      session_id: sessionId,
      entity_type: result.type,
      entity_id: result.id,
      name,
      // Колонка называется `dex_modifier` исторически, а держит теперь
      // итоговый модификатор инициативы. Переименование колонки — миграция
      // ради имени; смысл записан здесь и в resolveStatblockInfo выше.
      dex_modifier: info.initiativeModifier,
      max_hp: info.maxHp,
      current_hp: info.currentHp,
    });
    load();
  }

  // Мешок выгружает бойцов сюда же, без перетаскивания (unloadTargets.tsx).
  useUnloadTarget({
    label: "Инициатива",
    accepts: (item) => ACCEPT_TYPES.includes(item.type),
    drop: addToInitiative,
  });

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    await addToInitiative(JSON.parse(raw) as SearchResult);
  }

  async function updateInitiative(id: number, initiative: number | null) {
    await api.put(`/initiative-entries/${id}`, { initiative });
    load();
  }

  async function remove(id: number) {
    if (!(await confirm({ message: "Убрать участника из очереди хода?", confirmLabel: "Убрать", danger: true })))
      return;
    await api.del(`/initiative-entries/${id}`);
    load();
  }

  // Очистка спрашивает, в отличие от снятия галочки у логова: за строками
  // стоят брошенные хиты, набранные состояния и отметки мёртвых, и вернуть
  // их нечем. Заодно гасит бой — иначе сессия остаётся с combat_active при
  // пустой очереди, кнопка предлагает «Завершить», а боевая тема играет.
  async function clearAll() {
    if (
      !(await confirm({
        message: "Очистить очередь хода? Хиты, состояния и отметки мёртвых пропадут.",
        confirmLabel: "Очистить",
        danger: true,
      }))
    )
      return;
    if (session?.combat_active) {
      await setCombat(false, null);
      sound?.exitCombat();
    }
    await api.del(`/initiative-entries?session_id=${sessionId}`);
    load();
  }

  /**
   * «Новый бой»: гасит числа, оставляя бойцов, хиты, состояния и отметки
   * мёртвых. Соседняя «Очистить» сносит очередь целиком — это разные кнопки и
   * разные жесты.
   *
   * Подтверждение спрашивается только посреди боя. В начале боя это ровно то,
   * зачем кнопку нажимают, и лишний вопрос там — помеха: Мастер жмёт её,
   * когда за столом уже ждут. А вот случайное нажатие при идущем бое стирает
   * порядок хода, и вернуть его нечем.
   */
  const rolled = entries.filter((e) => e.initiative != null);

  async function resetRolls() {
    if (rolled.length === 0 || resettingRolls) return;
    if (
      session?.combat_active &&
      !(await confirm({
        message: "Идёт бой. Сбросить все брошенные числа и начать очередь заново?",
        confirmLabel: "Сбросить",
        danger: true,
      }))
    )
      return;
    setResettingRolls(true);
    try {
      await api.post(`/initiative-entries/reset-rolls?session_id=${sessionId}`, {});
      load();
    } finally {
      setResettingRolls(false);
    }
  }

  /**
   * Галочка особой строки. Снятая галочка убирает строку без подтверждения —
   * в отличие от «Убрать» у бойца: там за строкой стоят брошенные хиты и
   * набранные состояния, а здесь только имя и число.
   */
  async function toggleSpecial(spec: (typeof SPECIAL_ROWS)[number]) {
    const existing = entries.find((e) => e.kind === spec.kind);
    if (existing) await api.del(`/initiative-entries/${existing.id}`);
    else
      await api.post("/initiative-entries", {
        session_id: sessionId,
        name: spec.name,
        kind: spec.kind,
        initiative: spec.initiative,
      });
    load();
  }

  async function addCustom() {
    const name = customName.trim();
    if (!name) return;
    await api.post("/initiative-entries", {
      session_id: sessionId,
      name,
      kind: "custom",
      initiative: customInit === "" ? null : Number(customInit),
    });
    setCustomName("");
    setCustomInit("");
    setAddingCustom(false);
    load();
  }

  /**
   * Бросок инициативы за НПС — к20 плюс ловкость, всем, у кого числа ещё нет.
   *
   * Строки игроков не трогаем: инициативу за столом называют сами игроки, и
   * подставленное за них число пришлось бы искать и стирать. Уже заполненные
   * тоже не перебрасываем — иначе одна кнопка ломала бы половину очереди.
   * Логово, окружение и своё событие идут по своим числам, к костям
   * отношения не имеющим.
   */
  const rollable = entries.filter(
    (e) => e.kind === "creature" && e.entity_type !== "character" && e.initiative == null
  );

  async function rollInitiativeForNpcs() {
    if (rollable.length === 0 || rollingInitiative) return;
    setRollingInitiative(true);
    try {
      for (const e of rollable) {
        const mod = e.dex_modifier ?? 0; // модификатор инициативы, см. resolveStatblockInfo
        const value = rollDiceFormula(`1к20${mod >= 0 ? "+" : ""}${mod}`);
        if (value == null) continue;
        await api.put(`/initiative-entries/${e.id}`, { initiative: value });
      }
      load();
    } finally {
      setRollingInitiative(false);
    }
  }

  async function rerollHp(entry: InitiativeEntry) {
    if (!entry.entity_type || !entry.entity_id) return;
    setRollingId(entry.id);
    setHpErrorId(null);
    try {
      const info = await resolveStatblockInfo(entry.entity_type, entry.entity_id);
      if (info.maxHp == null) {
        setHpErrorId(entry.id);
        return;
      }
      await api.put(`/initiative-entries/${entry.id}`, { max_hp: info.maxHp, current_hp: info.maxHp });
      load();
    } finally {
      setRollingId(null);
    }
  }

  async function toggleDead(entry: InitiativeEntry) {
    await api.put(`/initiative-entries/${entry.id}`, { dead: !isDead(entry) });
    load();
  }

  async function toggleCondition(entry: InitiativeEntry, name: string) {
    const current = parseConditions(entry.conditions);
    const next = current.includes(name) ? current.filter((c) => c !== name) : [...current, name];
    await api.put(`/initiative-entries/${entry.id}`, { conditions: next });
    load();
  }

  function closeHpEditor() {
    setHpEditId(null);
    setHpAmount("");
  }

  // Temp HP absorbs damage first (standard 5e rule) — whatever's left over
  // after the temp pool is exhausted comes out of current HP, floored at 0.
  async function applyDamage(entry: InitiativeEntry) {
    const amount = Number(hpAmount);
    if (!amount || amount < 0) return;
    const temp = entry.temp_hp ?? 0;
    const fromTemp = Math.min(temp, amount);
    const remaining = amount - fromTemp;
    const current = entry.current_hp ?? entry.max_hp ?? 0;
    await api.put(`/initiative-entries/${entry.id}`, {
      temp_hp: temp - fromTemp,
      current_hp: Math.max(0, current - remaining),
    });
    closeHpEditor();
    load();
  }

  async function applyHeal(entry: InitiativeEntry) {
    const amount = Number(hpAmount);
    if (!amount || amount < 0) return;
    const current = entry.current_hp ?? 0;
    const capped = entry.max_hp != null ? Math.min(entry.max_hp, current + amount) : current + amount;
    await api.put(`/initiative-entries/${entry.id}`, { current_hp: capped });
    closeHpEditor();
    load();
  }

  async function applyTempHp(entry: InitiativeEntry) {
    const amount = Number(hpAmount);
    if (!amount || amount < 0) return;
    await api.put(`/initiative-entries/${entry.id}`, { temp_hp: (entry.temp_hp ?? 0) + amount });
    closeHpEditor();
    load();
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

  async function setCombat(active: boolean, turnEntryId: number | null, round?: number) {
    await api.put(`/sessions/${sessionId}/combat`, { active, turn_entry_id: turnEntryId, round });
    loadSession();
  }

  async function startCombat() {
    if (aliveSorted.length === 0) return;
    await setCombat(true, aliveSorted[0].id, 1);
    // Переключение идёт через движок пульта, а не напрямую в плеер: он
    // запоминает, что играло до боя, и показывает в пульте, что Бэкграунд
    // сменил трекер инициативы, а не Мастер.
    // Тема сессии главнее темы набора: сессионную выбирают под конкретный
    // вечер, а набор заготовлен на всю кампанию.
    const theme = session?.battle_playlist_id ?? sound?.state.data?.battle?.id ?? null;
    if (theme) sound?.enterCombat(theme);
  }

  function stopCombat() {
    setCombat(false, null);
    // Бой кончился — возвращаем то, что играло до него.
    sound?.exitCombat();
  }

  // Шаг по очереди хода. Считаем от места текущего в ПОЛНОМ порядке, а не
  // среди живых: убитый в свой же ход из списка живых выпадает, и поиск по
  // нему давал −1 — «Следующий» отдавал второго в очереди, а не того, кто
  // идёт за погибшим.
  function step(delta: 1 | -1) {
    if (aliveSorted.length === 0) return;
    const current = session?.combat_turn_entry_id ?? null;
    const from = current == null ? -1 : turnOrder.findIndex((e) => e.id === current);
    // Строку удалили целиком — места в порядке не осталось, начинаем с края.
    if (from === -1) {
      setCombat(true, (delta === 1 ? aliveSorted[0] : aliveSorted[aliveSorted.length - 1]).id);
      return;
    }
    const n = turnOrder.length;
    const round = session?.combat_round || 1;
    for (let k = 1; k <= n; k++) {
      const raw = from + delta * k;
      const candidate = turnOrder[((raw % n) + n) % n];
      if (isDead(candidate)) continue;
      // Раунд считается по переходу через край очереди, а не по числу шагов:
      // мёртвые пропускаются, и «сколько ходов прошло» с раундом не совпадает.
      const wrapped = raw < 0 || raw >= n;
      setCombat(true, candidate.id, wrapped ? Math.max(1, round + delta) : round);
      return;
    }
  }

  return (
    <div
      className={`drop-zone stack${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {confirmDialog}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <strong>Трекер инициативы</strong>
        <span className="row" style={{ gap: 4 }}>
          {/* Кнопка появляется, только когда есть кому бросать: пустая
              кнопка на пульте — лишний орган управления. */}
          {rollable.length > 0 && (
            <button
              type="button"
              className="comp-mini"
              disabled={rollingInitiative}
              title="Бросить к20 + ловкость всем НПС без числа. Персонажей игроков не трогает."
              onClick={rollInitiativeForNpcs}
            >
              {rollingInitiative ? "…" : `Бросить за НПС · ${rollable.length}`}
            </button>
          )}
          {/* Появляется, только когда есть что гасить: пустая кнопка на
              пульте — лишний орган управления, как и у броска за НПС выше. */}
          {rolled.length > 0 && (
            <button
              type="button"
              className="comp-mini"
              disabled={resettingRolls}
              title="Погасить все брошенные числа, оставив бойцов, хиты и состояния."
              onClick={resetRolls}
            >
              {resettingRolls ? "…" : `Новый бой · ${rolled.length}`}
            </button>
          )}
          {entries.length > 0 && (
            <button type="button" className="comp-mini" onClick={clearAll}>
              Очистить
            </button>
          )}
        </span>
      </div>
      <div className="row" style={{ justifyContent: "center", gap: 4 }}>
        <button
          type="button"
          className="comp-mini"
          onClick={() => step(-1)}
          disabled={!session?.combat_active || aliveSorted.length === 0}
          title="Предыдущий"
        >
          <NavIcon name="arrowRight" className="nav-icon icon-flip-x" />
        </button>
        {session?.combat_active ? (
          <button type="button" onClick={stopCombat}>
            Завершить
          </button>
        ) : (
          <button type="button" onClick={startCombat} disabled={aliveSorted.length === 0}>
            Старт
          </button>
        )}
        <button
          type="button"
          className="comp-mini"
          onClick={() => step(1)}
          disabled={!session?.combat_active || aliveSorted.length === 0}
          title="Следующий"
        >
          <NavIcon name="arrowRight" />
        </button>
        {/* Номер раунда — только пока бой идёт, и только числом: за столом его
            читают, а не правят. */}
        {!!session?.combat_active && (
          <span
            className="muted"
            style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", marginLeft: 4 }}
          >
            Раунд {session.combat_round || 1}
          </span>
        )}
      </div>
      {/* Логово и окружение — галочками, потому что решение про них бинарно:
          они в этом бою или их нет. Своё событие — плюсиком: у него надо
          спросить имя и число. */}
      <div className="initiative-specials stack" style={{ gap: 2 }}>
        {SPECIAL_ROWS.map((spec) => (
          <label key={spec.kind} className="row muted" style={{ gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={entries.some((e) => e.kind === spec.kind)}
              onChange={() => toggleSpecial(spec)}
            />
            {spec.name}
            <span style={{ fontSize: "0.8em" }}>({spec.initiative})</span>
          </label>
        ))}
        {addingCustom ? (
          <div className="row" style={{ gap: 4 }}>
            <input
              autoFocus
              placeholder="Событие"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addCustom();
                if (e.key === "Escape") setAddingCustom(false);
              }}
            />
            <input
              type="number"
              placeholder="Иниц."
              style={{ width: 64 }}
              value={customInit}
              onChange={(e) => setCustomInit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addCustom();
              }}
            />
            <button type="button" className="comp-mini" onClick={addCustom}>
              Добавить
            </button>
            <button type="button" className="comp-mini" onClick={() => setAddingCustom(false)}>
              <NavIcon name="close" />
            </button>
          </div>
        ) : (
          <button type="button" className="comp-mini" onClick={() => setAddingCustom(true)}>
            + Своё событие
          </button>
        )}
      </div>

      {entries.length === 0 && (
        <span className="muted">Перетащите сюда существо или персонажа</span>
      )}
      <div className="stack" style={{ gap: 4 }}>
        {sorted.map((entry) => {
          const dead = isDead(entry);
          // У логова, окружения и своего события нет хитов и нечему умирать.
          // Пустые поля в бою — лишние места, куда можно ткнуть по ошибке.
          // Состояния остаются: «логово подавлено на раунд» — обычный ход дел.
          const special = entry.kind !== "creature";
          const conditions = parseConditions(entry.conditions);
          const hpPct =
            entry.max_hp && entry.max_hp > 0
              ? Math.max(0, Math.min(100, (100 * (entry.current_hp ?? entry.max_hp)) / entry.max_hp))
              : null;
          return (
            <div
              key={entry.id}
              className={`initiative-tile initiative-${entry.kind}${
                session?.combat_active && entry.id === session.combat_turn_entry_id ? " initiative-current" : ""
              }${dead ? " initiative-dead" : ""}`}
            >
              {conditions.length > 0 && (
                <div className="initiative-conditions">
                  {conditions.map((c) => (
                    <span
                      key={c}
                      className="initiative-condition-chip"
                      style={{ background: colorForCondition(c) }}
                      title={c}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                {/* Шлем — персонаж игрока, полый квадрат — все остальные.
                    У логова и окружения метки нет: они никем не являются. */}
                <span className="initiative-mark">
                  {!special &&
                    (entry.entity_type === "character" ? (
                      <NavIcon name="helm" />
                    ) : (
                      <span className="initiative-mark--npc" />
                    ))}
                </span>
                <span style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                  {entry.name}
                  {(() => {
                    const info = roleMap.get(entry.id);
                    const roles = info?.roles ?? [];
                    if (roles.length === 0) return null;
                    const tactics = info?.tactics ?? [];
                    return (
                      <span style={{ marginLeft: 6, display: "inline-flex", gap: 4, verticalAlign: "middle" }}>
                        {roles.map((r) => (
                          <span key={r} className="creature-card__chip is-role" style={{ fontSize: "var(--fs-micro)", padding: "0 4px", lineHeight: "1.4" }} title={tactics.length ? tactics.join("\n") : r}>
                            {r}
                          </span>
                        ))}
                      </span>
                    );
                  })()}
                </span>
                {editingId === entry.id ? (
                  <input
                    type="number"
                    autoFocus
                    defaultValue={entry.initiative ?? ""}
                    style={{ width: 56 }}
                    onBlur={(e) => {
                      updateInitiative(entry.id, e.target.value === "" ? null : Number(e.target.value));
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={() => setEditingId(entry.id)}
                    title="Двойной клик — изменить"
                    style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    {entry.initiative ?? "—"}
                    {/* Ловкость у логова смысла не имеет, а «· +0» рядом с
                        числом читается как настоящий модификатор. */}
                    {!special && (
                      <span className="muted" style={{ fontSize: "0.8em" }}>
                        {" "}
                        · {formatModifier(entry.dex_modifier)}
                      </span>
                    )}
                  </span>
                )}
                <div className="row initiative-actions" style={{ gap: 2 }}>
                  {/* Череп и метка состояния были эмодзи ровно потому, что в
                      рисованном наборе не было ни того, ни другого. Теперь
                      есть — см. NavIcons. ♥ и ⚠ (бросок ХП и его ошибка)
                      остались эмодзи: сердце в наборе тоже появилось, но
                      различать «бросить» и «не вышло» одной фигурой нечем, а
                      два значка ради одной кнопки — лишняя работа. */}
                  {!special && (
                    <button
                      type="button"
                      className="comp-mini"
                      title="Отметить мёртвым"
                      onClick={() => toggleDead(entry)}
                    >
                      <NavIcon name="skull" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="comp-mini"
                    title="Состояния"
                    onClick={() => setConditionPickerFor((v) => (v === entry.id ? null : entry.id))}
                  >
                    <NavIcon name="conditions" />
                  </button>
                  {(entry.entity_type === "being" || entry.entity_type === "compendium_entry") &&
                    confirmRerollId !== entry.id && (
                    <button
                      type="button"
                      className="comp-mini"
                      title={
                        hpErrorId === entry.id
                          ? "Не удалось определить ХП — у существа не задана формула хит-костей в статблоке"
                          : "Бросить ХП"
                      }
                      style={hpErrorId === entry.id ? { color: "var(--danger, #c0392b)" } : undefined}
                      disabled={rollingId === entry.id}
                      onClick={() => {
                        if (entry.max_hp != null) setConfirmRerollId(entry.id);
                        else rerollHp(entry);
                      }}
                    >
                      {hpErrorId === entry.id ? "⚠" : "♥"}
                    </button>
                  )}
                  {confirmRerollId === entry.id && (
                    <span className="row" style={{ gap: 2, alignItems: "center" }}>
                      <span className="muted" style={{ fontSize: "0.8em" }}>
                        Уверены?
                      </span>
                      <button
                        type="button"
                        className="comp-mini"
                        title="Да, перебросить"
                        onClick={() => {
                          setConfirmRerollId(null);
                          rerollHp(entry);
                        }}
                      >
                        Да
                      </button>
                      <button
                        type="button"
                        className="comp-mini"
                        title="Отмена"
                        onClick={() => setConfirmRerollId(null)}
                      >
                        Нет
                      </button>
                    </span>
                  )}
                  <button type="button" className="comp-mini" title="Убрать" onClick={() => remove(entry.id)}>
                    <NavIcon name="delete" />
                  </button>
                </div>
              </div>
              {conditionPickerFor === entry.id && (
                <div className="initiative-condition-picker stack">
                  {conditionOptions.length === 0 && <span className="muted">Состояния не найдены в компендиуме</span>}
                  {conditionOptions.map((c) => (
                    <label key={c.id} className="row" style={{ gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={conditions.includes(c.name)}
                        onChange={() => toggleCondition(entry, c.name)}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}
              {hpPct != null && !special && (
                <div className="row" style={{ gap: 6, alignItems: "center" }}>
                  <span className="muted" style={{ fontSize: "0.8em", whiteSpace: "nowrap" }}>
                    ХП: {entry.current_hp ?? "—"} / {entry.max_hp}
                    {entry.temp_hp ? ` (+${entry.temp_hp})` : ""}
                  </span>
                  <div
                    className="initiative-hp-bar-track"
                    style={{ flex: 1, cursor: "pointer" }}
                    title="Изменить ХП"
                    onClick={() => {
                      setHpEditId(entry.id);
                      setHpAmount("");
                    }}
                  >
                    <div className="initiative-hp-bar-fill" style={{ width: `${hpPct}%` }} />
                    {entry.max_hp && entry.temp_hp ? (
                      <div
                        className="initiative-hp-bar-temp"
                        style={{ width: `${Math.min(100, (100 * entry.temp_hp) / entry.max_hp)}%` }}
                      />
                    ) : null}
                  </div>
                </div>
              )}
              {hpEditId === entry.id && (
                <div className="initiative-hp-editor row" style={{ gap: 4, alignItems: "center" }}>
                  <input
                    type="number"
                    autoFocus
                    placeholder="Кол-во"
                    value={hpAmount}
                    onChange={(e) => setHpAmount(e.target.value)}
                    style={{ width: 64 }}
                  />
                  <button type="button" className="comp-mini" onClick={() => applyDamage(entry)}>
                    Урон
                  </button>
                  <button type="button" className="comp-mini" onClick={() => applyHeal(entry)}>
                    Лечение
                  </button>
                  <button type="button" className="comp-mini" onClick={() => applyTempHp(entry)}>
                    +Врем. ХП
                  </button>
                  <button type="button" className="comp-mini" title="Закрыть" onClick={closeHpEditor}>
                    <NavIcon name="close" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
