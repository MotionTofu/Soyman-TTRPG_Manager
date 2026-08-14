import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
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
  DndFeature,
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
import { effectsLabel, type DndCheck, type DndEffect } from "./effects";
import { FeatureListEdit } from "./FeatureList";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { MentionText } from "../mentions/MentionText";
import { statblockScopeClass } from "../../statblockThemes";
import { SEARCH_DRAG_MIME } from "../LinkDropZone";
import { useBag } from "../../bag";
import { averageDiceFormula, rollDiceFormula } from "./diceRoll";
import { PipTrack } from "../litm/PipTrack";
import { api } from "../../api/client";
import { NavIcon } from "../NavIcons";

export const CREATURE_SIZES = ["Крошечный", "Маленький", "Средний", "Большой", "Огромный", "Громадный"] as const;
export const DIE_SIZES = [4, 6, 8, 10, 12] as const;
export const CR_VALUES = [
  "0", "1/8", "1/4", "1/2",
  ...Array.from({ length: 30 }, (_, i) => String(i + 1)),
];

function crToNumber(cr: string): number {
  if (cr === "1/8") return 0.125;
  if (cr === "1/4") return 0.25;
  if (cr === "1/2") return 0.5;
  const n = Number(cr);
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
// тип-мировоззрение/УО/чувства/урон-состояния) into the new structured
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

  let defenseNotes = typeof merged.defenseNotes === "string" ? merged.defenseNotes : "";
  if (typeof r.skills === "string" && r.skills && !defenseNotes.includes(r.skills)) {
    defenseNotes = [defenseNotes, `Навыки (старые данные): ${r.skills}`].filter(Boolean).join("\n");
  }
  if (typeof r.savingThrows === "string" && r.savingThrows && !defenseNotes.includes(r.savingThrows)) {
    defenseNotes = [defenseNotes, `Спасброски (старые данные): ${r.savingThrows}`].filter(Boolean).join("\n");
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
  function add() {
    if (!pick || value.some((s) => s.name === pick)) return;
    onChange([...value, { name: pick, distance: pick === "Тёмное зрение" ? "60" : "" }]);
    setPick("");
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
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
              onClick={() => {
                if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
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
  function removeSpell(entry: DndCreatureSpell) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    onChange({ ...value, spells: value.spells.filter((s) => s !== entry) });
  }

  const label = level === 0 ? "Заговоры" : `Круг ${level}`;

  return (
    <details className="dnd-spell-level-card" open>
      <summary className="row dnd-spell-level-summary" style={{ justifyContent: "space-between" }}>
        <span>{label}</span>
        {level > 0 && (
          <span onClick={(e) => e.stopPropagation()} className="row" style={{ gap: 10 }}>
            <PipTrack value={slots} max={9} onChange={setSlots} />
          </span>
        )}
      </summary>
      <div className="stack" style={{ marginTop: 6, gap: 4 }}>
        {spellsAtLevel.length === 0 && <span className="muted">Пусто</span>}
        {spellsAtLevel.map((s) => (
          <div key={value.spells.indexOf(s)} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontWeight: 600, minWidth: 140 }}>{s.name}</span>
            <select value={s.frequency} onChange={(e) => updateSpell(s, { frequency: e.target.value as DndCreatureSpellFrequency })}>
              <option value="atwill">Бесконечно</option>
              <option value="perday">N раз/день</option>
              <option value="slots">По ячейкам</option>
            </select>
            {s.frequency === "perday" && (
              <input
                type="number"
                style={{ width: 50 }}
                min={1}
                value={s.perDayCount ?? 1}
                onChange={(e) => updateSpell(s, { perDayCount: Number(e.target.value) || 1 })}
              />
            )}
            <select
              value={s.rollType ?? ""}
              onChange={(e) => updateSpell(s, { rollType: (e.target.value || undefined) as DndAttackRollType | undefined })}
              title="Механика для автодобавления в Действия"
            >
              <option value="">Без урона</option>
              <option value="attack">Бросок атаки</option>
              <option value="save">Спасбросок</option>
            </select>
            {s.rollType === "attack" && (
              <input
                type="number"
                placeholder="Бонус"
                style={{ width: 50 }}
                value={s.bonus ?? ""}
                onChange={(e) => updateSpell(s, { bonus: e.target.value === "" ? null : Number(e.target.value) })}
              />
            )}
            {s.rollType === "save" && (
              <>
                <select value={s.saveAbility ?? ""} onChange={(e) => updateSpell(s, { saveAbility: e.target.value as DndAbilityKey | "" })}>
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
                  style={{ width: 50 }}
                  value={s.saveDC ?? ""}
                  onChange={(e) => updateSpell(s, { saveDC: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </>
            )}
            {s.rollType && (
              <input placeholder="Урон/лечение" value={s.damage ?? ""} onChange={(e) => updateSpell(s, { damage: e.target.value })} style={{ width: 120 }} />
            )}
            <input
              placeholder="Описание"
              value={s.description}
              onChange={(e) => updateSpell(s, { description: e.target.value })}
              style={{ flex: 1, minWidth: 140 }}
            />
            <button type="button" className="comp-mini danger" onClick={() => removeSpell(s)}>
              <NavIcon name="close" />
            </button>
          </div>
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
  function update(i: number, patch: Partial<DndCreatureAction> & { cost?: number }) {
    onChange(values.map((a, idx) => (idx === i ? ({ ...a, ...patch } as T) : a)));
  }
  function remove(i: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
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
  function remove(i: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
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

  function addItem() {
    onChange({ ...value, items: [...value.items, { name: "", qty: "" }] });
  }
  function updateItem(i: number, patch: Partial<{ name: string; qty: string }>) {
    onChange({ ...value, items: value.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
  }
  function removeItem(i: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    onChange({ ...value, items: value.items.filter((_, idx) => idx !== i) });
  }
  function addCurrency() {
    onChange({ ...value, currency: [...value.currency, { label: "", formula: "" }] });
  }
  function updateCurrency(i: number, patch: Partial<{ label: string; formula: string }>) {
    onChange({ ...value, currency: value.currency.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  }
  function removeCurrency(i: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    onChange({ ...value, currency: value.currency.filter((_, idx) => idx !== i) });
  }
  function roll(i: number) {
    const result = rollDiceFormula(value.currency[i].formula);
    if (result !== null) setRolled((r) => ({ ...r, [i]: result }));
  }

  return (
    <div className="stack">
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

export function DndCreatureEdit({
  value,
  onChange,
}: {
  value: DndCreatureData;
  onChange: (v: DndCreatureData) => void;
}) {
  // Same fix as DndCharacterEdit/LitMCharacterEdit: a keystroke in any one
  // field used to replace the whole DndCreatureData object and hand every
  // FeatureListEdit block (traits/actions/bonus/reactions/legendary — each
  // can hold long descriptions) a fresh inline onChange, defeating their
  // React.memo and forcing all five to re-diff on every keystroke anywhere
  // on the sheet. These refs let the setters below stay referentially
  // stable while still reading/writing the latest value.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [damageTypes, setDamageTypes] = useState<DndMechanicsOption[]>([]);
  const [conditions, setConditions] = useState<DndMechanicsOption[]>([]);
  const [senseOptions, setSenseOptions] = useState<DndMechanicsOption[]>([]);
  const [creatureTypeOptions, setCreatureTypeOptions] = useState<DndMechanicsOption[]>([]);
  const [alignmentOptions, setAlignmentOptions] = useState<DndMechanicsOption[]>([]);
  const [systemId, setSystemId] = useState<number | null>(null);

  useEffect(() => {
    findDndSystemId().then((sid) => {
      setSystemId(sid);
      if (!sid) return;
      loadDndMechanicsGroup(sid, "Типы урона").then(setDamageTypes);
      loadDndMechanicsGroup(sid, "Состояния").then(setConditions);
      loadDndMechanicsGroup(sid, "Особое восприятие").then(setSenseOptions);
      loadDndMechanicsGroup(sid, MECHANICS_CREATURE_TYPE_GROUP).then(setCreatureTypeOptions);
      loadDndMechanicsGroup(sid, MECHANICS_ALIGNMENT_GROUP).then(setAlignmentOptions);
    });
  }, []);

  const { setAbilities, setTraits, setActions, setBonusActions, setReactions, setLegendary, setNotes } = useMemo(() => {
    function set<K extends keyof DndCreatureData>(key: K, v: DndCreatureData[K]) {
      onChangeRef.current({ ...valueRef.current, [key]: v });
    }
    return {
      setAbilities: (v: DndCreatureData["abilities"]) => set("abilities", v),
      setTraits: (v: DndFeature[]) => set("traits", v),
      setActions: (v: DndCreatureAction[]) => set("actions", v),
      setBonusActions: (v: DndCreatureAction[]) => set("bonusActions", v),
      setReactions: (v: DndCreatureAction[]) => set("reactions", v),
      setLegendary: (v: DndCreatureLegendary) => set("legendary", v),
      setNotes: (v: string) => set("notes", v),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleSkill(skill: string) {
    onChange({ ...value, skillProfs: { ...value.skillProfs, [skill]: !value.skillProfs[skill] } });
  }
  function toggleSave(key: DndAbilityKey) {
    onChange({ ...value, savingThrowProfs: { ...value.savingThrowProfs, [key]: !value.savingThrowProfs[key] } });
  }
  function toggleSaveAdvantageCondition(name: string) {
    const list = value.saveAdvantageConditions.includes(name)
      ? value.saveAdvantageConditions.filter((c) => c !== name)
      : [...value.saveAdvantageConditions, name];
    onChange({ ...value, saveAdvantageConditions: list });
  }

  return (
    <div className="stack dnd-card">
      <details className="card stack" open>
        <summary>
          <strong className="entry-title">База</strong>
        </summary>
        <div className="row">
          <input
            placeholder="Название существа"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            style={{ flex: 1 }}
          />
          <select value={value.challenge.rating} onChange={(e) => onChange({ ...value, challenge: { rating: e.target.value, proficiencyBonus: computeProficiencyBonusForCR(e.target.value) } })}>
            <option value="">— УО —</option>
            {CR_VALUES.map((cr) => (
              <option key={cr} value={cr}>
                {cr}
              </option>
            ))}
          </select>
          <label className="row" style={{ gap: 4 }}>
            Бонус мастерства
            <input
              type="number"
              style={{ width: 50 }}
              value={value.challenge.proficiencyBonus ?? ""}
              onChange={(e) => onChange({ ...value, challenge: { ...value.challenge, proficiencyBonus: e.target.value === "" ? null : Number(e.target.value) } })}
            />
          </label>
        </div>

        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <select value={value.size} onChange={(e) => onChange({ ...value, size: e.target.value })}>
            {CREATURE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={value.creatureType}
            onChange={(e) => onChange({ ...value, creatureType: e.target.value })}
            style={{ flex: 1 }}
          >
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
          <select
            value={value.alignment}
            onChange={(e) => onChange({ ...value, alignment: e.target.value })}
            style={{ flex: 1 }}
          >
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
        </div>

        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <label className="row" style={{ gap: 4 }}>
            КД
            <input
              type="number"
              style={{ width: 56 }}
              value={value.armorClass.value ?? ""}
              onChange={(e) => onChange({ ...value, armorClass: { ...value.armorClass, value: e.target.value === "" ? null : Number(e.target.value) } })}
            />
            <input
              placeholder="напр. натуральная броня"
              value={value.armorClass.note}
              onChange={(e) => onChange({ ...value, armorClass: { ...value.armorClass, note: e.target.value } })}
              style={{ width: 160 }}
            />
          </label>
          <label className="row" style={{ gap: 4 }}>
            Кости хитов
            <input
              type="number"
              style={{ width: 44 }}
              value={value.hitPoints.diceCount ?? ""}
              onChange={(e) => onChange({ ...value, hitPoints: { ...value.hitPoints, diceCount: e.target.value === "" ? null : Number(e.target.value) } })}
            />
            к
            <select
              value={value.hitPoints.dieSize ?? ""}
              onChange={(e) => onChange({ ...value, hitPoints: { ...value.hitPoints, dieSize: e.target.value === "" ? null : Number(e.target.value) } })}
            >
              <option value="">—</option>
              {DIE_SIZES.map((d) => (
                <option key={d} value={d}>
                  к{d}
                </option>
              ))}
            </select>
            <span className="muted">бонус</span>
            <input
              type="number"
              style={{ width: 50 }}
              value={value.hitPoints.bonus ?? ""}
              onChange={(e) => onChange({ ...value, hitPoints: { ...value.hitPoints, bonus: e.target.value === "" ? null : Number(e.target.value) } })}
            />
            {(value.hitPoints.diceCount || value.hitPoints.formula) && <span className="muted">≈ {formatHitPoints(value.hitPoints)}</span>}
          </label>
          <label className="row" style={{ gap: 4 }}>
            Бонус инициативы
            <input
              type="number"
              style={{ width: 50 }}
              value={value.initiativeBonus ?? ""}
              onChange={(e) => onChange({ ...value, initiativeBonus: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>
        </div>

        <SpeedEditor value={value.speed} onChange={(v) => onChange({ ...value, speed: v })} />
      </details>

      <details className="card stack" open>
        <summary>
          <strong className="entry-title">Характеристики</strong>
        </summary>
        <AbilityScoresEdit value={value.abilities} onChange={setAbilities} />

        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <div className="stack" style={{ gap: 4 }}>
            <span className="sb-prop-label">Спасброски</span>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {ABILITY_LABELS.map(({ key, label }) => (
                <label key={key} className="row" style={{ gap: 4 }}>
                  <input type="checkbox" checked={value.savingThrowProfs[key]} onChange={() => toggleSave(key)} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="sb-prop-label">Навыки</span>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {ALL_SKILLS.map((skill) => (
                <label key={skill} className="row" style={{ gap: 4 }}>
                  <input type="checkbox" checked={!!value.skillProfs[skill]} onChange={() => toggleSkill(skill)} />
                  {skill}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="stack" style={{ gap: 4 }}>
          <span className="sb-prop-label">Чувства</span>
          <SensesEditor value={value.sensesList} onChange={(v) => onChange({ ...value, sensesList: v })} options={senseOptions} />
        </div>
        <label>
          Особенности восприятия
          <input
            placeholder="напр. преимущество на Внимание/восприятие, полагающееся на слух"
            value={value.perceptionNote}
            onChange={(e) => onChange({ ...value, perceptionNote: e.target.value })}
          />
        </label>
        <label className="row" style={{ gap: 4 }}>
          Пассивная Внимательность
          <input
            type="number"
            style={{ width: 50 }}
            value={value.passivePerception ?? ""}
            onChange={(e) => onChange({ ...value, passivePerception: e.target.value === "" ? null : Number(e.target.value) })}
          />
          <button type="button" onClick={() => onChange({ ...value, passivePerception: computePassivePerception(value) })}>
            Авто
          </button>
        </label>
        <label>
          Языки
          <input value={value.languages} onChange={(e) => onChange({ ...value, languages: e.target.value })} />
        </label>
      </details>

      <details className="card stack" open>
        <summary>
          <strong className="entry-title">Защита</strong>
        </summary>
        <ChecklistEditor
          label="Уязвимости к урону"
          value={value.damageVulnerabilities}
          onChange={(v) => onChange({ ...value, damageVulnerabilities: v })}
          options={damageTypes}
        />
        <ChecklistEditor
          label="Сопротивления урону"
          value={value.damageResistances}
          onChange={(v) => onChange({ ...value, damageResistances: v })}
          options={damageTypes}
        />
        <ChecklistEditor
          label="Иммунитет к урону"
          value={value.damageImmunities}
          onChange={(v) => onChange({ ...value, damageImmunities: v })}
          options={damageTypes}
        />
        <ChecklistEditor
          label="Иммунитет к состояниям"
          value={value.conditionImmunities}
          onChange={(v) => onChange({ ...value, conditionImmunities: v })}
          options={conditions}
        />
        <div className="stack" style={{ gap: 4 }}>
          <span className="sb-prop-label">Преимущество на спасброски от</span>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {conditions.map((c) => (
              <label key={c.id} className="row" style={{ gap: 4 }}>
                <input type="checkbox" checked={value.saveAdvantageConditions.includes(c.name)} onChange={() => toggleSaveAdvantageCondition(c.name)} />
                {c.name}
              </label>
            ))}
            <label className="row" style={{ gap: 4 }}>
              <input
                type="checkbox"
                checked={value.saveAdvantageMagic}
                onChange={(e) => onChange({ ...value, saveAdvantageMagic: e.target.checked })}
              />
              Магии
            </label>
          </div>
        </div>
        <label>
          Дополнительно (защита)
          <MentionTextarea value={value.defenseNotes} onChange={(v) => onChange({ ...value, defenseNotes: v })} rows={2} />
        </label>
      </details>

      <details className="card stack" open>
        <summary>
          <strong className="entry-title">Заклинания</strong>
        </summary>
        <SpellcastingEditor
          value={value.spellcasting}
          onChange={(v) => onChange({ ...value, spellcasting: v })}
          systemId={systemId}
          abilities={value.abilities}
          proficiencyBonus={value.challenge.proficiencyBonus ?? 0}
        />
      </details>

      <details className="card stack" open>
        <summary>
          <strong className="entry-title">Действия</strong>
        </summary>
        <FeatureListEdit title="Особенности (Traits)" values={value.traits} onChange={setTraits} />

        <AddSpellActionButton
          spells={value.spellcasting.spells}
          actions={value.actions}
          onAdd={(a) => setActions([...value.actions, a])}
        />
        <ActionListEdit
          title="Действия (Actions)"
          values={value.actions}
          onChange={setActions}
          headerColorClass="dnd-header-actions"
          abilities={value.abilities}
          proficiencyBonus={value.challenge.proficiencyBonus}
        />
        <ActionListEdit
          title="Бонусные действия"
          values={value.bonusActions}
          onChange={setBonusActions}
          headerColorClass="dnd-header-bonus"
          abilities={value.abilities}
          proficiencyBonus={value.challenge.proficiencyBonus}
        />
        <ActionListEdit
          title="Реакции"
          values={value.reactions}
          onChange={setReactions}
          headerColorClass="dnd-header-reactions"
          abilities={value.abilities}
          proficiencyBonus={value.challenge.proficiencyBonus}
        />
        <LegendaryEditor
          value={value.legendary}
          onChange={setLegendary}
          abilities={value.abilities}
          proficiencyBonus={value.challenge.proficiencyBonus}
        />
      </details>

      <details className="card stack" open>
        <summary>
          <strong className="entry-title">Снаряжение</strong>
        </summary>
        <div className="row">
          <label style={{ flex: 1 }}>
            Среда обитания
            <input value={value.habitat} onChange={(e) => onChange({ ...value, habitat: e.target.value })} />
          </label>
          <label style={{ flex: 1 }}>
            Сокровища
            <input value={value.treasure} onChange={(e) => onChange({ ...value, treasure: e.target.value })} />
          </label>
        </div>

        <EquipmentEditor value={value.equipment} onChange={(v) => onChange({ ...value, equipment: v })} systemId={systemId} />
        <LootEditor value={value.loot} onChange={(v) => onChange({ ...value, loot: v })} />
      </details>

      <label>
        Заметки
        <MentionTextarea value={value.notes} onChange={setNotes} rows={3} />
      </label>
    </div>
  );
}

// One "Название графы | значение" row for the compact two-column edit
// layout — label to the left at a fixed width, control to the right,
// mirroring the source spreadsheet's table shape instead of the wide
// label-above-input rows used by the whole-card DndCreatureEdit form.
function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sb-field-row">
      <span className="sb-field-row-label">{label}</span>
      {children}
    </div>
  );
}

// Pencil-as-edit-toggle for a single view tab — same convention as the
// character sheet's TabEditToggle (DndCharacterForm.tsx): click to edit,
// click again to save, without leaving the compact view for other tabs.
function TabEditToggle({ editing, onToggle }: { editing: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="comp-mini dnd-tab-edit-toggle" title={editing ? "Сохранить" : "Редактировать"} onClick={onToggle}>
      <NavIcon name={editing ? "check" : "edit"} />
    </button>
  );
}

// One collapsible statblock line — like the character sheet's spell rows: a
// clickable summary (name + optional mechanical line) that expands to show
// the full description, instead of always dumping the whole text inline.
// Rows with no description just render flat (nothing to expand).
function SbEntryRow({
  name,
  extra,
  mech,
  description,
}: {
  name?: string;
  extra?: ReactNode;
  mech?: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!description.trim();
  return (
    <div className="sb-entry">
      <div
        className={`sb-entry-row${hasDetail ? " sb-entry-toggle" : ""}`}
        onClick={hasDetail ? () => setOpen((v) => !v) : undefined}
      >
        {name && <strong>{name}</strong>}
        {extra}
        {mech && <span className="muted"> {mech}</span>}
        {hasDetail && (
          <NavIcon name="chevron" className={`sb-entry-caret chevron-icon${open ? " is-open" : ""}`} />
        )}
      </div>
      {open && hasDetail && (
        <div className="sb-entry-detail">
          <MentionText text={description} />
        </div>
      )}
    </div>
  );
}

function SbFeatureGroup({ title, values }: { title: string; values: DndFeature[] }) {
  if (values.length === 0) return null;
  return (
    <>
      <div className="sb-section">{title}</div>
      {values.map((f, i) => (
        <SbEntryRow key={i} name={f.name ? `${f.name}.` : undefined} description={f.description} />
      ))}
    </>
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

function SbActionGroup({ title, values }: { title: string; values: DndCreatureAction[] }) {
  if (values.length === 0) return null;
  return (
    <>
      <div className="sb-section">{title}</div>
      {values.map((a, i) => (
        <SbEntryRow
          key={i}
          name={a.name ? `${a.name}.` : undefined}
          mech={formatAction(a)}
          description={a.description}
        />
      ))}
    </>
  );
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

export function formatHitPoints(hp: DndCreatureHitPoints): string {
  if (hp.diceCount && hp.dieSize) {
    const avg = Math.floor(hp.diceCount * (hp.dieSize / 2 + 0.5)) + (hp.bonus ?? 0);
    const bonusStr = hp.bonus ? (hp.bonus >= 0 ? `+${hp.bonus}` : `${hp.bonus}`) : "";
    return `${avg} (${hp.diceCount}к${hp.dieSize}${bonusStr})`;
  }
  return hp.formula || "";
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

// Compact GM card — same data as the full view, just a smaller subset of
// fields laid out per the .card-mini reference (name+CR header, one-line
// vitals, ability modifiers only, and the action list).
function DndCreatureViewMini({ value, theme, density }: { value: DndCreatureData; theme?: string | null; density?: string | null }) {
  const allActions: { name: string; description: string }[] = [
    ...value.traits,
    ...value.actions,
    ...value.bonusActions,
    ...value.reactions,
    ...value.legendary.actions,
    ...value.legendary.lairActions,
  ];
  const acText = formatArmorClass(value.armorClass);
  const hpText = formatHitPoints(value.hitPoints);
  const speedText = formatSpeed(value.speed);
  return (
    <div className={statblockScopeClass(theme, density)}>
      <div className="sb-card card-mini">
        <div className="sb-head">
          <div className="sb-head-row">
            <div className="sb-name">{value.name || "Без названия"}</div>
            {value.challenge.rating && <div style={{ fontSize: 12.5, opacity: 0.8 }}>УО {value.challenge.rating}</div>}
          </div>
        </div>
        <div className="sb-body">
          <div className="mini-vitals">
            <span>
              <b>КД</b> {acText}
            </span>
            <span>
              <b>ХП</b> {hpText || "—"}
            </span>
            <span>
              <b>Ск.</b> {speedText || "—"}
            </span>
          </div>
          <div className="mini-abilities">
            {ABILITY_LABELS.map(({ key, label }) => (
              <span key={key}>
                <b>{label[0]}</b> {formatModifier(abilityModifier(value.abilities[key]))}
              </span>
            ))}
          </div>
          {allActions.map((f, i) => (
            <div key={i} className="mini-action">
              {f.name && <b>{f.name}.</b>} <MentionText text={f.description} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const DND_CREATURE_VIEW_TABS = ["Действия", "Заклинания", "Снаряжение", "Особенности"] as const;
type DndCreatureViewTab = (typeof DND_CREATURE_VIEW_TABS)[number];

export function DndCreatureView({
  value,
  theme,
  density,
  compact,
  onQuickUpdate,
  collapsed,
  headerExtra,
  onHeaderClick,
  avatarUrl,
  onAvatarUpload,
  avatarUploading,
}: {
  value: DndCreatureData;
  theme?: string | null;
  density?: string | null;
  compact?: boolean;
  onQuickUpdate?: (patch: Partial<DndCreatureData>) => void;
  // Lets the owning card (StatblockCard) fold its edit/delete/theme controls
  // and expand/collapse toggle into this component's own title bar instead
  // of wrapping it in a second, redundant <details> frame.
  collapsed?: boolean;
  headerExtra?: ReactNode;
  onHeaderClick?: () => void;
  // Portrait shown next to the vitals/abilities block (sb-top-avatar) — the
  // statblock's own art, separate from whatever avatar the owning being/
  // character has on its profile. Column only renders when there's an
  // image or a way to add one, so read-only previews without either prop
  // stay exactly as before.
  avatarUrl?: string | null;
  onAvatarUpload?: (file: File) => void;
  avatarUploading?: boolean;
}) {
  // Not URL-synced / not lifted to props — same reasoning as the character
  // sheet's view tab state: several statblocks can render on one page (e.g.
  // a bestiary list), each needs its own independent tab.
  const [tab, setTab] = useState<DndCreatureViewTab>("Действия");

  // Each of the 5 tabs edits independently in place (TabEditToggle pattern,
  // same as the character sheet's Заклинания/Инвентарь tabs) — no whole-card
  // edit mode required for day-to-day tweaks.
  const [editingMain, setEditingMain] = useState(false);
  const [editingActions, setEditingActions] = useState(false);
  const [editingSpells, setEditingSpells] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState(false);
  const [editingTraits, setEditingTraits] = useState(false);

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

  function toggleSkill(skill: string) {
    onQuickUpdate?.({ skillProfs: { ...value.skillProfs, [skill]: !value.skillProfs[skill] } });
  }
  function toggleSave(key: DndAbilityKey) {
    onQuickUpdate?.({ savingThrowProfs: { ...value.savingThrowProfs, [key]: !value.savingThrowProfs[key] } });
  }
  function toggleSaveAdvantageCondition(name: string) {
    const list = value.saveAdvantageConditions.includes(name)
      ? value.saveAdvantageConditions.filter((c) => c !== name)
      : [...value.saveAdvantageConditions, name];
    onQuickUpdate?.({ saveAdvantageConditions: list });
  }
  const patch = (p: Partial<DndCreatureData>) => onQuickUpdate?.(p);

  if (compact) return <DndCreatureViewMini value={value} theme={theme} density={density} />;

  const metaParts = [
    [value.size, value.creatureType].filter(Boolean).join(" "),
    value.alignment,
    value.challenge.rating ? `УО ${value.challenge.rating}${value.challenge.proficiencyBonus ? ` (Бонус мастерства +${value.challenge.proficiencyBonus})` : ""}` : "",
  ].filter(Boolean);

  const saveList = ABILITY_LABELS.filter(({ key }) => value.savingThrowProfs[key]).map(
    ({ key, label }) => `${label} ${formatModifier(abilityModifier(value.abilities[key]) + (value.challenge.proficiencyBonus ?? 0))}`
  );
  const skillList = Object.entries(value.skillProfs)
    .filter(([, v]) => v)
    .map(([skill]) => {
      const ab = SKILL_ABILITY[skill];
      const bonus = ab ? abilityModifier(value.abilities[ab]) + (value.challenge.proficiencyBonus ?? 0) : 0;
      return `${skill} ${formatModifier(bonus)}`;
    });
  const sensesText = [
    ...value.sensesList.map((s) => `${s.name}${s.distance ? ` ${s.distance} фт.` : ""}`),
    value.passivePerception !== null ? `пассивная внимательность ${value.passivePerception}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const advantageParts = [...value.saveAdvantageConditions, value.saveAdvantageMagic ? "магии" : ""].filter(Boolean);

  const hasActions =
    value.actions.length > 0 ||
    value.bonusActions.length > 0 ||
    value.reactions.length > 0 ||
    value.legendary.resistanceEnabled ||
    value.legendary.actionsEnabled ||
    value.legendary.lairEnabled;

  return (
    <div className={statblockScopeClass(theme, density)}>
      <div className="sb-card">
        <div
          className={`sb-head${onHeaderClick ? " sb-head-clickable" : ""}`}
          onClick={onHeaderClick}
        >
          <div className="sb-head-row">
            <div>
              <div className="sb-name">{value.name || "Без названия"}</div>
              {metaParts.length > 0 && <div className="sb-meta">{metaParts.join(" · ")}</div>}
            </div>
            {headerExtra && (
              <div className="sb-head-controls" onClick={(e) => e.stopPropagation()}>
                {headerExtra}
              </div>
            )}
          </div>
        </div>
        {!collapsed && <div className="sb-body">
        <div className="sb-top-section">
        <div className="sb-top-main">
          <div className="sb-props">
            <div>
              <span className="sb-prop-label">Класс Защиты</span> {formatArmorClass(value.armorClass)}
            </div>
            <div>
              <span className="sb-prop-label">Хиты</span> {formatHitPoints(value.hitPoints) || "—"}
            </div>
            <div>
              <span className="sb-prop-label">Скорость</span> {formatSpeed(value.speed) || "—"}
            </div>
            <div>
              <span className="sb-prop-label">Инициатива</span> {value.initiativeBonus !== null ? formatModifier(value.initiativeBonus) : "—"}
            </div>
          </div>

          <div className="sb-abilities-inline">
            {ABILITY_LABELS.map(({ key, label }) => (
              <div key={key} className="sb-ability-tile">
                <div className="sb-ability-tile-mod">{formatModifier(abilityModifier(value.abilities[key]))}</div>
                <div className="sb-ability-tile-score">
                  {label} {value.abilities[key]}
                </div>
              </div>
            ))}
          </div>

          {/* Always visible — matches the source table's intent that base/
              characteristics/defense data sits right alongside HP/AC, not
              behind a click, same as the printed dnd.su statblock layout. */}
          <div className="sb-props">
            {onQuickUpdate && <TabEditToggle editing={editingMain} onToggle={() => setEditingMain((v) => !v)} />}
              {editingMain ? (
                <div className="sb-edit-compact">
                  <div className="sb-edit-col">
                    <FieldRow label="Имя">
                      <input value={value.name} onChange={(e) => patch({ name: e.target.value })} />
                    </FieldRow>
                    <FieldRow label="Тип">
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
                    </FieldRow>
                    <FieldRow label="Размер">
                      <select value={value.size} onChange={(e) => patch({ size: e.target.value })}>
                        {CREATURE_SIZES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </FieldRow>
                    <FieldRow label="Мировоззрение">
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
                    </FieldRow>
                    <FieldRow label="Класс опасности">
                      <div className="row" style={{ gap: 6 }}>
                        <select value={value.challenge.rating} onChange={(e) => patch({ challenge: { rating: e.target.value, proficiencyBonus: computeProficiencyBonusForCR(e.target.value) } })}>
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
                          style={{ width: 44 }}
                          value={value.challenge.proficiencyBonus ?? ""}
                          onChange={(e) => patch({ challenge: { ...value.challenge, proficiencyBonus: e.target.value === "" ? null : Number(e.target.value) } })}
                        />
                      </div>
                    </FieldRow>
                    <FieldRow label="Класс защиты">
                      <input
                        type="number"
                        value={value.armorClass.value ?? ""}
                        onChange={(e) => patch({ armorClass: { ...value.armorClass, value: e.target.value === "" ? null : Number(e.target.value) } })}
                      />
                    </FieldRow>
                    <FieldRow label="Тип защиты">
                      <input
                        placeholder="напр. натуральная броня"
                        value={value.armorClass.note}
                        onChange={(e) => patch({ armorClass: { ...value.armorClass, note: e.target.value } })}
                      />
                    </FieldRow>
                    <FieldRow label="Кость здоровья">
                      <select
                        value={value.hitPoints.dieSize ?? ""}
                        onChange={(e) => patch({ hitPoints: { ...value.hitPoints, dieSize: e.target.value === "" ? null : Number(e.target.value) } })}
                      >
                        <option value="">—</option>
                        {DIE_SIZES.map((d) => (
                          <option key={d} value={d}>
                            к{d}
                          </option>
                        ))}
                      </select>
                    </FieldRow>
                    <FieldRow label="Количество костей">
                      <input
                        type="number"
                        value={value.hitPoints.diceCount ?? ""}
                        onChange={(e) => patch({ hitPoints: { ...value.hitPoints, diceCount: e.target.value === "" ? null : Number(e.target.value) } })}
                      />
                    </FieldRow>
                    <FieldRow label="Пост. бонус к здоровью">
                      <input
                        type="number"
                        value={value.hitPoints.bonus ?? ""}
                        onChange={(e) => patch({ hitPoints: { ...value.hitPoints, bonus: e.target.value === "" ? null : Number(e.target.value) } })}
                      />
                      {(value.hitPoints.diceCount || value.hitPoints.formula) && <span className="muted"> ≈ {formatHitPoints(value.hitPoints)}</span>}
                    </FieldRow>
                    <FieldRow label="Бонус к инициативе">
                      <input
                        type="number"
                        value={value.initiativeBonus ?? ""}
                        onChange={(e) => patch({ initiativeBonus: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </FieldRow>
                  </div>

                  <div className="sb-edit-col">
                    <FieldRow label="Скорости">
                      <SpeedEditor value={value.speed} onChange={(v) => patch({ speed: v })} />
                    </FieldRow>
                    <FieldRow label="Особые чувства">
                      <SensesEditor value={value.sensesList} onChange={(v) => patch({ sensesList: v })} options={senseOptions} />
                    </FieldRow>
                    <FieldRow label="Особенности восприятия">
                      <input
                        placeholder="напр. преимущество на Внимание/восприятие, полагающееся на слух"
                        value={value.perceptionNote}
                        onChange={(e) => patch({ perceptionNote: e.target.value })}
                      />
                    </FieldRow>
                    <FieldRow label="Пассивное восприятие">
                      <div className="row" style={{ gap: 6 }}>
                        <input
                          type="number"
                          style={{ width: 50 }}
                          value={value.passivePerception ?? ""}
                          onChange={(e) => patch({ passivePerception: e.target.value === "" ? null : Number(e.target.value) })}
                        />
                        <button type="button" onClick={() => patch({ passivePerception: computePassivePerception(value) })}>
                          Авто
                        </button>
                      </div>
                    </FieldRow>
                    <FieldRow label="Языки">
                      <input value={value.languages} onChange={(e) => patch({ languages: e.target.value })} />
                    </FieldRow>
                  </div>

                  <div className="sb-edit-col">
                    <AbilityScoresEdit value={value.abilities} onChange={(v) => patch({ abilities: v })} />
                    <div className="stack" style={{ gap: 4 }}>
                      <span className="sb-prop-label">Спасброски</span>
                      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                        {ABILITY_LABELS.map(({ key, label }) => (
                          <label key={key} className="row" style={{ gap: 4 }}>
                            <input type="checkbox" checked={value.savingThrowProfs[key]} onChange={() => toggleSave(key)} />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="stack" style={{ gap: 4 }}>
                      <span className="sb-prop-label">Навыки</span>
                      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                        {ALL_SKILLS.map((skill) => (
                          <label key={skill} className="row" style={{ gap: 4 }}>
                            <input type="checkbox" checked={!!value.skillProfs[skill]} onChange={() => toggleSkill(skill)} />
                            {skill}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="sb-edit-col">
                    <ChecklistEditor label="Уязвимости к урону" value={value.damageVulnerabilities} onChange={(v) => patch({ damageVulnerabilities: v })} options={damageTypes} />
                    <ChecklistEditor label="Сопротивления урону" value={value.damageResistances} onChange={(v) => patch({ damageResistances: v })} options={damageTypes} />
                    <ChecklistEditor label="Иммунитет к урону" value={value.damageImmunities} onChange={(v) => patch({ damageImmunities: v })} options={damageTypes} />
                    <ChecklistEditor label="Иммунитет к состояниям" value={value.conditionImmunities} onChange={(v) => patch({ conditionImmunities: v })} options={conditions} />
                    <div className="stack" style={{ gap: 4 }}>
                      <span className="sb-prop-label">Преимущество на спасброски от</span>
                      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                        {conditions.map((c) => (
                          <label key={c.id} className="row" style={{ gap: 4 }}>
                            <input type="checkbox" checked={value.saveAdvantageConditions.includes(c.name)} onChange={() => toggleSaveAdvantageCondition(c.name)} />
                            {c.name}
                          </label>
                        ))}
                        <label className="row" style={{ gap: 4 }}>
                          <input type="checkbox" checked={value.saveAdvantageMagic} onChange={(e) => patch({ saveAdvantageMagic: e.target.checked })} />
                          Магии
                        </label>
                      </div>
                    </div>
                    <FieldRow label="Дополнительно (защита)">
                      <MentionTextarea value={value.defenseNotes} onChange={(v) => patch({ defenseNotes: v })} rows={2} />
                    </FieldRow>
                  </div>
                </div>
              ) : (
                <>
                  {saveList.length > 0 && (
                    <div>
                      <span className="sb-prop-label">Спасброски</span> {saveList.join(", ")}
                    </div>
                  )}
                  {skillList.length > 0 && (
                    <div>
                      <span className="sb-prop-label">Навыки</span> {skillList.join(", ")}
                    </div>
                  )}
                  {value.damageVulnerabilities.length > 0 && (
                    <div>
                      <span className="sb-prop-label">Уязвимости</span> {value.damageVulnerabilities.join(", ")}
                    </div>
                  )}
                  {value.damageResistances.length > 0 && (
                    <div>
                      <span className="sb-prop-label">Сопротивления</span> {value.damageResistances.join(", ")}
                    </div>
                  )}
                  {value.damageImmunities.length > 0 && (
                    <div>
                      <span className="sb-prop-label">Иммунитет к урону</span> {value.damageImmunities.join(", ")}
                    </div>
                  )}
                  {value.conditionImmunities.length > 0 && (
                    <div>
                      <span className="sb-prop-label">Иммунитет к состояниям</span> {value.conditionImmunities.join(", ")}
                    </div>
                  )}
                  {advantageParts.length > 0 && (
                    <div>
                      <span className="sb-prop-label">Преимущество на спасброски от</span> {advantageParts.join(", ")}
                    </div>
                  )}
                  {value.defenseNotes && (
                    <div>
                      <MentionText text={value.defenseNotes} />
                    </div>
                  )}
                  {sensesText && (
                    <div>
                      <span className="sb-prop-label">Чувства</span> {sensesText}
                    </div>
                  )}
                  {value.perceptionNote && (
                    <div>
                      <MentionText text={value.perceptionNote} />
                    </div>
                  )}
                  {value.languages && (
                    <div>
                      <span className="sb-prop-label">Языки</span> {value.languages}
                    </div>
                  )}
                </>
              )}
            </div>
        </div>
        {(avatarUrl || onAvatarUpload) && (
          <label className="sb-top-avatar" title="Изображение существа">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="sb-top-avatar-img" />
            ) : (
              <div className="sb-top-avatar-placeholder">+</div>
            )}
            {onAvatarUpload && (
              <>
                <span className="sb-top-avatar-hint">{avatarUploading ? "Загрузка…" : avatarUrl ? "Изменить" : "Добавить"}</span>
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onAvatarUpload(file);
                  }}
                />
              </>
            )}
          </label>
        )}
        </div>

          <div className="tabs">
            {DND_CREATURE_VIEW_TABS.map((t) => (
              <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>

          {tab === "Действия" && (
            <>
              {onQuickUpdate && <TabEditToggle editing={editingActions} onToggle={() => setEditingActions((v) => !v)} />}
              {editingActions ? (
                <div className="stack">
                  <ActionListEdit
                    title="Действия (Actions)"
                    values={value.actions}
                    onChange={(v) => patch({ actions: v })}
                    headerColorClass="dnd-header-actions"
                    abilities={value.abilities}
                    proficiencyBonus={value.challenge.proficiencyBonus}
                  />
                  <ActionListEdit
                    title="Бонусные действия"
                    values={value.bonusActions}
                    onChange={(v) => patch({ bonusActions: v })}
                    headerColorClass="dnd-header-bonus"
                    abilities={value.abilities}
                    proficiencyBonus={value.challenge.proficiencyBonus}
                  />
                  <ActionListEdit
                    title="Реакции"
                    values={value.reactions}
                    onChange={(v) => patch({ reactions: v })}
                    headerColorClass="dnd-header-reactions"
                    abilities={value.abilities}
                    proficiencyBonus={value.challenge.proficiencyBonus}
                  />
                  <LegendaryEditor
                    value={value.legendary}
                    onChange={(v) => patch({ legendary: v })}
                    abilities={value.abilities}
                    proficiencyBonus={value.challenge.proficiencyBonus}
                  />
                </div>
              ) : (
                <>
                  <SbActionGroup title="Действия" values={value.actions} />
                  <SbActionGroup title="Бонусные действия" values={value.bonusActions} />
                  <SbActionGroup title="Реакции" values={value.reactions} />

                  {value.legendary.resistanceEnabled && (
                    <div className="sb-entry">
                      <span className="sb-prop-label">Легендарные сопротивления</span> {value.legendary.resistanceCount ?? "—"}/день
                    </div>
                  )}
                  {value.legendary.actionsEnabled && (
                    <>
                      <div className="sb-section">
                        Легендарные действия
                        {value.legendary.actionPoints !== null ? ` (Очков: ${value.legendary.actionPoints} за раунд)` : ""}
                      </div>
                      {value.legendary.actions.map((a, i) => (
                        <SbEntryRow
                          key={i}
                          name={a.name || undefined}
                          extra={<span className="muted"> (Стоимость: {a.cost})</span>}
                          mech={formatAction(a)}
                          description={a.description}
                        />
                      ))}
                    </>
                  )}
                  {value.legendary.lairEnabled && <SbActionGroup title="Действия логова" values={value.legendary.lairActions} />}

                  {!hasActions && <p className="muted">Действий пока нет.</p>}
                </>
              )}
            </>
          )}

          {tab === "Заклинания" && (
            <>
              {onQuickUpdate && <TabEditToggle editing={editingSpells} onToggle={() => setEditingSpells((v) => !v)} />}
              {editingSpells ? (
                <SpellcastingEditor
                  value={value.spellcasting}
                  onChange={(v) => patch({ spellcasting: v })}
                  systemId={systemId}
                  abilities={value.abilities}
                  proficiencyBonus={value.challenge.proficiencyBonus ?? 0}
                />
              ) : value.spellcasting.enabled ? (
                <>
                  <div className="sb-entry">
                    {value.spellcasting.ability && (
                      <>
                        Основная характеристика: {ABILITY_LABELS.find((a) => a.key === value.spellcasting.ability)?.label}.{" "}
                      </>
                    )}
                    {value.spellcasting.slots.length > 0 && (
                      <>Ячейки: {value.spellcasting.slots.map((s) => `${s.level} круг — ${s.slots}`).join(", ")}. </>
                    )}
                  </div>
                  {value.spellcasting.spells.map((s, i) => (
                    <SbEntryRow
                      key={i}
                      name={s.name || "Без названия"}
                      extra={
                        <span className="muted">
                          {" "}
                          ({s.level === 0 ? "заговор" : `круг ${s.level}`}, {formatSpellFrequency(s)})
                        </span>
                      }
                      description={s.description}
                    />
                  ))}
                  {value.spellcasting.spells.length === 0 && <p className="muted">Заклинаний пока нет.</p>}
                </>
              ) : (
                <p className="muted">Заклинательной способности нет.</p>
              )}
            </>
          )}

          {tab === "Снаряжение" && (
            <>
              {onQuickUpdate && <TabEditToggle editing={editingEquipment} onToggle={() => setEditingEquipment((v) => !v)} />}
              {editingEquipment ? (
                <div className="stack">
                  <div className="row">
                    <label style={{ flex: 1 }}>
                      Среда обитания
                      <input value={value.habitat} onChange={(e) => patch({ habitat: e.target.value })} />
                    </label>
                    <label style={{ flex: 1 }}>
                      Сокровища
                      <input value={value.treasure} onChange={(e) => patch({ treasure: e.target.value })} />
                    </label>
                  </div>
                  <EquipmentEditor value={value.equipment} onChange={(v) => patch({ equipment: v })} systemId={systemId} />
                  <LootEditor value={value.loot} onChange={(v) => patch({ loot: v })} />
                </div>
              ) : (
                <div className="sb-props">
                  {(value.habitat || value.treasure) && (
                    <div>
                      {value.habitat && (
                        <>
                          <span className="sb-prop-label">Среда обитания</span> {value.habitat}{" "}
                        </>
                      )}
                      {value.treasure && (
                        <>
                          <span className="sb-prop-label">Сокровища</span> {value.treasure}
                        </>
                      )}
                    </div>
                  )}
                  {value.equipment.length > 0 && (
                    <div>
                      <span className="sb-prop-label">Снаряжение</span>{" "}
                      {value.equipment.map((it) => `${it.name}${it.qty ? ` ×${it.qty}` : ""}`).join(", ")}
                    </div>
                  )}
                  {(value.loot.items.length > 0 || value.loot.currency.length > 0) && (
                    <div>
                      <span className="sb-prop-label">Лут</span>{" "}
                      {value.loot.items.map((it) => `${it.name}${it.qty ? ` ×${it.qty}` : ""}`).join(", ")}
                      {value.loot.items.length > 0 && value.loot.currency.length > 0 && "; "}
                      {value.loot.currency
                        .map((c) => {
                          const avg = averageDiceFormula(c.formula);
                          return `${c.label}: ${c.formula}${avg !== null ? ` (≈ ${avg})` : ""}`;
                        })
                        .join(", ")}
                    </div>
                  )}
                  {!value.habitat && !value.treasure && value.equipment.length === 0 && value.loot.items.length === 0 && value.loot.currency.length === 0 && (
                    <p className="muted">Снаряжения пока нет.</p>
                  )}
                </div>
              )}
            </>
          )}

          {tab === "Особенности" && (
            <>
              {onQuickUpdate && <TabEditToggle editing={editingTraits} onToggle={() => setEditingTraits((v) => !v)} />}
              {editingTraits ? (
                <div className="stack">
                  <FeatureListEdit title="Особенности (Traits)" values={value.traits} onChange={(v) => patch({ traits: v })} />
                  <label>
                    Заметки
                    <MentionTextarea value={value.notes} onChange={(v) => patch({ notes: v })} rows={3} />
                  </label>
                </div>
              ) : (
                <>
                  <SbFeatureGroup title="Особенности" values={value.traits} />
                  {value.traits.length === 0 && <p className="muted">Особенностей пока нет.</p>}
                  {value.notes && (
                    <>
                      <div className="sb-section">Заметки</div>
                      <div className="sb-entry" style={{ whiteSpace: "pre-wrap" }}>
                        <MentionText text={value.notes} />
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>}
      </div>
    </div>
  );
}
