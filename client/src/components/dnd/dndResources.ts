import type { DndAbilityScores, DndClassEntry } from "../../types";
import { abilityModifier } from "./AbilityScores";
import { resourcesAtLevel, statsAtLevel, type ClassProgression } from "./progression";

// Вкладка «Ресурсы»: пулы, которые персонаж тратит, и показатели, которые
// просто растут по уровням.
//
// Раньше это был список из десяти пулов, зашитых в код, где принадлежность
// классу проверялась сравнением строки имени («Чародей», «Варвар», «Воин» +
// «Мастер оружия»), а максимум считался вручную написанной лесенкой порогов.
// Добавить класс без правки исходников было нельзя. Теперь и то, и другое
// берётся из таблицы развития класса: колонка с ролью «Расходуемый ресурс»
// даёт пул, колонка с ролью «Показатель по уровню» — просто значение.
//
// Максимум по-прежнему нигде не хранится: он вычисляется. Хранится только
// израсходованное и внешняя прибавка (предметы и черты, увеличивающие пул).

export interface DndResourceDef {
  key: string;
  label: string;
  max: number;
  /** Класс, из таблицы которого пришёл пул — показывается, когда их несколько. */
  className: string;
}

export interface DndStatDef {
  key: string;
  label: string;
  value: string;
  className: string;
}

export interface ClassResourceSource {
  entry: DndClassEntry;
  progression?: ClassProgression;
}

// Ключ должен пережить переименование колонки и не столкнуться с колонкой
// другого класса, поэтому строится из id записи класса и ключа колонки.
function resourceKey(classId: number | null, columnKey: string): string {
  return `prog:${classId ?? "x"}:${columnKey}`;
}

function toNumber(raw: string): number {
  const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function applicableResources(sources: ClassResourceSource[]): DndResourceDef[] {
  const out: DndResourceDef[] = [];
  for (const { entry, progression } of sources) {
    if (!progression || entry.level <= 0) continue;
    for (const col of resourcesAtLevel(progression, entry.level)) {
      const max = toNumber(col.value);
      if (max <= 0) continue;
      out.push({
        key: resourceKey(entry.classId, col.key),
        label: col.label,
        max,
        className: entry.className,
      });
    }
  }
  return out;
}

export function applicableStats(sources: ClassResourceSource[]): DndStatDef[] {
  const out: DndStatDef[] = [];
  for (const { entry, progression } of sources) {
    if (!progression || entry.level <= 0) continue;
    for (const col of statsAtLevel(progression, entry.level)) {
      out.push({
        key: resourceKey(entry.classId, col.key),
        label: col.label,
        value: col.value,
        className: entry.className,
      });
    }
  }
  return out;
}

// ——— то, чего в таблице нет ———
//
// Три пула в 5.5 по уровням не расписаны, а считаются формулой, поэтому в
// таблице развития их попросту нет: Возложение рук — уровень Паладина × 5,
// Кости вдохновения — модификатор Харизмы, Избранный враг — бонус владения.
// Пока для них нет поля в записи класса, они остаются здесь — но уже как
// три явных исключения, а не как вся система целиком.
//
// Следующий шаг — поле «Ресурсы вне таблицы» у класса с крошечным словарём
// («уровень класса × N», «модификатор характеристики», «бонус владения»),
// после чего этот блок уходит вместе с последними именами классов в коде.

function nameMatches(stored: string, name: string): boolean {
  return stored === name || stored.startsWith(`${name} [`) || stored.startsWith(`${name} (`);
}

function classLevel(classes: DndClassEntry[], name: string): number {
  const c = classes.find((c) => nameMatches(c.className, name));
  return c ? c.level : 0;
}

function proficiencyBonusNumber(classes: DndClassEntry[]): number {
  const totalLevel = Math.max(1, classes.reduce((sum, c) => sum + (c.level || 0), 0));
  return Math.min(6, 2 + Math.floor((totalLevel - 1) / 4));
}

const FORMULA_RESOURCES: {
  key: string;
  label: string;
  className: string;
  compute(classes: DndClassEntry[], abilities: DndAbilityScores): number;
}[] = [
  {
    key: "lay_on_hands",
    label: "Возложение рук",
    className: "Паладин",
    compute: (classes) => classLevel(classes, "Паладин") * 5,
  },
  {
    key: "bardic_inspiration",
    label: "Вдохновение барда",
    className: "Бард",
    compute: (classes, abilities) =>
      classLevel(classes, "Бард") > 0 ? Math.max(1, abilityModifier(abilities.cha)) : 0,
  },
  {
    key: "favored_enemy",
    label: "Избранный враг",
    className: "Следопыт",
    compute: (classes) => (classLevel(classes, "Следопыт") > 0 ? proficiencyBonusNumber(classes) : 0),
  },
];

export function formulaResources(classes: DndClassEntry[], abilities: DndAbilityScores): DndResourceDef[] {
  return FORMULA_RESOURCES.map((r) => ({
    key: r.key,
    label: r.label,
    max: r.compute(classes, abilities),
    className: r.className,
  })).filter((r) => r.max > 0);
}

// Всё вместе, в том виде, в каком это показывает лист.
export function allResources(
  sources: ClassResourceSource[],
  abilities: DndAbilityScores
): DndResourceDef[] {
  const classes = sources.map((s) => s.entry);
  const fromTable = applicableResources(sources);
  // Избранный враг у Следопыта есть и в таблице, и формулой — таблица
  // главнее, дубликат по названию отбрасываем.
  const labels = new Set(fromTable.map((r) => r.label.toLowerCase()));
  const fromFormula = formulaResources(classes, abilities).filter(
    (r) => !labels.has(r.label.toLowerCase())
  );
  return [...fromTable, ...fromFormula];
}
