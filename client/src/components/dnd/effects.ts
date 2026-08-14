// Structured "what this thing actually does" model, shared by everything a
// character can apply: spells, creature actions, class/species features,
// feats, magic items. Replaces the old fixed attack_save/damage/healing
// trio, which could only express one roll and one damage, was optional in
// practice (39 of 94 seeded spells had no category at all), and pushed
// everything else into free text.
//
// Shape is deliberately flat: a carrier has 0..N checks (an attack roll or a
// saving throw) and 0..N effects, and each effect says *when* it happens by
// pointing at a check plus an outcome. A spell with both an attack and a
// save (Ice Knife: ranged attack, then a Dex save for the burst) is two
// checks and three effects — no special case. Nesting effects inside checks
// would have made that the special case instead.

import { ABILITY_SCORES } from "../../compendium";

export type DndCheckType = "attack" | "save";
export type DndAttackRange = "melee" | "ranged";

export interface DndCheck {
  // Local to one carrier, not a database id — effects reference it. Kept as
  // a string so it survives JSON round-trips without index-shift bugs when a
  // check in the middle is deleted.
  id: string;
  type: DndCheckType;
  // Attack-only.
  attackRange?: DndAttackRange;
  // Save-only: a Russian ability name from ABILITY_SCORES.
  saveAbility?: string;
  // Overrides the caster's computed spell save DC / attack bonus. Almost
  // always empty — magic items with a fixed DC are the reason it exists.
  dcOverride?: number | null;
}

export type DndEffectType =
  | "damage"
  | "heal"
  | "temp_hp"
  | "condition"
  | "condition_remove"
  | "movement"
  | "zone"
  | "summon"
  | "transform"
  | "create_object"
  | "roll_modifier"
  | "defense"
  | "special";

// "always" = no roll gates it (Cure Wounds, Shield). The rest name a check
// outcome and are only valid alongside a checkId.
export type DndEffectWhen = "always" | "hit" | "miss" | "save_fail" | "save_success";

export type DndMovementKind = "push" | "pull" | "teleport" | "speed";

// A reference into a "Справочник" mechanics group (damage types, conditions)
// rather than a typed-in string — same {id, name} shape the compendium
// editor already uses for schools/weapon properties, so a renamed reference
// entry doesn't orphan the pick.
export interface DndMechanicsRef {
  id: number;
  name: string;
}

// Some spells let the caster pick the damage type at cast time (Chromatic
// Orb). Modelling that as "no type" would be wrong — the type isn't missing,
// it's chosen — so it gets a sentinel ref with an id no real entry can have.
export const DAMAGE_TYPE_CHOSEN_ID = -1;
export const DAMAGE_TYPE_CHOSEN: DndMechanicsRef = {
  id: DAMAGE_TYPE_CHOSEN_ID,
  name: "Выбирается при накладывании",
};

export interface DndEffect {
  id: string;
  type: DndEffectType;
  when: DndEffectWhen;
  // Which check gates this effect. Null/undefined only when when === "always".
  checkId?: string | null;

  // damage / heal / temp_hp
  dice?: string; // "8d6", "2d8 + мод"
  damageType?: DndMechanicsRef | null;
  // The single most common rule in the game, so it's a flag on the damage
  // effect rather than a second "half damage on success" effect — otherwise
  // every Fireball in the book would need two chips.
  halfOnSuccess?: boolean;
  // Scaling per slot level above the spell's own ("1d6"). Replaces the
  // free-text `upcast` textarea, so the sheet can show the damage for the
  // slot actually being spent.
  upcastPerLevel?: string;
  // Cantrips scale on *character* level, not slot level — a different rule,
  // so a different field. The die is per-spell (Eldritch Blast adds 1d10,
  // Sacred Flame 1d8); the thresholds are fixed by 5.5 at levels 5/11/17 and
  // so aren't stored.
  cantripScaling?: string;

  // condition / condition_remove
  condition?: DndMechanicsRef | null;

  // movement
  movementKind?: DndMovementKind;
  distance?: string;

  // zone
  zoneShape?: string;
  zoneSize?: string;

  // roll_modifier
  modifier?: string; // "+1d4", "помеха"

  // summon / transform / create_object / defense / special, and free-form
  // detail for any of the above.
  text?: string;
}

// What applying this costs. Unifies a spell's slot with a class feature's
// resource pool (Second Wind, Lay on Hands) so the view mode can spend both
// through the same control.
export type DndCostKind = "none" | "spell_slot" | "resource" | "uses" | "hit_dice";
export type DndCostPeriod = "short_rest" | "long_rest" | "day";

