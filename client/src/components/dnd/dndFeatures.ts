import type { CompendiumEntry, DndActionTiming, DndFeature } from "../../types";
import type { DndCheck, DndCost, DndEffect } from "./effects";

// Выделено из DndCharacterForm: раздача особенностей нужна и форме, и
// визарду, а в визарде до этого жила своя усечённая копия — без entryId,
// без сортировки и без времени накладывания, из-за чего созданный визардом
// персонаж получал особенности, которые не попадали во вкладку «Действия».
// Одна реализация на оба входа, отдельным модулем, чтобы визард не тянул
// компонентный файл ради одной функции.

export const TIMING_LABEL_TO_KEY: Record<string, DndActionTiming> = {
  "Действие": "action",
  "Бонусное действие": "bonus",
  "Реакция": "reaction",
  "Иное": "other",
};

export const TIMING_KEY_TO_LABEL: Record<DndActionTiming, string> = {
  action: "Действие",
  bonus: "Бонусное действие",
  reaction: "Реакция",
  other: "Иное",
};

// Best-effort classification for spells that predate casting_timing (only
// the free-text casting_time field exists) — matched by keyword so old
// compendium content still buckets sensibly into the new Бой tab sections
// instead of silently disappearing.
export function inferTimingFromLegacyText(text: string): { timing: DndActionTiming; other?: string } {
  const t = text.toLowerCase();
  if (t.includes("бонус")) return { timing: "bonus" };
  if (t.includes("реакц")) return { timing: "reaction" };
  if (t.includes("действ")) return { timing: "action" };
  return { timing: "other", other: text };
}

export function spellTimingFromData(
  data: Record<string, unknown>
): { castingTiming?: DndActionTiming; castingTimingOther?: string } {
  const label = typeof data.casting_timing === "string" ? data.casting_timing : "";
  if (label && TIMING_LABEL_TO_KEY[label]) {
    return {
      castingTiming: TIMING_LABEL_TO_KEY[label],
      castingTimingOther: typeof data.casting_timing_other === "string" ? data.casting_timing_other : undefined,
    };
  }
  const legacy = typeof data.casting_time === "string" ? data.casting_time : "";
  if (legacy) {
    const inferred = inferTimingFromLegacyText(legacy);
    return { castingTiming: inferred.timing, castingTimingOther: inferred.other };
  }
  return {};
}

// Converts class/subclass/species feature entries into DndFeature rows,
// tagged with sourceParentId so a later pick can find-and-replace just
// these (requirement: features stay in sync with the picked class/species).
// maxLevel filters to features unlocked at or below the class's current
// level; omit it (species has no level) to include everything.
export function featuresFromEntries(
  entries: CompendiumEntry[],
  parentId: number,
  maxLevel?: number
): DndFeature[] {
  return entries
    .filter((e) => maxLevel == null || (e.level ?? 0) <= maxLevel)
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.position - b.position)
    .map((e) => ({
      name: e.name,
      description: e.description,
      entryId: e.id,
      sourceParentId: parentId,
      level: e.level,
      // Снимаем то же, что и у заклинаний: без времени накладывания умение не
      // попадёт во вкладку «Действия», а без эффектов там нечего показать.
      ...spellTimingFromData(e.data),
      checks: (e.data.checks as DndCheck[] | undefined) ?? [],
      effects: (e.data.effects as DndEffect[] | undefined) ?? [],
      cost: e.data.cost as DndCost | undefined,
    }));
}

// ——— выборы игрока (fighter-choices) ———
//
// Выбор — то, что персонаж берёт сам, а не получает автовыдачей: черта
// боевого стиля, приёмы, заклинания, оружие мастерства. Определение живёт
// в data.choices записи умения (видит и визард, и лист), пик хранится
// строкой персонажа С entryId — и дальше работает как связанная запись.
// Уровень доступности — уровень самого умения (Черта стиля — 1,
// Дополнительный стиль Чемпиона — 7) либо явный minLevel в дефе
// (лесенки приёмов/выстрелов на одном умении).

