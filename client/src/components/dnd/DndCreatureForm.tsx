import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import type {
  CompendiumEntry,
  DndAbilityKey,
  DndAbilityScores,
  DndActionCategory,
  DndAttackRollType,
  DndCreatureAction,
  DndCreatureData,
  DndCreatureEquipmentItem,
  DndCreatureLegendary,
  DndCreatureLoot,
  DndCreatureSense,
  DndCreatureSpell,
  DndCreatureSpellFrequency,
  DndCreatureSpellcasting,
  DndCreatureSpeed,
  DndCreatureHitPoints,
  DndCreatureArmorClass,
  DndLegendaryActionEntry,
  SearchResult,
} from "../../types";
import {
  ABILITY_LABELS,
  ABILITY_NAME_TO_KEY,
  AbilityScoresEdit,
  ALL_SKILLS,
  SKILLS_BY_ABILITY,
  abilityModifier,
  emptyAbilities,
  emptySavingThrowProfs,
  formatModifier,
} from "./AbilityScores";
import {
  loadDndEquipmentEntries,
  loadDndMechanicsGroup,
  loadDndSpellsByLevel,
  findDndSystemId,
  type DndMechanicsOption,
  type DndSpellOption,
} from "./dndCompendium";
import { MECHANICS_CREATURE_TYPE_GROUP, MECHANICS_ALIGNMENT_GROUP } from "../../compendium";
import { useConfirm } from "../../hooks/useConfirm";
import { useDndPrefs } from "../../hooks/useDndPrefs";
import type { DndAbilityPrimary } from "../../dndPrefs";
import { effectsLabel, type DndCheck, type DndEffect } from "./effects";
import { FeatureListEdit } from "./FeatureList";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { MentionText } from "../mentions/MentionText";
import { SEARCH_DRAG_MIME } from "../LinkDropZone";
import { useBag } from "../../bag";
import { averageDiceFormula, rollDiceFormula } from "./diceRoll";
import { PipTrack } from "../litm/PipTrack";
import { api } from "../../api/client";
import { NavIcon } from "../NavIcons";
import { CHALLENGE_RATINGS, CREATURE_SIZES as COMPENDIUM_CREATURE_SIZES, normaliseCr } from "../../compendium";

export const CREATURE_SIZES = COMPENDIUM_CREATURE_SIZES;
export const DIE_SIZES = [4, 6, 8, 10, 12] as const;
/** @deprecated — используйте CHALLENGE_RATINGS из compendium.ts (единый источник, C2) */
export const CR_VALUES: readonly string[] = CHALLENGE_RATINGS;

function crToNumber(cr: string): number {
  const c = normaliseCr(cr);
  if (c === "1/8") return 0.125;
  if (c === "1/4") return 0.25;
  if (c === "1/2") return 0.5;
  const n = Number(c);
  return Number.isFinite(n) ? n : 0;
}

// Standard 5e challenge-rating -> proficiency-bonus table.
export function computeProficiencyBonusForCR(cr: string): number {
  const n = crToNumber(cr);
  if (n <= 4) return 2;
  if (n <= 8) return 3;
  if (n <= 12) return 4;
  if (n <= 16) return 5;
  if (n <= 20) return 6;
  if (n <= 24) return 7;
  if (n <= 28) return 8;
  return 9;
}

const SKILL_ABILITY: Record<string, DndAbilityKey> = Object.fromEntries(
  Object.entries(SKILLS_BY_ABILITY).flatMap(([ability, skills]) => skills.map((s) => [s, ability as DndAbilityKey]))
);

export function emptySpeed(): DndCreatureSpeed {
  return { walk: null, fly: null, swim: null, climb: null, burrow: null, hover: false, note: "" };
}

export function emptyHitPoints(): DndCreatureHitPoints {
  return { diceCount: null, dieSize: null, bonus: null, formula: "" };
}

export function emptyArmorClass(): DndCreatureArmorClass {
  return { value: null, note: "" };
}

export function emptySpellcasting(): DndCreatureSpellcasting {
  return { enabled: false, ability: "", slots: [], spells: [] };
}

export function emptyLegendary(): DndCreatureLegendary {
  return {
    resistanceEnabled: false,
    resistanceCount: null,
    actionsEnabled: false,
    actionPoints: null,
    actions: [],
    lairEnabled: false,
    lairActions: [],
  };
}

export function emptyCreature(): DndCreatureData {
  return {
    name: "",
    size: "Средний",
    creatureType: "",
    alignment: "",
    armorClass: emptyArmorClass(),
    hitPoints: emptyHitPoints(),
    speed: emptySpeed(),
    initiativeBonus: null,
    challenge: { rating: "", proficiencyBonus: null },
    abilities: emptyAbilities(),
    savingThrowProfs: emptySavingThrowProfs(),
    skillProfs: {},
    damageVulnerabilities: [],
    damageResistances: [],
    damageImmunities: [],
    conditionImmunities: [],
    saveAdvantageConditions: [],
    saveAdvantageMagic: false,
    defenseNotes: "",
    sensesList: [],
    perceptionNote: "",
    passivePerception: null,
    languages: "",
    spellcasting: emptySpellcasting(),
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: [],
    legendary: emptyLegendary(),
    habitat: "",
    treasure: "",
    equipment: [],
    loot: { items: [], currency: [] },
    notes: "",
  };
}

function toLegacyList(current: unknown, legacyRaw: unknown): string[] {
  if (Array.isArray(current) && current.length > 0) return current as string[];
  const list = typeof legacyRaw === "string" && legacyRaw.trim() ? legacyRaw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean) : [];
  if (list.length > 0) return list;
  return Array.isArray(current) ? (current as string[]) : [];
}

const SPEED_KEYWORDS: { re: RegExp; key: "walk" | "fly" | "swim" | "climb" | "burrow" }[] = [
  { re: /пол[её]т|летит|fly/i, key: "fly" },
  { re: /плавани|плывёт|swim/i, key: "swim" },
  { re: /лазани|climb/i, key: "climb" },
  { re: /копани|рыть|burrow/i, key: "burrow" },
  { re: /ходьб|walk/i, key: "walk" },
];

function parseLegacySpeed(text: string): DndCreatureSpeed {
  const speed = emptySpeed();
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const leftovers: string[] = [];
  parts.forEach((part, i) => {
    const numMatch = /(\d+)/.exec(part);
    const value = numMatch ? Number(numMatch[1]) : null;
    const matched = SPEED_KEYWORDS.find((k) => k.re.test(part));
    if (matched && value !== null) {
      speed[matched.key] = value;
      if (/паря|hover/i.test(part)) speed.hover = true;
    } else if (value !== null && i === 0 && speed.walk === null) {
      // A bare leading number with no keyword is almost always walking speed
      // (legacy "30 фт., полёт 60 фт." style entries).
      speed.walk = value;
    } else {
      leftovers.push(part);
    }
  });
  speed.note = leftovers.join(", ");
  return speed;
}

const AC_RE = /^(\d+)\s*\(?([^)]*)\)?/;
const HIT_DICE_RE = /(\d+)\s*[кdD](\d+)\s*([+-]\s*\d+)?/;

