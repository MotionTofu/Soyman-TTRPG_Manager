// Лист D&D: жетоны спутников и окно спутника со статблоком.
import type { DndCompanion, CompendiumEntry } from "../../types";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { creatureCardQuery } from "../../data/creatureCard";
import { cardMaxHp, cardAc } from "../CreatureCard";
import { NavIcon } from "../NavIcons";
import { CreatureTypeBadge, creatureTypeName } from "./creatureTypeIcons";
import { stripLatin } from "./sheetShared";
import { EntityPreviewModal } from "../EntityPreviewModal";
import type { CompanionBlueprint } from "./companionFormula";
import { useDndRuntime } from "./DndRuntime";
import { rollDiceFormula } from "./diceRoll";
import { PoolMeter, poolShowsNumber } from "./TofuPips";

export function CompanionToken({
  companion,
  getEntry,
  onRemove,
  onPatch,
}: {
  companion: DndCompanion;
  getEntry: (id: number | null | undefined) => CompendiumEntry | undefined;
  onRemove?: () => void;
  /** Хиты питомца из бестиария (гриллинг 2026-09-24, Q13). */
  onPatch?: (patch: Partial<DndCompanion>) => void;
}) {
  const entry = getEntry(companion.entryId);
  const avatar = entry?.avatar_image_url;
  const [open, setOpen] = useState(false);
  // Максимум — из статблока существа, хранится только израсходованное, как у
  // тел по чертежу. Нет статблока — нет и счётчика.
  const card = useQuery({ ...creatureCardQuery("compendium_entry", companion.entryId ?? 0), enabled: companion.entryId != null });
  const maxHp = cardMaxHp(card.data);
  const hpLeft = maxHp != null ? maxHp - Math.min(companion.hpUsed ?? 0, maxHp) : null;
  const ac = cardAc(card.data);
  // Строкой, как в макете (2026-09-25): «КЗ 12 · хиты 2 / 2», без полосы.
  const meta = [ac != null ? `КЗ ${ac}` : null, maxHp != null && hpLeft != null ? `хиты ${hpLeft} / ${maxHp}` : null]
    .filter(Boolean)
    .join(" · ");
  const body = (
    <>
      {/* Знак типа существа — бейджем поверх лица (полотно «Подвал
          спутников»). Лицо режет содержимое по кругу (overflow), поэтому
          бейдж — сосед лица, а не его потомок. Нет типа — нет бейджа. */}
      <span className="dnd-companion-portrait">
        <span className="dnd-companion-face">
          {avatar ? <img src={avatar} alt="" /> : <NavIcon name="skull" />}
        </span>
        <CreatureTypeBadge type={creatureTypeName(entry)} />
      </span>
      <span className="dnd-companion-text">
        <span className="dnd-companion-name">{stripLatin(entry?.name || companion.name)}</span>
        {meta && <span className="dnd-companion-meta">{meta}</span>}
      </span>
    </>
  );
  return (
    <span className="dnd-companion">
      {/* Окно со статблоком, а не переход в бестиарий: за столом спрашивают
          КЗ и хиты фамильяра посреди боя, и уход со страницы стоит потери
          места на листе — вернуться придётся заново и не туда. */}
      {companion.entryId ? (
        <button type="button" className="dnd-companion-link" onClick={() => setOpen(true)}>
          {body}
        </button>
      ) : (
        <span className="dnd-companion-link">{body}</span>
      )}
      {open && companion.entryId && (
        <EntityPreviewModal type="compendium_entry" id={companion.entryId} onClose={() => setOpen(false)} />
      )}
      {onRemove && (
        <button
          type="button"
          className="comp-mini dnd-companion-remove"
          title="Убрать спутника"
          aria-label={`Убрать спутника: ${companion.name}`}
          onClick={onRemove}
        >
          <NavIcon name="close" />
        </button>
      )}
    </span>
  );
}

