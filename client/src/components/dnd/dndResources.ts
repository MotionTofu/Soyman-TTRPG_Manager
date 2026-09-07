import type { DndAbilityScores, DndClassEntry, DndFeature } from "../../types";
import type { DndCost, DndCostPeriod } from "./effects";
import { abilityModifier } from "./AbilityScores";
import {
  columnsAtLevel,
  resourcesAtLevel,
  statsAtLevel,
  type ClassProgression,
  type ProgressionRecharge,
} from "./progression";

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
  /** Когда пул восстанавливается — приходит из колонки таблицы развития. */
  recharge: ProgressionRecharge;
  /** Класс, из таблицы которого пришёл пул — показывается, когда их несколько. */
  className: string;
  /** Чем пополнить вне отдыха («3 очка чародейства»): название пула-донора
   *  и цена. Донор ищется по названию среди пулов персонажа. */
  restore?: { pool: string; amount: number };
}

export interface DndStatDef {
  key: string;
  label: string;
  value: string;
  className: string;
}

/** Строка таблицы схем реплик у записи класса (решение R1). */
export interface ReplicateScheme {
  entryId: number;
  minLevel: number;
}

/** Общая строка таблицы схем («любой обычный…», книга): шаблон выбора, каждый
 *  взятый по нему предмет — отдельная схема. id стабилен в пределах записи
 *  класса ("common", "uncommon-wondrous", "rare-wondrous"). */
export interface ReplicaGeneric {
  id: string;
  label: string;
  minLevel: number;
  rarity?: string;
  types?: string[];
  excludeTypes?: string[];
  excludeCursed?: boolean;
}

export interface ClassResourceSource {
  entry: DndClassEntry;
  progression?: ClassProgression;
  /** Схемы реплик, если класс их даёт (Артефактор). */
  replicateSchemes?: ReplicateScheme[];
  /** Общие строки схем из данных записи класса. */
  replicateGenerics?: ReplicaGeneric[];
  /** Источник — подкласс этого класса (id записи класса): пулы и показатели
   *  подкласса (кости превосходства, ячейки Мистического рыцаря — нет, те
   *  идут слотами) живут в прогрессии записи подкласса, а уровень берётся
   *  из строки базового класса. Нужно, чтобы подпись «· класс» у
   *  многоклассовых считалась по корням, а не по источникам: иначе
   *  одноклассовый Воин/Мастер боевых искусств выглядел бы многоклассовым. */
  subOf?: number | null;
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
        recharge: col.recharge,
        className: entry.className,
      });
    }
  }
  return out;
}

/** Бонус к пределам реплик сверх таблицы (Лучший бронник 9 ур.: +1 схема и
 *  +1 предмет, но только доспехи). Маркер — поле replicaBonus у записи
 *  умения, цифры и оговорка — из него же. Не форсится (философия R4:
 *  показываем, не запираем): категория «только доспехи» — на честности. */
export interface ReplicaBonus {
  schemes: number;
  items: number;
  notes: string[];
}

/** Пределы реплик на текущем уровне класса: сколько схем можно знать и
 *  сколько предметов держать созданными. Обе колонки живут в таблице
 *  развития со своими ролями — искать их по названию в коде не нужно.
 *  generics — доступные общие строки («любой обычный…») того же уровня. */
export interface ReplicaLimits {
  classId: number | null;
  className: string;
  level: number;
  schemes: number;
  items: number;
  available: ReplicateScheme[];
  generics: ReplicaGeneric[];
}

