import { useEffect, useState } from "react";
import type { CompendiumEntry, DndCharacterData, DndFeature } from "../../types";
import { grantsFromEntry } from "./dndGrants";
import { useDndSkills } from "./useDndSkills";
import { loadDndEquipmentEntries, loadDndSpellIndex } from "./dndCompendium";
import { isMasterableWeapon } from "./StartingEquipmentPicker";
import { recomputeGrantedSpells } from "./DndCharacterForm";
import { Sheet } from "./wizardUi";
import { withLiveEffects } from "./dndFeatures";
import { totalCharacterLevel } from "./AbilityScores";
import { deriveSheet } from "@shared/dnd/derive";
import { FeatChoices } from "./FeatChoices";
import {
  ALL_PARTS,
  applyFeatPick,
  defaultFeatPick,
  EMPTY_FEAT_PICK,
  featCtxFrom,
  featHitPoints,
  featPickMissing,
  type FeatPart,
  type FeatPick,
} from "./featPick";

/**
 * «Не выбрано» у черт листа (гриллинг черт 2026-09-24, Q8, Q9).
 *
 * Черта, добавленная на листе руками, и черта старого листа ничего не
 * выдали: +1, владения, заклинания лежали только в тексте. Строка под
 * «Чертами» называет, чего не хватает, кнопка открывает тот же выбор, что
 * в визарде и повышении уровня.
 *
 * У черт происхождения навыки, инструменты и заклинания и раньше выбирал
 * визард — их не спрашиваем повторно, только новое: +1, список и
 * характеристику заклинаний, сопротивление.
 */

const ORIGIN_PARTS: FeatPart[] = ["ability", "spellList", "spellAbility", "resist"];

function partsFor(entry: CompendiumEntry): FeatPart[] {
  return entry.data.category === "Черта происхождения" ? ORIGIN_PARTS : ALL_PARTS;
}