// Bridges old saved creature statblocks (free-text АС/ХП/скорость/размер-
// тип-мировоззрение/КО/чувства/урон-состояния) into the new structured
// shape, so existing data keeps displaying instead of going blank — mirrors
// normalizeDndCharacter's approach in this same directory.
export function normalizeDndCreature(raw: unknown): DndCreatureData {
  const base = emptyCreature();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const merged: DndCreatureData = { ...base, ...(r as Partial<DndCreatureData>) };

  if (typeof r.armorClass === "string") {
    const m = AC_RE.exec(r.armorClass.trim());
    merged.armorClass = m ? { value: Number(m[1]) || null, note: (m[2] || "").trim() } : { value: null, note: r.armorClass };
  } else {
    merged.armorClass = { ...base.armorClass, ...((r.armorClass as object) ?? {}) };
  }

  if (typeof r.hitPoints === "string") {
    const m = HIT_DICE_RE.exec(r.hitPoints);
    merged.hitPoints = m
      ? {
          diceCount: Number(m[1]) || null,
          dieSize: Number(m[2]) || null,
          bonus: m[3] ? Number(m[3].replace(/\s/g, "")) : null,
          formula: r.hitPoints,
        }
      : { diceCount: null, dieSize: null, bonus: null, formula: r.hitPoints };
  } else {
    merged.hitPoints = { ...base.hitPoints, ...((r.hitPoints as object) ?? {}) };
  }

  if (typeof r.speed === "string") {
    merged.speed = r.speed ? parseLegacySpeed(r.speed) : base.speed;
  } else {
    merged.speed = { ...base.speed, ...((r.speed as object) ?? {}) };
  }

  // r.size/creatureType/alignment being absent (rather than merged.size,
  // which is already non-empty from emptyCreature()'s "Средний" default) is
  // what actually distinguishes "never set" from "explicitly set" here.
  if (!r.size && !r.creatureType && !r.alignment && typeof r.sizeTypeAlignment === "string" && r.sizeTypeAlignment) {
    const parts = r.sizeTypeAlignment.split(",").map((p) => p.trim());
    const knownSize = CREATURE_SIZES.find((s) => parts[0]?.toLowerCase().startsWith(s.toLowerCase()));
    merged.size = knownSize ?? "Средний";
    merged.creatureType = knownSize ? parts[0].slice(knownSize.length).trim() : parts[0] ?? "";
    merged.alignment = parts.slice(1).join(", ");
  }
  if (!merged.size) merged.size = "Средний";

  if ((!merged.challenge || !merged.challenge.rating) && typeof r.challengeRating === "string" && r.challengeRating) {
    merged.challenge = { rating: r.challengeRating, proficiencyBonus: computeProficiencyBonusForCR(r.challengeRating) };
  } else {
    merged.challenge = { ...base.challenge, ...((r.challenge as object) ?? {}) };
  }

  if ((!Array.isArray(merged.sensesList) || merged.sensesList.length === 0) && typeof r.senses === "string" && r.senses) {
    merged.sensesList = r.senses
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((part) => {
        const m = /^(.*?)(\d+)\s*фт\.?$/.exec(part);
        return m ? { name: m[1].trim(), distance: m[2] } : { name: part, distance: "" };
      });
  } else {
    merged.sensesList = Array.isArray(merged.sensesList) ? merged.sensesList : [];
  }

  merged.damageVulnerabilities = toLegacyList(merged.damageVulnerabilities, r.damageVulnerabilities);
  merged.damageResistances = toLegacyList(merged.damageResistances, r.damageResistances);
  merged.damageImmunities = toLegacyList(merged.damageImmunities, r.damageImmunities);
  merged.conditionImmunities = toLegacyList(merged.conditionImmunities, r.conditionImmunities);
  merged.saveAdvantageConditions = Array.isArray(merged.saveAdvantageConditions) ? merged.saveAdvantageConditions : [];

  merged.savingThrowProfs = { ...emptySavingThrowProfs(), ...((r.savingThrowProfs as object) ?? {}) };
  merged.skillProfs = typeof r.skillProfs === "object" && r.skillProfs ? (r.skillProfs as Record<string, boolean>) : {};

  // Импортированные записи бестиария несут владения списками полных русских
  // названий (`savingThrowProficiencies: ["Ловкость", "Мудрость"]`,
  // `skillProficiencies`), а структурных `savingThrowProfs`/`skillProfs` у них
  // нет. Без этого разбора у всего импортированного бестиария не залита ни
  // одна кость характеристики и пуста строка навыков, хотя данные лежат
  // рядом. Своё значение всегда сильнее: разбор идёт, только если структурного
  // владения ещё нет.
  const legacySaveProfs = Array.isArray(r.savingThrowProficiencies) ? r.savingThrowProficiencies : null;
  if (legacySaveProfs && !Object.values(merged.savingThrowProfs).some(Boolean)) {
    for (const raw of legacySaveProfs) {
      if (typeof raw !== "string") continue;
      const key = ABILITY_NAME_TO_KEY[raw.trim()];
      if (key) merged.savingThrowProfs[key] = true;
    }
  }
  const legacySkillProfs = Array.isArray(r.skillProficiencies) ? r.skillProficiencies : null;
  if (legacySkillProfs && Object.keys(merged.skillProfs).length === 0) {
    // Навыки в импорте написаны в своём регистре («Внимание/Восприятие»
    // против «Внимание/восприятие» в справочнике), поэтому сверяем без него.
    const byLower = new Map(ALL_SKILLS.map((skill) => [skill.toLowerCase(), skill]));
    for (const raw of legacySkillProfs) {
      if (typeof raw !== "string") continue;
      const skill = byLower.get(raw.trim().toLowerCase());
      if (skill) merged.skillProfs[skill] = true;
    }
  }

  // Текстовые «старые данные» дописываются в примечание, ТОЛЬКО пока владение
  // не разобрано структурно: иначе те же спасброски печатались бы дважды —
  // залитой костью и строкой под ней.
  let defenseNotes = typeof merged.defenseNotes === "string" ? merged.defenseNotes : "";
  if (
    typeof r.skills === "string" && r.skills &&
    Object.keys(merged.skillProfs).length === 0 &&
    !defenseNotes.includes(r.skills)
  ) {
    defenseNotes = [defenseNotes, `Навыки (старые данные): ${r.skills}`].filter(Boolean).join("\n");
  }
  if (
    typeof r.savingThrows === "string" && r.savingThrows &&
    !Object.values(merged.savingThrowProfs).some(Boolean) &&
    !defenseNotes.includes(r.savingThrows)
  ) {
    defenseNotes = [defenseNotes, `Спасброски (старые данные): ${r.savingThrows}`].filter(Boolean).join("\n");
  }
  // Те же две строки могли быть дописаны прежней нормализацией и УЖЕ лежать
  // в сохранённом примечании. Раз владение теперь разобрано структурно, они
  // повторяют залитую кость и строку навыков — снимаем их при чтении (в базе
  // ничего не переписывается, пока Мастер сам не сохранит запись).
  if (Object.values(merged.savingThrowProfs).some(Boolean) || Object.keys(merged.skillProfs).length > 0) {
    defenseNotes = defenseNotes
      .split(/\r?\n/)
      .filter((line) => !/^(Навыки|Спасброски) \(старые данные\):/.test(line.trim()))
      .join("\n")
      .trim();
  }
  merged.defenseNotes = defenseNotes;

  merged.spellcasting =
    merged.spellcasting && typeof merged.spellcasting === "object" && "enabled" in merged.spellcasting
      ? { ...base.spellcasting, ...(merged.spellcasting as object) }
      : base.spellcasting;

  merged.traits = Array.isArray(merged.traits) ? merged.traits : [];
  merged.actions = migrateLegacyActions(merged.actions);
  merged.bonusActions = migrateLegacyActions(merged.bonusActions);
  merged.reactions = migrateLegacyActions(merged.reactions);

  // Old saved creatures kept legendary actions as a flat DndFeature[] with
  // no point economy at all — migrate into the new `legendary.actions`
  // (cost defaults to 1, the most common 5e value) and flip actionsEnabled
  // on so the migrated rows are actually visible; everything else in
  // `legendary` (resistances/lair) simply defaults to disabled/empty.
  const legacyLegendaryActions = Array.isArray(r.legendaryActions) ? r.legendaryActions : null;
  if (legacyLegendaryActions && legacyLegendaryActions.length > 0 && (!merged.legendary || !Array.isArray(merged.legendary.actions) || merged.legendary.actions.length === 0)) {
    merged.legendary = {
      ...emptyLegendary(),
      actionsEnabled: true,
      actions: legacyLegendaryActions.map((f: unknown) => migrateLegacyAction(f, 1) as DndLegendaryActionEntry),
    };
  } else {
    const legacy = (merged.legendary as Partial<DndCreatureLegendary>) ?? {};
    merged.legendary = {
      ...emptyLegendary(),
      ...legacy,
      actions: Array.isArray(legacy.actions) ? legacy.actions : [],
      lairActions: migrateLegacyActions(legacy.lairActions),
    };
  }

  merged.equipment = Array.isArray(merged.equipment) ? merged.equipment : [];
  const legacyLoot = merged.loot as Partial<DndCreatureLoot> | undefined;
  merged.loot = {
    items: Array.isArray(legacyLoot?.items) ? legacyLoot!.items : [],
    currency: Array.isArray(legacyLoot?.currency) ? legacyLoot!.currency : [],
  };

  return merged;
}

// A legacy row is a plain {name, description} — anything already carrying
// `category` is assumed already-migrated and passed through untouched, so
// this is safe to re-run on already-current data too.
function migrateLegacyAction(raw: unknown, extraCost?: number): DndCreatureAction {
  const f = (raw && typeof raw === "object" ? raw : {}) as Partial<DndCreatureAction> & { name?: string; description?: string };
  if (f.category) return f as DndCreatureAction;
  const base: DndCreatureAction = { name: f.name ?? "", category: "other", description: f.description ?? "" };
  return extraCost !== undefined ? ({ ...base, cost: extraCost } as DndLegendaryActionEntry) : base;
}

function migrateLegacyActions(list: unknown): DndCreatureAction[] {
  if (!Array.isArray(list)) return [];
  return list.map((f) => migrateLegacyAction(f));
}

export function computePassivePerception(value: DndCreatureData): number {
  const prof = value.challenge.proficiencyBonus ?? 0;
  const proficient = !!value.skillProfs["Внимание/восприятие"];
  return 10 + abilityModifier(value.abilities.wis) + (proficient ? prof : 0);
}

// --- Small shared editors, reused by both the wizard and the plain edit form ---

export function SpeedEditor({ value, onChange }: { value: DndCreatureSpeed; onChange: (v: DndCreatureSpeed) => void }) {
  const FIELDS: { key: "walk" | "fly" | "swim" | "climb" | "burrow"; label: string }[] = [
    { key: "walk", label: "Ходьба" },
    { key: "fly", label: "Полёт" },
    { key: "swim", label: "Плавание" },
    { key: "climb", label: "Лазание" },
    { key: "burrow", label: "Копание" },
  ];
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {FIELDS.map(({ key, label }) => (
        <label key={key} className="row" style={{ gap: 4 }}>
          {label}
          <input
            type="number"
            style={{ width: 56 }}
            value={value[key] ?? ""}
            placeholder="—"
            onFocus={() => {
              if (value[key] === null) onChange({ ...value, [key]: 30 });
            }}
            onChange={(e) => {
              const raw = e.target.value;
              onChange({ ...value, [key]: raw === "" ? null : Number(raw) || 0 });
            }}
          />
          фт.
        </label>
      ))}
      {value.fly !== null && (
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={value.hover} onChange={(e) => onChange({ ...value, hover: e.target.checked })} />
          парит
        </label>
      )}
      <input
        placeholder="Доп. заметка"
        value={value.note}
        onChange={(e) => onChange({ ...value, note: e.target.value })}
        style={{ flex: 1, minWidth: 120 }}
      />
    </div>
  );
}

export function SensesEditor({
  value,
  onChange,
  options,
}: {
  value: DndCreatureSense[];
  onChange: (v: DndCreatureSense[]) => void;
  options: DndMechanicsOption[];
}) {
  const [pick, setPick] = useState("");
  const [confirmDialog, confirm] = useConfirm();
  function add() {
    if (!pick || value.some((s) => s.name === pick)) return;
    onChange([...value, { name: pick, distance: pick === "Тёмное зрение" ? "60" : "" }]);
    setPick("");
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
      {confirmDialog}
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {value.map((s) => (
          <span key={s.name} className="row" style={{ gap: 4 }}>
            {s.name}
            <input
              type="number"
              style={{ width: 50 }}
              value={s.distance}
              onChange={(e) => onChange(value.map((v) => (v.name === s.name ? { ...v, distance: e.target.value } : v)))}
            />
            фт.
            <button
              type="button"
              className="comp-mini"
              onClick={async () => {
                if (!(await confirm({ message: `Убрать чувство «${s.name}»?`, confirmLabel: "Убрать", danger: true }))) return;
                onChange(value.filter((v) => v.name !== s.name));
              }}
            >
              <NavIcon name="close" />
            </button>
          </span>
        ))}
      </div>
      <div className="row" style={{ gap: 4 }}>
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">— добавить чувство —</option>
          {options
            .filter((o) => !value.some((v) => v.name === o.name))
            .map((o) => (
              <option key={o.id} value={o.name}>
                {o.name}
              </option>
            ))}
        </select>
        <button type="button" onClick={add} disabled={!pick}>
          +
        </button>
      </div>
    </div>
  );
}

export function ChecklistEditor({
  value,
  onChange,
  options,
  label,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: DndMechanicsOption[];
  label: string;
}) {
  function toggle(name: string) {
    onChange(value.includes(name) ? value.filter((v) => v !== name) : [...value, name]);
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="sb-prop-label">{label}</span>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => (
          <label key={o.id} className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={value.includes(o.name)} onChange={() => toggle(o.name)} />
            {o.name}
          </label>
        ))}
        {options.length === 0 && <span className="muted">Справочник не заполнен.</span>}
      </div>
    </div>
  );
}

