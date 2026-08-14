import { memo, useEffect, useState } from "react";
import {
  ATTACK_RANGE_LABELS,
  DAMAGE_TYPE_CHOSEN,
  COST_KIND_LABELS,
  COST_PERIOD_LABELS,
  EFFECT_TYPE_LABELS,
  EFFECT_TYPE_ORDER,
  EFFECT_WHEN_LABELS,
  EMPTY_COST,
  MOVEMENT_KIND_LABELS,
  SAVE_ABILITIES,
  allowedWhen,
  checkLabel,
  costSummary,
  effectSummary,
  newCheck,
  newEffect,
  type DndAttackRange,
  type DndCheck,
  type DndCost,
  type DndCostKind,
  type DndCostPeriod,
  type DndEffect,
  type DndEffectType,
  type DndEffectWhen,
  type DndMechanicsRef,
  type DndMovementKind,
} from "./effects";
import { loadDndMechanicsGroup, type DndMechanicsOption } from "./dndCompendium";
import { NavIcon } from "../NavIcons";

// Chip list for a carrier's checks + effects, modelled on the LitM power/
// weakness tag rows (same .litm-tag CSS) because that layout stays compact
// with many short rows. The difference: a tag there is a string, an effect
// here is a small record — so a chip shows a one-line summary and expands
// its fields inline underneath. Inline rather than a modal on purpose; a
// modal would cost exactly the compactness this borrows the look for.

const DAMAGE_TYPE_GROUP = "Типы урона";
const CONDITION_GROUP = "Состояния";

// Both reference lists live in the same mechanics section, so one pass
// fetches both instead of two round-trips per editor.
function useMechanicsRefs(systemId: number | null) {
  const [damageTypes, setDamageTypes] = useState<DndMechanicsOption[]>([]);
  const [conditions, setConditions] = useState<DndMechanicsOption[]>([]);
  useEffect(() => {
    if (!systemId) return;
    loadDndMechanicsGroup(systemId, DAMAGE_TYPE_GROUP).then(setDamageTypes);
    loadDndMechanicsGroup(systemId, CONDITION_GROUP).then(setConditions);
  }, [systemId]);
  return { damageTypes, conditions };
}

