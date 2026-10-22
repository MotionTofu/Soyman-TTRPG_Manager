import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";
import {
  recognizeCreatureAction,
  recognizeRepeat,
  recognizeSave,
  type DndMechanicsRef,
} from "@soyman/shared";

/**
 * Боевой режим, шаг 3: «что накладывает» — из текста книги в поля (Q61/Q64).
 *
 * - Заклинанию — у его спасброска `repeat`: когда цель его повторяет.
 * - Действию чудовища — `inflicts` (состояния, длительность, повтор) и, если
 *   пусты, характеристика и СЛ спасброска из текста.
 *
 * Разбор — `shared/src/dnd/inflicts.ts`, без угадывания: неоднозначное не
 * размечается. Итог прогона проверен владельцем 2026-10-22 без ✗:
 * `.scratch/combat-mode/inflicts-table.md`. Уже размеченное не трогается —
 * правки Мастера в форме важнее.
 */

const CONDITION_NAMES = [
  "Ослеплённый",
  "Очарованный",
  "Оглохший",
  "Испуганный",
  "Недееспособный",
  "Парализованный",
  "Отравленный",
  "Лежащий ничком",
  "Опутанный",
  "Ошеломлённый",
  "Бессознательный",
  "Схваченный",
  "Окаменевший",
];

const RU_ABILITY: Record<string, string> = {
  str: "Сила",
  dex: "Ловкость",
  con: "Телосложение",
  int: "Интеллект",
  wis: "Мудрость",
  cha: "Харизма",
};

type Json = Record<string, unknown>;

function parseObject(raw: string | null): Json | null {
  try {
    const d = JSON.parse(raw || "{}");
    return d && typeof d === "object" && !Array.isArray(d) ? d : null;
  } catch {
    return null;
  }
}

/** Состояния справочника по системам: у друга id другие, ищем по имени. */
function conditionsBySystem(database: Database.Database): Map<number, DndMechanicsRef[]> {
  const rows = database
    .prepare(
      `SELECT id, name, system_id FROM compendium_entries
       WHERE name IN (${CONDITION_NAMES.map(() => "?").join(",")}) ORDER BY id`
    )
    .all(...CONDITION_NAMES) as { id: number; name: string; system_id: number }[];
  const out = new Map<number, DndMechanicsRef[]>();
  for (const r of rows) {
    const list = out.get(r.system_id) ?? [];
    if (!list.some((c) => c.name === r.name)) list.push({ id: r.id, name: r.name });
    out.set(r.system_id, list);
  }
  return out;
}

/** Повтор у спасброска заклинания; true — запись изменилась. */
function markSpell(data: Json, description: string | null): boolean {
  const checks = Array.isArray(data.checks) ? (data.checks as Json[]) : [];
  const saves = checks.filter((c) => c.type === "save");
  if (saves.length !== 1 || saves[0].repeat) return false;
  const effects = Array.isArray(data.effects) ? (data.effects as Json[]) : [];
  const text = [description ?? "", ...effects.map((e) => (typeof e.text === "string" ? e.text : ""))].join(" ");
  const r = recognizeRepeat(text);
  if (!r || "review" in r) return false;
  if (r.ability && RU_ABILITY[r.ability] !== saves[0].saveAbility) return false;
  saves[0].repeat = r.value;
  return true;
}

/** Разметка действий статблока существа; число размеченных действий. */
function markCreature(content: Json, known: readonly DndMechanicsRef[]): number {
  const legendary = content.legendary as Json | undefined;
  const lists = [content.actions, content.bonusActions, content.reactions, legendary?.actions];
  let marked = 0;
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const action of list as Json[]) {
      if (action.inflicts || typeof action.name !== "string") continue;
      const description = typeof action.description === "string" ? action.description : "";
      const res = recognizeCreatureAction(
        { name: action.name, description, isMultiattack: action.isMultiattack === true },
        known
      );
      if (!res || "review" in res) continue;
      action.inflicts = {
        conditions: res.conditions.value,
        duration: res.duration?.value ?? null,
        repeat: res.repeat?.value ?? null,
      };
      if (!action.saveAbility) {
        const save = recognizeSave(description);
        if (save) {
          action.saveAbility = save.value.ability;
          action.saveDC = save.value.dc;
        }
      }
      marked++;
    }
  }
  return marked;
}

export function migrateDndInflicts(database: Database.Database, dbDir: string): void {
  const conditions = conditionsBySystem(database);
  // Существа сеттинга — без своей системы: берём ту, где состояний больше всего.
  const fallback = [...conditions.values()].sort((a, b) => b.length - a.length)[0] ?? [];

  const spellUpdates: { id: number; data: string }[] = [];
  const spells = database
    .prepare("SELECT id, data, description FROM compendium_entries WHERE kind = 'spell'")
    .all() as { id: number; data: string | null; description: string | null }[];
  for (const s of spells) {
    const data = parseObject(s.data);
    if (data && markSpell(data, s.description)) spellUpdates.push({ id: s.id, data: JSON.stringify(data) });
  }

  const creatureUpdates: { id: number; content: string }[] = [];
  let actions = 0;
  const rows = database
    .prepare(
      `SELECT s.id, s.content, e.system_id
       FROM statblocks s
       LEFT JOIN compendium_entries e ON s.owner_type = 'compendium_entry' AND e.id = s.owner_id
       WHERE s.format = 'dnd_creature'`
    )
    .all() as { id: number; content: string | null; system_id: number | null }[];
  for (const row of rows) {
    const content = parseObject(row.content);
    if (!content) continue;
    const known = (row.system_id != null ? conditions.get(row.system_id) : undefined) ?? fallback;
    const n = markCreature(content, known);
    if (n) {
      actions += n;
      creatureUpdates.push({ id: row.id, content: JSON.stringify(content) });
    }
  }
  if (!spellUpdates.length && !creatureUpdates.length) return;

  const snapshot = path.join(dbDir, `app-before-inflicts-${randomUUID()}.db`);
  database.prepare("VACUUM INTO ?").run(snapshot);
  const saveSpell = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
  const saveStatblock = database.prepare("UPDATE statblocks SET content = ? WHERE id = ?");
  database.transaction(() => {
    for (const u of spellUpdates) saveSpell.run(u.data, u.id);
    for (const u of creatureUpdates) saveStatblock.run(u.content, u.id);
  })();
  console.log(
    `[migrate] dnd_inflicts_v1: заклинаний ${spellUpdates.length}, действий ${actions} в ${creatureUpdates.length} статблоках. Снимок: ${snapshot}`
  );
}