// Fetches a compendium spell's mechanical fields and converts them into a
// creature spell's roll-type/bonus/save-DC — same idea as the character
// sheet's fetchSpellMeta, but a creature has no "spell attack bonus" field
// of its own to read live, so the bonus/DC are computed once at add-time
// from the creature's own spellcasting ability + proficiency bonus (passed
// in), matching how spellToAction already treats these fields elsewhere.
async function fetchCreatureSpellMeta(
  entryId: number,
  ability: DndAbilityKey | "",
  proficiencyBonus: number,
  abilities: DndAbilityScores
): Promise<Partial<DndCreatureSpell>> {
  try {
    const entry = await api.get<CompendiumEntry>(`/systems/entries/${entryId}`);
    // Заклинания перешли на структурные броски и эффекты; старые
    // attack_save/damage/healing читаются только у записей, которые ещё не
    // мигрировали (их не осталось после migrateSpellEffects, но чужой
    // импортированный компендиум может быть старым).
    const checks = (entry.data.checks as DndCheck[] | undefined) ?? [];
    const effects = (entry.data.effects as DndEffect[] | undefined) ?? [];
    const attackSave = typeof entry.data.attack_save === "string" ? entry.data.attack_save : "";
    const legacyDamage = typeof entry.data.damage === "string" ? entry.data.damage : "";
    const legacyHealing = typeof entry.data.healing === "string" ? entry.data.healing : "";
    const abilityMod = ability ? abilityModifier(abilities[ability]) : 0;
    let rollType: DndAttackRollType | undefined;
    let bonus: number | null = null;
    let saveAbility: DndAbilityKey | "" = "";
    let saveDC: number | null = null;
    const check = checks[0];
    if (check?.type === "attack" || (!check && attackSave.startsWith("Атака"))) {
      rollType = "attack";
      bonus = abilityMod + proficiencyBonus;
    } else if (check?.type === "save" || (!check && attackSave.startsWith("Спасбросок"))) {
      rollType = "save";
      const abilityName = check?.saveAbility ?? attackSave.replace("Спасбросок", "").trim();
      saveAbility = ABILITY_NAME_TO_KEY[abilityName] ?? "";
      // У существа своя СЛ — от его характеристики и бонуса мастерства, а не
      // та, что была бы у заклинателя; dcOverride перебивает и это.
      saveDC = check?.dcOverride ?? 8 + abilityMod + proficiencyBonus;
    }
    const damage = effects.length > 0 ? effectsLabel(effects) : legacyDamage || legacyHealing;
    return { rollType, bonus, saveAbility, saveDC, damage: damage || undefined, description: entry.description || "" };
  } catch {
    return {};
  }
}