export interface DndCost {
  kind: DndCostKind;
  amount?: number | null;
  // dndResources.ts resource key, for kind === "resource".
  resourceKey?: string;
  // For kind === "uses": how often the uses come back.
  per?: DndCostPeriod;
}

export const EMPTY_COST: DndCost = { kind: "none" };

export const EFFECT_TYPE_LABELS: Record<DndEffectType, string> = {
  damage: "Урон",
  heal: "Лечение",
  temp_hp: "Временные хиты",
  condition: "Состояние",
  condition_remove: "Снятие состояния",
  movement: "Перемещение",
  zone: "Зона",
  summon: "Призыв",
  transform: "Превращение",
  create_object: "Создание объекта",
  roll_modifier: "Модификатор броска",
  defense: "Защита",
  special: "Особое",
};

// Order the "+ добавить эффект" menu shows them in — by how often they come
// up when entering a spellbook, not alphabetically.
export const EFFECT_TYPE_ORDER: DndEffectType[] = [
  "damage",
  "heal",
  "condition",
  "temp_hp",
  "movement",
  "zone",
  "condition_remove",
  "summon",
  "transform",
  "create_object",
  "roll_modifier",
  "defense",
  "special",
];

export const EFFECT_WHEN_LABELS: Record<DndEffectWhen, string> = {
  always: "всегда",
  hit: "при попадании",
  miss: "при промахе",
  save_fail: "при провале",
  save_success: "при успехе",
};

export const MOVEMENT_KIND_LABELS: Record<DndMovementKind, string> = {
  push: "толчок",
  pull: "притягивание",
  teleport: "телепортация",
  speed: "скорость",
};

export const COST_KIND_LABELS: Record<DndCostKind, string> = {
  none: "Без стоимости",
  spell_slot: "Ячейка заклинания",
  resource: "Ресурс класса",
  uses: "Использования",
  hit_dice: "Кости хитов",
};

export const COST_PERIOD_LABELS: Record<DndCostPeriod, string> = {
  short_rest: "за короткий отдых",
  long_rest: "за долгий отдых",
  day: "в день",
};

export const ATTACK_RANGE_LABELS: Record<DndAttackRange, string> = {
  melee: "ближняя",
  ranged: "дальняя",
};

export const SAVE_ABILITIES = [...ABILITY_SCORES];

// Which `when` values make sense for a given set of checks — the effect
// editor offers only these, so an effect can't end up gated on an outcome
// that can never happen.
export function allowedWhen(checks: DndCheck[]): DndEffectWhen[] {
  const result: DndEffectWhen[] = ["always"];
  if (checks.some((c) => c.type === "attack")) result.push("hit", "miss");
  if (checks.some((c) => c.type === "save")) result.push("save_fail", "save_success");
  return result;
}

let idCounter = 0;
// Unique within one editing session, which is all these ids need to be —
// they're scoped to a single carrier's own checks/effects, never global.
export function newLocalId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function newCheck(type: DndCheckType): DndCheck {
  return type === "attack"
    ? { id: newLocalId("c"), type: "attack", attackRange: "ranged" }
    : { id: newLocalId("c"), type: "save", saveAbility: SAVE_ABILITIES[1] };
}

// A new effect defaults to the first outcome that actually exists on this
// carrier: with a save present that's "при провале", which is what it is for
// the overwhelming majority of spells.
export function newEffect(type: DndEffectType, checks: DndCheck[]): DndEffect {
  const save = checks.find((c) => c.type === "save");
  const attack = checks.find((c) => c.type === "attack");
  const gate = save ?? attack ?? null;
  const when: DndEffectWhen = save ? "save_fail" : attack ? "hit" : "always";
  const base: DndEffect = { id: newLocalId("e"), type, when, checkId: gate?.id ?? null };
  if (type === "damage" && save) base.halfOnSuccess = true;
  if (type === "movement") base.movementKind = "push";
  return base;
}

export function checkLabel(check: DndCheck): string {
  if (check.type === "attack") {
    return `Атака ${ATTACK_RANGE_LABELS[check.attackRange ?? "ranged"]}`;
  }
  return `Спасбросок ${check.saveAbility ?? ""}`.trim();
}

// Short ability abbreviation used in the compact chip summary, so a chip
// reads "Урон · 8d6 огнём · пров. Лвк" instead of wrapping onto three lines.
const ABILITY_ABBR: Record<string, string> = {
  Сила: "Сил",
  Ловкость: "Лвк",
  Телосложение: "Тел",
  Интеллект: "Инт",
  Мудрость: "Мдр",
  Харизма: "Хар",
};

