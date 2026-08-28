import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { DndCreatureData, SearchResult, Statblock } from "../../types";
import { MonsterTemplatePicker } from "../MonsterTemplatePicker";
import {
  emptyCreature,
  normalizeDndCreature,
  computeProficiencyBonusForCR,
  computePassivePerception,
  formatHitPoints,
  CREATURE_SIZES,
  DIE_SIZES,
  CR_VALUES,
  SpeedEditor,
  SensesEditor,
  SpellcastingEditor,
  ActionListEdit,
  AddSpellActionButton,
  LegendaryEditor,
  EquipmentEditor,
  LootEditor,
} from "./DndCreatureForm";
import { ABILITY_LABELS, AbilityScoresEdit, ALL_SKILLS, abilityModifier, formatModifier } from "./AbilityScores";
import { findDndSystemId, loadDndMechanicsGroup, type DndMechanicsOption } from "./dndCompendium";
import { MECHANICS_CREATURE_TYPE_GROUP, MECHANICS_ALIGNMENT_GROUP } from "../../compendium";

const STEPS = ["База", "Общее", "Защита", "Характеристики", "Заклинания", "Действия", "Снаряжение", "Обзор"] as const;
type Step = (typeof STEPS)[number];

interface Props {
  ownerType: "character" | "being" | "compendium_entry";
  ownerId: number;
  ownerName?: string;
  ownerCreatureSize?: string;
  ownerCreatureType?: string;
  ownerCreatureCR?: string;
  onDone: () => void;
  onCancel: () => void;
}