export function FeatPending({
  value,
  getEntry,
  onApply,
}: {
  value: DndCharacterData;
  getEntry: (id: number | null | undefined) => CompendiumEntry | undefined;
  onApply: (patch: Partial<DndCharacterData>) => void;
}) {
  const skills = useDndSkills(value.systemId);
  const [open, setOpen] = useState<DndFeature | null>(null);
  const pb = Number.parseInt(value.proficiencyBonus || "2", 10) || 2;

  const pending = value.feats.flatMap((f) => {
    if (f.choices || f.entryId == null) return [];
    const entry = getEntry(f.entryId);
    if (!entry) return [];
    const g = grantsFromEntry(entry, skills.resolve);
    const ctx = featCtxFrom(value, pb, entry.id, { except: f, listSourceId: g.spellListFrom });
    const missing = featPickMissing(entry, g, EMPTY_FEAT_PICK, ctx, partsFor(entry));
    return missing.length ? [{ f, missing }] : [];
  });

  // Хиты черты (Q7): лист хранит максимум числом, и «Крепкий», вписанный
  // руками, до него не доходил. Предлагаем прибавить, только когда сохранённое
  // меньше расчёта ровно на прибавку этой черты: так не задваивается то, что
  // уже учтено повышением уровня, и не трогается максимум, поправленный руками.
  const level = totalCharacterLevel(value.classes);
  const stored = (Number.parseInt(value.hitPointMax || "", 10) || 0) + (Number.parseInt(value.hitPointMaxTemp || "", 10) || 0);
  const derived = value.hpLump != null ? deriveSheet(withLiveEffects(value, getEntry)).maxHitPoints.value : null;
  const gap = derived != null ? derived - stored : 0;
  const hpRows = value.feats.flatMap((f) => {
    const hp = featHitPoints([getEntry(f.entryId)]);
    const bonus = hp.perLevel * level + hp.flat;
    return bonus > 0 && gap === bonus ? [{ f, bonus }] : [];
  });
  const addHp = (bonus: number) => {
    const cur = Number.parseInt(value.hitPointsCurrent || "", 10);
    const max = Number.parseInt(value.hitPointMax || "", 10) || 0;
    onApply({ hitPointMax: String(max + bonus), hitPointsCurrent: String((Number.isFinite(cur) ? cur : max) + bonus) });
  };
  if (pending.length === 0 && hpRows.length === 0 && !open) return null;

  return (
    <>
      <ul className="dnd-feat-pending">
        {pending.map(({ f, missing }, i) => (
          <li key={`${f.entryId}-${i}`}>
            <span>
              <strong>{f.name}</strong>: не выбрано — {missing.join(", ")}
            </span>
            <button type="button" onClick={() => setOpen(f)}>
              Выбрать
            </button>
          </li>
        ))}
        {hpRows.slice(0, 1).map(({ f, bonus }) => (
          <li key={`hp-${f.entryId}`}>
            <span>
              <strong>{f.name}</strong>: хиты +{bonus} ещё не в максимуме
            </span>
            <button type="button" onClick={() => addHp(bonus)}>
              Прибавить
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <FeatPendingSheet
          feature={open}
          value={value}
          entry={getEntry(open.entryId)!}
          pb={pb}
          skills={skills}
          onClose={() => setOpen(null)}
          onApply={(patch) => {
            onApply(patch);
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

function FeatPendingSheet({
  feature,
  value,
  entry,
  pb,
  skills,
  onClose,
  onApply,
}: {
  feature: DndFeature;
  value: DndCharacterData;
  entry: CompendiumEntry;
  pb: number;
  skills: ReturnType<typeof useDndSkills>;
  onClose: () => void;
  onApply: (patch: Partial<DndCharacterData>) => void;
}) {
  const g = grantsFromEntry(entry, skills.resolve);
  const ctx = featCtxFrom(value, pb, entry.id, { except: feature, listSourceId: g.spellListFrom });
  const parts = partsFor(entry);
  const [pick, setPick] = useState<FeatPick>(() => defaultFeatPick(g, ctx));
  const [spellIndex, setSpellIndex] = useState<CompendiumEntry[]>([]);
  const [equipment, setEquipment] = useState<CompendiumEntry[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!value.systemId) return;
    const ac = new AbortController();
    loadDndSpellIndex(value.systemId, { signal: ac.signal }).then(setSpellIndex).catch(() => undefined);
    loadDndEquipmentEntries(value.systemId, { signal: ac.signal }).then(setEquipment).catch(() => undefined);
    return () => ac.abort();
  }, [value.systemId]);
  const catalogs = {
    spellIndex,
    tools: equipment.filter((e) => typeof e.data.tool_kind === "string"),
    weapons: equipment.filter(isMasterableWeapon),
    skills: skills.rows,
  };
  const missing = featPickMissing(entry, g, pick, ctx, parts);

  async function apply() {
    setSaving(true);
    try {
      // Части, которые не спрашивали, не пишутся: пустой выбор по ним.
      const scoped: FeatPick = {
        ...pick,
        ...(parts.includes("skills") ? {} : { skills: [], skillOrExpertise: [], expertise: [] }),
        ...(parts.includes("tools") ? {} : { tools: [] }),
        ...(parts.includes("spells") ? {} : { spells: {} }),
      };
      const scopedGrants = parts === ALL_PARTS ? g : { ...g, armorProfs: [], weaponProfs: [], toolIds: [], toolNames: [], allSkills: false };
      const next = applyFeatPick(value, entry, scopedGrants, scoped, ctx, catalogs, { replace: feature });
      const spells = await recomputeGrantedSpells(next);
      onApply({
        abilities: next.abilities,
        savingThrowProfs: next.savingThrowProfs,
        skillProfs: next.skillProfs,
        proficiencies: next.proficiencies,
        masteredWeapons: next.masteredWeapons,
        feats: next.feats,
        ...spells,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      title={entry.name}
      onClose={onClose}
      actions={
        <button type="button" className="primary wz-wide-btn" disabled={missing.length > 0 || saving} onClick={apply}>
          {missing.length > 0 ? `Осталось: ${missing.join(", ")}` : "Применить к листу"}
        </button>
      }
    >
      <FeatChoices entry={entry} grants={g} ctx={ctx} pick={pick} onChange={setPick} parts={parts} {...catalogs} />
    </Sheet>
  );
}