export function replicaLimits(sources: ClassResourceSource[]): ReplicaLimits[] {
  const out: ReplicaLimits[] = [];
  for (const { entry, progression, replicateSchemes, replicateGenerics } of sources) {
    if (
      (!replicateSchemes || replicateSchemes.length === 0) &&
      (!replicateGenerics || replicateGenerics.length === 0)
    ) {
      continue;
    }
    if (entry.level <= 0) continue;
    const schemes = toNumber(columnsAtLevel(progression, entry.level, "replica_schemes")[0]?.value ?? "");
    const items = toNumber(columnsAtLevel(progression, entry.level, "replica_items")[0]?.value ?? "");
    // Схема доступна, когда уровень класса дорос до её порога.
    const available = (replicateSchemes ?? []).filter((s) => s.minLevel <= entry.level);
    const generics = (replicateGenerics ?? []).filter((g) => g.minLevel <= entry.level);
    if (schemes <= 0 && items <= 0) continue;
    out.push({
      classId: entry.classId,
      className: entry.className,
      level: entry.level,
      schemes,
      items,
      available,
      generics,
    });
  }
  return out;
}

/** Подписывать ли пулы/показатели классом («· Воин»): корней больше одного.
 *  Корень — класс, а не источник: подкласс (subOf) корнем не считается, иначе
 *  одноклассовый персонаж с подклассом выглядел бы многоклассовым. */
