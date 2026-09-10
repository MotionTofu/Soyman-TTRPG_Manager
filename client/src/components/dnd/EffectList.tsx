import { memo, useEffect, useState } from "react";
import {
  ATTACK_RANGE_LABELS,
  DAMAGE_TYPE_CHOSEN,
  COST_KIND_LABELS,
  COST_PERIOD_LABELS,
  EFFECT_TYPE_LABELS,
  ROLL_TARGET_LABELS,
  PROFICIENCY_SHARE_LABELS,
  EFFECT_TYPE_ORDER,
  EFFECT_WHEN_LABELS,
  EMPTY_COST,
  MOVEMENT_KIND_LABELS,
  SAVE_ABILITIES,
  allowedWhen,
  checkLabel,
  costSummary,
  effectSummary,
  formatDiceSteps,
  formatLevelSteps,
  parseDiceSteps,
  newCheck,
  newEffect,
  parseLevelSteps,
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
  type DndRollTarget,
  type DndProficiencyShare,
} from "./effects";
import { loadDndMechanicsGroup, type DndMechanicsOption } from "./dndCompendium";
import { ABILITY_LABELS } from "./AbilityScores";
import type { DndAbilityKey } from "../../types";
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
              ячейки, поэтому поля разные и показываются по уровню записи.
              Плюс кубы от уровня класса (пушка +1к8 на 9-м) — своим полем. */}
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
          <input
            placeholder="Куб от ур. класса, напр. 9:3к8"
            title="Кубы от уровня класса-хозяина: 9:3к8, 15:4к6"
            value={formatDiceSteps(effect.levelDice)}
            onChange={(e) => onChange({ levelDice: parseDiceSteps(e.target.value) })}
          />
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
      // Свободный текст остаётся: им описываются условные и кубиковые
      // модификаторы («1к4 к броскам атаки или спасброскам»), которые в число
      // не сводятся. Три поля справа — машинная разметка: только размеченное
      // доходит до производных величин листа. Не размечено — модификатор
      // просто показывается текстом, как показывался всегда.
      return (
        <>
          <input
            placeholder="Модификатор, напр. +1к4"
            value={effect.modifier ?? ""}
            onChange={(e) => onChange({ modifier: e.target.value })}
          />
          <select
            value={effect.appliesTo ?? ""}
            title="К какому броску применяется — чтобы лист мог посчитать"
            onChange={(e) =>
              onChange({ appliesTo: e.target.value ? (e.target.value as DndRollTarget) : undefined })
            }
          >
            <option value="">не размечено</option>
            {(Object.keys(ROLL_TARGET_LABELS) as DndRollTarget[]).map((t) => (
              <option key={t} value={t}>
                {ROLL_TARGET_LABELS[t]}
              </option>
            ))}
          </select>
          {effect.appliesTo && (
            <>
              <input
                type="number"
                style={{ width: 56 }}
                placeholder="+N"
                title="Плоская прибавка"
                value={effect.flat ?? ""}
                onChange={(e) =>
                  onChange({ flat: e.target.value === "" ? undefined : Number(e.target.value) })
                }
              />
              <select
                value={effect.proficiency ?? ""}
                title="Прибавка бонусом мастерства"
                onChange={(e) =>
                  onChange({
                    proficiency: e.target.value ? (e.target.value as DndProficiencyShare) : undefined,
                  })
                }
              >
                <option value="">без бонуса мастерства</option>
                {(Object.keys(PROFICIENCY_SHARE_LABELS) as DndProficiencyShare[]).map((v) => (
                  <option key={v} value={v}>
                    {PROFICIENCY_SHARE_LABELS[v]}
                  </option>
                ))}
              </select>
            </>
          )}
        </>
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
        {check.type === "save" && (
          <select
            value={check.dcAbility ?? ""}
            onChange={(e) => onChange({ dcAbility: (e.target.value as DndAbilityKey) || undefined })}
            title="Чья характеристика задаёт СЛ — пусто: от заклинательной (как было)"
          >
            <option value="">СЛ: заклинатель</option>
            {ABILITY_LABELS.map(({ key, label }) => (
              <option key={key} value={key}>
                СЛ: {label}
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
        {/* Активация тратой ячейки сверх пула (пушка/эликсир/защитник):
            карточка умения предложит свободную ячейку. Работает и без пула
            (kind «none» — воскрешение защитника всегда за слот). */}
        {(cost.kind === "uses" || cost.kind === "none") && (
          <label className="muted" title="Умение можно активировать тратой ячейки заклинания" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={!!cost.slotSpend}
              onChange={(e) => onChange({ ...cost, slotSpend: e.target.checked || undefined })}
            />
            трата ячейки
          </label>
        )}
        {/* Возврат потраченной ячейки (поглощение реплики): карточка
            предложит круги, в которых есть потраченные. */}
        {(cost.kind === "uses" || cost.kind === "none") && (
          <label className="muted" title="Умение возвращает потраченную ячейку заклинания" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={!!cost.slotReturn}
              onChange={(e) => onChange({ ...cost, slotReturn: e.target.checked || undefined })}
            />
            возврат ячейки
          </label>
        )}
        {/* Свой ресурс (структурность): умение приносит собственный пул
            (применения выше, восполнение слева), а не тратит классовый.
            Без галочки uses — только текст цены, механики нет. */}
        {cost.kind === "uses" && (
          <label className="muted" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={!!cost.ownResource}
              onChange={(e) => onChange({ ...cost, ownResource: e.target.checked })}
            />
            свой ресурс
          </label>
        )}
        {/* Максимум пула — модификатор характеристики (минимум 1):
            хоумбрю-пул без правки кода. Без выбора — число применений выше. */}
        {cost.kind === "uses" && cost.ownResource && (
          <select
            value={cost.maxAbility ?? ""}
            title="Максимум пула — модификатор"
            onChange={(e) =>
              onChange({
                ...cost,
                maxAbility: (e.target.value || undefined) as DndAbilityKey | undefined,
                // Без характеристики множителю не на что опереться — сбрасываем.
                ...(e.target.value ? {} : { maxMultiplier: undefined }),
              })
            }
          >
            <option value="">макс. числом</option>
            {ABILITY_LABELS.map(({ key, label }) => (
              <option key={key} value={key}>
                макс. {label}
              </option>
            ))}
          </select>
        )}
        {/* Скейл максимума от уровня класса («3:2, 5:3, 9:4, 15:5» — эликсиры):
            уровень подставляет лист по родителям записи. */}
        {cost.kind === "uses" && cost.ownResource && (
          <input
            value={formatLevelSteps(cost.levelSteps)}
            placeholder="ур:макс"
            title="Максимум по уровню класса: 3:2, 5:3, 9:4, 15:5"
            aria-label="Скейл максимума от уровня"
            onChange={(e) => onChange({ ...cost, levelSteps: parseLevelSteps(e.target.value) })}
            style={{ width: 130 }}
          />
        )}
        {/* Множитель к модификатору («удвоенный мод Интеллекта»): только
            вместе с выбранной характеристикой выше. */}
        {cost.kind === "uses" && cost.ownResource && cost.maxAbility && (
          <input
            type="number"
            className="dnd-effect-dc"
            placeholder="×N"
            title="Множитель к модификатору (пусто = ×1)"
            value={cost.maxMultiplier ?? ""}
            onChange={(e) =>
              onChange({
                ...cost,
                maxMultiplier: e.target.value === "" ? undefined : Math.max(1, Number(e.target.value) || 1),
              })
            }
            style={{ width: 52 }}
          />
        )}
        {/* Восстановление чужой ценой («Крылья»: пополнить за 3 очка
            чародейства): название пула-донора и цена. */}
        {cost.kind === "uses" && cost.ownResource && (
          <span className="muted" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            восст.
            <input
              value={cost.restore?.pool ?? ""}
              placeholder="пул"
              aria-label="Пул-донор восстановления"
              onChange={(e) => {
                const pool = e.target.value;
                onChange(pool ? { ...cost, restore: { pool, amount: cost.restore?.amount ?? 1 } } : { ...cost, restore: undefined });
              }}
              style={{ width: 90 }}
            />
            <input
              type="number"
              className="dnd-effect-dc"
              placeholder="цена"
              aria-label="Цена восстановления"
              value={cost.restore?.amount ?? ""}
              onChange={(e) =>
                onChange({
                  ...cost,
                  restore: { pool: cost.restore?.pool ?? "", amount: e.target.value === "" ? 1 : Number(e.target.value) || 1 },
                })
              }
            />
          </span>
        )}
        {/* Грант короткого отдыха чужому пулу (Отдохнувший гений +1,
            Магическое наставление всё при настройке): пул — названием,
            количество — числом или «full». Сама запись обычно kind none. */}
        {(cost.kind === "uses" || cost.kind === "none") && (
          <span className="muted" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            корот.отдых
            <input
              value={cost.shortRest?.pool ?? ""}
              placeholder="пул"
              aria-label="Пул гранта короткого отдыха"
              onChange={(e) => {
                const pool = e.target.value;
                onChange(
                  pool
                    ? { ...cost, shortRest: { pool, amount: cost.shortRest?.amount ?? 1 } }
                    : { ...cost, shortRest: undefined }
                );
              }}
              style={{ width: 90 }}
            />
            <input
              value={
                cost.shortRest?.amount === "full"
                  ? "full"
                  : (cost.shortRest?.amount ?? "")
              }
              placeholder="1/full"
              title="Сколько вернуть: число или full"
              aria-label="Количество гранта"
              onChange={(e) => {
                const v = e.target.value.trim().toLowerCase();
                onChange({
                  ...cost,
                  shortRest: {
                    pool: cost.shortRest?.pool ?? "",
                    amount: v === "full" ? "full" : Math.max(1, Number(v) || 1),
                  },
                });
              }}
              style={{ width: 56 }}
            />
            <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!cost.shortRest?.needsAttuned}
                onChange={(e) =>
                  onChange({
                    ...cost,
                    shortRest: {
                      pool: cost.shortRest?.pool ?? "",
                      amount: cost.shortRest?.amount ?? 1,
                      ...(e.target.checked ? { needsAttuned: true } : {}),
                    },
                  })
                }
              />
              +настройка
            </label>
          </span>
        )}
        {/* Обман смерти (Душа творения): редкости через запятую и хитов
            за разрушенную реплику. */}
        {(cost.kind === "uses" || cost.kind === "none") && (
          <span className="muted" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            обман смерти
            <input
              value={(cost.deathCheat?.rarities ?? []).join(", ")}
              placeholder="редкости"
              aria-label="Редкости обмана смерти"
              onChange={(e) => {
                const rarities = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                onChange(
                  rarities.length > 0 || (cost.deathCheat?.hpPer ?? 0) > 0
                    ? { ...cost, deathCheat: { rarities, hpPer: cost.deathCheat?.hpPer ?? 20 } }
                    : { ...cost, deathCheat: undefined }
                );
              }}
              style={{ width: 110 }}
            />
            <input
              type="number"
              className="dnd-effect-dc"
              placeholder="хиты"
              aria-label="Хитов за реплику"
              value={cost.deathCheat?.hpPer ?? ""}
              onChange={(e) =>
                onChange({
                  ...cost,
                  deathCheat: {
                    rarities: cost.deathCheat?.rarities ?? [],
                    hpPer: e.target.value === "" ? 20 : Math.max(1, Number(e.target.value) || 20),
                  },
                })
              }
              style={{ width: 56 }}
            />
          </span>
        )}
        {/* Тратить из пула по названию (классовые пулы в ключ зашивают id
            записи класса — из справочника на них ссылаются названием). */}
        {cost.kind === "resource" && (
          <input
            value={cost.resourceLabel ?? ""}
            placeholder="пул по названию"
            title="Тратить из пула с таким названием"
            aria-label="Пул по названию"
            onChange={(e) => onChange({ ...cost, resourceLabel: e.target.value || undefined })}
            style={{ width: 110 }}
          />
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
            {c.dcOverride == null && c.dcAbility ? ` (СЛ: ${ABILITY_LABELS.find((a) => a.key === c.dcAbility)?.label ?? c.dcAbility})` : ""}
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