// Строка заклинания в правке. Свёрнутая держит только то, что меняют чаще
// всего — название и частоту; механика (бросок, СЛ, урон) и описание
// разворачиваются по кнопке. Прежняя строка выкладывала все семь полей в один
// ряд, и он переносился по три раза на каждое заклинание.
function CreatureSpellEditRow({
  spell,
  onChange,
  onRemove,
}: {
  spell: DndCreatureSpell;
  onChange: (patch: Partial<DndCreatureSpell>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sbc__spell-edit">
      <div className="sbc__spell-edit-head">
        <input
          className="sbc__spell-edit-name"
          value={spell.name}
          placeholder="Название"
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <select
          value={spell.frequency}
          onChange={(e) => onChange({ frequency: e.target.value as DndCreatureSpellFrequency })}
        >
          <option value="atwill">Бесконечно</option>
          <option value="perday">N раз/день</option>
          <option value="slots">По ячейкам</option>
        </select>
        {spell.frequency === "perday" && (
          <input
            type="number"
            style={{ width: 46 }}
            min={1}
            value={spell.perDayCount ?? 1}
            onChange={(e) => onChange({ perDayCount: Number(e.target.value) || 1 })}
          />
        )}
        <button
          type="button"
          className={`sbc__toggle${open ? " is-on" : ""}`}
          title="Механика и описание"
          onClick={() => setOpen((v) => !v)}
        >
          Подробно
        </button>
        <button type="button" className="comp-mini danger" onClick={onRemove}>
          <NavIcon name="close" />
        </button>
      </div>
      {open && (
        <div className="sbc__form">
          <span className="sbc__form-lab">Бросок</span>
          <select
            value={spell.rollType ?? ""}
            onChange={(e) => onChange({ rollType: (e.target.value || undefined) as DndAttackRollType | undefined })}
            title="Механика для автодобавления в Действия"
          >
            <option value="">Без броска</option>
            <option value="attack">Бросок атаки</option>
            <option value="save">Спасбросок</option>
          </select>
          {spell.rollType === "attack" && (
            <>
              <span className="sbc__form-lab">Бонус</span>
              <input
                type="number"
                value={spell.bonus ?? ""}
                onChange={(e) => onChange({ bonus: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </>
          )}
          {spell.rollType === "save" && (
            <>
              <span className="sbc__form-lab">Спасбросок</span>
              <span className="row" style={{ gap: 6 }}>
                <select
                  value={spell.saveAbility ?? ""}
                  onChange={(e) => onChange({ saveAbility: e.target.value as DndAbilityKey | "" })}
                >
                  <option value="">—</option>
                  {ABILITY_LABELS.map(({ key, label }) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="СЛ"
                  style={{ width: 60 }}
                  value={spell.saveDC ?? ""}
                  onChange={(e) => onChange({ saveDC: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </span>
            </>
          )}
          {spell.rollType && (
            <>
              <span className="sbc__form-lab">Урон</span>
              <input
                placeholder="напр. 8к6 огня"
                value={spell.damage ?? ""}
                onChange={(e) => onChange({ damage: e.target.value })}
              />
            </>
          )}
          <span className="sbc__form-lab">Описание</span>
          <textarea rows={2} value={spell.description} onChange={(e) => onChange({ description: e.target.value })} />
        </div>
      )}
    </div>
  );
}

// One circle (or the cantrips row, level 0) of the creature's spell list —
// mirrors DndSpellLevelSection's compendium-search add flow and PipTrack
// slot display from the character sheet, instead of the free-text-only
// fields this used to have.
function CreatureSpellLevelSection({
  level,
  systemId,
  value,
  onChange,
  ability,
  proficiencyBonus,
  abilities,
}: {
  level: number;
  systemId: number | null;
  value: DndCreatureSpellcasting;
  onChange: (v: DndCreatureSpellcasting) => void;
  ability: DndAbilityKey | "";
  proficiencyBonus: number;
  abilities: DndAbilityScores;
}) {
  const [adding, setAdding] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<DndSpellOption[]>([]);

  useEffect(() => {
    if (!adding || !systemId) return;
    loadDndSpellsByLevel(systemId, level).then(setOptions);
  }, [adding, systemId, level]);

  const slots = value.slots.find((s) => s.level === level)?.slots ?? 0;
  const spellsAtLevel = value.spells.filter((s) => s.level === level);
  const filtered = query.trim() ? options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase())) : options;

  function setSlots(n: number) {
    const exists = value.slots.some((s) => s.level === level);
    const nextSlots = exists
      ? value.slots.map((s) => (s.level === level ? { ...s, slots: n } : s))
      : [...value.slots, { level, slots: n }].sort((a, b) => a.level - b.level);
    onChange({ ...value, slots: nextSlots });
  }
  async function addSpell(entryId: number | null, name: string) {
    setAdding(false);
    setQuery("");
    const meta = entryId ? await fetchCreatureSpellMeta(entryId, ability, proficiencyBonus, abilities) : {};
    onChange({ ...value, spells: [...value.spells, { name, level, frequency: "atwill", perDayCount: null, description: "", ...meta }] });
  }
  function updateSpell(entry: DndCreatureSpell, patch: Partial<DndCreatureSpell>) {
    const idx = value.spells.indexOf(entry);
    onChange({ ...value, spells: value.spells.map((s, i) => (i === idx ? { ...s, ...patch } : s)) });
  }
  async function removeSpell(entry: DndCreatureSpell) {
    const name = entry.name?.trim();
    if (!(await confirm({
      message: name ? `Убрать «${name}» из заклинаний существа?` : "Убрать это заклинание?",
      confirmLabel: "Убрать",
      danger: true,
    }))) return;
    onChange({ ...value, spells: value.spells.filter((s) => s !== entry) });
  }

  const label = level === 0 ? "Заговоры" : `Круг ${level}`;

  return (
    <details className="dnd-spell-level-card" open>
      {confirmDialog}
      <summary className="row dnd-spell-level-summary" style={{ justifyContent: "space-between" }}>
        <span>{label}</span>
        {level > 0 && (
          <span onClick={(e) => e.stopPropagation()} className="row" style={{ gap: 10 }}>
            <PipTrack value={slots} max={9} onChange={setSlots} label={`Ячейки, ${label}`} />
          </span>
        )}
      </summary>
      <div className="stack" style={{ marginTop: 6, gap: 4 }}>
        {spellsAtLevel.length === 0 && <span className="muted">Пусто</span>}
        {spellsAtLevel.map((s) => (
          <CreatureSpellEditRow
            key={value.spells.indexOf(s)}
            spell={s}
            onChange={(patch) => updateSpell(s, patch)}
            onRemove={() => removeSpell(s)}
          />
        ))}
        {adding ? (
          <div className="dnd-spell-add">
            <input
              autoFocus
              placeholder="Название заклинания…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim()) addSpell(null, query.trim());
                if (e.key === "Escape") setAdding(false);
              }}
            />
            {filtered.length > 0 && (
              <div className="mention-dropdown">
                {filtered.slice(0, 8).map((o) => (
                  <div
                    key={o.id}
                    className="mention-dropdown-item"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addSpell(o.id, o.name);
                    }}
                  >
                    {o.name}
                  </div>
                ))}
              </div>
            )}
            <button type="button" onClick={() => setAdding(false)}>
              Отмена
            </button>
          </div>
        ) : (
          <button type="button" className="comp-mini" onClick={() => setAdding(true)} style={{ alignSelf: "flex-start" }}>
            + Добавить заклинание
          </button>
        )}
      </div>
    </details>
  );
}

export function SpellcastingEditor({
  value,
  onChange,
  systemId,
  abilities,
  proficiencyBonus,
}: {
  value: DndCreatureSpellcasting;
  onChange: (v: DndCreatureSpellcasting) => void;
  systemId: number | null;
  abilities: DndAbilityScores;
  proficiencyBonus: number;
}) {
  const maxCircle = value.slots.length > 0 ? Math.max(...value.slots.map((s) => s.level)) : 0;

  function setMaxCircle(n: number) {
    if (n === 0) {
      onChange({ ...value, slots: [] });
      return;
    }
    const nextSlots = [];
    for (let l = 1; l <= n; l++) {
      nextSlots.push(value.slots.find((s) => s.level === l) ?? { level: l, slots: 1 });
    }
    onChange({ ...value, slots: nextSlots });
  }

  return (
    <div className="stack">
      <label className="row" style={{ gap: 6 }}>
        <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />
        Есть заклинательная способность
      </label>
      {value.enabled && (
        <>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="row" style={{ gap: 6 }}>
              Основная характеристика
              <select value={value.ability} onChange={(e) => onChange({ ...value, ability: e.target.value as DndAbilityKey | "" })}>
                <option value="">—</option>
                {ABILITY_LABELS.map(({ key, label }) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="row" style={{ gap: 6 }}>
              Кругов заклинаний
              <select value={maxCircle} onChange={(e) => setMaxCircle(Number(e.target.value))}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "Нет" : n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <CreatureSpellLevelSection
              level={0}
              systemId={systemId}
              value={value}
              onChange={onChange}
              ability={value.ability}
              proficiencyBonus={proficiencyBonus}
              abilities={abilities}
            />
            {Array.from({ length: maxCircle }, (_, i) => i + 1).map((l) => (
              <CreatureSpellLevelSection
                key={l}
                level={l}
                systemId={systemId}
                value={value}
                onChange={onChange}
                ability={value.ability}
                proficiencyBonus={proficiencyBonus}
                abilities={abilities}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function spellToAction(spell: DndCreatureSpell): DndCreatureAction {
  return {
    name: spell.name,
    category: "attack",
    rollType: spell.rollType,
    bonus: spell.bonus,
    saveAbility: spell.saveAbility,
    saveDC: spell.saveDC,
    damage: spell.damage,
    description: spell.description,
    sourceSpellName: spell.name,
  };
}

const ACTION_CATEGORY_LABELS: Record<DndActionCategory, string> = {
  attack: "Атака",
  movement: "Движение",
  healing: "Лечение",
  defense: "Защита",
  other: "Иное",
};

function emptyAction(): DndCreatureAction {
  return { name: "", category: "other", description: "" };
}

// Shared editor for actions/bonusActions/reactions and (with costEditable)
// legendary actions/lair actions — a new type from `DndFeature` on purpose,
// since `DndFeature` is also used by the character sheet's own feature
// lists and mustn't gain attack-mechanic fields those don't need.
export function ActionListEdit<T extends DndCreatureAction>({
  title,
  values,
  onChange,
  headerColorClass,
  costEditable,
  abilities,
  proficiencyBonus,
}: {
  title: string;
  values: T[];
  onChange: (v: T[]) => void;
  headerColorClass?: string;
  costEditable?: boolean;
  abilities: DndAbilityScores;
  proficiencyBonus: number | null;
}) {
  const [confirmDialog, confirm] = useConfirm();
  function update(i: number, patch: Partial<DndCreatureAction> & { cost?: number }) {
    onChange(values.map((a, idx) => (idx === i ? ({ ...a, ...patch } as T) : a)));
  }
  async function remove(i: number) {
    const name = values[i]?.name?.trim();
    if (!(await confirm({
      message: name ? `Удалить действие «${name}»?` : "Удалить это действие?",
      confirmLabel: "Удалить",
      danger: true,
    }))) return;
    onChange(values.filter((_, idx) => idx !== i));
  }
  function add() {
    const next = costEditable ? { ...emptyAction(), cost: 1 } : emptyAction();
    onChange([...values, next as T]);
  }
  function autoDC(i: number) {
    const a = values[i];
    if (!a.saveAbility) return;
    const dc = 8 + (proficiencyBonus ?? 0) + abilityModifier(abilities[a.saveAbility as DndAbilityKey]);
    update(i, { saveDC: dc });
  }
  return (
    <div className="stack">
      {confirmDialog}
      <div className={`dnd-feature-header ${headerColorClass ?? ""}`}>{title}</div>
      {values.map((a, i) => (
        <div key={i} className="stack dnd-card" style={{ gap: 6 }}>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            <input
              placeholder="Название"
              value={a.name}
              onChange={(e) => update(i, { name: e.target.value })}
              style={{ flex: 1, minWidth: 120 }}
            />
            <select value={a.category} onChange={(e) => update(i, { category: e.target.value as DndActionCategory })}>
              {Object.entries(ACTION_CATEGORY_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            {costEditable && (
              <label className="row" style={{ gap: 4 }}>
                Стоимость
                <input
                  type="number"
                  style={{ width: 44 }}
                  value={(a as unknown as DndLegendaryActionEntry).cost ?? 1}
                  onChange={(e) => update(i, { cost: Number(e.target.value) || 0 })}
                />
              </label>
            )}
            <button type="button" className="comp-mini" onClick={() => remove(i)}>
              <NavIcon name="close" />
            </button>
          </div>
          {a.category === "attack" && (
            <div className="row" style={{ flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <label className="row" style={{ gap: 4 }}>
                <input type="checkbox" checked={!!a.isMultiattack} onChange={(e) => update(i, { isMultiattack: e.target.checked })} />
                Мультиатака
              </label>
              {!a.isMultiattack && (
                <>
                  <select value={a.rollType ?? "attack"} onChange={(e) => update(i, { rollType: e.target.value as DndAttackRollType })}>
                    <option value="attack">Бросок атаки</option>
                    <option value="save">Спасбросок</option>
                  </select>
                  {(a.rollType ?? "attack") === "attack" ? (
                    <label className="row" style={{ gap: 4 }}>
                      Бонус
                      <input
                        type="number"
                        style={{ width: 50 }}
                        value={a.bonus ?? ""}
                        onChange={(e) => update(i, { bonus: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </label>
                  ) : (
                    <>
                      <select value={a.saveAbility ?? ""} onChange={(e) => update(i, { saveAbility: e.target.value as DndAbilityKey | "" })}>
                        <option value="">—</option>
                        {ABILITY_LABELS.map(({ key, label }) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <label className="row" style={{ gap: 4 }}>
                        СЛ
                        <input
                          type="number"
                          style={{ width: 50 }}
                          value={a.saveDC ?? ""}
                          onChange={(e) => update(i, { saveDC: e.target.value === "" ? null : Number(e.target.value) })}
                        />
                      </label>
                      <button type="button" onClick={() => autoDC(i)}>
                        Авто
                      </button>
                    </>
                  )}
                  <input
                    placeholder="Урон, напр. 2к6+3 рубящий"
                    value={a.damage ?? ""}
                    onChange={(e) => update(i, { damage: e.target.value })}
                    style={{ flex: 1, minWidth: 140 }}
                  />
                </>
              )}
            </div>
          )}
          <MentionTextarea value={a.description} onChange={(v) => update(i, { description: v })} rows={2} placeholder="Описание" />
        </div>
      ))}
      <button type="button" onClick={add} style={{ alignSelf: "flex-start" }}>
        + действие
      </button>
    </div>
  );
}

// One-click helper: pull a spell not yet turned into an action row (tracked
// via sourceSpellName) into the actions list, copying its already-filled
// attack/save/damage fields — see spellToAction above.
export function AddSpellActionButton({
  spells,
  actions,
  onAdd,
}: {
  spells: DndCreatureSpell[];
  actions: DndCreatureAction[];
  onAdd: (a: DndCreatureAction) => void;
}) {
  const [pick, setPick] = useState("");
  const available = spells.filter((s) => s.name && !actions.some((a) => a.sourceSpellName === s.name));
  if (spells.length === 0) return null;
  return (
    <div className="row" style={{ gap: 4 }}>
      <select value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">— добавить из заклинаний —</option>
        {available.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!pick}
        onClick={() => {
          const spell = spells.find((s) => s.name === pick);
          if (spell) onAdd(spellToAction(spell));
          setPick("");
        }}
      >
        Добавить
      </button>
    </div>
  );
}

export function LegendaryEditor({
  value,
  onChange,
  abilities,
  proficiencyBonus,
}: {
  value: DndCreatureLegendary;
  onChange: (v: DndCreatureLegendary) => void;
  abilities: DndAbilityScores;
  proficiencyBonus: number | null;
}) {
  return (
    <div className="stack">
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={value.resistanceEnabled}
          onChange={(e) => onChange({ ...value, resistanceEnabled: e.target.checked })}
        />
        Легендарные сопротивления
      </label>
      {value.resistanceEnabled && (
        <label className="row" style={{ gap: 4 }}>
          Количество в день
          <input
            type="number"
            style={{ width: 50 }}
            value={value.resistanceCount ?? ""}
            onChange={(e) => onChange({ ...value, resistanceCount: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </label>
      )}

      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={value.actionsEnabled}
          onChange={(e) => onChange({ ...value, actionsEnabled: e.target.checked })}
        />
        Легендарные действия
      </label>
      {value.actionsEnabled && (
        <>
          <label className="row" style={{ gap: 4 }}>
            Очков за раунд
            <input
              type="number"
              style={{ width: 50 }}
              value={value.actionPoints ?? ""}
              onChange={(e) => onChange({ ...value, actionPoints: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>
          <ActionListEdit
            title="Легендарные действия"
            values={value.actions}
            onChange={(v) => onChange({ ...value, actions: v })}
            headerColorClass="dnd-header-legendary"
            costEditable
            abilities={abilities}
            proficiencyBonus={proficiencyBonus}
          />
        </>
      )}

      <label className="row" style={{ gap: 6 }}>
        <input type="checkbox" checked={value.lairEnabled} onChange={(e) => onChange({ ...value, lairEnabled: e.target.checked })} />
        Действия логова
      </label>
      {value.lairEnabled && (
        <ActionListEdit
          title="Действия логова"
          values={value.lairActions}
          onChange={(v) => onChange({ ...value, lairActions: v })}
          headerColorClass="dnd-header-legendary"
          abilities={abilities}
          proficiencyBonus={proficiencyBonus}
        />
      )}
    </div>
  );
}

function readSearchDrop(e: DragEvent): SearchResult | null {
  const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SearchResult;
  } catch {
    return null;
  }
}

function emptyEquipmentItem(): DndCreatureEquipmentItem {
  return { name: "", qty: "", notes: "" };
}

// Special/notable gear a creature carries — deliberately much simpler than
// the character-side DndEquipmentItem (no cached armor/weapon fields for
// computing AC/attacks: a creature's AC and attacks are already
// hand-authored via the armorClass field / ActionListEdit above).
export function EquipmentEditor({
  value,
  onChange,
  systemId,
}: {
  value: DndCreatureEquipmentItem[];
  onChange: (v: DndCreatureEquipmentItem[]) => void;
  systemId: number | null;
}) {
  const [addMode, setAddMode] = useState<"compendium" | "bag" | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CompendiumEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const { items: bagItems } = useBag();

  useEffect(() => {
    if (addMode !== "compendium" || !systemId) return;
    loadDndEquipmentEntries(systemId).then(setOptions);
  }, [addMode, systemId]);

  function update(i: number, patch: Partial<DndCreatureEquipmentItem>) {
    onChange(value.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  async function remove(i: number) {
    const name = value[i]?.name?.trim();
    if (!(await confirm({
      message: name ? `Убрать «${name}» из снаряжения?` : "Убрать эту вещь?",
      confirmLabel: "Убрать",
      danger: true,
    }))) return;
    onChange(value.filter((_, idx) => idx !== i));
  }
  function append(item: DndCreatureEquipmentItem) {
    onChange([...value, item]);
    setAddMode(null);
    setQuery("");
  }
  function addFromSearch(result: SearchResult) {
    const isEquipment = result.type === "compendium_entry" && (result.kind === "equipment" || result.kind === "magic_item");
    append({ name: result.title, qty: "", notes: "", entryId: isEquipment ? result.id : null });
  }
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const result = readSearchDrop(e);
    if (result) addFromSearch(result);
  }

  const filteredOptions = query.trim() ? options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase())) : options;

  return (
    <div
      className={`stack${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {confirmDialog}
      <div className="dnd-feature-header">Снаряжение</div>
      {value.map((item, i) => (
        <div key={i} className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input placeholder="Название" value={item.name} onChange={(e) => update(i, { name: e.target.value })} style={{ flex: 1, minWidth: 120 }} />
          <input placeholder="Кол-во" value={item.qty} onChange={(e) => update(i, { qty: e.target.value })} style={{ width: 70 }} />
          <input placeholder="Заметки" value={item.notes} onChange={(e) => update(i, { notes: e.target.value })} style={{ flex: 1, minWidth: 120 }} />
          <button type="button" className="comp-mini" onClick={() => remove(i)}>
            <NavIcon name="close" />
          </button>
        </div>
      ))}
      {addMode === "compendium" ? (
        <div className="dnd-spell-add">
          <input autoFocus placeholder="Название предмета…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {filteredOptions.length > 0 && (
            <div className="mention-dropdown">
              {filteredOptions.slice(0, 8).map((o) => (
                <div
                  key={o.id}
                  className="mention-dropdown-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    append({ name: o.name, qty: "", notes: "", entryId: o.id });
                  }}
                >
                  {o.name}
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setAddMode(null)}>
            Отмена
          </button>
        </div>
      ) : addMode === "bag" ? (
        <div className="stack" style={{ gap: 4 }}>
          {bagItems.length === 0 && <span className="muted">Мешок пуст.</span>}
          {bagItems.map((b, bi) => (
            <button key={bi} type="button" className="comp-mini" style={{ alignSelf: "flex-start" }} onClick={() => addFromSearch(b)}>
              {b.title}
            </button>
          ))}
          <button type="button" onClick={() => setAddMode(null)}>
            Отмена
          </button>
        </div>
      ) : (
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          <button type="button" onClick={() => append(emptyEquipmentItem())}>
            + Свой
          </button>
          <button type="button" onClick={() => setAddMode("compendium")}>
            + Из компендиума
          </button>
          <button type="button" onClick={() => setAddMode("bag")}>
            + Из мешка
          </button>
        </div>
      )}
    </div>
  );
}

export function LootEditor({ value, onChange }: { value: DndCreatureLoot; onChange: (v: DndCreatureLoot) => void }) {
  const [rolled, setRolled] = useState<Record<number, number>>({});
  const [confirmDialog, confirm] = useConfirm();

  function addItem() {
    onChange({ ...value, items: [...value.items, { name: "", qty: "" }] });
  }
  function updateItem(i: number, patch: Partial<{ name: string; qty: string }>) {
    onChange({ ...value, items: value.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
  }
  async function removeItem(i: number) {
    const name = value.items[i]?.name?.trim();
    if (!(await confirm({
      message: name ? `Убрать «${name}» из добычи?` : "Убрать эту вещь из добычи?",
      confirmLabel: "Убрать",
      danger: true,
    }))) return;
    onChange({ ...value, items: value.items.filter((_, idx) => idx !== i) });
  }
  function addCurrency() {
    onChange({ ...value, currency: [...value.currency, { label: "", formula: "" }] });
  }
  function updateCurrency(i: number, patch: Partial<{ label: string; formula: string }>) {
    onChange({ ...value, currency: value.currency.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  }
  async function removeCurrency(i: number) {
    const label = value.currency[i]?.label?.trim();
    if (!(await confirm({
      message: label ? `Убрать «${label}» из добычи?` : "Убрать эту строку монет?",
      confirmLabel: "Убрать",
      danger: true,
    }))) return;
    onChange({ ...value, currency: value.currency.filter((_, idx) => idx !== i) });
  }
  function roll(i: number) {
    const result = rollDiceFormula(value.currency[i].formula);
    if (result !== null) setRolled((r) => ({ ...r, [i]: result }));
  }

  return (
    <div className="stack">
      {confirmDialog}
      <div className="dnd-feature-header">Лут</div>
      <div className="stack" style={{ gap: 4 }}>
        <span className="sb-prop-label">Предметы</span>
        {value.items.map((it, i) => (
          <div key={i} className="row" style={{ gap: 6 }}>
            <input placeholder="Название" value={it.name} onChange={(e) => updateItem(i, { name: e.target.value })} style={{ flex: 1 }} />
            <input placeholder="Кол-во" value={it.qty} onChange={(e) => updateItem(i, { qty: e.target.value })} style={{ width: 70 }} />
            <button type="button" className="comp-mini" onClick={() => removeItem(i)}>
              <NavIcon name="close" />
            </button>
          </div>
        ))}
        <button type="button" onClick={addItem} style={{ alignSelf: "flex-start" }}>
          + предмет
        </button>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <span className="sb-prop-label">Валюта</span>
        {value.currency.map((c, i) => {
          const avg = averageDiceFormula(c.formula);
          return (
            <div key={i} className="row" style={{ gap: 6, alignItems: "center" }}>
              <input placeholder="ЗМ" value={c.label} onChange={(e) => updateCurrency(i, { label: e.target.value })} style={{ width: 60 }} />
              <input
                placeholder="напр. 3к100+30"
                value={c.formula}
                onChange={(e) => updateCurrency(i, { formula: e.target.value })}
                style={{ width: 120 }}
              />
              {avg !== null && <span className="muted">≈ {avg}</span>}
              <button type="button" onClick={() => roll(i)} disabled={avg === null}>
                <NavIcon name="die" /> Бросить
              </button>
              {rolled[i] !== undefined && <span className="muted">→ {rolled[i]}</span>}
              <button type="button" className="comp-mini" onClick={() => removeCurrency(i)}>
                <NavIcon name="close" />
              </button>
            </div>
          );
        })}
        <button type="button" onClick={addCurrency} style={{ alignSelf: "flex-start" }}>
          + валюта
        </button>
      </div>
    </div>
  );
}

// Renders an action's mechanical line the way real 5e statblocks phrase it
// ("Бросок атаки +5, Урон 2к6+3 рубящий" / "Спасбросок Телосложение СЛ 14"),
// blank for multiattack rows (their description carries the summary text)
// and for non-attack categories.
function formatAction(a: DndCreatureAction): string {
  if (a.category !== "attack" || a.isMultiattack) return "";
  const parts: string[] = [];
  if (a.rollType === "save") {
    const abilityLabel = a.saveAbility ? ABILITY_LABELS.find((x) => x.key === a.saveAbility)?.label : "";
    if (a.saveDC !== null && a.saveDC !== undefined) parts.push(`Спасбросок ${abilityLabel ?? ""} СЛ ${a.saveDC}`.trim());
  } else if (a.bonus !== null && a.bonus !== undefined) {
    parts.push(`Бросок атаки ${formatModifier(a.bonus)}`);
  }
  if (a.damage) parts.push(`Урон ${a.damage}`);
  return parts.join(", ");
}

export function formatSpeed(speed: DndCreatureSpeed): string {
  const parts: string[] = [];
  if (speed.walk !== null) parts.push(`${speed.walk} фт.`);
  if (speed.fly !== null) parts.push(`полёт ${speed.fly} фт.${speed.hover ? " (парит)" : ""}`);
  if (speed.swim !== null) parts.push(`плавание ${speed.swim} фт.`);
  if (speed.climb !== null) parts.push(`лазание ${speed.climb} фт.`);
  if (speed.burrow !== null) parts.push(`копание ${speed.burrow} фт.`);
  if (speed.note) parts.push(speed.note);
  return parts.join(", ");
}

// Среднее число хитов — то, чем Мастер пользуется за столом.
export function hitPointsAverage(hp: DndCreatureHitPoints): string {
  if (hp.diceCount && hp.dieSize) {
    return String(Math.floor(hp.diceCount * (hp.dieSize / 2 + 0.5)) + (hp.bonus ?? 0));
  }
  return hp.formula || "";
}

// Кости и постоянный бонус — происхождение числа. У высоких костей с большим
// бонусом («19к12+133») строка вдвое длиннее самого числа и разносила пару
// «КЗ | Хиты», поэтому в статблоке она печатается отдельно и мельче.
export function hitPointsDice(hp: DndCreatureHitPoints): string {
  if (!hp.diceCount || !hp.dieSize) return "";
  const bonusStr = hp.bonus ? (hp.bonus >= 0 ? `+${hp.bonus}` : `${hp.bonus}`) : "";
  return `${hp.diceCount}к${hp.dieSize}${bonusStr}`;
}

export function formatHitPoints(hp: DndCreatureHitPoints): string {
  const dice = hitPointsDice(hp);
  const avg = hitPointsAverage(hp);
  return dice ? `${avg} (${dice})` : avg;
}

export function formatArmorClass(ac: DndCreatureArmorClass): string {
  if (ac.value === null) return ac.note || "—";
  return ac.note ? `${ac.value} (${ac.note})` : String(ac.value);
}

function formatSpellFrequency(s: DndCreatureSpell): string {
  if (s.frequency === "atwill") return "бесконечно";
  if (s.frequency === "perday") return `${s.perDayCount ?? 1}/день`;
  return "по ячейкам";
}

// ====================================================================
// Статблок существа — полный рабочий лист боя (design_revision.md, шаг 6).
//
// Быстрый взгляд занят карточкой существа (шаг 4), и переход между ними
// односторонний: из карточки кнопкой «Статблок». Поэтому порядок здесь
// боевой, а не справочный, а секция, которой нечего показать, не рисуется
// вовсе (§1.11).
// ====================================================================

type SbcSectionId =
  | "legendary"
  | "defense"
  | "traits"
  | "actions"
  | "bonus"
  | "reactions"
  | "spells"
  | "gear"
  | "notes";

const SBC_SECTIONS: { id: SbcSectionId; title: string }[] = [
  { id: "legendary", title: "Легендарное" },
  { id: "defense", title: "Защита и чувства" },
  { id: "traits", title: "Черты" },
  { id: "actions", title: "Действия" },
  { id: "bonus", title: "Бонусные действия" },
  { id: "reactions", title: "Реакции" },
  { id: "spells", title: "Заклинания" },
  { id: "gear", title: "Снаряжение и лут" },
  { id: "notes", title: "Заметки" },
];

// Узкая раскладка группирует девять секций в пять разделов: за столом
// «действия, бонусные и реакции» — один вопрос, а не три.
const SBC_SEGMENTS: { id: string; label: string; sections: SbcSectionId[] }[] = [
  { id: "legendary", label: "Легенд.", sections: ["legendary"] },
  { id: "defense", label: "Защита", sections: ["defense"] },
  { id: "traits", label: "Черты", sections: ["traits"] },
  { id: "actions", label: "Действия", sections: ["actions", "bonus", "reactions"] },
  { id: "rest", label: "Прочее", sections: ["spells", "gear", "notes"] },
];

function sectionHasContent(v: DndCreatureData, id: SbcSectionId): boolean {
  switch (id) {
    case "legendary":
      return v.legendary.resistanceEnabled || v.legendary.actionsEnabled || v.legendary.lairEnabled;
    case "defense":
      return (
        v.damageVulnerabilities.length > 0 ||
        v.damageResistances.length > 0 ||
        v.damageImmunities.length > 0 ||
        v.conditionImmunities.length > 0 ||
        v.saveAdvantageConditions.length > 0 ||
        v.saveAdvantageMagic ||
        !!v.defenseNotes ||
        v.sensesList.length > 0 ||
        v.passivePerception !== null ||
        !!v.perceptionNote ||
        !!v.languages
      );
    case "traits":
      return v.traits.length > 0;
    case "actions":
      return v.actions.length > 0;
    case "bonus":
      return v.bonusActions.length > 0;
    case "reactions":
      return v.reactions.length > 0;
    case "spells":
      return v.spellcasting.enabled;
    case "gear":
      return (
        v.equipment.length > 0 ||
        v.loot.items.length > 0 ||
        v.loot.currency.length > 0 ||
        !!v.habitat ||
        !!v.treasure
      );
    case "notes":
      return !!v.notes;
  }
}

function SbcRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sbc__row">
      <span className="sbc__lab">{label}</span>
      <span className="sbc__val">{children}</span>
    </div>
  );
}

function SbcEntry({ name, mech, description }: { name?: string; mech?: string; description: string }) {
  return (
    <div className="sbc__entry">
      {name && <span className="sbc__ename">{name}.</span>}
      {mech && <span className="sbc__mech"> {mech}.</span>}{" "}
      <MentionText text={description} />
    </div>
  );
}

// Короткая выкладка заклинания — то, ради чего у заклинания заведены
// отдельные поля механики: частота, бросок и урон одной строкой, чтобы за
// столом не приходилось разворачивать описание.
function creatureSpellMech(s: DndCreatureSpell): string {
  const parts: string[] = [formatSpellFrequency(s)];
  if (s.rollType === "attack" && s.bonus !== null && s.bonus !== undefined) {
    parts.push(`атака ${formatModifier(s.bonus)}`);
  } else if (s.rollType === "save" && s.saveDC) {
    const ab = s.saveAbility ? ABILITY_LABELS.find((a) => a.key === s.saveAbility)?.label : "";
    parts.push(`СЛ ${s.saveDC}${ab ? ` ${ab}` : ""}`);
  }
  if (s.damage) parts.push(s.damage);
  return parts.join(" · ");
}

// Ячейки — квадратами, а не кружками: §1.1, кругов система не рисует
// (PipTrack листа персонажа — вокабуляр LitM, его разбор ещё не дошёл).
function SbcSlots({ count }: { count: number }) {
  return (
    <span className="sbc__slots" title={`Ячеек: ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="sbc__slot" />
      ))}
      <span className="sbc__slot-count">{count}</span>
    </span>
  );
}

function SbcSpellRow({ spell }: { spell: DndCreatureSpell }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!spell.description.trim();
  return (
    <div className="sbc__spell">
      <div
        className={`sbc__spell-row${hasDetail ? " is-toggle" : ""}`}
        onClick={hasDetail ? () => setOpen((v) => !v) : undefined}
      >
        <span className="sbc__spell-name">{spell.name || "Без названия"}</span>
        <span className="sbc__spell-meta">{creatureSpellMech(spell)}</span>
        {hasDetail && <NavIcon name="chevron" className={`chevron-icon${open ? " is-open" : ""}`} />}
      </div>
      {open && hasDetail && (
        <div className="sbc__spell-desc">
          <MentionText text={spell.description} />
        </div>
      )}
    </div>
  );
}

// Круг заклинаний в просмотре: подпись, ячейки квадратами, свёрнутые строки.
// Круг, в котором ничего нет и ячеек нет, не печатается вовсе (§1.11).
function SbcSpellLevel({ level, slots, spells }: { level: number; slots: number; spells: DndCreatureSpell[] }) {
  return (
    <details className="sbc__spell-level" open>
      <summary className="sbc__spell-level-head">
        <span>{level === 0 ? "Заговоры" : `${level} круг`}</span>
        {slots > 0 && <SbcSlots count={slots} />}
      </summary>
      <div className="sbc__spells">
        {spells.map((s, i) => (
          <SbcSpellRow key={i} spell={s} />
        ))}
      </div>
    </details>
  );
}

function SbcActionList({ values }: { values: DndCreatureAction[] }) {
  return (
    <>
      {values.map((a, i) => (
        <SbcEntry key={i} name={a.name || undefined} mech={formatAction(a) || undefined} description={a.description} />
      ))}
    </>
  );
}

// Кость характеристики — две грани, как у монеты: главное число (модификатор
// или само значение, настройка во «Внешнем виде») и спасбросок. Клик
// переворачивает ОДНУ кость: у Ловкости свой спасбросок, у остальных
// характеристик его нет, и переворачивать шесть, чтобы посмотреть один,
// незачем.
//
// Владение спасбросоком показано ЗАЛИВКОЙ, а не оттенком: в «Соевом нуаре»
// --accent равен чернилам (themes.ts), и акцентный контур там не отличался
// бы ни от чего — тот же дефект уже ловили в календаре на шаге 1. Скачок
// «контур → заливка» читается в любом режиме и на ч/б печати.
const SBC_DIE_POINTS = "50,3 92,27 92,73 50,97 8,73 8,27";

function AbilityDie({
  label,
  score,
  mod,
  save,
  prof,
  primary,
}: {
  label: string;
  score: number;
  mod: number;
  save: number;
  prof: boolean;
  primary: DndAbilityPrimary;
}) {
  const [flipped, setFlipped] = useState(false);
  const main = primary === "score" ? String(score) : formatModifier(mod);
  const under = primary === "score" ? formatModifier(mod) : String(score);
  return (
    <button
      type="button"
      className={`sbc__die${prof ? " is-prof" : ""}`}
      onClick={() => setFlipped((v) => !v)}
      title={flipped ? `${label}: спасбросок ${formatModifier(save)}` : `${label}: показать спасбросок`}
    >
      <span className="sbc__die-shape">
        <svg width="42" height="42" viewBox="0 0 100 100" aria-hidden="true">
          <polygon
            points={SBC_DIE_POINTS}
            fill={prof ? "var(--accent)" : "none"}
            stroke={prof ? "var(--accent)" : "var(--ink)"}
            strokeWidth="7"
          />
        </svg>
        <span className="sbc__die-num">{flipped ? formatModifier(save) : main}</span>
      </span>
      <span className="sbc__die-lab">{flipped ? "спас" : `${label} ${under}`}</span>
    </button>
  );
}

function SbcSectionHead({
  title,
  editing,
  onToggleEdit,
}: {
  title: string;
  editing: boolean;
  onToggleEdit?: () => void;
}) {
  return (
    <div className="sbc__sec">
      <span>{title}</span>
      {onToggleEdit && (
        <span className="sbc__sec-tools">
          <button type="button" className={`sbc__toggle${editing ? " is-on" : ""}`} onClick={onToggleEdit}>
            {editing ? "Готово" : "Править"}
          </button>
        </span>
      )}
    </div>
  );
}

export function DndCreatureView({
  value,
  onQuickUpdate,
  collapsed,
  headerExtra,
  onHeaderClick,
  avatarUrl,
  onAvatarUpload,
  avatarUploading,
}: {
  value: DndCreatureData;
  // Правка идёт ПО МЕСТУ, по секциям: форма-простыня (DndCreatureEdit)
  // удалена вместе с темами — держать два интерфейса правки одного и того
  // же существа значило гарантированно их разойтись.
  onQuickUpdate?: (patch: Partial<DndCreatureData>) => void;
  collapsed?: boolean;
  headerExtra?: ReactNode;
  onHeaderClick?: () => void;
  avatarUrl?: string | null;
  onAvatarUpload?: (file: File) => void;
  avatarUploading?: boolean;
}) {
  const prefs = useDndPrefs();
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Порог раскладки считается ПО КОНТЕЙНЕРУ, а не по окну: на шаге 2
  // медиазапрос по окну уже соврал — колонка контента была 501 при окне 1100.
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = (w: number) => {
      if (w > 0) setNarrow(w < 900);
    };
    // Меряем сразу, а не ждём наблюдателя: ResizeObserver не присылает первый
    // отчёт, пока окно не рисует кадры (свёрнутое окно, фоновая вкладка,
    // скрытая панель), и статблок оставался бы в широкой раскладке, даже
    // будучи узким.
    measure(el.getBoundingClientRect().width);
    // Пересчёт по окну — дешёвая подстраховка на тот же случай: окно
    // развернули, кадры пошли, а наблюдатель ещё спит.
    const onResize = () => measure(el.getBoundingClientRect().width);
    window.addEventListener("resize", onResize);
    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", onResize);
    }
    const ro = new ResizeObserver((entries) => measure(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, []);

  const [editing, setEditing] = useState<SbcSectionId | "side" | null>(null);
  // Секция, которой нечего показать, не рисуется — но завести первую черту
  // как-то надо. «Раскрытые» секции держатся только на время сеанса правки.
  const [revealed, setRevealed] = useState<SbcSectionId[]>([]);
  const [seg, setSeg] = useState<string | null>(null);

  const [damageTypes, setDamageTypes] = useState<DndMechanicsOption[]>([]);
  const [conditions, setConditions] = useState<DndMechanicsOption[]>([]);
  const [senseOptions, setSenseOptions] = useState<DndMechanicsOption[]>([]);
  const [creatureTypeOptions, setCreatureTypeOptions] = useState<DndMechanicsOption[]>([]);
  const [alignmentOptions, setAlignmentOptions] = useState<DndMechanicsOption[]>([]);
  const [systemId, setSystemId] = useState<number | null>(null);

  useEffect(() => {
    if (!onQuickUpdate) return;
    findDndSystemId().then((sid) => {
      setSystemId(sid);
      if (!sid) return;
      loadDndMechanicsGroup(sid, "Типы урона").then(setDamageTypes);
      loadDndMechanicsGroup(sid, "Состояния").then(setConditions);
      loadDndMechanicsGroup(sid, "Особое восприятие").then(setSenseOptions);
      loadDndMechanicsGroup(sid, MECHANICS_CREATURE_TYPE_GROUP).then(setCreatureTypeOptions);
      loadDndMechanicsGroup(sid, MECHANICS_ALIGNMENT_GROUP).then(setAlignmentOptions);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!onQuickUpdate]);

  const patch = (p: Partial<DndCreatureData>) => onQuickUpdate?.(p);
  function toggleSkill(skill: string) {
    patch({ skillProfs: { ...value.skillProfs, [skill]: !value.skillProfs[skill] } });
  }
  function toggleSave(key: DndAbilityKey) {
    patch({ savingThrowProfs: { ...value.savingThrowProfs, [key]: !value.savingThrowProfs[key] } });
  }
  function toggleSaveAdvantageCondition(name: string) {
    const list = value.saveAdvantageConditions.includes(name)
      ? value.saveAdvantageConditions.filter((c) => c !== name)
      : [...value.saveAdvantageConditions, name];
    patch({ saveAdvantageConditions: list });
  }

  const pb = value.challenge.proficiencyBonus ?? 0;
  const metaParts = [
    [value.size, value.creatureType].filter(Boolean).join(" "),
    value.alignment,
  ].filter(Boolean);
  const crText = value.challenge.rating
    ? `КО ${value.challenge.rating}${pb ? ` (БМ +${pb})` : ""}`
    : "КО —";

  const skillList = Object.entries(value.skillProfs)
    .filter(([, on]) => on)
    .map(([skill]) => {
      const ab = SKILL_ABILITY[skill];
      const bonus = ab ? abilityModifier(value.abilities[ab]) + pb : 0;
      return `${skill} ${formatModifier(bonus)}`;
    });
  const sensesText = [
    ...value.sensesList.map((s) => `${s.name}${s.distance ? ` ${s.distance} фт.` : ""}`),
    value.passivePerception !== null ? `пассивная внимательность ${value.passivePerception}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const advantageParts = [...value.saveAdvantageConditions, value.saveAdvantageMagic ? "магии" : ""].filter(Boolean);

  // Круги, которым есть что показать: заклинания этого круга или его ячейки.
  const spellLevels = Array.from(
    new Set([
      ...value.spellcasting.spells.map((s) => s.level),
      ...value.spellcasting.slots.filter((s) => s.slots > 0).map((s) => s.level),
    ])
  )
    .sort((a, b) => a - b)
    .map((level) => ({
      level,
      slots: value.spellcasting.slots.find((s) => s.level === level)?.slots ?? 0,
      spells: value.spellcasting.spells.filter((s) => s.level === level),
    }));

  const visible = SBC_SECTIONS.filter((s) => sectionHasContent(value, s.id) || revealed.includes(s.id));
  const absent = SBC_SECTIONS.filter((s) => !sectionHasContent(value, s.id) && !revealed.includes(s.id));
  const segments = SBC_SEGMENTS.filter((g) => visible.some((s) => g.sections.includes(s.id)));
  const activeSeg =
    segments.find((g) => g.id === seg) ?? segments.find((g) => g.id === "actions") ?? segments[0] ?? null;
  const shown = narrow && activeSeg ? visible.filter((s) => activeSeg.sections.includes(s.id)) : visible;

  // Портрет статблока — свой, отдельный от аватара сущности (§1.13, дуотон
  // на него не идёт). Широко он стоит крупным кадром в остатке левой
  // колонки, и миниатюры в шапке тогда нет: один арт не работает дважды на
  // одном экране (тот же довод снял фоновый слой главной на шаге 1).
  const hasPortrait = !!avatarUrl || !!onAvatarUpload;
  const bigPortrait = hasPortrait && !narrow;

  function portrait(className: string) {
    const inner = avatarUrl ? (
      <img src={avatarUrl} alt="" />
    ) : (
      <span className="sbc__portrait-empty">+</span>
    );
    if (!onAvatarUpload) {
      return avatarUrl ? <span className={className}>{inner}</span> : null;
    }
    return (
      <label className={className} title="Изображение существа" onClick={(e) => e.stopPropagation()}>
        {inner}
        <span className="sbc__portrait-hint">{avatarUploading ? "Загрузка…" : avatarUrl ? "Изменить" : "Добавить"}</span>
        <input
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onAvatarUpload(file);
          }}
        />
      </label>
    );
  }

  function renderSection(id: SbcSectionId) {
    const isEditing = editing === id;
    switch (id) {
      case "legendary":
        return isEditing ? (
          <div className="sbc__editor">
            <LegendaryEditor
              value={value.legendary}
              onChange={(v) => patch({ legendary: v })}
              abilities={value.abilities}
              proficiencyBonus={value.challenge.proficiencyBonus}
            />
          </div>
        ) : (
          <div className="sbc__body">
            {value.legendary.resistanceEnabled && (
              <SbcRow label="Сопротивления">{value.legendary.resistanceCount ?? "—"} / день</SbcRow>
            )}
            {value.legendary.actionsEnabled && (
              <>
                {value.legendary.actionPoints !== null && (
                  <SbcRow label="Очки действий">{value.legendary.actionPoints} за раунд</SbcRow>
                )}
                {value.legendary.actions.map((a, i) => (
                  <SbcEntry
                    key={i}
                    name={a.name || undefined}
                    mech={`(${a.cost})${formatAction(a) ? ` ${formatAction(a)}` : ""}`}
                    description={a.description}
                  />
                ))}
              </>
            )}
            {value.legendary.lairEnabled &&
              value.legendary.lairActions.map((a, i) => (
                <SbcEntry
                  key={i}
                  name={a.name || undefined}
                  mech={`(логово)${formatAction(a) ? ` ${formatAction(a)}` : ""}`}
                  description={a.description}
                />
              ))}
          </div>
        );

      case "defense":
        return isEditing ? (
          <div className="sbc__editor">
            <div className="sbc__editor-cols">
              <ChecklistEditor
                label="Уязвимости к урону"
                value={value.damageVulnerabilities}
                onChange={(v) => patch({ damageVulnerabilities: v })}
                options={damageTypes}
              />
              <ChecklistEditor
                label="Сопротивления урону"
                value={value.damageResistances}
                onChange={(v) => patch({ damageResistances: v })}
                options={damageTypes}
              />
              <ChecklistEditor
                label="Иммунитет к урону"
                value={value.damageImmunities}
                onChange={(v) => patch({ damageImmunities: v })}
                options={damageTypes}
              />
              <ChecklistEditor
                label="Иммунитет к состояниям"
                value={value.conditionImmunities}
                onChange={(v) => patch({ conditionImmunities: v })}
                options={conditions}
              />
            </div>
            <div className="sbc__form-block">
              <span className="sbc__form-lab">Преимущество на спасброски от</span>
              <div className="sbc__checks">
                {conditions.map((c) => (
                  <label key={c.id} className="row" style={{ gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={value.saveAdvantageConditions.includes(c.name)}
                      onChange={() => toggleSaveAdvantageCondition(c.name)}
                    />
                    {c.name}
                  </label>
                ))}
                <label className="row" style={{ gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={value.saveAdvantageMagic}
                    onChange={(e) => patch({ saveAdvantageMagic: e.target.checked })}
                  />
                  Магии
                </label>
              </div>
            </div>

            {/* Чувства, языки и примечание — такой же таблицей «подпись |
                поле», как «Основное»: в две колонки подписи наезжали на
                соседние поля, потому что подпись держала фиксированную
                ширину, а текст в неё не помещался. */}
            <div className="sbc__form">
              <span className="sbc__form-lab">Особые чувства</span>
              <SensesEditor value={value.sensesList} onChange={(v) => patch({ sensesList: v })} options={senseOptions} />

              <span className="sbc__form-lab">Пассивное восприятие</span>
              <span className="row" style={{ gap: 6 }}>
                <input
                  type="number"
                  style={{ width: 68 }}
                  value={value.passivePerception ?? ""}
                  onChange={(e) => patch({ passivePerception: e.target.value === "" ? null : Number(e.target.value) })}
                />
                <button type="button" onClick={() => patch({ passivePerception: computePassivePerception(value) })}>
                  Авто
                </button>
              </span>

              <span className="sbc__form-lab">Особенности восприятия</span>
              <input
                placeholder="напр. преимущество на восприятие, полагающееся на слух"
                value={value.perceptionNote}
                onChange={(e) => patch({ perceptionNote: e.target.value })}
              />

              <span className="sbc__form-lab">Языки</span>
              <input value={value.languages} onChange={(e) => patch({ languages: e.target.value })} />

              <span className="sbc__form-lab">Дополнительно</span>
              <MentionTextarea value={value.defenseNotes} onChange={(v) => patch({ defenseNotes: v })} rows={2} />
            </div>
          </div>
        ) : (
          <div className="sbc__body">
            {value.damageVulnerabilities.length > 0 && (
              <SbcRow label="Уязвимости">{value.damageVulnerabilities.join(", ")}</SbcRow>
            )}
            {value.damageResistances.length > 0 && (
              <SbcRow label="Сопротивления">{value.damageResistances.join(", ")}</SbcRow>
            )}
            {(value.damageImmunities.length > 0 || value.conditionImmunities.length > 0) && (
              <SbcRow label="Иммунитет">
                {[value.damageImmunities.join(", "), value.conditionImmunities.join(", ")].filter(Boolean).join("; ")}
              </SbcRow>
            )}
            {advantageParts.length > 0 && <SbcRow label="Преим. на спас">{advantageParts.join(", ")}</SbcRow>}
            {sensesText && <SbcRow label="Чувства">{sensesText}</SbcRow>}
            {value.perceptionNote && <SbcRow label="Восприятие">{value.perceptionNote}</SbcRow>}
            {value.languages && <SbcRow label="Языки">{value.languages}</SbcRow>}
            {value.defenseNotes && (
              <div className="sbc__entry">
                <MentionText text={value.defenseNotes} />
              </div>
            )}
          </div>
        );

      case "traits":
        return isEditing ? (
          <div className="sbc__editor">
            <FeatureListEdit title="Черты" values={value.traits} onChange={(v) => patch({ traits: v })} />
          </div>
        ) : (
          <div className="sbc__body">
            {value.traits.map((f, i) => (
              <SbcEntry key={i} name={f.name || undefined} description={f.description} />
            ))}
          </div>
        );

      case "actions":
      case "bonus":
      case "reactions": {
        const key = id === "actions" ? "actions" : id === "bonus" ? "bonusActions" : "reactions";
        const list = value[key] as DndCreatureAction[];
        const title = id === "actions" ? "Действия" : id === "bonus" ? "Бонусные действия" : "Реакции";
        const colorClass =
          id === "actions" ? "dnd-header-actions" : id === "bonus" ? "dnd-header-bonus" : "dnd-header-reactions";
        return isEditing ? (
          <div className="sbc__editor">
            <ActionListEdit
              title={title}
              values={list}
              onChange={(v) => patch({ [key]: v } as Partial<DndCreatureData>)}
              headerColorClass={colorClass}
              abilities={value.abilities}
              proficiencyBonus={value.challenge.proficiencyBonus}
            />
          </div>
        ) : (
          <div className="sbc__body">
            <SbcActionList values={list} />
          </div>
        );
      }

      case "spells":
        return isEditing ? (
          <div className="sbc__editor">
            <SpellcastingEditor
              value={value.spellcasting}
              onChange={(v) => patch({ spellcasting: v })}
              systemId={systemId}
              abilities={value.abilities}
              proficiencyBonus={pb}
            />
          </div>
        ) : (
          <div className="sbc__body">
            {value.spellcasting.ability && (
              <SbcRow label="Характеристика">
                {ABILITY_LABELS.find((a) => a.key === value.spellcasting.ability)?.label}
              </SbcRow>
            )}
            {spellLevels.map(({ level, slots, spells }) => (
              <SbcSpellLevel key={level} level={level} slots={slots} spells={spells} />
            ))}
          </div>
        );

      case "gear":
        return isEditing ? (
          <div className="sbc__editor">
            <div className="sbc__form">
              <span className="sbc__form-lab">Среда обитания</span>
              <input value={value.habitat} onChange={(e) => patch({ habitat: e.target.value })} />
              <span className="sbc__form-lab">Сокровища</span>
              <input value={value.treasure} onChange={(e) => patch({ treasure: e.target.value })} />
            </div>
            <EquipmentEditor value={value.equipment} onChange={(v) => patch({ equipment: v })} systemId={systemId} />
            <LootEditor value={value.loot} onChange={(v) => patch({ loot: v })} />
          </div>
        ) : (
          <div className="sbc__body">
            {value.habitat && <SbcRow label="Среда">{value.habitat}</SbcRow>}
            {value.treasure && <SbcRow label="Сокровища">{value.treasure}</SbcRow>}
            {value.equipment.length > 0 && (
              <SbcRow label="Снаряжение">
                {value.equipment.map((it) => `${it.name}${it.qty ? ` ×${it.qty}` : ""}`).join(", ")}
              </SbcRow>
            )}
            {(value.loot.items.length > 0 || value.loot.currency.length > 0) && (
              <SbcRow label="Лут">
                {value.loot.items.map((it) => `${it.name}${it.qty ? ` ×${it.qty}` : ""}`).join(", ")}
                {value.loot.items.length > 0 && value.loot.currency.length > 0 && "; "}
                {value.loot.currency
                  .map((c) => {
                    const avg = averageDiceFormula(c.formula);
                    return `${c.label}: ${c.formula}${avg !== null ? ` (≈ ${avg})` : ""}`;
                  })
                  .join(", ")}
              </SbcRow>
            )}
          </div>
        );

      case "notes":
        return isEditing ? (
          <div className="sbc__editor">
            <MentionTextarea value={value.notes} onChange={(v) => patch({ notes: v })} rows={3} />
          </div>
        ) : (
          <div className="sbc__body">
            <div className="sbc__entry" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={value.notes} />
            </div>
          </div>
        );
    }
  }

  return (
    <div className="sb-scope">
      <div className="sbc" ref={rootRef}>
        <div
          className={`sbc__band${onHeaderClick ? " is-clickable" : ""}`}
          onClick={onHeaderClick}
        >
          {!bigPortrait && portrait("sbc__portrait-sm")}
          <div className="sbc__title">
            <div className="sbc__name">{value.name || "Без названия"}</div>
            {metaParts.length > 0 && <div className="sbc__meta">{metaParts.join(" · ")}</div>}
          </div>
          <div className="sbc__cr">{crText}</div>
          {headerExtra && (
            <div className="sbc__controls" onClick={(e) => e.stopPropagation()}>
              {headerExtra}
            </div>
          )}
        </div>

        {!collapsed && (
          <div className={`sbc__cols${narrow ? " is-narrow" : ""}${editing === "side" ? " is-editing-side" : ""}`}>
            {/* Левая колонка — то, чем существо бросает. Не уезжает из виду. */}
            <div className="sbc__side">
              {onQuickUpdate && (
                <SbcSectionHead
                  title="Основное"
                  editing={editing === "side"}
                  onToggleEdit={() => setEditing((v) => (v === "side" ? null : "side"))}
                />
              )}

              {editing === "side" ? (
                <div className="sbc__side-form">
                  {/* Правится таблицей «подпись | поле», а не свободным
                      потоком: у поля своя колонка, и длинная подпись больше
                      не выталкивает контрол за край раздела. */}
                  <div className="sbc__form">
                    <span className="sbc__form-lab">Имя</span>
                    <input value={value.name} onChange={(e) => patch({ name: e.target.value })} />

                    <span className="sbc__form-lab">Тип</span>
                    <select value={value.creatureType} onChange={(e) => patch({ creatureType: e.target.value })}>
                      <option value="">— тип существа —</option>
                      {value.creatureType && !creatureTypeOptions.some((o) => o.name === value.creatureType) && (
                        <option value={value.creatureType}>{value.creatureType}</option>
                      )}
                      {creatureTypeOptions.map((o) => (
                        <option key={o.id} value={o.name}>
                          {o.name}
                        </option>
                      ))}
                    </select>

                    <span className="sbc__form-lab">Размер</span>
                    <select value={value.size} onChange={(e) => patch({ size: e.target.value })}>
                      {CREATURE_SIZES.map((sz) => (
                        <option key={sz} value={sz}>
                          {sz}
                        </option>
                      ))}
                    </select>

                    <span className="sbc__form-lab">Мировоззрение</span>
                    <select value={value.alignment} onChange={(e) => patch({ alignment: e.target.value })}>
                      <option value="">— мировоззрение —</option>
                      {value.alignment && !alignmentOptions.some((o) => o.name === value.alignment) && (
                        <option value={value.alignment}>{value.alignment}</option>
                      )}
                      {alignmentOptions.map((o) => (
                        <option key={o.id} value={o.name}>
                          {o.name}
                        </option>
                      ))}
                    </select>

                    <span className="sbc__form-lab">Класс опасности</span>
                    <span className="row" style={{ gap: 6 }}>
                      <select
                        value={value.challenge.rating}
                        onChange={(e) =>
                          patch({
                            challenge: {
                              rating: e.target.value,
                              proficiencyBonus: computeProficiencyBonusForCR(e.target.value),
                            },
                          })
                        }
                      >
                        <option value="">—</option>
                        {CR_VALUES.map((cr) => (
                          <option key={cr} value={cr}>
                            {cr}
                          </option>
                        ))}
                      </select>
                      <span className="muted">Б.М.</span>
                      <input
                        type="number"
                        style={{ width: 52 }}
                        value={value.challenge.proficiencyBonus ?? ""}
                        onChange={(e) =>
                          patch({
                            challenge: {
                              ...value.challenge,
                              proficiencyBonus: e.target.value === "" ? null : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </span>
                  </div>

                  <div className="sbc__form">
                    <span className="sbc__form-lab">Класс защиты</span>
                    <input
                      type="number"
                      value={value.armorClass.value ?? ""}
                      onChange={(e) =>
                        patch({
                          armorClass: {
                            ...value.armorClass,
                            value: e.target.value === "" ? null : Number(e.target.value),
                          },
                        })
                      }
                    />

                    <span className="sbc__form-lab">Тип защиты</span>
                    <input
                      placeholder="напр. натуральная броня"
                      value={value.armorClass.note}
                      onChange={(e) => patch({ armorClass: { ...value.armorClass, note: e.target.value } })}
                    />

                    <span className="sbc__form-lab">Хиты</span>
                    <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <input
                        type="number"
                        placeholder="костей"
                        style={{ width: 68 }}
                        value={value.hitPoints.diceCount ?? ""}
                        onChange={(e) =>
                          patch({
                            hitPoints: {
                              ...value.hitPoints,
                              diceCount: e.target.value === "" ? null : Number(e.target.value),
                            },
                          })
                        }
                      />
                      <select
                        value={value.hitPoints.dieSize ?? ""}
                        onChange={(e) =>
                          patch({
                            hitPoints: {
                              ...value.hitPoints,
                              dieSize: e.target.value === "" ? null : Number(e.target.value),
                            },
                          })
                        }
                      >
                        <option value="">к—</option>
                        {DIE_SIZES.map((d) => (
                          <option key={d} value={d}>
                            к{d}
                          </option>
                        ))}
                      </select>
                      <span className="muted">+</span>
                      <input
                        type="number"
                        placeholder="бонус"
                        style={{ width: 68 }}
                        value={value.hitPoints.bonus ?? ""}
                        onChange={(e) =>
                          patch({
                            hitPoints: {
                              ...value.hitPoints,
                              bonus: e.target.value === "" ? null : Number(e.target.value),
                            },
                          })
                        }
                      />
                      {hitPointsAverage(value.hitPoints) && (
                        <span className="sbc__val">≈ {hitPointsAverage(value.hitPoints)}</span>
                      )}
                    </span>

                    <span className="sbc__form-lab">Инициатива</span>
                    <input
                      type="number"
                      value={value.initiativeBonus ?? ""}
                      onChange={(e) => patch({ initiativeBonus: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </div>

                  {/* Скорости — своя строка на всю ширину: пять полей с
                      подписями в колонку 300 px не встают, и «Скорости»
                      висело в пустоте. */}
                  <div className="sbc__form sbc__form--wide">
                    <span className="sbc__form-lab">Скорости</span>
                    <SpeedEditor value={value.speed} onChange={(v) => patch({ speed: v })} />
                  </div>

                  <div className="sbc__form-block">
                    <AbilityScoresEdit value={value.abilities} onChange={(v) => patch({ abilities: v })} />
                  </div>

                  <div className="sbc__form-block">
                    <span className="sbc__lab sbc__lab--auto">Спасброски</span>
                    <div className="sbc__checks">
                      {ABILITY_LABELS.map(({ key, label }) => (
                        <label key={key} className="row" style={{ gap: 4 }}>
                          <input type="checkbox" checked={value.savingThrowProfs[key]} onChange={() => toggleSave(key)} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="sbc__form-block sbc__form--wide">
                    <span className="sbc__lab sbc__lab--auto">Навыки</span>
                    <div className="sbc__checks">
                      {ALL_SKILLS.map((skill) => (
                        <label key={skill} className="row" style={{ gap: 4 }}>
                          <input type="checkbox" checked={!!value.skillProfs[skill]} onChange={() => toggleSkill(skill)} />
                          {skill}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* КЗ и хиты — два самых спрашиваемых числа, одной строкой
                      пополам: держать их на двух строках значит гонять глаз
                      вертикально там, где хватает одного взгляда. */}
                  <div className="sbc__pair">
                    <span className="sbc__lab sbc__lab--auto">КЗ</span>
                    <span className="sbc__val sbc__val--big">{formatArmorClass(value.armorClass)}</span>
                    <span className="sbc__lab sbc__lab--auto">Хиты</span>
                    <span className="sbc__val sbc__val--big">
                      {hitPointsAverage(value.hitPoints) || "—"}
                      {hitPointsDice(value.hitPoints) && (
                        <span className="sbc__val-sub">{hitPointsDice(value.hitPoints)}</span>
                      )}
                    </span>
                  </div>
                  <div className="sbc__rows">
                    <SbcRow label="Скорость">{formatSpeed(value.speed) || "—"}</SbcRow>
                    <SbcRow label="Инициатива">
                      {value.initiativeBonus !== null ? formatModifier(value.initiativeBonus) : "—"}
                    </SbcRow>
                  </div>

                  <div className="sbc__divider">
                    <span className="sbc__lab sbc__lab--auto">Характеристики</span>
                    <div className="sbc__dies">
                      {ABILITY_LABELS.map(({ key, label }) => {
                        const mod = abilityModifier(value.abilities[key]);
                        const prof = !!value.savingThrowProfs[key];
                        return (
                          <AbilityDie
                            key={key}
                            label={label}
                            score={value.abilities[key]}
                            mod={mod}
                            save={mod + (prof ? pb : 0)}
                            prof={prof}
                            primary={prefs.abilityPrimary}
                          />
                        );
                      })}
                    </div>
                    <span className="sbc__hint">
                      Залитая кость — владение спасбросоком. Щелчок переворачивает кость на спасбросок.
                    </span>
                  </div>

                  {skillList.length > 0 && (
                    <div className="sbc__divider">
                      <span className="sbc__lab sbc__lab--auto">Навыки</span>
                      <span className="sbc__val">{skillList.join(", ")}</span>
                    </div>
                  )}

                  {bigPortrait && portrait("sbc__portrait")}
                </>
              )}
            </div>

            <div className="sbc__scroll">
              {narrow && segments.length > 1 && (
                <div className="sbc__segs">
                  {segments.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className={`sbc__seg${activeSeg?.id === g.id ? " is-on" : ""}`}
                      onClick={() => setSeg(g.id)}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              )}

              {shown.map((s) => (
                <div key={s.id}>
                  <SbcSectionHead
                    title={s.title}
                    editing={editing === s.id}
                    onToggleEdit={
                      onQuickUpdate ? () => setEditing((v) => (v === s.id ? null : s.id)) : undefined
                    }
                  />
                  {renderSection(s.id)}
                </div>
              ))}

              {/* §1.11: у пустого статблока главный блок обязан объяснить,
                  что здесь будет — одной строкой, а не тремя заглушками
                  «Действий пока нет / Заклинательной способности нет /
                  Снаряжения пока нет». */}
              {visible.length === 0 && (
                <div className="sbc__invite">
                  <span className="sbc__invite-text">
                    {onQuickUpdate
                      ? "Здесь будут действия, черты и защита — всё, чем существо ходит в бою. Пока не заполнено, ни одна секция не показывается."
                      : "Статблок пока не заполнен."}
                  </span>
                  {onQuickUpdate && (
                    <button
                      type="button"
                      className="sbc__toggle"
                      onClick={() => {
                        setRevealed(["actions"]);
                        setEditing("actions");
                      }}
                    >
                      Заполнить
                    </button>
                  )}
                </div>
              )}

              {onQuickUpdate && absent.length > 0 && visible.length > 0 && (
                <div className="sbc__adds">
                  {absent.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="sbc__add"
                      onClick={() => {
                        setRevealed((v) => [...v, s.id]);
                        setEditing(s.id);
                      }}
                    >
                      + {s.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