function RefSelect({
  value,
  options,
  placeholder,
  extra,
  onChange,
}: {
  value: DndMechanicsRef | null | undefined;
  options: DndMechanicsOption[];
  placeholder: string;
  // Options that aren't reference entries — currently only the damage type
  // that's picked at cast time.
  extra?: DndMechanicsRef[];
  onChange: (v: DndMechanicsRef | null) => void;
}) {
  const all = [...(extra ?? []), ...options];
  return (
    <select
      value={value?.id ?? ""}
      onChange={(e) => {
        const id = Number(e.target.value);
        const picked = all.find((o) => o.id === id);
        onChange(picked ? { id: picked.id, name: picked.name } : null);
      }}
    >
      <option value="">{placeholder}</option>
      {all.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

// The per-type field set. Kept as one switch rather than a component per
// effect type: each branch is two or three inputs, and splitting them would
// spread one small decision across thirteen files.
function EffectFields({
  effect,
  damageTypes,
  conditions,
  isCantrip,
  onChange,
}: {
  effect: DndEffect;
  damageTypes: DndMechanicsOption[];
  conditions: DndMechanicsOption[];
  isCantrip: boolean;
  onChange: (patch: Partial<DndEffect>) => void;
}) {
  switch (effect.type) {
    case "damage":
    case "heal":
    case "temp_hp":
      return (
        <>
          <input
            placeholder="Кости, напр. 3к6"
            value={effect.dice ?? ""}
            onChange={(e) => onChange({ dice: e.target.value })}
          />
          {effect.type === "damage" && (
            <RefSelect
              value={effect.damageType}
              options={damageTypes}
              extra={[DAMAGE_TYPE_CHOSEN]}
              placeholder="Тип урона"
              onChange={(v) => onChange({ damageType: v })}
            />
          )}
          {/* Заговоры растут по уровню персонажа, заклинания — по кругу
              ячейки, поэтому поля разные и показываются по уровню записи. */}
          {isCantrip ? (
            <input
              placeholder="Прибавка на 5/11/17 ур., напр. 1к8"
              value={effect.cantripScaling ?? ""}
              onChange={(e) => onChange({ cantripScaling: e.target.value })}
            />
          ) : (
            <input
              placeholder="За круг выше, напр. 1к6"
              value={effect.upcastPerLevel ?? ""}
              onChange={(e) => onChange({ upcastPerLevel: e.target.value })}
            />
          )}
        </>
      );
    case "condition":
    case "condition_remove":
      return (
        <RefSelect
          value={effect.condition}
          options={conditions}
          placeholder="Состояние"
          onChange={(v) => onChange({ condition: v })}
        />
      );
    case "movement":
      return (
        <>
          <select
            value={effect.movementKind ?? "push"}
            onChange={(e) => onChange({ movementKind: e.target.value as DndMovementKind })}
          >
            {(Object.keys(MOVEMENT_KIND_LABELS) as DndMovementKind[]).map((k) => (
              <option key={k} value={k}>
                {MOVEMENT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <input
            placeholder="Расстояние, напр. 10 футов"
            value={effect.distance ?? ""}
            onChange={(e) => onChange({ distance: e.target.value })}
          />
        </>
      );
    case "zone":
      return (
        <>
          <input
            placeholder="Форма, напр. сфера"
            value={effect.zoneShape ?? ""}
            onChange={(e) => onChange({ zoneShape: e.target.value })}
          />
          <input
            placeholder="Размер, напр. 20 футов"
            value={effect.zoneSize ?? ""}
            onChange={(e) => onChange({ zoneSize: e.target.value })}
          />
        </>
      );
    case "roll_modifier":
      return (
        <input
          placeholder="Модификатор, напр. +1d4"
          value={effect.modifier ?? ""}
          onChange={(e) => onChange({ modifier: e.target.value })}
        />
      );
    default:
      return null;
  }
}

function CheckRow({
  check,
  onChange,
  onRemove,
}: {
  check: DndCheck;
  onChange: (patch: Partial<DndCheck>) => void;
  onRemove: () => void;
}) {
  return (
    <span className="litm-tag dnd-check-chip">
      <span className="dnd-effect-chip-fields">
        {check.type === "attack" ? (
          <select
            value={check.attackRange ?? "ranged"}
            onChange={(e) => onChange({ attackRange: e.target.value as DndAttackRange })}
          >
            {(Object.keys(ATTACK_RANGE_LABELS) as DndAttackRange[]).map((r) => (
              <option key={r} value={r}>
                Атака {ATTACK_RANGE_LABELS[r]}
              </option>
            ))}
          </select>
        ) : (
          <select value={check.saveAbility ?? ""} onChange={(e) => onChange({ saveAbility: e.target.value })}>
            {SAVE_ABILITIES.map((a) => (
              <option key={a} value={a}>
                Спасбросок {a}
              </option>
            ))}
          </select>
        )}
        <input
          type="number"
          className="dnd-effect-dc"
          placeholder="СЛ"
          title="Своя СЛ — только если она не считается от заклинателя"
          value={check.dcOverride ?? ""}
          onChange={(e) => onChange({ dcOverride: e.target.value === "" ? null : Number(e.target.value) })}
        />
      </span>
      <button type="button" onClick={onRemove} title="Убрать бросок">
        −
      </button>
    </span>
  );
}

function EffectChip({
  effect,
  checks,
  damageTypes,
  conditions,
  isCantrip,
  expanded,
  onToggle,
  onChange,
  onRemove,
}: {
  effect: DndEffect;
  checks: DndCheck[];
  damageTypes: DndMechanicsOption[];
  conditions: DndMechanicsOption[];
  isCantrip: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<DndEffect>) => void;
  onRemove: () => void;
}) {
  const whenOptions = allowedWhen(checks);
  return (
    <div className="dnd-effect-item">
      <span className={`litm-tag dnd-effect-chip${expanded ? " is-open" : ""}`}>
        <button type="button" className="dnd-effect-summary" onClick={onToggle}>
          {effectSummary(effect, checks)}
        </button>
        <button type="button" onClick={onRemove} title="Убрать эффект">
          −
        </button>
      </span>
      {expanded && (
        <div className="dnd-effect-body">
          <EffectFields
            effect={effect}
            damageTypes={damageTypes}
            conditions={conditions}
            isCantrip={isCantrip}
            onChange={onChange}
          />
          {/* Free-form detail is available on every type, not just the ones
              with no structured fields — a Fireball still sometimes needs a
              note, and the alternative is people abusing the dice field. */}
          <input
            placeholder="Уточнение (необязательно)"
            value={effect.text ?? ""}
            onChange={(e) => onChange({ text: e.target.value })}
          />
          <span className="dnd-effect-when">
            <select
              value={effect.when}
              onChange={(e) => {
                const when = e.target.value as DndEffectWhen;
                // Re-point at a check that can actually produce this outcome,
                // so deleting or retyping a check never leaves an effect
                // gated on something that no longer exists.
                const gate =
                  when === "always"
                    ? null
                    : checks.find((c) => (when === "hit" || when === "miss" ? c.type === "attack" : c.type === "save"));
                onChange({ when, checkId: gate?.id ?? null });
              }}
            >
              {whenOptions.map((w) => (
                <option key={w} value={w}>
                  {EFFECT_WHEN_LABELS[w]}
                </option>
              ))}
            </select>
            {effect.type === "damage" && effect.when === "save_fail" && (
              <label className="dnd-effect-half">
                <input
                  type="checkbox"
                  checked={!!effect.halfOnSuccess}
                  onChange={(e) => onChange({ halfOnSuccess: e.target.checked })}
                />
                половина при успехе
              </label>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function CostRow({ cost, onChange }: { cost: DndCost; onChange: (v: DndCost) => void }) {
  return (
    <span className="litm-tag dnd-cost-chip">
      <span className="dnd-effect-chip-fields">
        <select
          value={cost.kind}
          onChange={(e) => onChange({ ...cost, kind: e.target.value as DndCostKind })}
        >
          {(Object.keys(COST_KIND_LABELS) as DndCostKind[]).map((k) => (
            <option key={k} value={k}>
              {COST_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {(cost.kind === "uses" || cost.kind === "resource" || cost.kind === "hit_dice") && (
          <input
            type="number"
            className="dnd-effect-dc"
            placeholder="кол-во"
            value={cost.amount ?? ""}
            onChange={(e) => onChange({ ...cost, amount: e.target.value === "" ? null : Number(e.target.value) })}
          />
        )}
        {cost.kind === "uses" && (
          <select
            value={cost.per ?? "long_rest"}
            onChange={(e) => onChange({ ...cost, per: e.target.value as DndCostPeriod })}
          >
            {(Object.keys(COST_PERIOD_LABELS) as DndCostPeriod[]).map((p) => (
              <option key={p} value={p}>
                {COST_PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        )}
      </span>
    </span>
  );
}

interface Props {
  systemId: number | null;
  checks: DndCheck[];
  effects: DndEffect[];
  cost?: DndCost;
  edit: boolean;
  // Level 0 entries scale on character level instead of slot level, which
  // changes which scaling field the damage effect offers.
  isCantrip?: boolean;
  onChange: (patch: { checks?: DndCheck[]; effects?: DndEffect[]; cost?: DndCost }) => void;
  // Hidden for carriers that can't cost anything (a monster's innate action).
  showCost?: boolean;
}

export const EffectList = memo(function EffectList({
  systemId,
  checks,
  effects,
  cost,
  edit,
  isCantrip = false,
  onChange,
  showCost = true,
}: Props) {
  const { damageTypes, conditions } = useMechanicsRefs(systemId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addingType, setAddingType] = useState(false);

  const safeChecks = checks ?? [];
  const safeEffects = effects ?? [];

  function patchCheck(id: string, patch: Partial<DndCheck>) {
    onChange({ checks: safeChecks.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  }
  function removeCheck(id: string) {
    // Effects gated on this check would otherwise point at nothing and stop
    // rendering their outcome — drop them back to "всегда" instead.
    onChange({
      checks: safeChecks.filter((c) => c.id !== id),
      effects: safeEffects.map((e) =>
        e.checkId === id ? { ...e, checkId: null, when: "always" as DndEffectWhen } : e
      ),
    });
  }
  function patchEffect(id: string, patch: Partial<DndEffect>) {
    onChange({ effects: safeEffects.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  }
  function removeEffect(id: string) {
    onChange({ effects: safeEffects.filter((e) => e.id !== id) });
    if (expandedId === id) setExpandedId(null);
  }
  function addEffect(type: DndEffectType) {
    const created = newEffect(type, safeChecks);
    setAddingType(false);
    onChange({ effects: [...safeEffects, created] });
    setExpandedId(created.id);
  }

  if (!edit) {
    // View mode: no add/remove controls, no expansion — the summary line is
    // the whole point, details live in the entry's description.
    const costText = costSummary(cost);
    if (safeChecks.length === 0 && safeEffects.length === 0 && !costText) return null;
    return (
      <div className="litm-tag-row dnd-effect-row">
        {safeChecks.map((c) => (
          <span key={c.id} className="litm-tag dnd-check-chip">
            {checkLabel(c)}
            {c.dcOverride != null ? ` (СЛ ${c.dcOverride})` : ""}
          </span>
        ))}
        {safeEffects.map((e) => (
          <span key={e.id} className="litm-tag dnd-effect-chip">
            {effectSummary(e, safeChecks)}
          </span>
        ))}
        {costText && <span className="litm-tag dnd-cost-chip">{costText}</span>}
      </div>
    );
  }

  return (
    <div className="litm-tag-row dnd-effect-row">
      {safeChecks.map((c) => (
        <CheckRow
          key={c.id}
          check={c}
          onChange={(patch) => patchCheck(c.id, patch)}
          onRemove={() => removeCheck(c.id)}
        />
      ))}
      <span className="litm-tag litm-tag-add dnd-effect-add">
        <span className="muted">бросок</span>
        <button type="button" onClick={() => onChange({ checks: [...safeChecks, newCheck("attack")] })}>
          + атака
        </button>
        <button type="button" onClick={() => onChange({ checks: [...safeChecks, newCheck("save")] })}>
          + спасбросок
        </button>
      </span>

      {safeEffects.map((e) => (
        <EffectChip
          key={e.id}
          effect={e}
          checks={safeChecks}
          damageTypes={damageTypes}
          conditions={conditions}
          isCantrip={isCantrip}
          expanded={expandedId === e.id}
          onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
          onChange={(patch) => patchEffect(e.id, patch)}
          onRemove={() => removeEffect(e.id)}
        />
      ))}

      {addingType ? (
        <div className="dnd-effect-type-menu">
          {EFFECT_TYPE_ORDER.map((t) => (
            <button key={t} type="button" onClick={() => addEffect(t)}>
              {EFFECT_TYPE_LABELS[t]}
            </button>
          ))}
          <button type="button" className="muted" onClick={() => setAddingType(false)}>
            <NavIcon name="close" />
          </button>
        </div>
      ) : (
        <span className="litm-tag litm-tag-add dnd-effect-add">
          <span className="muted">добавить эффект</span>
          <button type="button" onClick={() => setAddingType(true)}>
            +
          </button>
        </span>
      )}

      {showCost && <CostRow cost={cost ?? EMPTY_COST} onChange={(v) => onChange({ cost: v })} />}
    </div>
  );
});