// Тело спутника по чертежу (Фаза B): пушка и защитник Артефактора. Жетон
// отвечает «кто это», тело — «сколько хитов и что с ним»: пипсы хитов, КЗ,
// развеивание/возврат, Починка, детонация, укрытие. Максимум хитов и КЗ
// считаются из уровня класса и INT при каждом рендере — ап уровня сам
// поднимает тело; хранится только израсходованное (как у пулов ресурсов).
export function CompanionBody({
  companion,
  blueprint,
  maxHp,
  ac,
  ownerFeatureName,
  ownsDetonate,
  ownsCover,
  previewEntryId,
  variants,
  activeVariant,
  onVariant,
  onPatch,
  onRemove,
}: {
  companion: DndCompanion;
  blueprint: CompanionBlueprint;
  maxHp: number;
  ac: number | null;
  /** Умение-хозяин — подсказка, где пересоздавать мёртвое тело. */
  ownerFeatureName: string;
  ownsDetonate: boolean;
  ownsCover: boolean;
  /** Запись для окна-превью по клику на имя (фича-чертёж или заклинание). */
  previewEntryId?: number | null;
  /** Виды тела из variants чертежа (звери Повелителя зверей). */
  variants?: string[];
  activeVariant?: string;
  onVariant?: (name: string) => void;
  onPatch: (patch: Partial<DndCompanion>) => void;
  onRemove: () => void;
}) {
  const [hurt, setHurt] = useState("");
  const [lastMend, setLastMend] = useState<number | null>(null);
  const { allowDiceRolls, detached } = useDndRuntime();
  const [previewOpen, setPreviewOpen] = useState(false);
  const used = Math.min(companion.hpUsed ?? 0, maxHp);
  const left = maxHp - used;
  // Знак типа и у тел по чертежу: тип берётся из самого чертежа
  // (`companion.type` записи компендиума). Не проставлен — знака нет.
  const typeBadge = <CreatureTypeBadge type={blueprint.type} size={17} />;
  const nameNode = previewEntryId && !detached ? (
    <>
      {typeBadge}
      <button type="button" className="dnd-spell-name-link" onClick={() => setPreviewOpen(true)}>
        {companion.name}
      </button>
      {previewOpen && (
        <EntityPreviewModal type="compendium_entry" id={previewEntryId} onClose={() => setPreviewOpen(false)} />
      )}
    </>
  ) : (
    <strong className="row" style={{ gap: 5, alignItems: "center" }}>
      {typeBadge}
      {companion.name}
    </strong>
  );
  if (companion.dead) {
    return (
      <div className="dnd-companion-body is-dead">
        <div className="row" style={{ justifyContent: "space-between" }}>
          {nameNode}
          <button type="button" className="comp-mini danger" onClick={onRemove} aria-label={`Убрать тело: ${companion.name}`}>
            <NavIcon name="close" />
          </button>
        </div>
        <span className="muted">Уничтожен — пересоздание через «{ownerFeatureName}».</span>
      </div>
    );
  }
  if (companion.dismissed) {
    return (
      <div className="dnd-companion-body is-dismissed">
        <div className="row" style={{ justifyContent: "space-between" }}>
          {nameNode}
          <button type="button" className="comp-mini danger" onClick={onRemove} aria-label={`Убрать тело: ${companion.name}`}>
            <NavIcon name="close" />
          </button>
        </div>
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <span className="muted">Развеян.</span>
          <button type="button" className="comp-mini" onClick={() => onPatch({ dismissed: false })}>
            Вернуть
          </button>
        </div>
      </div>
    );
  }
  const applyHurt = () => {
    const n = Math.floor(Number(hurt));
    if (!Number.isFinite(n) || n <= 0) return;
    const next = used + n;
    onPatch({ hpUsed: next, ...(next >= maxHp ? { dead: true } : {}) });
    setHurt("");
  };
  // Числовое лечение (починка защитника, отдых у костра и т.п.): пипсами
  // тридцать хитов не натыкать, а кнопки Починки есть только у пушки.
  const applyHeal = () => {
    const n = Math.floor(Number(hurt));
    if (!Number.isFinite(n) || n <= 0) return;
    onPatch({ hpUsed: Math.max(0, used - n) });
    setHurt("");
  };
  const mend = () => {
    if (!blueprint.mending || !allowDiceRolls) return;
    const rolled = rollDiceFormula(blueprint.mending) ?? 0;
    onPatch({ hpUsed: Math.max(0, used - rolled) });
    setLastMend(rolled);
  };
  return (
    <div className="dnd-companion-body">
      <div className="row" style={{ justifyContent: "space-between" }}>
        {nameNode}
        <span className="row" style={{ gap: 6, alignItems: "center" }}>
          {companion.spellEntryId != null && companion.spellLevel != null && (
            <span className="muted">круг {companion.spellLevel}</span>
          )}
          {ac != null && <span className="muted">КЗ {ac}</span>}
          <button type="button" className="comp-mini danger" onClick={onRemove} aria-label={`Убрать тело: ${companion.name}`}>
            <NavIcon name="close" />
          </button>
        </span>
      </div>
      <PoolMeter
        max={maxHp}
        left={left}
        label={`${companion.name}: хиты`}
        onSetLeft={(next) => onPatch({ hpUsed: maxHp - next, ...(maxHp - next >= maxHp ? { dead: true } : {}) })}
      />
      {/* Число уже стоит в шкале, когда максимум велик, — второй раз его
          не пишем. */}
      {!poolShowsNumber(maxHp) && (
        <span className="dnd-pool-count">
          {left} из {maxHp}
        </span>
      )}
      {/* Виды тела (звери Повелителя зверей): смена вида — новое тело. */}
      {(variants ?? []).length > 1 && onVariant && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {(variants ?? []).map((v) => (
            <button
              key={v}
              type="button"
              className="comp-mini"
              disabled={v === activeVariant}
              title={v === activeVariant ? "Текущий вид" : `Сменить вид: ${v} (новое тело, полные хиты)`}
              aria-pressed={v === activeVariant}
              onClick={() => onVariant(v)}
            >
              {v}
            </button>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="number"
          value={hurt}
          onChange={(e) => setHurt(e.target.value)}
          placeholder="число"
          aria-label={`Урон или лечение: ${companion.name}`}
          style={{ width: 64 }}
        />
        <button type="button" className="comp-mini" onClick={applyHurt}>
          Ударить
        </button>
        <button type="button" className="comp-mini" onClick={applyHeal}>
          Вылечить
        </button>
        {blueprint.mending && allowDiceRolls && (
          <button type="button" className="comp-mini" title={`Починка: ${blueprint.mending}`} onClick={mend}>
            Починка {blueprint.mending}
            {lastMend != null ? ` (${lastMend})` : ""}
          </button>
        )}
        {blueprint.dismissable && (
          <button type="button" className="comp-mini" onClick={() => onPatch({ dismissed: true })}>
            Развеять
          </button>
        )}
        {ownsDetonate && (
          <button
            type="button"
            className="comp-mini danger"
            title="Пушка уничтожается; спасбросок — строкой «Взрывная пушка» в Действиях"
            onClick={() => onPatch({ dead: true })}
          >
            Детонировать
          </button>
        )}
        <button type="button" className="comp-mini" onClick={() => onPatch({ dead: true })}>
          Мёртв
        </button>
      </div>
      {ownsCover && (
        <span className="muted">Укрытие на половину в радиусе 10 футов от пушки.</span>
      )}
      {blueprint.actions && blueprint.actions.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          {blueprint.actions.map((a, k) => (
            <span key={k} className="muted">
              {a.name && <strong>{a.name}. </strong>}
              {a.note}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