export interface ChoiceDef {
  /** Стабильный ключ для хранения пиков. Один на вид выбора: обе черты
   *  стиля (1 и 7 ур.) делят "fighting_style", пики копятся массивом. */
  key: string;
  /** Вид выбора: "feat" (03), далее "spell" | "entry" | "weapon" | "skill". */
  kind: string;
  /** Для kind === "feat": категория черт ("Боевой Стиль"). */
  category?: string;
  /** Для kind === "entry": имя группы механик ("Боевые приёмы"). */
  group?: string;
  /** Сколько пиков даёт это определение. */
  count: number;
  /** Минимальный уровень: явный minLevel из данных или уровень умения.
   *  Несколько дефов на одном умении дают лесенку (приёмы БМ: 3 +2@7
   *  +2@10 +2@15) — общий key копит пики массивом. */
  minLevel: number;
  /** Имя умения-источника для подписей. */
  sourceName: string;
  /** Id записи умения-источника (чистка пиков при смене класса/подкласса). */
  sourceEntryId: number;
  /** Источник — класс (true) или подкласс (false): пики чистятся вместе
   *  со своим источником, чужые не трогаем. */
  fromClass: boolean;
}

function parseChoiceDef(raw: unknown, entry: CompendiumEntry): ChoiceDef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const key = typeof r.key === "string" && r.key.trim() ? r.key.trim() : "";
  const kind = typeof r.kind === "string" && r.kind.trim() ? r.kind.trim() : "";
  if (!key || !kind) return null;
  const count = typeof r.count === "number" ? r.count : Number.parseInt(String(r.count ?? "1"), 10);
  if (!Number.isFinite(count) || count <= 0) return null;
  const explicitMin = typeof r.minLevel === "number" ? r.minLevel : Number.parseInt(String(r.minLevel ?? ""), 10);
  return {
    key,
    kind,
    category: typeof r.category === "string" && r.category.trim() ? r.category.trim() : undefined,
    group: typeof r.group === "string" && r.group.trim() ? r.group.trim() : undefined,
    count,
    minLevel: Number.isFinite(explicitMin) && explicitMin > 0 ? explicitMin : (entry.level ?? 1),
    sourceName: entry.name,
    sourceEntryId: entry.id,
    fromClass: false,
  };
}

/** Определения выборов из записей умений класса/подкласса. fromClass
 *  размечает источник (класс или подкласс) для чистки пиков. */
export function choicesFromEntries(entries: CompendiumEntry[], fromClass: boolean): ChoiceDef[] {
  const out: ChoiceDef[] = [];
  for (const e of entries) {
    const list = (e.data as Record<string, unknown> | undefined)?.choices;
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const def = parseChoiceDef(raw, e);
      if (def) out.push({ ...def, fromClass });
    }
  }
  return out.sort((a, b) => a.minLevel - b.minLevel || a.sourceEntryId - b.sourceEntryId);
}

// Суммирование слотов выборов записей каталога (тикет 05 fighter-choices,
// тикет 02 warlock): дефы лесенки с общим key копят count, в зачёт идёт
// только открытое уровнем. Один подсчёт на визард и счётчик листа — двумя
// реализациями они уже разъезжались бы молча.
export interface EntrySlotSource {
  def: ChoiceDef;
  /** Уровень, которым открыт def: уровень класса для классовых/подклассовых
   *  дефов, суммарный уровень персонажа для черт (черты не привязаны
   *  к классу, а бонусные пики вроде воззваний идут именно оттуда). */
  level: number;
}

export interface EntrySlot {
  key: string;
  group: string;
  total: number;
}

export function sumEntrySlots(list: EntrySlotSource[]): EntrySlot[] {
  const out: EntrySlot[] = [];
  for (const { def, level } of list) {
    if (def.kind !== "entry" || !def.group) continue;
    if (def.minLevel > level) continue;
    const g = out.find((x) => x.key === def.key);
    if (g) g.total += def.count;
    else out.push({ key: def.key, group: def.group, total: def.count });
  }
  return out;
}