export function showClassSuffix(sources: ClassResourceSource[]): boolean {
  const roots = new Set<number | string>();
  for (const s of sources) {
    if (s.entry.level <= 0) continue;
    roots.add(s.subOf ?? s.entry.classId ?? s.entry.className);
  }
  return roots.size > 1;
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
// Четыре пула в 5.5 по уровням не расписаны, а считаются формулой, поэтому в
// таблице развития их попросту нет: Возложение рук — уровень Паладина × 5,
// Кости вдохновения — модификатор Харизмы, Избранный враг — бонус владения,
// Чародейные выстрелы — модификатор Интеллекта у подкласса (минимум 1).
// Пока для них нет поля в записи класса, они остаются здесь — но уже как
// три явных исключения, а не как вся система целиком.
//
// Следующий шаг — поле «Ресурсы вне таблицы» у класса с крошечным словарём
// («уровень класса × N», «модификатор характеристики», «бонус владения»),
// после чего этот блок уходит вместе с последними именами классов в коде.

// «Воин [Fighter]» и «Воин (Fighter)» — тот же класс, что «Воин»:
// оригинал в скобках — подпись справочника, а не другой класс.
export function nameMatches(stored: string, name: string): boolean {
  return stored === name || stored.startsWith(`${name} [`) || stored.startsWith(`${name} (`);
}

function classLevel(classes: DndClassEntry[], name: string): number {
  const c = classes.find((c) => nameMatches(c.className, name));
  return c ? c.level : 0;
}

// Есть ли строка с таким подклассом (имя — как в записи справочника,
// скобочные суффиксы «[Fighter]» снимаются тем же nameMatches).
function hasSubclass(classes: DndClassEntry[], name: string): boolean {
  return classes.some((c) => c.subclassName && nameMatches(c.subclassName, name));
}

function proficiencyBonusNumber(classes: DndClassEntry[]): number {
  const totalLevel = Math.max(1, classes.reduce((sum, c) => sum + (c.level || 0), 0));
  return Math.min(6, 2 + Math.floor((totalLevel - 1) / 4));
}

const FORMULA_RESOURCES: {
  key: string;
  label: string;
  className: string;
  /** Только когда строка несёт этот подкласс (Чародейный стрелок): пул
   *  подкласса, а не класса. Без поля — как раньше, по классу. */
  subclassName?: string;
  recharge: ProgressionRecharge;
  compute(classes: DndClassEntry[], abilities: DndAbilityScores): number;
}[] = [
  {
    key: "lay_on_hands",
    label: "Возложение рук",
    className: "Паладин",
    recharge: "long",
    compute: (classes) => classLevel(classes, "Паладин") * 5,
  },
  {
    key: "bardic_inspiration",
    label: "Вдохновение барда",
    className: "Бард",
    // PHB 2024: возвращается и на коротком отдыхе.
    recharge: "short",
    compute: (classes, abilities) =>
      classLevel(classes, "Бард") > 0 ? Math.max(1, abilityModifier(abilities.cha)) : 0,
  },
  {
    key: "favored_enemy",
    label: "Избранный враг",
    className: "Следопыт",
    recharge: "long",
    compute: (classes) => (classLevel(classes, "Следопыт") > 0 ? proficiencyBonusNumber(classes) : 0),
  },
  {
    key: "arcane_shot",
    label: "Чародейные выстрелы",
    className: "Воин",
    subclassName: "Чародейный стрелок",
    recharge: "short",
    compute: (classes, abilities) =>
      hasSubclass(classes, "Чародейный стрелок") ? Math.max(1, abilityModifier(abilities.int)) : 0,
  },
];

export function formulaResources(classes: DndClassEntry[], abilities: DndAbilityScores): DndResourceDef[] {
  return FORMULA_RESOURCES.map((r) => ({
    key: r.key,
    label: r.label,
    max: r.compute(classes, abilities),
    recharge: r.recharge,
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

// Свои ресурсы способностей (структурность, гриллинг 2026-09-06): умение с
// cost {kind: "uses", ownResource: true} приносит собственный пул, а не
// тратит классовый. Ключ — по записи компендиума (имя рядом не нужно: имя
// берётся из умения при отрисовке, а ключ лишь сводит трату и остаток).
// Без entryId пула нет: вписанному руками соответствию не на что опереться,
// и его цена остаётся текстом, как раньше.
export function featurePoolKey(entryId: number): string {
  return `feature:${entryId}`;
}

/** Наибольший порог levelSteps не выше уровня (3/5/9/15 → 2/3/4/5).
 *  Ниже первого порога — первый (умение всё равно требует свой минимальный
 *  уровень, ниже него персонаж его не имеет). Без уровня (null) — null,
 *  вызывающий откатывается к amount. */
export function steppedMax(
  steps: { level: number; max: number }[],
  level: number | null
): number | null {
  if (level == null) return null;
  let best: number | null = null;
  for (const s of steps) {
    if (s.level <= level && (best == null || s.max > best)) best = s.max;
  }
  return best ?? (steps.length > 0 ? steps[0].max : null);
}

function featureRecharge(per: DndCostPeriod | undefined): ProgressionRecharge {
  // «В день» восстанавливается долгим отдыхом, как и всё дневное.
  if (per === "short_rest") return "short";
  return "long";
}

/** Пулы умений из списка (живых, разрешённых) — дедуп по ключу: одна и та же
 *  способность дважды не даёт два пула. Максимум — по старшинству: сначала
 *  levelSteps (порог по уровню класса через levelOf — эликсиры 2→3→4→5),
 *  потом maxAbility (модификатор, минимум 1 / кратно множителю), потом число.
 *  levelOf возвращает уровень класса-хозяина записи (по родителям) или null —
 *  без него шаги не на что опереть, и работает amount. Хоумбрю без правки
 *  кода. */
export function featurePools(
  features: DndFeature[],
  abilities?: DndAbilityScores,
  levelOf?: (entryId: number) => number | null
): DndResourceDef[] {
  const seen = new Set<string>();
  const out: DndResourceDef[] = [];
  for (const f of features) {
    const cost: DndCost | undefined = f.cost;
    if (cost?.kind !== "uses" || !cost.ownResource || typeof f.entryId !== "number") continue;
    const key = featurePoolKey(f.entryId);
    if (seen.has(key)) continue;
    seen.add(key);
    const mult = cost.maxMultiplier && cost.maxMultiplier > 0 ? Math.floor(cost.maxMultiplier) : 1;
    const stepped =
      cost.levelSteps && cost.levelSteps.length > 0 && levelOf
        ? steppedMax(cost.levelSteps, levelOf(f.entryId))
        : null;
    const max =
      stepped != null
        ? stepped
        : cost.maxAbility && abilities
          ? Math.max(mult, abilityModifier(abilities[cost.maxAbility]) * mult)
          : cost.amount && cost.amount > 0
            ? cost.amount
            : 1;
    out.push({
      key,
      label: f.name || "Свой ресурс",
      max,
      recharge: featureRecharge(cost.per),
      className: "",
      ...(cost.restore?.pool ? { restore: { pool: cost.restore.pool, amount: cost.restore.amount } } : {}),
    });
  }
  return out;
}