function whenSummary(effect: DndEffect, checks: DndCheck[]): string | null {
  if (effect.when === "always") return null;
  const check = checks.find((c) => c.id === effect.checkId);
  if (effect.when === "hit") return "при попадании";
  if (effect.when === "miss") return "при промахе";
  const abbr = check?.saveAbility ? ABILITY_ABBR[check.saveAbility] ?? check.saveAbility : "";
  return `${effect.when === "save_fail" ? "пров." : "усп."} ${abbr}`.trim();
}

// One-line summary shown on a collapsed chip. Only the parts that are
// actually filled in appear — a half-entered effect still reads sensibly.
export function effectSummary(effect: DndEffect, checks: DndCheck[]): string {
  const parts: string[] = [EFFECT_TYPE_LABELS[effect.type]];
  switch (effect.type) {
    case "damage":
    case "heal":
    case "temp_hp":
      if (effect.dice) parts.push(effect.dice);
      if (effect.type === "damage" && effect.damageType?.name) {
        parts[parts.length - 1] = [effect.dice, effect.damageType.name].filter(Boolean).join(" ");
      }
      break;
    case "condition":
    case "condition_remove":
      if (effect.condition?.name) parts.push(effect.condition.name);
      break;
    case "movement":
      parts.push(
        [MOVEMENT_KIND_LABELS[effect.movementKind ?? "push"], effect.distance].filter(Boolean).join(" ")
      );
      break;
    case "zone":
      parts.push([effect.zoneShape, effect.zoneSize].filter(Boolean).join(" "));
      break;
    case "roll_modifier":
      if (effect.modifier) parts.push(effect.modifier);
      break;
    default:
      if (effect.text) parts.push(effect.text);
      break;
  }
  const when = whenSummary(effect, checks);
  if (when) parts.push(when);
  if (effect.halfOnSuccess) parts.push("полов.");
  return parts.filter(Boolean).join(" · ");
}

// ——— производные для листа персонажа ———

// Строка «чем это разрешается» для таблицы Действий: бонус атаки берётся у
// персонажа, СЛ — тоже, если у броска не задана своя (dcOverride есть только
// у предметов с фиксированной СЛ).
export function checksLabel(checks: DndCheck[], spellAttackBonus: number, spellDc: number): string {
  if (!checks || checks.length === 0) return "—";
  return checks
    .map((c) => {
      if (c.type === "attack") {
        return `АТК ${spellAttackBonus >= 0 ? "+" : ""}${spellAttackBonus}`;
      }
      const abbr = c.saveAbility ? ABILITY_ABBR[c.saveAbility] ?? c.saveAbility : "";
      return `СЛ ${abbr} ${c.dcOverride ?? spellDc}`.replace(/\s+/g, " ").trim();
    })
    .join(" / ");
}

// Урон/лечение одной строкой. Показываем только то, что реально в цифрах —
// состояния и зоны в этой колонке не помещаются и живут в описании.
export function effectsLabel(effects: DndEffect[]): string {
  if (!effects || effects.length === 0) return "—";
  const numeric = effects.filter((e) => e.type === "damage" || e.type === "heal" || e.type === "temp_hp");
  if (numeric.length === 0) {
    // Ничего числового — показываем типы, чтобы строка не была пустой.
    return effects.map((e) => effectSummary(e, [])).join("; ");
  }
  return numeric
    .map((e) => {
      const parts = [e.dice, e.type === "damage" ? e.damageType?.name : EFFECT_TYPE_LABELS[e.type]];
      const text = parts.filter(Boolean).join(" ");
      return e.halfOnSuccess ? `${text} (полов.)` : text;
    })
    .join(" + ");
}

// Есть ли что показывать в «Действиях»: либо бросок, либо числовой эффект.
// Заменяет старое поле `category`, которое было необязательным и потому
// прятало половину книги.
export function hasResolvableEffect(checks: DndCheck[], effects: DndEffect[]): boolean {
  if (checks && checks.length > 0) return true;
  return (effects ?? []).some((e) => e.type === "damage" || e.type === "heal" || e.type === "temp_hp");
}

export function costSummary(cost: DndCost | undefined): string | null {
  if (!cost || cost.kind === "none") return null;
  switch (cost.kind) {
    case "spell_slot":
      return "Ячейка";
    case "hit_dice":
      return `Кости хитов${cost.amount ? ` ×${cost.amount}` : ""}`;
    case "resource":
      return `Ресурс${cost.amount ? ` ×${cost.amount}` : ""}`;
    case "uses":
      return `${cost.amount ?? 1} ${COST_PERIOD_LABELS[cost.per ?? "long_rest"]}`;
    default:
      return null;
  }
}