// Guided step-by-step creation for a brand-new D&D 5.5 creature statblock —
// used only when adding a fresh dnd_creature (see StatblockList's
// addStatblock). Editing/leveling an existing creature stays in the regular
// DndCreatureEdit form; this wizard is a one-time onboarding path only —
// every step of the user's original 9-step plan (base fields, spellcasting,
// actions/legendary economy/lair, equipment/loot) is covered here.
export function DndCreatureWizard({
  ownerType,
  ownerId,
  ownerName,
  ownerCreatureSize,
  ownerCreatureType,
  ownerCreatureCR,
  onDone,
  onCancel,
}: Props) {
  const [step, setStep] = useState<Step>("База");
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"new" | "clone" | null>(null);
  const [clonePick, setClonePick] = useState<SearchResult | null>(null);
  const [cloneLoading, setCloneLoading] = useState(false);

  const [draft, setDraft] = useState<DndCreatureData>(() => {
    const d = emptyCreature();
    d.name = ownerName ?? "";
    if (ownerCreatureSize && (CREATURE_SIZES as readonly string[]).includes(ownerCreatureSize)) d.size = ownerCreatureSize;
    if (ownerCreatureType) d.creatureType = ownerCreatureType;
    if (ownerCreatureCR) d.challenge = { rating: ownerCreatureCR, proficiencyBonus: computeProficiencyBonusForCR(ownerCreatureCR) };
    return d;
  });

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

  async function pickClone(entry: SearchResult | null) {
    setClonePick(entry);
    if (!entry) return;
    setCloneLoading(true);
    try {
      const rows = await api.get<Statblock[]>(`/statblocks?owner_type=compendium_entry&owner_id=${entry.id}`);
      const sb = rows.find((s) => s.format === "dnd_creature");
      if (sb) {
        const parsed = normalizeDndCreature(JSON.parse(sb.content || "{}"));
        setDraft({ ...parsed, name: draft.name || parsed.name });
      }
    } catch {
      // no statblock on the picked template — keep whatever is already drafted
    } finally {
      setCloneLoading(false);
    }
  }

  function toggleSkill(skill: string) {
    setDraft({ ...draft, skillProfs: { ...draft.skillProfs, [skill]: !draft.skillProfs[skill] } });
  }
  function toggleSave(key: (typeof ABILITY_LABELS)[number]["key"]) {
    setDraft({ ...draft, savingThrowProfs: { ...draft.savingThrowProfs, [key]: !draft.savingThrowProfs[key] } });
  }
  function toggleListItem(list: string[], name: string): string[] {
    return list.includes(name) ? list.filter((v) => v !== name) : [...list, name];
  }

  async function finish() {
    setSaving(true);
    await api.post("/statblocks", {
      owner_type: ownerType,
      owner_id: ownerId,
      format: "dnd_creature",
      kind: "full",
      content: JSON.stringify(draft),
    });
    setSaving(false);
    onDone();
  }

  const stepIndex = STEPS.indexOf(step);
  function next() {
    setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]);
  }
  function back() {
    setStep(STEPS[Math.max(0, stepIndex - 1)]);
  }

  return (
    <div className="card stack">
      <div className="tabs">
        {STEPS.map((s, i) => (
          <button key={s} className={step === s ? "active" : ""} disabled={i > stepIndex} onClick={() => setStep(s)}>
            {s}
          </button>
        ))}
      </div>

      {step === "База" && (
        <div className="stack">
          <div className="row">
            <button className={mode === "new" ? "active" : ""} onClick={() => { setMode("new"); setClonePick(null); }}>
              Новое существо
            </button>
            <button className={mode === "clone" ? "active" : ""} onClick={() => setMode("clone")}>
              На основе существующего
            </button>
          </div>
          {mode === "clone" && (
            <div className="stack">
              <MonsterTemplatePicker value={clonePick} onChange={pickClone} />
              {cloneLoading && <span className="muted">Загружаю…</span>}
            </div>
          )}
        </div>
      )}

      {step === "Общее" && (
        <div className="stack">
          <div className="row">
            <input
              placeholder="Название существа"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              style={{ flex: 1 }}
            />
            <select
              value={draft.challenge.rating}
              onChange={(e) => setDraft({ ...draft, challenge: { rating: e.target.value, proficiencyBonus: computeProficiencyBonusForCR(e.target.value) } })}
            >
              <option value="">— КО —</option>
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
                value={draft.challenge.proficiencyBonus ?? ""}
                onChange={(e) => setDraft({ ...draft, challenge: { ...draft.challenge, proficiencyBonus: e.target.value === "" ? null : Number(e.target.value) } })}
              />
            </label>
          </div>

          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <select value={draft.size} onChange={(e) => setDraft({ ...draft, size: e.target.value })}>
              {CREATURE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={draft.creatureType}
              onChange={(e) => setDraft({ ...draft, creatureType: e.target.value })}
              style={{ flex: 1 }}
            >
              <option value="">— тип существа —</option>
              {draft.creatureType && !creatureTypeOptions.some((o) => o.name === draft.creatureType) && (
                <option value={draft.creatureType}>{draft.creatureType}</option>
              )}
              {creatureTypeOptions.map((o) => (
                <option key={o.id} value={o.name}>
                  {o.name}
                </option>
              ))}
            </select>
            <select
              value={draft.alignment}
              onChange={(e) => setDraft({ ...draft, alignment: e.target.value })}
              style={{ flex: 1 }}
            >
              <option value="">— мировоззрение —</option>
              {draft.alignment && !alignmentOptions.some((o) => o.name === draft.alignment) && (
                <option value={draft.alignment}>{draft.alignment}</option>
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
                value={draft.armorClass.value ?? ""}
                onChange={(e) => setDraft({ ...draft, armorClass: { ...draft.armorClass, value: e.target.value === "" ? null : Number(e.target.value) } })}
              />
              <input
                placeholder="напр. натуральная броня"
                value={draft.armorClass.note}
                onChange={(e) => setDraft({ ...draft, armorClass: { ...draft.armorClass, note: e.target.value } })}
                style={{ width: 160 }}
              />
            </label>
            <label className="row" style={{ gap: 4 }}>
              Кости хитов
              <input
                type="number"
                style={{ width: 44 }}
                value={draft.hitPoints.diceCount ?? ""}
                onChange={(e) => setDraft({ ...draft, hitPoints: { ...draft.hitPoints, diceCount: e.target.value === "" ? null : Number(e.target.value) } })}
              />
              к
              <select
                value={draft.hitPoints.dieSize ?? ""}
                onChange={(e) => setDraft({ ...draft, hitPoints: { ...draft.hitPoints, dieSize: e.target.value === "" ? null : Number(e.target.value) } })}
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
                value={draft.hitPoints.bonus ?? ""}
                onChange={(e) => setDraft({ ...draft, hitPoints: { ...draft.hitPoints, bonus: e.target.value === "" ? null : Number(e.target.value) } })}
              />
              {(draft.hitPoints.diceCount || draft.hitPoints.formula) && <span className="muted">≈ {formatHitPoints(draft.hitPoints)}</span>}
            </label>
            <label className="row" style={{ gap: 4 }}>
              Бонус инициативы
              <input
                type="number"
                style={{ width: 50 }}
                value={draft.initiativeBonus ?? ""}
                onChange={(e) => setDraft({ ...draft, initiativeBonus: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </label>
          </div>

          <SpeedEditor value={draft.speed} onChange={(v) => setDraft({ ...draft, speed: v })} />
        </div>
      )}

      {step === "Защита" && (
        <div className="stack">
          {(["damageVulnerabilities", "damageResistances", "damageImmunities"] as const).map((key) => (
            <div key={key} className="stack" style={{ gap: 4 }}>
              <span className="sb-prop-label">
                {key === "damageVulnerabilities" ? "Уязвимости к урону" : key === "damageResistances" ? "Сопротивления урону" : "Иммунитет к урону"}
              </span>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {damageTypes.map((o) => (
                  <label key={o.id} className="row" style={{ gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={draft[key].includes(o.name)}
                      onChange={() => setDraft({ ...draft, [key]: toggleListItem(draft[key], o.name) })}
                    />
                    {o.name}
                  </label>
                ))}
              </div>
            </div>
          ))}

          <div className="stack" style={{ gap: 4 }}>
            <span className="sb-prop-label">Иммунитет к состояниям</span>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {conditions.map((o) => (
                <label key={o.id} className="row" style={{ gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={draft.conditionImmunities.includes(o.name)}
                    onChange={() => setDraft({ ...draft, conditionImmunities: toggleListItem(draft.conditionImmunities, o.name) })}
                  />
                  {o.name}
                </label>
              ))}
            </div>
          </div>

          <div className="stack" style={{ gap: 4 }}>
            <span className="sb-prop-label">Преимущество на спасброски от</span>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {conditions.map((o) => (
                <label key={o.id} className="row" style={{ gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={draft.saveAdvantageConditions.includes(o.name)}
                    onChange={() => setDraft({ ...draft, saveAdvantageConditions: toggleListItem(draft.saveAdvantageConditions, o.name) })}
                  />
                  {o.name}
                </label>
              ))}
              <label className="row" style={{ gap: 4 }}>
                <input
                  type="checkbox"
                  checked={draft.saveAdvantageMagic}
                  onChange={(e) => setDraft({ ...draft, saveAdvantageMagic: e.target.checked })}
                />
                Магии
              </label>
            </div>
          </div>

          <label>
            Дополнительно
            <input
              placeholder="особые свойства защиты"
              value={draft.defenseNotes}
              onChange={(e) => setDraft({ ...draft, defenseNotes: e.target.value })}
            />
          </label>
        </div>
      )}

      {step === "Характеристики" && (
        <div className="stack">
          <AbilityScoresEdit value={draft.abilities} onChange={(v) => setDraft({ ...draft, abilities: v })} />

          <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
            <div className="stack" style={{ gap: 4 }}>
              <span className="sb-prop-label">Спасброски</span>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {ABILITY_LABELS.map(({ key, label }) => (
                  <label key={key} className="row" style={{ gap: 4 }}>
                    <input type="checkbox" checked={draft.savingThrowProfs[key]} onChange={() => toggleSave(key)} />
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
                    <input type="checkbox" checked={!!draft.skillProfs[skill]} onChange={() => toggleSkill(skill)} />
                    {skill}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="stack" style={{ gap: 4 }}>
            <span className="sb-prop-label">Чувства</span>
            <SensesEditor value={draft.sensesList} onChange={(v) => setDraft({ ...draft, sensesList: v })} options={senseOptions} />
          </div>
          <label>
            Особенности восприятия
            <input
              placeholder="напр. преимущество на Внимание/восприятие, полагающееся на слух"
              value={draft.perceptionNote}
              onChange={(e) => setDraft({ ...draft, perceptionNote: e.target.value })}
            />
          </label>
          <label className="row" style={{ gap: 4 }}>
            Пассивная Внимательность
            <input
              type="number"
              style={{ width: 50 }}
              value={draft.passivePerception ?? ""}
              onChange={(e) => setDraft({ ...draft, passivePerception: e.target.value === "" ? null : Number(e.target.value) })}
            />
            <button type="button" onClick={() => setDraft({ ...draft, passivePerception: computePassivePerception(draft) })}>
              Авто
            </button>
          </label>
          <label>
            Языки
            <input value={draft.languages} onChange={(e) => setDraft({ ...draft, languages: e.target.value })} />
          </label>
        </div>
      )}

      {step === "Заклинания" && (
        <SpellcastingEditor
          value={draft.spellcasting}
          onChange={(v) => setDraft({ ...draft, spellcasting: v })}
          systemId={systemId}
          abilities={draft.abilities}
          proficiencyBonus={draft.challenge.proficiencyBonus ?? 0}
        />
      )}

      {step === "Действия" && (
        <div className="stack">
          <AddSpellActionButton
            spells={draft.spellcasting.spells}
            actions={draft.actions}
            onAdd={(a) => setDraft({ ...draft, actions: [...draft.actions, a] })}
          />
          <ActionListEdit
            title="Действия"
            values={draft.actions}
            onChange={(v) => setDraft({ ...draft, actions: v })}
            headerColorClass="dnd-header-actions"
            abilities={draft.abilities}
            proficiencyBonus={draft.challenge.proficiencyBonus}
          />
          <ActionListEdit
            title="Бонусные действия"
            values={draft.bonusActions}
            onChange={(v) => setDraft({ ...draft, bonusActions: v })}
            headerColorClass="dnd-header-bonus"
            abilities={draft.abilities}
            proficiencyBonus={draft.challenge.proficiencyBonus}
          />
          <ActionListEdit
            title="Реакции"
            values={draft.reactions}
            onChange={(v) => setDraft({ ...draft, reactions: v })}
            headerColorClass="dnd-header-reactions"
            abilities={draft.abilities}
            proficiencyBonus={draft.challenge.proficiencyBonus}
          />
          <LegendaryEditor
            value={draft.legendary}
            onChange={(v) => setDraft({ ...draft, legendary: v })}
            abilities={draft.abilities}
            proficiencyBonus={draft.challenge.proficiencyBonus}
          />
        </div>
      )}

      {step === "Снаряжение" && (
        <div className="stack">
          <EquipmentEditor value={draft.equipment} onChange={(v) => setDraft({ ...draft, equipment: v })} systemId={systemId} />
          <LootEditor value={draft.loot} onChange={(v) => setDraft({ ...draft, loot: v })} />
        </div>
      )}

      {step === "Обзор" && (
        <div className="stack">
          <div>
            <strong>{draft.name || "Без названия"}</strong>
            {draft.challenge.rating && <span className="muted"> — КО {draft.challenge.rating}</span>}
          </div>
          <div className="muted">
            {[draft.size, draft.creatureType].filter(Boolean).join(" ")} · {draft.alignment || "—"}
          </div>
          <div className="row" style={{ gap: 12 }}>
            <span>
              <b>КД</b> {draft.armorClass.value ?? "—"}
            </span>
            <span>
              <b>ХП</b> {formatHitPoints(draft.hitPoints) || "—"}
            </span>
          </div>
          <div className="dnd-abilities-row">
            {ABILITY_LABELS.map(({ key, label }) => (
              <div key={key} className="dnd-ability-box">
                <span className="dnd-ability-label">{label}</span>
                <span className="dnd-ability-score">{draft.abilities[key]}</span>
                <span className="dnd-ability-mod">{formatModifier(abilityModifier(draft.abilities[key]))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <button onClick={onCancel}>Отмена</button>
          {stepIndex > 0 && <button onClick={back}>Назад</button>}
        </div>
        {step === "Обзор" ? (
          <button className="primary" onClick={finish} disabled={saving || !draft.name}>
            {saving ? "Создаю…" : "Создать существо"}
          </button>
        ) : (
          <button className="primary" onClick={next} disabled={step === "База" && !mode}>
            Далее
          </button>
        )}
      </div>
    </div>
  );
}
