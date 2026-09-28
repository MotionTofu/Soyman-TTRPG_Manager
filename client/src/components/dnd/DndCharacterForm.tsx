import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { write } from "../../data/hooks";
import { afterWriteAnywhere } from "../../data/imperative";
import { showSaveError } from "../../data/notices";
import type { CompendiumEntry, DndAbilityKey, DndActionTiming, DndCharacterData, DndCompanion, DndElixir, DndPinnedAction, DndReplicaItem, DndClassEntry, DndEquipmentItem, DndFeature, DndManualAttack, DndSpellEntry } from "../../types";
import { ABILITY_LABELS, ABILITY_NAME_TO_KEY, abilityModifier, characterSpellcastingAbility, classSkillChoiceTotal, classSkillPool, formatModifier, parseAbilityNames, parseBonus, SKILLS_BY_ABILITY } from "./AbilityScores";
import { AbilitySavesSkillsEdit, AbilitySavesSkillsView } from "./AbilitySavesSkills";
import { useDndSkills } from "./useDndSkills";
import { saveDndPrefs } from "../../dndPrefs";
import { loadDndClassProgressions, loadDndSpellIndex } from "./dndCompendium";
import { ABILITY_KEY_ABBR, type DndEffect } from "./effects";
import { useCompendiumEntries } from "./useCompendiumEntries";
import { FeatPending } from "./FeatPending";
import { sheetClassColor, textOnClassColor } from "./dndClassColors";
import { DEFAULT_PORTRAIT_FOCUS, useFrameDrag } from "./portraitFrame";
import { PortraitFrameModal, portraitImgStyle } from "./PortraitFrameModal";
import { DndDie } from "./DndDie";
import { PoolMeter } from "./TofuPips";
import {
  blueprintFromEntryData,
  companionClassId,
  companionMaxCount,
  companionStats,
  companionsAfterLongRest,
  liveCompanionsOf,
  liveSummonOf,
  resolveBlueprintVariant,
  type CompanionBlueprint,
} from "./companionFormula";
import { useDndRuntime } from './DndRuntime';
import { DndCardBack } from "./DndCardBack";
import { DndLevelUpWizard } from "./DndLevelUpWizard";
import type { LevelUpDraftHost } from "./dndLevelUpDraft";
import { DndTransferBox } from "./DndTransferBox";
import {
  fetchCharacterInbox,
  markInboxMessageRead,
  saveInboxMessageAsNote,
  type CharacterInboxMessage,
} from "./characterInbox";
import {
  fetchTransfers,
  offerItemTransfer,
  offerMoneyTransfer,
  transferAction,
  type CharacterTransfer,
} from "./characterTransfers";
import { getCachedUser } from "../../api/currentUser";
import { armorProfNames, findCarryDoublings } from "./dndEquipment";
import { deadEntryIds, hasFailedEntries, retryFailedEntries } from "./entryCache";
import { deadLinkNames } from "./deadLinks";
import { arcanumCountByCircle, arcanumTopCircle, computeSpellSlots, effectiveCasterLevel, highestCircle, isRoundUpCaster, sourceCasterKind } from "./dndSlots";
import { cantripsAtLevel, classPreparedFormula, formulaPreparedLimit, preparedAtLevel, type ClassProgression } from "./progression";
import { AutoFeatureListEdit, FeatureListEdit } from "./FeatureList";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { MentionText } from "../mentions/MentionText";
import {
  isItemMonkWeapon,
  resolveMartialArts,
  unarmoredMovementBonus,
  upgradeDamageDie,
} from "./dndMonk";
import { allResources, featurePools, nameMatches, type ClassResourceSource, type ReplicaBonus, type ReplicaGeneric, type ReplicateScheme } from "./dndResources";
import { Modal } from "../Modal";
import { CardSpread, CardTile } from "./DndCards";
import { openMentionPreview } from "../mentions/mentionPreviewStore";
import { useConfirm } from "../../hooks/useConfirm";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useDndPrefs } from "../../hooks/useDndPrefs";
import { lineageDamageType, liveEffectEntryIds, TIMING_KEY_TO_LABEL, withGrantedSenses, withLineageDamage, withLiveEffects, INSPIRATION_TOKEN_ENABLED, RECEIVED_SPELLS_ENABLED } from "./dndFeatures";
import { classSpellPicks } from "./classSpellPicks";
import { ChecklistEditor, formatSpeed, SensesEditor, SpeedEditor } from "./DndCreatureForm";
import { linkFeatsByName, loadDndFeats } from "./dndCompendium";
import { rasterAsset } from "../../rasterAssets";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTabState } from "../../hooks/useTabState";
import { CompendiumEntryPicker } from "../MonsterTemplatePicker";
import { classAndLevelSummary } from "./dndSummary";
import { deriveSheet, weaponEffects, type WeaponUse } from "@shared/dnd/derive";
import { wornArmorState } from "./armorClass";
import { NavIcon } from "../NavIcons";
import { type DndViewTab, useOneShotOverlayFocus, DND_VIEW_TABS, stripLatin, TabEditToggle, LabeledEditButton, SheetModalHead } from "./sheetShared";
import { spellNameParts, buildSpellDetail, SpellFields, FULL_LIST_CLASSES, DndClassSpellListModal, DndArcanumPicker, DndSpellsView } from "./SheetSpells";
import { equippedWeaponSummaries, type AttackRow, weaponAttackRows, combatSpellRows, featureActionRows, manualAttackRows, pickBookmarks, walkDieParts, ActionInfoModal, SpendAction, DndActionPools, AttacksTable } from "./SheetCombat";
import { DndOriginEditForm, NARRATIVE_FIELDS, useDndOrigin } from "./SheetOrigin";
import { resolveSpell, resolveFeature, recomputeGrantedSpells, spellSnapshotFromEntry } from "./grantedSpells";
import { hitDicePools, DndRestModal, DndResourcesView } from "./SheetRest";
import { DeathSaveOverlay, AcQuickBox, HpQuickBox, InitiativeQuickBox, ActiveConditionIcons, ConditionsBox, LiveChip, InitiativePlate } from "./SheetVitals";
import { CompanionBody, CompanionToken } from "./SheetCompanions";
import { DndSkillsView, FightingStyleCounter, EntryChoiceCounter, WeaponMasteryEdit } from "./SheetProficiencies";
import { EquipmentLoadPlate, DndEquipmentEdit, DndEquipmentQuickView } from "./SheetEquipment";

// Нормализация листа и «пустой лист» переехали в общий с сервером пакет:
// разбор старых форматов нужен и серверу, а внутри React-файла он ему был
// недоступен. Реэкспорт оставлен — их зовут визарды, превью и импорт.
export { emptyDndCharacter, normalizeDndCharacter } from "@shared/dnd/normalize";

const TIMING_OPTIONS: DndActionTiming[] = ["action", "bonus", "reaction", "other"];

// Hand-typed "Атаки" rows (requirement: split "Бой" into Действия/Бонусные/
// Реакции/Особое) — a small dedicated editor rather than reusing
// FeatureListEdit, since the timing select only makes sense here and
// FeatureListEdit's DndFeature shape is shared by five other, unrelated lists.
const AttackListEdit = memo(function AttackListEdit({
  values,
  onChange,
}: {
  values: DndManualAttack[];
  onChange: (v: DndManualAttack[]) => void;
}) {
  const [confirmDialog, confirm] = useConfirm();
  function update(i: number, patch: Partial<DndManualAttack>) {
    const next = values.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  async function remove(i: number) {
    const name = values[i]?.name?.trim();
    if (!(await confirm({
      message: name ? `Удалить атаку «${name}»?` : "Удалить эту атаку?",
      confirmLabel: "Удалить",
      danger: true,
    }))) return;
    onChange(values.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...values, { name: "", description: "", timing: "action" }]);
  }
  return (
    <div className="dnd-feature-section">
      {confirmDialog}
      <div className="dnd-feature-header dnd-header-actions">Атаки</div>
      <div className="stack">
        {values.map((a, i) => (
          <div key={i} className="dnd-feature-row">
            <div className="row">
              <input
                placeholder="Название"
                value={a.name}
                onChange={(e) => update(i, { name: e.target.value })}
                style={{ flex: 1 }}
              />
              <select value={a.timing} onChange={(e) => update(i, { timing: e.target.value as DndActionTiming })}>
                {TIMING_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {TIMING_KEY_TO_LABEL[t]}
                  </option>
                ))}
              </select>
              <button type="button" className="comp-mini" onClick={() => remove(i)} aria-label="Убрать строку">
                <NavIcon name="close" />
              </button>
            </div>
            {a.timing === "other" && (
              <input
                placeholder="Сколько занимает (напр. «10 минут», «Не требует действия»)"
                value={a.timingOther ?? ""}
                onChange={(e) => update(i, { timingOther: e.target.value })}
              />
            )}
            <MentionTextarea value={a.description} onChange={(v) => update(i, { description: v })} rows={2} />
          </div>
        ))}
        <button type="button" onClick={add} style={{ alignSelf: "flex-start" }}>
          + Добавить
        </button>
      </div>
    </div>
  );
});

// Все id, которые листу нужно догрузить одной пачкой.
function sheetEntryIds(value: DndCharacterData): (number | null | undefined)[] {
  const spells = [...value.cantrips, ...value.spellsByLevel.flat()].map((s) => s.entryId);
  const features = [
    ...value.classFeatures,
    ...value.speciesFeatures,
    ...value.feats,
    ...value.specialAbilities,
  ].map((f) => f.entryId);
  // Записи классов нужны ради таблиц развития (по ним считаются ячейки) и
  // стартовых наборов; предыстория — только ради набора. Подклассы — ради
  // их прогрессий (кости превосходства, ячейки Мистического рыцаря) и
  // заклинательной характеристики.
  const classes = value.classes.map((c) => c.classId);
  const subclasses = value.classes.map((c) => c.subclassId);
  // Спутники: их записи не запрашивались вовсе, хотя жетон рисует портрет из
  // бестиария (`entry.avatar_image_url`) и теперь ещё знак типа. Без запроса
  // `getEntry` всегда пуст — жетон навсегда оставался черепом-заглушкой.
  // Что это было упущение, а не решение, видно по `deadLinkNames`: спутников
  // она уже считает (найдено 09.09 при подключении знаков типов).
  const companions = (value.companions ?? []).flatMap((c) => [c.entryId, c.featureEntryId, c.spellEntryId, c.classId]);
  return [...spells, ...features, ...classes, ...subclasses, ...companions, ...liveEffectEntryIds(value), value.raceId, value.backgroundId];
}

// Обман смерти («Душа творения», 20 ур.): на нуле хитов разрушить N созданных
// реплик указанных редкостей → хиты = hpPer × N. Редкость читается из записи
// схемы; какие именно разрушать — решает игрок, лист снимает старейшие
// (порядок массива = порядок создания). Кроме мгновенной смерти — на
// честности стола, лист её не объявляет (как и весь урон).
function SoulCheat({
  rarities,
  hpPer,
  items,
  getEntry,
  onCheat,
}: {
  rarities: string[];
  hpPer: number;
  items: DndReplicaItem[];
  getEntry: (id: number | null | undefined) => CompendiumEntry | undefined;
  onCheat: (count: number, destroyIds: string[]) => void;
}) {
  const [n, setN] = useState("1");
  const eligible = items.filter((it) => {
    const data = getEntry(it.schemeEntryId)?.data as { rarity?: unknown } | undefined;
    return typeof data?.rarity === "string" && rarities.includes(data.rarity);
  });
  if (eligible.length === 0) return null;
  const count = Math.min(Math.max(1, Math.floor(Number(n) || 1)), eligible.length);
  return (
    <div className="stack sb-death-saves" style={{ gap: 4 }}>
      <span className="muted">
        Обман смерти: разрушьте реплики ({eligible.length} подходят) — хиты станут {hpPer} за каждую.
        Кроме мгновенной смерти; разрушаются старейшие.
      </span>
      <div className="row" style={{ gap: 6, alignItems: "center" }}>
        <input
          type="number"
          value={n}
          min={1}
          max={eligible.length}
          onChange={(e) => setN(e.target.value)}
          style={{ width: 56 }}
          aria-label="Реплик разрушить"
        />
        <button
          type="button"
          className="comp-mini danger"
          onClick={() => {
            onCheat(count, eligible.slice(0, count).map((e) => e.id));
            setN("1");
          }}
        >
          Разрушить → {hpPer * count} хитов
        </button>
      </div>
    </div>
  );
}

// Эликсиры алхимика на руках (таблица 1к6 — в данных умения, elixirTable).
// За столом кубики кидают сами: бросок снаружи → ткнуть эффект в пикер;
// [🎲] — для тех, кто кидает приложухой (6 = «выбери сам», как в книге).
// Пул созданий живёт отдельно (тратится кнопками выше); здесь — что за
// эликсиры фактически на руках. На долгом отдыхе сгорают (чистит отдых).
function ElixirBox({
  table,
  elixirs,
  onChange,
}: {
  table: { key: string; name: string; short: string }[];
  elixirs: DndElixir[];
  onChange: (next: DndElixir[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const add = (effect: string) => {
    onChange([
      ...elixirs,
      { id: `elixir-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, effect },
    ]);
  };
  const roll = () => {
    const d = 1 + Math.floor(Math.random() * 6);
    if (d >= table.length) {
      // Последний ряд таблицы — «на выбор»: кубик его не даёт, открываем список.
      setPicking(true);
      return;
    }
    add(table[d - 1].key);
  };
  const nameOf = (effect: string) => table.find((t) => t.key === effect)?.name ?? effect;
  return (
    <div className="stack" style={{ gap: 6, alignItems: "flex-start" }}>
      <strong>Эликсиры на руках ({elixirs.length})</strong>
      {elixirs.length === 0 && <span className="muted">Пусто — создайте на долгом отдыхе.</span>}
      {elixirs.map((e) => (
        <div key={e.id} className="row" style={{ gap: 6, alignItems: "center" }}>
          <span style={{ flex: "1 1 auto" }}>{nameOf(e.effect)}</span>
          <button
            type="button"
            className="comp-mini"
            title="Выпито или вылито — флакон исчезает"
            onClick={() => onChange(elixirs.filter((x) => x.id !== e.id))}
          >
            Выпито
          </button>
        </div>
      ))}
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="comp-mini" onClick={() => setPicking((v) => !v)}>
          {picking ? "Скрыть список" : "Выбрать эффект"}
        </button>
        <button type="button" className="comp-mini" title="Бросок 1к6 по таблице (6 — выбираете сами)" onClick={roll}>
          🎲 Случайный
        </button>
      </div>
      {picking && (
        <div className="stack" style={{ gap: 2 }}>
          {table.map((t) => (
            <button
              key={t.key}
              type="button"
              className="comp-mini"
              style={{ textAlign: "left", alignSelf: "stretch" }}
              title={t.short}
              onClick={() => {
                add(t.key);
                setPicking(false);
              }}
            >
              {t.name} <span className="muted">— {t.short}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Пассивные свойства персонажа: скорости, чувства, защиты и заметки класса
// (владения и стартовое снаряжение, которые заполняет выбор класса). До
// роспуска формы правки всё это хранилось, но нигде не показывалось — лист
// молчал о том, что персонаж имеет сопротивление яду.
// Поиск по листу. Главный вопрос игрока за столом — «что оно делает», а не
// «на какой оно вкладке»: поэтому результат заклинания или умения открывает
// его карточку сразу, а не переключает раздел и оставляет искать глазами.
// У того, что карточки не имеет (навыки, свободно вписанные предметы),
// остаётся переход на вкладку с подсветкой строки.
interface SheetSearchHit {
  key: string;
  name: string;
  tab: DndViewTab;
  /** Заклинание или умение — открывается карточкой прямо из поиска. */
  card?: { kind: "spell"; spell: DndSpellEntry } | { kind: "feature"; feature: DndFeature };
  /** Всё остальное — подсветка строки на своей вкладке. */
  highlight?: string;
  meta?: string;
}

function collectSheetHits(
  value: DndCharacterData,
  liveCantrips: DndSpellEntry[],
  liveSpellsByLevel: DndSpellEntry[][],
  liveFeatureGroups: DndFeature[][]
): SheetSearchHit[] {
  const hits: SheetSearchHit[] = [];
  const spellLabel = (lvl: number) => (lvl === 0 ? "Заговор" : `${lvl} круг`);
  liveCantrips.forEach((sp, i) =>
    hits.push({ key: `spell-0-${i}`, name: sp.name, tab: "Магия", meta: spellLabel(0), card: { kind: "spell", spell: sp } })
  );
  liveSpellsByLevel.forEach((lvl, li) =>
    lvl.forEach((sp, i) =>
      hits.push({
        key: `spell-${li + 1}-${i}`,
        name: sp.name,
        tab: "Магия",
        meta: spellLabel(li + 1),
        card: { kind: "spell", spell: sp },
      })
    )
  );
  // Порядок строго как в liveFeatureGroups у вызывающего: классовые, видовые,
  // черты, особые умения.
  const groupNames = ["Классовая особенность", "Видовая особенность", "Черта", "Особое умение"];
  liveFeatureGroups.forEach((group, gi) =>
    group.forEach((f, i) =>
      hits.push({
        key: `feature-${gi}-${i}`,
        name: f.name || "Без названия",
        tab: "Особенности",
        meta: groupNames[gi],
        card: { kind: "feature", feature: f },
      })
    )
  );
  value.equipmentSections.forEach((sec, si) =>
    sec.items.forEach((it, i) => {
      if (!it.name) return;
      hits.push({
        key: `equip-${si}-${i}`,
        name: it.name,
        tab: "Снаряжение",
        meta: sec.name || "Снаряжение",
        highlight: `equip-${si}-${i}`,
      });
    })
  );
  for (const { key, label } of ABILITY_LABELS) {
    for (const skill of SKILLS_BY_ABILITY[key]) {
      hits.push({ key: `skill-${skill}`, name: skill, tab: "Навыки", meta: label, highlight: `skill-${skill}` });
    }
  }
  value.proficiencies.forEach((pr, i) => {
    if (!pr.name) return;
    hits.push({ key: `prof-${i}`, name: pr.name, tab: "Навыки", meta: "Владение", highlight: `prof-${i}` });
  });
  return hits;
}

function DndCardModal({
  title,
  spell,
  feature,
  getEntry,
  extra,
  onClose,
}: {
  title: string;
  spell?: DndSpellEntry | null;
  feature?: DndFeature | null;
  getEntry: (id: number | null | undefined) => CompendiumEntry | undefined;
  /** Действие в подвале окна — например «Потратить ячейку». */
  extra?: ReactNode;
  onClose: () => void;
}) {
  const entry = spell?.entryId ? getEntry(spell.entryId) : undefined;
  // Заголовок приходит одной строкой (имя строки действия либо умения).
  // Русское имя ставим в полный голос, оригинал — тихой подписью под ним:
  // так название читается сразу, а опознаватель не спорит с ним за внимание.
  const { ru, en } = spellNameParts({ name: title, nameOriginal: spell?.nameOriginal ?? entry?.name_original });
  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-spell-modal">
        <SheetModalHead title={ru} sub={en} onClose={onClose} />
        {spell && entry && (() => {
          const d = buildSpellDetail(entry);
          return (
            <>
              <SpellFields detail={d} />
              <MentionText text={d.description} />
            </>
          );
        })()}
        {spell && !entry && <span className="muted">Описание берётся из компендиума — запись не найдена.</span>}
        {feature && <MentionText text={feature.description} />}
        {extra}
      </div>
    </Modal>
  );
}

function DndSheetSearch({
  hits,
  onGo,
  getEntry,
  openCard,
  setOpenCard,
}: {
  hits: SheetSearchHit[];
  onGo: (hit: SheetSearchHit) => void;
  getEntry: (id: number | null | undefined) => CompendiumEntry | undefined;
  openCard: SheetSearchHit | null;
  setOpenCard: (hit: SheetSearchHit | null) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const found = q ? hits.filter((h) => h.name.toLowerCase().includes(q)).slice(0, 12) : [];

  function pick(hit: SheetSearchHit) {
    setQuery("");
    if (hit.card) setOpenCard(hit);
    onGo(hit);
  }

  return (
    <div className="dnd-sheet-search">
      <input
        type="search"
        value={query}
        placeholder="Найти на листе: заклинание, умение, предмет, навык…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("");
          if (e.key === "Enter" && found.length > 0) pick(found[0]);
        }}
      />
      {q && (
        <div className="dnd-sheet-search-results">
          {found.length === 0 ? (
            <div className="dnd-sheet-search-empty muted">Ничего не нашлось</div>
          ) : (
            found.map((h) => (
              <button
                key={h.key}
                type="button"
                className="dnd-sheet-search-hit"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(h);
                }}
              >
                <span className="dnd-sheet-search-name">{h.name}</span>
                <span className="dnd-sheet-search-where">
                  {h.tab}
                  {h.meta ? ` · ${h.meta}` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      )}
      {openCard?.card && (
        <DndCardModal
          title={openCard.name}
          spell={openCard.card.kind === "spell" ? openCard.card.spell : null}
          feature={openCard.card.kind === "feature" ? openCard.card.feature : null}
          getEntry={getEntry}
          onClose={() => setOpenCard(null)}
        />
      )}
    </div>
  );
}

function DndTraitsView({ value }: { value: DndCharacterData }) {
  const prefs = useDndPrefs();
  // Скорость и сопротивления — посчитанные: черты («Подвижный» +10,
  // «Портальный странник») доходят сюда эффектами (гриллинг черт 2026-09-24).
  const sheet = deriveSheet(value);
  const walk = sheet.walkSpeed.parts.length > 1 ? { ...value.speeds, walk: sheet.walkSpeed.value } : value.speeds;
  const speeds = formatSpeed(walk, prefs.distanceUnit);
  const senses = value.sensesList
    .map((sn) => [sn.name, sn.distance].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");
  const defences: [string, string[]][] = [
    ["Уязвимости", value.damageVulnerabilities],
    ["Сопротивления", sheet.damageResistances.map((r) => (r.source ? `${r.name} (${r.source})` : r.name))],
    ["Иммунитет к урону", value.damageImmunities],
    ["Иммунитет к состояниям", value.conditionImmunities],
  ];
  const rows: [string, string][] = [];
  if (speeds) rows.push(["Скорости", speeds]);
  if (senses) rows.push(["Чувства", senses]);
  for (const [label, list] of defences) if (list.length > 0) rows.push([label, list.join(", ")]);
  const notes = value.notes?.trim();
  // §1.11: показывать нечего — блок не показывается.
  if (rows.length === 0 && !notes) return null;
  // Той же секцией, что и группы умений, но без шеврона: строки здесь не
  // раскрываются, и это должно быть видно до клика (разбор 2026-09-11).
  return (
    <>
      {rows.length > 0 && (
        <div className="dnd-feat-section">
          <div className="dnd-feat-section-head">
            <span className="dnd-feat-section-mark" aria-hidden="true" />
            <span className="dnd-feat-section-title">Свойства</span>
          </div>
          <div className="dnd-feat-list">
            {rows.map(([label, text]) => (
              <div key={label} className="dnd-feat-prop">
                <span className="dnd-feat-prop-label">{label}</span>
                <span className="dnd-feat-prop-value">{text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {notes && (
        <div className="dnd-feat-section">
          <div className="dnd-feat-section-head">
            <span className="dnd-feat-section-mark" aria-hidden="true" />
            <span className="dnd-feat-section-title">Заметки класса</span>
          </div>
          <div className="dnd-feat-notes">
            <MentionText text={notes} />
          </div>
        </div>
      )}
    </>
  );
}

function SbFeatureGroup({ title, values }: { title: string; values: DndFeature[] }) {
  // Описание раскрывается прямо под строкой, а не модалкой (решение владельца
  // 2026-09-04). Модалка перекрывала лист целиком и требовала закрытия, чтобы
  // сверить особенность с соседней; за столом это лишний шаг. Открыта всегда
  // одна — иначе список уезжает с экрана.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (values.length === 0) return null;
  // Бейдж уровня — только если уровни в группе различаются. «Ур. 1» у всех
  // видовых (или у всех классовых на первом уровне) ничего не сообщает и
  // только шумит. Строки без уровня (добавленные руками) в счёт не идут.
  const showLevels = new Set(values.map((f) => f.level).filter((l) => l != null && l > 0)).size > 1;
  return (
    <details className="dnd-feat-section" open>
      <summary className="dnd-feat-section-head">
        <span className="dnd-feat-section-mark" aria-hidden="true" />
        <span className="dnd-feat-section-title">{title}</span>
        <span className="dnd-feat-section-count">{values.length}</span>
        <NavIcon name="chevron" className="chevron-icon" />
      </summary>
      {/* Строки — одним листом под заголовком (макет 2026-09-25). */}
      <div className="dnd-feat-list">
        {values.map((f, i) => {
          const open = openIndex === i;
          return (
            <div key={i} className={`dnd-feat-item${open ? " is-open" : ""}`}>
              <button
                type="button"
                className="dnd-feat-row"
                aria-expanded={open}
                onClick={() => setOpenIndex(open ? null : i)}
              >
                <span className="dnd-feat-name">{f.name || "Без названия"}</span>
                {showLevels && f.level ? <span className="dnd-feat-level">ур. {f.level}</span> : null}
                <NavIcon name="chevron" className={`chevron-icon${open ? " is-open" : ""}`} />
              </button>
              {open && (
                <div className="dnd-feat-description">
                  <MentionText text={f.description} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

// Compact GM/player summary card — same content, .card-mini layout.
function DndCharacterViewMini({ value }: { value: DndCharacterData }) {
  const classLine = classAndLevelSummary(value.classes);
  // КЗ собирает общий модуль: сборка «формула + защита без доспехов» была
  // здесь, в основном виде листа и в шпаргалках — тремя посимвольно
  // одинаковыми копиями.
  const computedAc = deriveSheet(value).armorClass.value;
  return (
    <div className="sb-scope">
      <div className="sb-card card-mini">
        <div className="sb-head">
          <div className="sb-head-row">
            <div className="sb-name">{value.characterName || "Без имени"}</div>
            {classLine && <div style={{ fontSize: "var(--fs-meta)", opacity: 0.8 }}>{classLine}</div>}
          </div>
        </div>
        <div className="sb-body">
          <div className="mini-vitals">
            <span>
              <b>КЗ</b> {computedAc}
            </span>
            {(value.hitPointMax || value.hitPointsCurrent) && (
              <span>
                <b>ХП</b> {value.hitPointsCurrent || "0"}/{value.hitPointMax || "0"}
              </span>
            )}
            {value.speed && (
              <span>
                <b>Ск.</b> {value.speed}
              </span>
            )}
          </div>
          <div className="mini-abilities">
            {ABILITY_LABELS.map(({ key, label }) => (
              <span key={key}>
                <b>{label[0]}</b> {formatModifier(abilityModifier(value.abilities[key]))}
              </span>
            ))}
          </div>
          {[
            ...value.attacks,
            ...equippedWeaponSummaries(value.equipmentSections),
            ...value.speciesFeatures,
            ...value.classFeatures,
            ...value.feats,
            ...value.specialAbilities,
          ].map((f, i) => (
            <div key={i} className="mini-action">
              {f.name && <b>{f.name}.</b>} <MentionText text={f.description} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Кнопка веера: миниатюра колоды — 8 квадратиков (4 ряда по 2, по числу карт).
// Один размер со всеми инструментальными кнопками вкладок (dnd-tab-btn):
// предсказуемость важнее экономии пикселей.
function DndFanButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="dnd-tab-btn dnd-fan-btn" title="Колода карт" aria-label="Открыть колоду карт" onClick={onOpen}>
      <span className="dnd-fan-btn-grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} />
        ))}
      </span>
    </button>
  );
}

// Разворот колоды веером (гриллинг 2026-09-04, Q33). Свайпать через три
// карты до нужной — бред, а полоска названий на телефоне узкая: в неё влезает
// шесть названий из восьми. Свайп вниз раскладывает всю колоду миниатюрами, и
// он же объясняет устройство листа тому, кто открыл его впервые — Мастеру,
// заглянувшему в чужой чарник.
function DndDeckFan({
  current,
  pendingItems,
  subtitle,
  details,
  onPick,
  onClose,
}: {
  current: DndViewTab;
  pendingItems: number;
  /** «Имя · класс уровень» в шапку (канвас DeckFan). */
  subtitle: string;
  /** Строки-счётчики миниатюр: каждая своей строкой, вместо декоративных
   *  глифов. Строит родитель — у него все данные листа под рукой. */
  details: Record<DndViewTab, string[]>;
  onPick: (tab: DndViewTab) => void;
  onClose: () => void;
}) {
  // Дабл-тап, открывший веер, кончается кликом по тому же пальцу — а веер
  // уже под ним, и клик уходил в первую попавшуюся миниатюру. Первые 600мс
  // жизни клики глотаются: это хвост открывающего жеста, а не выбор.
  const openedAt = useRef(Date.now());
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const dialogRef = useOneShotOverlayFocus('.dnd-deck-fan-close');
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      ref={dialogRef}
      className="dnd-deck-fan-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Колода карт"
      tabIndex={-1}
      onClickCapture={(e) => {
        if (Date.now() - openedAt.current < 600) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onClick={(e) => {
        // Выход по фону — только в десктопной модалке: на телефоне веер во
        // весь экран, и «фоном» там оказываются промежутки сетки — тап мимо
        // карты закрывал бы колоду вместо выбора.
        if (!isMobile && e.target === e.currentTarget) onClose();
      }}
    >
      {/* Обёртка-окно: на телефоне прозрачна (display: contents), на десктопе
          становится модалкой (см. CSS). */}
      <div className="dnd-deck-fan-modal">
      <div className="dnd-deck-fan-head">
        <div className="dnd-deck-fan-title-row">
          <span className="dnd-deck-fan-title">Колода</span>
          <span className="dnd-deck-fan-sub">{subtitle}</span>
          {/* Выход на главную: на листе нижняя навигация приложения спрятана,
              и из веера — ближайшей к выходу точки — его видно сразу. Маршрут
              уводит со страницы, веер размонтируется сам, закрывать нечего. */}
          <button type="button" className="dnd-deck-fan-close" onClick={() => navigate("/")} title="Вернуться на главную" aria-label="Вернуться на главную">
            <NavIcon name="home" />
          </button>
          <button type="button" className="dnd-deck-fan-close" onClick={onClose} aria-label="Закрыть колоду">
            <NavIcon name="close" />
          </button>
        </div>
        <div className="dnd-deck-fan-hint">Дабл-тап по портрету развернул колоду · тап переносит</div>
      </div>
      <div className="dnd-deck-fan-grid">
        {DND_VIEW_TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`dnd-deck-fan-card${t === current ? " is-current" : ""}`}
            aria-current={t === current ? "page" : undefined}
            onClick={() => {
              onPick(t);
              onClose();
            }}
          >
            <span className="dnd-deck-fan-name">
              {t}
              {/* Текущая карта — кислотой с наклейкой (макет 2026-09-25):
                  жёлтое = выбрано. */}
              {t === current && <span className="dnd-deck-fan-here">здесь</span>}
              {t === "Снаряжение" && pendingItems > 0 && <span className="dnd-fan-dot" aria-label="есть непринятое" />}
            </span>
            <span className="dnd-deck-fan-rule" aria-hidden="true" />
            <span className="dnd-fan-lines">
              {details[t].length > 0 ? (
                details[t].map((line, i) => (
                  <span key={i} className="dnd-fan-line">
                    {line}
                  </span>
                ))
              ) : (
                <span className="dnd-fan-line is-dim">Пусто</span>
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="dnd-deck-fan-foot">
        <span className="dnd-deck-fan-grabber" aria-hidden="true" />
        <span className="dnd-deck-fan-hint">Тап по карте переносит</span>
      </div>
      </div>
    </div>
  );
}

export function DndCharacterView({
  value,
  portraitUrl,
  compact,
  cardOnly,
  onQuickUpdate,
  syncTabToUrl,
  campaignId,
  ownerCharacterId,
  onPortraitUpload,
  onSheetBack,
  fanSignal,
  onPortraitRefresh,
  levelUpDraft,
  onLevelUpApply,
  readOnly,
  dossierExtra,
  onRelations,
  sideColumn,
}: {
  value: DndCharacterData;
  // Лицо первой карты. Отдельное поле под изображение заводить не пришлось —
  // у Персонажа уже есть avatar_image_path; сюда приходит готовый URL, а
  // кадрирование задаёт portraitFocus в самом листе (работает и у Существа,
  // у которого записи Персонажа нет).
  portraitUrl?: string | null;
  // Только для окна предпросмотра сущности (EntityPreviewModal): там лист
  // показывается мельком, поверх другой страницы, и полный лист туда не
  // помещается. Видом статблока (`kind`) это больше не управляется — краткого
  // чарника в списке статблоков нет, см. StatblockList.
  compact?: boolean;
  // Только лицевая карта, без вкладок и колоды: предпросмотр в Обзоре визарда
  // (владелец 2026-09-24: «слева — главная карта из чарника»).
  cardOnly?: boolean;
  // View-mode quick edits (HP, inspiration, death saves, spell slots used)
  // save immediately without entering the full DndCharacterEdit form —
  // mirrors LitMCharacterView's onQuickUpdate for tag edits.
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
  // Держать активную вкладку в адресе (?sheet=). Включает вызывающая
  // сторона, и только когда лист на странице один: в бестиарии листов
  // несколько, и один параметр на всех им конфликтует (гриллинг 2026-09-03).
  // Параметр свой, не `tab`: у страницы, внутри которой живёт лист, вкладки
  // свои, и делить один параметр с ней нельзя.
  syncTabToUrl?: boolean;
  // Кампания и сам персонаж — чтобы было кому передать созданную реплику
  // (решение R2/W8). Без них кнопка «Передать» просто скажет, что некому.
  campaignId?: number | null;
  ownerCharacterId?: number | null;
  // Загрузка портрета силами хоста (OneShot): через его очередь сохранений,
  // иначе следующая правка листа упрётся в устаревшую ревизию.
  onPortraitUpload?: (file: File) => Promise<void>;
  // Жест «назад» с первой карты (свайп вправо, решение владельца 2026-09-06):
  // уводит с полноэкранной страницы чарника обратно в профиль. Встроенному
  // листу возвращаться некуда — без пропса жест молчит.
  onSheetBack?: () => void;
  // Колода веером по команде хоста — пункт «Колода карт» в меню «⋯» OneShot
  // для тех, кто не знает двойного тапа. Каждое новое число открывает веер.
  fanSignal?: number;
  // Портрет протух (подпись URL живёт 60 секунд): перезагрузить персонажа,
  // чтобы приехал свежий avatar_image_url. Без пропса — просто плейсхолдер.
  onPortraitRefresh?: () => void;
  // Resumable level-up (C2): непрозрачный хост-контракт визарда
  // (identity/initial/onChange/onClear, см. dndLevelUpDraft). Без пропса
  // визард работает как раньше без сохранения черновика.
  levelUpDraft?: LevelUpDraftHost | null;
  // Durable level-up commit: в отличие от onQuickUpdate (resolve на enqueue),
  // резолвится только реальным коммитом и реджектится ошибкой записи, чтобы
  // визард чистил черновик строго после durable save. Без пропса визард
  // использует onQuickUpdate как раньше.
  onLevelUpApply?: (patch: Partial<DndCharacterData>) => Promise<void>;
  // Read-only контракт (расшаренный лист для мастера): ни одной мутации.
  // Большинство контролов и так гейтится отсутствием onQuickUpdate, но этот
  // флаг — явный контракт вызывающей стороны: скрывает affordances правки
  // (панель «Редактировать», тоглы разделов), которые без колбэка остались
  // бы висеть бездействующими иконками.
  readOnly?: boolean;
  // Основной SoyMan (персонаж = лист, 2026-09-27): главы профиля, галерея и
  // даты — под полями «Досье»; «Отношения» — кнопкой на обороте карты.
  // OneShot их не передаёт.
  dossierExtra?: ReactNode;
  // Колонка справа от вкладок на десктопе — заметки игрока (гриллинг
  // 2026-09-28, Q20). Её ширину берёт то, что вкладки ужаты до таббара.
  sideColumn?: ReactNode;
  onRelations?: () => void;
}) {
  // Оба хука вызываются всегда — по правилам хуков ветвиться здесь нельзя,
  // да и незачем: неиспользуемый просто держит своё состояние вхолостую.
  const [localTab, setLocalTab] = useState<DndViewTab>("Карта");
  // Параметр называется `card`, а не `sheet`: на своём маршруте
  // (/characters/:id/sheet) «sheet?sheet=» читается как опечатка, а карта
  // внутри листа — это именно карта (гриллинг 2026-09-04).
  const [urlTab, setUrlTab] = useTabState<DndViewTab>(DND_VIEW_TABS, "Карта", undefined, "card");
  const tab = syncTabToUrl ? urlTab : localTab;
  const setTab = syncTabToUrl ? setUrlTab : setLocalTab;
  // Полоска карт шире экрана (на 390px — 474 против 362), а сама к активной
  // не подтягивалась: свайп на «Досье» или «Ресурсы» уводил подчёркнутый
  // язычок за кадр, и единственный индикатор «на какой я карте» пропадал
  // (аудит 09.09, В2). `inline: nearest` не дёргает полоску, когда язычок и
  // так виден; `block: nearest` не даёт утащить страницу по вертикали.
  // Карусель, как лента классов в визарде: активный язычок тянется в центр,
  // пока полоске есть куда ехать (просьба владельца 2026-09-26).
  const deckStripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const active = deckStripRef.current?.querySelector<HTMLElement>("button.active");
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [tab]);
  // Живые данные компендиума для всех заклинаний и умений листа — одной
  // пачкой на весь лист, а не запросом на запись (см. entryCache.ts).
  const wantedIds = sheetEntryIds(value);
  const getEntry = useCompendiumEntries(wantedIds);
  // Весь список класса (Q2): справочник заклинаний грузится, только если среди
  // классов есть готовящий из всего списка; в лист ничего не пишется.
  const fullListClasses = value.classes.filter(
    (c) => c.classId != null && FULL_LIST_CLASSES.some((n) => nameMatches(c.className, n))
  );
  const needSpellIndex = fullListClasses.length > 0 && value.systemId != null;
  const [spellIndex, setSpellIndex] = useState<CompendiumEntry[] | null>(null);
  useEffect(() => {
    if (!needSpellIndex || value.systemId == null) return;
    const ac = new AbortController();
    loadDndSpellIndex(value.systemId, { signal: ac.signal })
      .then(setSpellIndex)
      .catch(() => undefined);
    return () => ac.abort();
  }, [needSpellIndex, value.systemId]);
  // Мёртвые ссылки этого листа (этап 8): запросили пачкой, сервер промолчал —
  // запись снесли из компендиума уже после вписки. Кэш общий на сессию,
  // поэтому пересекаем с запрошенным именно этим листом.
  const deadIds = deadEntryIds().filter((id) => wantedIds.includes(id));
  const deadNames = deadIds.length > 0 ? deadLinkNames(value, new Set(deadIds)) : [];
  // Черты старых листов без ссылки на справочник — связать по имени один
  // раз (гриллинг 2026-09-24, Q2): без ссылки их эффекты не считаются.
  const unlinkedFeats = value.feats.filter((f) => f.entryId == null).map((f) => f.name).join("|");
  useEffect(() => {
    if (!unlinkedFeats || !onQuickUpdate || readOnly || value.systemId == null) return;
    let alive = true;
    loadDndFeats(value.systemId)
      .then((all) => {
        const next = alive ? linkFeatsByName(value.feats, all) : null;
        if (next) onQuickUpdate({ feats: next });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- раз на набор несвязанных имён
  }, [unlinkedFeats, value.systemId]);
  // Цвет класса — единственная краска на карте. Боковые кромки рамки,
  // подчёркивание текущей карты в полоске, заливка хитов. При мультиклассе
  // берётся класс с наибольшим уровнем (dndClassColors.ts).
  const cardColor = sheetClassColor(value.classes, getEntry);
  const [fanOpen, setFanOpen] = useState(false);
  useEffect(() => {
    if (fanSignal) setFanOpen(true);
  }, [fanSignal]);
  // Модалка передачи из Снаряжения: то же меню, что оборот карты.
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  // Предмет, выбранный из меню строки: диалог передачи открывается уже
  // с ним, а не с пустым списком. Сбрасывается вместе с закрытием.
  const [transferPreselect, setTransferPreselect] = useState("");
  // Раскрывашка мёртвых ссылок (вид — канвас Actions): имена нужны для
  // починки, но не каждый раз.
  const [deadOpen, setDeadOpen] = useState(false);
  // Раскрывашка правки в десктопной правой колонке (под оборотом).
  const [rightEditOpen, setRightEditOpen] = useState(false);
  // Карты правил листа и карточка конкретного умения живут на уровне всего
  // листа: стрелка из CardSpread открывает ровно ту же DndCardModal, что и
  // поиск внизу, а не второе похожее окно.
  const [openRulesEntryId, setOpenRulesEntryId] = useState<number | null>(null);
  const [openSheetCard, setOpenSheetCard] = useState<SheetSearchHit | null>(null);
  // Смена аватара из той же раскрывашки: файл уходит на роут персонажа, а
  // свежий URL приезжает через onPortraitRefresh (перезагрузка персонажа).
  // Кадрирование тут не нужно — оно уже есть на лицевой (?edit=1 тянет
  // портрет через portraitFocus), здесь только сам файл.
  const [avatarUploading, setAvatarUploading] = useState(false);
  const canUploadPortrait = !!onPortraitUpload || ownerCharacterId != null;
  // Окно кадра: новый файл (ещё не залит — «Отмена» ничего не льёт) или
  // текущий портрет.
  const [frameEdit, setFrameEdit] = useState<{ src: string; file?: File } | null>(null);
  function closeFrameEdit() {
    if (frameEdit?.file) URL.revokeObjectURL(frameEdit.src);
    setFrameEdit(null);
  }
  async function uploadPortrait(file: File): Promise<boolean> {
    if (!canUploadPortrait) return false;
    setAvatarUploading(true);
    try {
      if (onPortraitUpload) await onPortraitUpload(file);
      else if (ownerCharacterId != null) {
        const form = new FormData();
        form.append("file", file);
        await write.post(`/characters/${ownerCharacterId}/avatar`, form, { timeoutMs: 60_000 });
        afterWriteAnywhere([{ kind: "character", id: ownerCharacterId }]);
        onPortraitRefresh?.();
      }
      return true;
    } catch (e) {
      // Раньше падение загрузки уходило в никуда: кнопка гасла, портрет
      // оставался прежним, и было не понять, что файл не принят.
      showSaveError(`Портрет не загрузился: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setAvatarUploading(false);
    }
  }
  // Десктопный сплит (этап 7): лицевая карта всегда стоит слева в натуральную
  // величину, содержимое активной вкладки — справа. Тот же порог 700px, что
  // у useIsMobile и мобильной CSS. На телефоне лицевая видна только на своей
  // вкладке, как было.
  const showDesktopFace = !useIsMobile();
  // Оборот первой карты — входящие игрока (этап 4). Угол виден всегда:
  // серый без входящих, цвета класса при непрочитанных. Мастеру игроцкий
  // роут отвечает 404 — тогда оборот открывается с пояснением, а не
  // пустотой: угол одинаково доступен, содержимое только владельцу.
  // Загрузка ленивая: угол-индикатор нужен только на первой карте.
  const [cardFlipped, setCardFlipped] = useState(false);
  // Оракул класса: счётчик переворотов — по нему рубашка тянет новую цитату.
  // Десктоп-панель («Карта» без переворота) счётчик не трогает: цитата там
  // стоит, пока карту не перевернут на телефоне/мобильной вёрстке.
  const [flipCount, setFlipCount] = useState(0);
  const prevFlipped = useRef(cardFlipped);
  useEffect(() => {
    if (cardFlipped && !prevFlipped.current) setFlipCount((c) => c + 1);
    prevFlipped.current = cardFlipped;
  }, [cardFlipped]);
  // Пул оракула — из записи класса с наибольшим уровнем (то же правило, что
  // цвет карты выше). Пусто/нет записи — рубашка без листка.
  const oracleQuotes = (() => {
    let best: DndClassEntry | null = null;
    for (const c of value.classes) {
      if (!c.className?.trim()) continue;
      if (!best || (c.level || 0) > (best.level || 0)) best = c;
    }
    if (!best) return [];
    // К пулу класса — цитаты его подкласса (домен Жреца, Дикая магия).
    const quotes = (id: number | null | undefined) => {
      const raw = getEntry(id)?.data.oracle_quotes;
      return Array.isArray(raw) ? raw.filter((q): q is string => typeof q === "string") : [];
    };
    return [...quotes(best.classId), ...quotes(best.subclassId)];
  })();
  // Визард левелапа с оборота карты (игрок своего, мастер любого): модалка
  // живёт здесь же, применение — тем же мгновенным сохранением, что значения.
  const [showLevelUp, setShowLevelUp] = useState(false);
  const { detached, campaignConnected } = useDndRuntime();
  const [inbox, setInbox] = useState<CharacterInboxMessage[] | null>(null);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  // Сервер отказал (403 чужому токену, 404 не-владельцу): это Мастер смотрит
  // чужой лист, а не сломанная сеть. Показываем пояснение вместо ошибки —
  // содержимое входящих видит только владелец персонажа.
  const [inboxDenied, setInboxDenied] = useState(false);
  const [inboxNotice, setInboxNotice] = useState<string | null>(null);
  const [inboxBusyId, setInboxBusyId] = useState<number | null>(null);
  const [savedNoteIds, setSavedNoteIds] = useState<ReadonlySet<number>>(new Set());
  const [cornerGlint, setCornerGlint] = useState(false);
  const inboxTried = useRef(false);
  // Протухшая подпись URL портрета: скрываем битую картинку, один раз зовём
  // родителя за свежей ссылкой. Сбрасывается новым URL и сменой карты.
  const [portraitStale, setPortraitStale] = useState(false);
  const portraitRefreshCalled = useRef<string | null>(null);
  useEffect(() => {
    setPortraitStale(false);
  }, [portraitUrl, tab]);
  function handlePortraitError() {
    setPortraitStale(true);
    if (portraitRefreshCalled.current !== portraitUrl) {
      portraitRefreshCalled.current = portraitUrl ?? null;
      onPortraitRefresh?.();
    }
  }
  // Данные уже приезжали: следующие тики тихие, без скелетона и ошибок.
  const inboxReady = useRef(false);
  const canUseInbox = ownerCharacterId != null;
  // Входящие и передачи — роуты игрока: сервер отвечает 403 любой учётке без
  // привязанного профиля игрока (server/src/routes/player.ts). Мастер без
  // профиля получал этот отказ на каждом открытии листа и на каждом тике
  // оборота; экран его и так гасил, но запрос уходил впустую и падал в журнал
  // ошибок (data/journal.ts). Здесь отказ известен заранее — и запроса нет.
  const knownNoPlayerProfile = () => {
    const user = getCachedUser();
    return user != null && user.playerId == null;
  };
  const unreadInbox = (inbox ?? []).filter((m) => !m.read_at).length;
  // Передачи 4б живут рядом с входящими: тот же оборот, тот же угол (плюс
  // входящие офферы к непрочитанным), тот же опрос на открытом обороте.
  const [transfers, setTransfers] = useState<{ incoming: CharacterTransfer[]; outgoing: CharacterTransfer[] } | null>(null);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [transfersError, setTransfersError] = useState<string | null>(null);
  const [transferNotice, setTransferNotice] = useState<string | null>(null);
  const [transferBusyId, setTransferBusyId] = useState<number | null>(null);
  const transfersTried = useRef(false);
  const transfersReady = useRef(false);
  const incomingOffered = (transfers?.incoming ?? []).filter((t) => t.state === "offered").length;
  const unreadTotal = unreadInbox + incomingOffered;
  // Свайп между соседними картами (влево/вправо). Доминантная вертикаль
  // глотается молча: она принадлежит прокрутке, а веер колоды теперь
  // открывается долгим нажатием на портрет (см. ниже), не свайпом вниз.
  // Жест свободен: таблица «Атаки» на телефоне не прокручивается вбок, а
  // разбирается в стопку карточек (dnd-sheet.css). Но полоска названий, поля
  // ввода и всё, что прокручивается само, свайп перехватывать не должны —
  // иначе прокрутка полоски меняла бы карту под пальцем.
  const touchStart = useRef<{ x: number; y: number; ok: boolean } | null>(null);
  function onSheetTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    const el = e.target as HTMLElement;
    const ok = !el.closest(".dnd-deck-strip, input, textarea, select, [data-no-swipe], .modal, [contenteditable]");
    touchStart.current = { x: t.clientX, y: t.clientY, ok };
  }
  function onSheetTouchEnd(e: React.TouchEvent) {
    const from = touchStart.current;
    touchStart.current = null;
    if (!from || !from.ok) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - from.x;
    const dy = t.clientY - from.y;
    if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 1.5) return;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // Оборот — не карта колоды: свайпы на нём ничего не переключают.
    if (cardFlipped) return;
    const i = DND_VIEW_TABS.indexOf(tab);
    if (i === 0 && dx > 0) {
      // Первая карта, жест «назад» (свайп вправо свободен: левее первой карты
      // ничего нет). На остальных картах вправо — предыдущая карта, как было.
      if (onSheetBack) onSheetBack();
      return;
    }
    const next = dx < 0 ? i + 1 : i - 1;
    if (next >= 0 && next < DND_VIEW_TABS.length) setTab(DND_VIEW_TABS[next]);
  }
  // Веер колоды — двойной тап по портрету (решение владельца 2026-09-06).
  // Начинали с долгого нажатия, но оно не жилец: веер появляется под уже
  // лежащим пальцем, и touchend тут же нажимает кнопку под ним либо тянет
  // выделение текста из открывшегося меню. Дабл-тап свободен от этого —
  // палец к моменту открытия уже поднят. Картуш с именем исключён: дабл-тап
  // по тексту — выделение слова. iOS-зум по дабл-тапу гасится touch-action
  // в CSS (dnd-sheet.css). Окно 350мс и сдвиг до 30px — обычные значения.
  const lastPortraitTap = useRef<{ t: number; x: number; y: number } | null>(null);
  function onPortraitTouchEnd(e: React.TouchEvent) {
    const el = e.target as HTMLElement;
    // Картуш — текст (дабл-тап выделяет слово), спасброски — свои кнопки:
    // ни то, ни другое веер колоды открывать не должно.
    if (el.closest(".dnd-card-cartouche, .dnd-death-overlay, .dnd-death-strip")) {
      lastPortraitTap.current = null;
      return;
    }
    // Перетаскивание кадра — не тап: веер по окончании драга не открываем.
    if (frame.draggedRef.current) {
      frame.draggedRef.current = false;
      lastPortraitTap.current = null;
      return;
    }
    const t = e.changedTouches[0];
    const now = Date.now();
    const prev = lastPortraitTap.current;
    lastPortraitTap.current = { t: now, x: t.clientX, y: t.clientY };
    if (prev && now - prev.t < 350 && Math.hypot(t.clientX - prev.x, t.clientY - prev.y) < 30) {
      lastPortraitTap.current = null;
      setFanOpen(true);
    }
  }
  // Подгрузка входящих: один раз при первом показе лицевой стороны.
  // Ошибка (включая 404 для Мастера) гасит только оборот: лицевая карта
  // обязана работать и без входящих.
  const refreshInbox = useCallback(() => {
    if (ownerCharacterId == null) return;
    if (knownNoPlayerProfile()) {
      setInboxDenied(true);
      setInboxLoading(false);
      return;
    }
    const id = ownerCharacterId;
    // Тихий тик не должен мигать «Загрузкой»: скелетон — только пока данных
    // нет вовсе, ошибка на фоне — тоже молча, старое лучше пустоты.
    if (!inboxReady.current) setInboxLoading(true);
    fetchCharacterInbox(id).then(
      (rows) => {
        inboxReady.current = true;
        setInbox(rows);
        setInboxError(null);
        setInboxDenied(false);
        setInboxLoading(false);
      },
      (e) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (/forbidden|not found|403|404/i.test(msg)) setInboxDenied(true);
        else if (!inboxReady.current) setInboxError(msg);
        setInboxLoading(false);
      }
    );
  }, [ownerCharacterId]);
  useEffect(() => {
    if (!canUseInbox || tab !== "Карта" || inbox !== null || inboxTried.current) return;
    inboxTried.current = true;
    refreshInbox();
  }, [canUseInbox, tab, inbox, refreshInbox]);
  const refreshTransfers = useCallback(() => {
    if (ownerCharacterId == null) return;
    if (knownNoPlayerProfile()) {
      transfersReady.current = true;
      setTransfers({ incoming: [], outgoing: [] });
      setTransfersError(null);
      setTransfersLoading(false);
      return;
    }
    const id = ownerCharacterId;
    if (!transfersReady.current) setTransfersLoading(true);
    fetchTransfers(id).then(
      (rows) => {
        transfersReady.current = true;
        setTransfers(rows);
        setTransfersError(null);
        setTransfersLoading(false);
      },
      (e) => {
        // Мастеру список недоступен, как и входящие: оборот объясняет, а не
        // сыплет ошибкой. Различать нечего — quiet null вместо шума.
        if (/forbidden|not found|403|404/i.test(e instanceof Error ? e.message : String(e))) {
          transfersReady.current = true;
          setTransfers({ incoming: [], outgoing: [] });
          setTransfersError(null);
        } else if (!transfersReady.current) {
          setTransfersError(e instanceof Error ? e.message : String(e));
        }
        setTransfersLoading(false);
      }
    );
  }, [ownerCharacterId]);
  useEffect(() => {
    if (!canUseInbox || tab !== "Карта" || transfers !== null || transfersTried.current) return;
    transfersTried.current = true;
    refreshTransfers();
  }, [canUseInbox, tab, transfers, refreshTransfers]);
  // Уход с первой карты возвращает оборот лицом: перевёрнутая карта,
  // оставшаяся за спиной у соседней, — это потерянный жест.
  useEffect(() => {
    setCardFlipped(false);
  }, [tab]);
  // Живой оборот: пока он открыт, список дотягивается каждые 10 секунд —
  // иначе послание, пришедшее в открытый оборот, видно только после
  // закрытия-открытия. Только на видимой вкладке и вне полёта собственной
  // правки (busy), чтобы тихий тик не перетирал строку под пальцем.
  // Передачи едут тем же тиком: оффер тоже должен приходить сам.
  useEffect(() => {
    if (!cardFlipped || tab !== "Карта") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || inboxBusyId != null || transferBusyId != null) return;
      refreshInbox();
      refreshTransfers();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [cardFlipped, tab, inboxBusyId, transferBusyId, refreshInbox, refreshTransfers]);
  // Действие по передаче: после успеха оба списка дотягиваются сразу, а не
  // следующим тиком — за столом десять секунд решают.
  async function handleTransferAction(id: number, action: "accept" | "decline" | "return" | "claim") {
    setTransferBusyId(id);
    setTransferNotice(null);
    try {
      await transferAction(id, action);
      refreshTransfers();
      refreshInbox();
    } catch (e) {
      setTransferNotice(`Не вышло: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTransferBusyId(null);
    }
  }
  async function handleTransferSend(args: { recipientId: number; itemId: string | null; section: number; index: number; name: string; qty: number; kind: "item" | "replica" }) {
    if (ownerCharacterId == null) return;
    setTransferBusyId(-1);
    setTransferNotice(null);
    try {
      await offerItemTransfer({ senderId: ownerCharacterId, ...args });
      refreshTransfers();
    } catch (e) {
      setTransferNotice(`Не отправилось: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTransferBusyId(null);
    }
  }
  async function handleMoneySend(args: { recipientId: number; coins: { cp: number; sp: number; ep: number; gp: number; pp: number } }) {
    if (ownerCharacterId == null) return;
    setTransferBusyId(-1);
    setTransferNotice(null);
    try {
      await offerMoneyTransfer({ senderId: ownerCharacterId, ...args });
      refreshTransfers();
      refreshInbox();
    } catch (e) {
      setTransferNotice(`Не отправилось: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTransferBusyId(null);
    }
  }
  // Оборот рисуется дважды (слева при перевороте, справа на десктопной
  // «Карте»), но никогда разом: условия исключают друг друга. Одна функция,
  // чтобы две копии не разъехались.
  function renderCardBack(edit?: ReactNode) {
    return (
      <DndCardBack
        characterName={value.characterName || "Без имени"}
        color={cardColor}
        messages={inbox ?? []}
        loading={inboxLoading}
        loadError={inboxError}
        denied={!canUseInbox || inboxDenied}
        notice={inboxNotice}
        busyId={inboxBusyId}
        savedIds={savedNoteIds}
        oracleQuotes={oracleQuotes}
        flipKey={flipCount}
        onRetry={refreshInbox}
        onRead={(id) => void handleInboxRead(id)}
        onSave={(id) => void handleInboxSave(id)}
        onClose={() => setCardFlipped(false)}
      >
        {/* Характеристики — и с оборота, в режиме правки: тот же редактор,
            что на лицевой. В боевом режиме оборот остаётся чистыми входящими —
            правка там шумела бы в самом тихом месте листа. */}
        {editFromUrl && onQuickUpdate && (
          <AbilitySavesSkillsEdit
            abilities={value.abilities}
            proficiencyBonus={formatModifier(derived.proficiencyBonus.value)}
            savingThrowProfs={value.savingThrowProfs}
            skillProfs={value.skillProfs}
            classSkillPool={classSkillPool(value.classes)}
            classSkillChoiceCount={classSkillChoiceTotal(value.classes)}
            backgroundSkillNames={value.backgroundSkillNames}
            bonuses={value.abilityBonuses}
            onAbilitiesChange={(v) => onQuickUpdate({ abilities: v })}
            onSavingThrowProfsChange={(v) => onQuickUpdate({ savingThrowProfs: v })}
            onSkillProfsChange={(v) => onQuickUpdate({ skillProfs: v })}
          />
        )}
        {/* Инструмент передач — только владельцу: Мастеру игроцкие роуты
            отвечают forbidden, и вместо формы он видел бы ошибку загрузки
            партии. Пояснение уже показывает оборот (denied). */}
        {canUseInbox && !inboxDenied && ownerCharacterId != null && (
          <DndTransferBox
            color={cardColor}
            campaignId={campaignId}
            characterId={ownerCharacterId}
            characterName={value.characterName}
            equipment={value.equipmentSections}
            ownCoins={value.coins}
            incoming={transfers?.incoming ?? []}
            outgoing={transfers?.outgoing ?? []}
            loading={transfersLoading}
            loadError={transfersError}
            notice={transferNotice}
            busyId={transferBusyId}
            onAction={(id, action) => void handleTransferAction(id, action)}
            onSendItem={(args) => void handleTransferSend(args)}
            onSendMoney={(args) => void handleMoneySend(args)}
            onCommitCoins={(c) => onQuickUpdate?.({ coins: c })}
            onCalcChanged={() => {
              refreshTransfers();
              refreshInbox();
            }}
            onRetry={refreshTransfers}
          />
        )}
        {/* Постер — буквально лицевая сторона главной карты, снимком.
            Левелап отсюда убран: вход в него — цифра уровня в картуше на
            лицевой стороне. Здесь он висел под отказом «оборот читает
            владелец персонажа», то есть мастеру предлагался ровно там, где
            ему только что отказали. */}
        {/* ОТДЫХ — на обороте (макет 2026-09-25): его нажимают раз за
            сцену, а на лицевой жетон спорил с рамкой карты. */}
        {onQuickUpdate && (
          <section className="dnd-back-plate" aria-label="Отдых">
            <h4 className="dnd-back-plate-title">Отдых</h4>
            <div className="dnd-back-plate-row">
              <button type="button" className="dnd-back-btn is-ink" onClick={() => setRestOpen("short")}>
                Короткий<span>кости хитов</span>
              </button>
              <button type="button" className="dnd-back-btn is-ink" onClick={() => setRestOpen("long")}>
                Долгий<span>всё заново</span>
              </button>
            </div>
          </section>
        )}
        {onRelations && (
          <section className="dnd-back-plate" aria-label="Отношения">
            <h4 className="dnd-back-plate-title">Отношения</h4>
            <div className="dnd-back-plate-row">
              <button type="button" className="dnd-back-btn is-ink" onClick={onRelations}>
                Открыть<span>связи с миром и партией</span>
              </button>
            </div>
          </section>
        )}
        {edit}
      </DndCardBack>
    );
  }
  // Настройка предметов: ромбы вместо точек, слоты сверх трёх. Счёт — по
  // строкам с ◆: ручное число осталось только для старых листов, где строк
  // с флагом ещё нет. Стоит в боковой колонке «Снаряжения» (макет) и под
  // правкой раздела.
  function renderAttunement() {
    const rows = value.equipmentSections.flatMap((s) => s.items).filter((it) => !it.transferOut);
    const rowsAreSource = rows.some((it) => "attuned" in it);
    const counted = rows.filter((it) => it.attuned).length;
    const shown = rowsAreSource ? counted : (value.attunementCount ?? 0);
    const over = counted > 3 + (value.attunementExtra ?? 0);
    return (shown > 0 || onQuickUpdate) ? (
      <div className="dnd-frame">
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <span className="sb-prop-label">Настроено предметов</span>{" "}
          {over && (
            <span className="dnd-limit-over" title="Лимит настройки превышен">
              сверх лимита!
            </span>
          )}
        </div>
        {/* Кнопки слотов — в строке с ячейками, у правого края. */}
        <div className="row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between" }}>
          {/* Медальоны (владелец 2026-09-26): пустой слот — тусклый ч/б,
              занятый — яркий. Руками число ставится только в старых листах. */}
          <span
            className="dnd-attune-pips"
            role="group"
            aria-label={`Настроено предметов: ${shown} из ${3 + (value.attunementExtra ?? 0)}`}
          >
            {Array.from({ length: 3 + (value.attunementExtra ?? 0) }, (_, i) => {
              const on = i < shown;
              // Медальон — фоном из CSS, не <img>: сборка автономного HTML
              // встраивает только url() стилей, путь в JSX ушёл бы в сеть.
              const img = <span className="dnd-attune-pip-face" aria-hidden="true" />;
              return !rowsAreSource && onQuickUpdate ? (
                <button
                  key={i}
                  type="button"
                  className={`dnd-attune-pip${on ? " is-on" : ""}`}
                  aria-label={`Слот настройки ${i + 1}`}
                  aria-pressed={on}
                  onClick={() => onQuickUpdate({ attunementCount: on && i + 1 === shown ? i : i + 1 })}
                >
                  {img}
                </button>
              ) : (
                <span key={i} className={`dnd-attune-pip${on ? " is-on" : ""}`} aria-hidden="true">
                  {img}
                </span>
              );
            })}
          </span>
          {onQuickUpdate && (
            <span className="row" style={{ gap: 4 }}>
              <button
                type="button"
                className="comp-mini"
                title="Добавить слот настройки"
                aria-label="Добавить слот настройки"
                onClick={() => onQuickUpdate({ attunementExtra: (value.attunementExtra ?? 0) + 1 })}
              >
                +
              </button>
              {(value.attunementExtra ?? 0) > 0 && (
                <button
                  type="button"
                  className="comp-mini"
                  title="Убрать слот настройки"
                  aria-label="Убрать слот настройки"
                  onClick={() =>
                    onQuickUpdate({
                      attunementExtra: (value.attunementExtra ?? 0) - 1,
                      attunementCount: Math.min(shown, 3 + (value.attunementExtra ?? 0) - 1),
                    })
                  }
                >
                  −
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    ) : null;
  
  }
  // Правка основной информации — раскрывашкой (решение владельца): поля
  // сохраняются мгновенно, как везде на листе, «Сохранить» лишь закрывает
  // панель. На десктопе стоит под оборотом в правой колонке, на телефоне —
  // последней плашкой самого оборота (макет 2026-09-25): другого входа в
  // правку с телефона в OneShot нет.
  function renderFaceEdit() {
    if (!syncTabToUrl || !onQuickUpdate || readOnly) return null;
    return (
      <div className="stack dnd-face-edit">
        <button
          type="button"
          className="dnd-face-edit-head"
          aria-expanded={rightEditOpen}
          onClick={() => setRightEditOpen((v) => !v)}
        >
          <span>
            Редактировать <span className="dnd-face-edit-hint">имя, портрет, характеристики</span>
          </span>
          <span aria-hidden="true">{rightEditOpen ? "−" : "+"}</span>
        </button>
        {rightEditOpen && (
          <>
            {/* Портрет: файл сразу уходит в окно кадра — точную копию
                портретной зоны карты этого устройства (гриллинг 2026-09-25).
                Льётся только по «Готово». */}
            {canUploadPortrait && (
              <div className="dnd-face-portrait">
                <span className="dnd-face-avatar" aria-hidden="true">
                  {portraitUrl ? <img src={portraitUrl} alt="" style={portraitImgStyle(value.portraitFocus, value.portraitZoom)} /> : <span className="dnd-face-avatar-empty">+</span>}
                </span>
                <label className="dnd-back-btn">
                  {portraitUrl ? "Новый портрет" : "Загрузить портрет"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: "none" }}
                    disabled={avatarUploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) setFrameEdit({ src: URL.createObjectURL(file), file });
                    }}
                  />
                </label>
                {portraitUrl && (
                  <button type="button" className="dnd-back-btn" onClick={() => setFrameEdit({ src: portraitUrl })}>
                    Кадр
                  </button>
                )}
              </div>
            )}
            <DndOriginEditForm origin={origin} value={value} onQuickUpdate={onQuickUpdate} identityOnly />
            {/* Характеристики — в ту же раскрывашку: на десктопе это и
                есть «режим редактирования» (лицевая при этом тоже
                правится только через ?edit=1, которого здесь нет).
                В ?edit=1 редактор уже стоит на лицевой и на обороте,
                поэтому тут его гасим, чтобы не двоился. */}
            {!editFromUrl && (
              <AbilitySavesSkillsEdit
                abilities={value.abilities}
                proficiencyBonus={formatModifier(derived.proficiencyBonus.value)}
                savingThrowProfs={value.savingThrowProfs}
                skillProfs={value.skillProfs}
                classSkillPool={classSkillPool(value.classes)}
                classSkillChoiceCount={classSkillChoiceTotal(value.classes)}
                backgroundSkillNames={value.backgroundSkillNames}
                bonuses={value.abilityBonuses}
            onAbilitiesChange={(v) => onQuickUpdate({ abilities: v })}
                onSavingThrowProfsChange={(v) => onQuickUpdate({ savingThrowProfs: v })}
                onSkillProfsChange={(v) => onQuickUpdate({ skillProfs: v })}
              />
            )}
            <button type="button" className="primary" onClick={() => setRightEditOpen(false)}>
              Сохранить
            </button>
          </>
        )}
      </div>
    );
  }
  // Блик загнутого угла раз в 30 секунд, пока есть непрочитанное и вкладка
  // видна. При prefers-reduced-motion блика нет вовсе (спецификация карты).
  useEffect(() => {
    if (unreadTotal === 0) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setCornerGlint(true);
      window.setTimeout(() => setCornerGlint(false), 1200);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [unreadTotal]);
  // Пометка прочтения — действием адресата, оптимистично: список уже
  // отсортирован сервером, строка просто гаснет. Ошибка — строкой notice,
  // не молча: иначе «нажал — ничего» читается как прочитанное.
  async function handleInboxRead(id: number) {
    setInboxBusyId(id);
    setInboxNotice(null);
    try {
      const updated = await markInboxMessageRead(id);
      setInbox((prev) => prev?.map((m) => (m.id === id ? updated : m)) ?? prev);
    } catch (e) {
      setInboxNotice(`Не отметилось: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInboxBusyId(null);
    }
  }
  // Сохранение статьёй в путевые заметки персонажа. Повторный тап по той же
  // строке блокируется флагом savedNoteIds: серверного флага «сохранено»
  // нет, а дубль заметки — это мусор в дневнике.
  async function handleInboxSave(id: number) {
    const msg = inbox?.find((m) => m.id === id);
    if (!msg || campaignId == null || ownerCharacterId == null) return;
    setInboxBusyId(id);
    setInboxNotice(null);
    try {
      await saveInboxMessageAsNote({ campaignId, characterId: ownerCharacterId, message: msg.message });
      setSavedNoteIds((prev) => new Set(prev).add(id));
    } catch (e) {
      setInboxNotice(`Не сохранилось: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInboxBusyId(null);
    }
  }
  // Навыки: встроенный каталог, уточнённый справочником системы. Без
  // справочника лист полон — имена берутся встроенные.
  const skills = useDndSkills(value.systemId);
  const systemIdForSlots = value.systemId;
  const pendingItems = value.equipmentSections.reduce(
    (sum, sec) => sum + sec.items.filter((i) => i.pendingFrom).length,
    0
  );
  // Per-section edit toggles for "Особенности" (only "Особые умения" is
  // user-authored — species/class/feats are inherited compendium content and
  // stay read-only) and "Досье" — separate from StatblockList's whole-card
  // editMode, which swaps in the entire DndCharacterEdit form. Draft state is
  // local (not saved on every keystroke, unlike the single-click quick edits
  // elsewhere on this sheet) — an explicit "Сохранить" commits via
  // onQuickUpdate, "Отмена" discards.
  // Все четыре списка особенностей — тексты, а тексты по общему правилу
  // правятся через черновик с явным сохранением: набранный абзац терять
  // нельзя (гриллинг 2026-09-03). Видовые и классовые приходят из
  // компендиума, но править их руками лист позволял и раньше — роспуск формы
  // не должен этого отнимать.
  const [draftFeatures, setDraftFeatures] = useState<Pick<
    DndCharacterData,
    "speciesFeatures" | "classFeatures" | "feats" | "specialAbilities"
  > | null>(null);
  const [draftDossier, setDraftDossier] = useState<Pick<
    DndCharacterData,
    "personalityTraits" | "ideals" | "bonds" | "flaws"
  > | null>(null);
  // Уход с карты закрывает правку «Досье» и «Особенностей» — и **сохраняет**
  // набранное, а не выбрасывает. Черновики этих двух вкладок жили дольше
  // самой вкладки: вернувшись, попадаешь сразу в форму там, где ждал показ.
  // Просто обнулить их нельзя — они, в отличие от всего остального листа,
  // фиксируются не на каждое нажатие, а кнопкой, и сброс молча съел бы
  // набранный текст. Поэтому уход равен нажатию «готово»; «Отмена» остаётся
  // на самой вкладке.
  const prevTab = useRef(tab);
  useEffect(() => {
    if (prevTab.current === tab) return;
    prevTab.current = tab;
    if (draftFeatures) {
      onQuickUpdate?.(draftFeatures);
      setDraftFeatures(null);
    }
    if (draftDossier) {
      onQuickUpdate?.(draftDossier);
      setDraftDossier(null);
    }
  }, [tab, draftFeatures, draftDossier, onQuickUpdate]);
  // `MentionTextarea` — memo, но пока onChange создавался заново на каждый
  // рендер, мемоизация не работала вовсе: нажатие клавиши в «Идеалах»
  // перерисовывало и «Черты характера», и «Привязанности», и «Слабости».
  // Колбэки берут прежнее состояние через функциональный сеттер, поэтому
  // зависимостей нет и ссылки стабильны на всю жизнь компонента.
  const narrativeCallbacks = useMemo(
    () =>
      Object.fromEntries(
        NARRATIVE_FIELDS.map(({ key }) => [
          key,
          (v: string) =>
            setDraftDossier((prev) => (prev ? { ...prev, [key]: v } : prev)),
        ])
      ) as Record<string, (v: string) => void>,
    []
  );
  // Same idea as draftSpecial/draftDossier above, but these two commit on
  // every keystroke like the rest of the sheet (no local draft to lose) —
  // the pencil just toggles between the compact quick-view and the fuller
  // structural editor for that one tab, without touching StatblockList's
  // whole-card editMode.
  const [editingInventory, setEditingInventory] = useState(false);
  const [editingSpells, setEditingSpells] = useState(false);
  const prefs = useDndPrefs();
  const [editingTraits, setEditingTraits] = useState(false);

  const [editingActions, setEditingActions] = useState(false);
  // Подсветка строки, на которую увёл поиск, — для того, у чего нет карточки
  // (навык, свободно вписанный предмет, владение). Гаснет по следующему
  // касанию листа.
  const [highlight, setHighlight] = useState<string | null>(null);
  const [openAction, setOpenAction] = useState<AttackRow | null>(null);
  // Модалка состояний: открыта состоянием карты, а не плашки, — иконки
  // навешанных состояний над живым рядом ведут в то же окно.
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [addingCompanion, setAddingCompanion] = useState(false);
  // Призыв заклинанием — двухшаговый: сначала «Призвать», потом круг ячейки
  // (мощь тела зависит от круга, а ритуал ячейки не тратит — форсить трату
  // выбором круга нельзя).
  const [summonSpell, setSummonSpell] = useState<number | null>(null);
  const [restOpen, setRestOpen] = useState<false | "short" | "long">(false);
  // Происхождение правится адресом ?edit=1 (карандаш на плашке чарника в
  // профиле): кнопки-карандаша в шапке больше нет (решение владельца
  // 2026-09-06). На самой карте органов правки нет — за столом лист читают.
  const [searchParams, setSearchParams] = useSearchParams();
  const editFromUrl = syncTabToUrl && searchParams.get("edit") === "1";
  function leaveEdit() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("edit");
      return next;
    });
  }
  // Кадрирование портрета перетаскиванием (этап 9): только в ?edit=1 — за
  // столом портрет не тянут, там жест принадлежит вееру и прокрутке.
  // Точка в долях, по умолчанию чуть выше центра: на портретах в полный
  // рост лицо сидит в верхней трети, и обрезка ровно по центру
  // промахивается по нему. Черновик в полёте, коммит по отпусканию.
  const frame = useFrameDrag(!!editFromUrl && !!onQuickUpdate, value.portraitFocus, (f) =>
    onQuickUpdate?.({ portraitFocus: f })
  );
  const canFrame = !!editFromUrl && !!onQuickUpdate;
  // Запасные таблицы подгружаются лениво и только когда без них не обойтись
  // (многоклассье без полного заклинателя) — обычному персонажу лишний
  // запрос ни к чему.
  const [fallbackProgressions, setFallbackProgressions] = useState<(ClassProgression | undefined)[]>([]);
  // Здесь, а не рядом с местом использования: ниже по функции стоит ранний
  // возврат для compact-вида, и хук за ним вызывался бы не в каждом рендере.
  const [spellListOpen, setSpellListOpen] = useState(false);
  const [arcanumOpen, setArcanumOpen] = useState(false);
  // Справочники грузятся только когда панель открыта — см. флаг в useDndOrigin.
  // Справочники нужны обеим панелям правки: происхождению — иерархия классов,
  // виды и предыстории, свойствам — типы урона и состояния. Грузим, когда
  // открыта любая из них, и не грузим, пока лист просто читают.
  const originEditing = editFromUrl;
  const origin = useDndOrigin(value, (v) => onQuickUpdate?.(v), originEditing || editingTraits);
  // Считается до раннего выхода: ниже стоят хуки, а компактная карточка
  // возвращается раньше.
  const slotSources = value.classes
    .filter((c) => c.classId != null && c.level > 0)
    .map((c) => ({
      classId: c.classId,
      level: c.level,
      progression: getEntry(c.classId)?.data.progression as ClassProgression | undefined,
      subProgression:
        c.subclassId != null
          ? (getEntry(c.subclassId)?.data.progression as ClassProgression | undefined)
          : undefined,
      roundUp: isRoundUpCaster(getEntry(c.classId)?.data as Record<string, unknown> | undefined),
    }));
  // Запасная таблица нужна ровно в одном случае: заклинательных классов
  // несколько и ни один из них не полный (Паладин + Следопыт). Тогда таблицу
  // многоклассья брать неоткуда, кроме как у полного заклинателя системы.
  const needsFallbackTable =
    slotSources.filter((s) => sourceCasterKind(s) !== "none").length > 1 &&
    !slotSources.some((s) => sourceCasterKind(s) === "full");
  useEffect(() => {
    if (!needsFallbackTable || !systemIdForSlots || fallbackProgressions.length > 0) return;
    loadDndClassProgressions(systemIdForSlots).then((list) =>
      setFallbackProgressions(list as unknown as ClassProgression[])
    );
  }, [needsFallbackTable, systemIdForSlots, fallbackProgressions.length]);

  if (compact) return <DndCharacterViewMini value={withGrantedSenses(withLiveEffects(value, getEntry), getEntry)} />;
  const liveCantrips = value.cantrips.map((s) => resolveSpell(s, getEntry));
  const liveSpellsByLevel = value.spellsByLevel.map((lvl) => lvl.map((s) => resolveSpell(s, getEntry)));
  const computedSlots = computeSpellSlots(slotSources, fallbackProgressions);
  // Сколько заговоров и подготовленных положено — по таблице каждого класса,
  // при многоклассье суммой. Не в счёт идут заклинания «вне лимита»: и по
  // правилам 5.5, и по разметке справочника выдача вида, класса и подкласса
  // всегда подготовлена и мест не занимает.
  const spellLimits = (() => {
    let cantrips: number | null = null;
    let prepared: number | null = null;
    for (const src of slotSources) {
      // Классовая и подклассовая (Мистический рыцарь) таблицы складываются:
      // лимиты у подкласса свои, у класса их нет — дубля взяться неоткуда.
      for (const prog of [src.progression, src.subProgression]) {
        const c = cantripsAtLevel(prog, src.level);
        if (c != null) cantrips = (cantrips ?? 0) + c;
      }
      // Формульный лимит (Артефактор: мод + пол-уровня) главнее табличного:
      // статика колонки при нештатном INT врёт тихо. Характеристика берётся
      // из записи самого класса; не разобралась — откат к таблице, а не
      // пропавший лимит.
      const classData = (src.classId != null ? getEntry(src.classId)?.data : undefined) as
        | { prepared_formula?: unknown; spellcasting_ability?: unknown }
        | undefined;
      if (classPreparedFormula(classData as Record<string, unknown> | undefined)) {
        const key = parseAbilityNames(classData?.spellcasting_ability)[0];
        if (key) {
          prepared =
            (prepared ?? 0) +
            formulaPreparedLimit("mod_plus_half_level", src.level, abilityModifier(value.abilities[key]));
          continue;
        }
      }
      const p = preparedAtLevel(src.progression, src.level);
      if (p != null) prepared = (prepared ?? 0) + p;
      const subP = preparedAtLevel(src.subProgression, src.level);
      if (subP != null) prepared = (prepared ?? 0) + subP;
    }
    const counts = (list: DndSpellEntry[]) => list.filter((sp) => !sp.outsideLimit).length;
    return {
      cantrips,
      prepared,
      cantripsUsed: counts(liveCantrips),
      preparedUsed: liveSpellsByLevel.reduce(
        (sum, lvl) => sum + lvl.filter((sp) => !sp.outsideLimit && sp.prepared > 0).length,
        0
      ),
      outside:
        liveCantrips.filter((sp) => sp.outsideLimit).length +
        liveSpellsByLevel.reduce((sum, lvl) => sum + lvl.filter((sp) => sp.outsideLimit).length, 0),
    };
  })();
  // Стартовые наборы: у каждого класса персонажа и у предыстории.
  // Плюс источники подклассов: их прогрессии (кости превосходства, кости
  // пси-энергии) читаются тем же кодом по уровню базового класса.
  const resourceSources: ClassResourceSource[] = value.classes.flatMap((c) => {
    const own: ClassResourceSource = {
      entry: c,
      progression: getEntry(c.classId)?.data.progression as ClassProgression | undefined,
      // Схемы реплик лежат у записи класса (решение R1) — сюда попадают,
      // потому что вкладка «Ресурсы» и есть место, где ими пользуются.
      replicateSchemes: (getEntry(c.classId)?.data.replicate_schemes as ReplicateScheme[] | undefined) ?? [],
      replicateGenerics: (getEntry(c.classId)?.data.replicate_generics as ReplicaGeneric[] | undefined) ?? [],
    };
    if (c.subclassId == null) return [own];
    const sub: ClassResourceSource = {
      entry: {
        classId: c.subclassId,
        className: c.subclassName || "Подкласс",
        subclassId: null,
        subclassName: "",
        level: c.level,
        skillChoiceOptions: [],
        skillChoiceCount: 0,
        spellcastingAbility: "",
      },
      progression: getEntry(c.subclassId)?.data.progression as ClassProgression | undefined,
      replicateSchemes: [],
      subOf: c.classId,
    };
    return [own, sub];
  });
  // Боевые искусства монаха: категория оружия — снимком инвентаря, а у старых
  // строк — живым резолвом по entryId (снимка тогда не было).
  const weaponCategoryOf = (entryId: number | null | undefined): string | undefined => {
    if (entryId == null) return undefined;
    const cat = getEntry(entryId)?.data.category;
    return typeof cat === "string" ? cat : undefined;
  };
  // Состояние целиком: активно ли умение, какая кость. Живой резолв — те же
  // записи, что карточка уже догрузила для таблиц развития и особенностей.
  const martial = resolveMartialArts(
    value.classFeatures,
    value.equipmentSections,
    resourceSources,
    weaponCategoryOf
  );
  const monkWeaponOf = (item: DndEquipmentItem) => isItemMonkWeapon(item, weaponCategoryOf);
  // Движение без доспехов — из той же таблицы развития, что и пулы.
  const moveBonus = unarmoredMovementBonus(resourceSources, value.equipmentSections);
  // Ручная правка выигрывает всегда: у самодельного класса таблицы может не
  // быть вовсе, и обнулять ему ячейки расчётом нельзя.
  const autoSlots = !value.spellSlotsManual && computedSlots.basis !== "none";
  const shownSlotPips = autoSlots ? computedSlots.slots : value.spellSlotPips;
  // Круг, где лежат заклинания, виден и без ячеек: «Посвящённый» у Воина
  // даёт заклинание 1 круга, а ячеек нет (гриллинг черт 2026-09-24).
  const filledTop = value.spellsByLevel.reduce((top, lvl, i) => (lvl.length > 0 ? i + 1 : top), 0);
  const shownSlotLevels = autoSlots
    ? Math.max(highestCircle(computedSlots.slots), value.spellSlotLevels, filledTop)
    : Math.max(value.spellSlotLevels, filledTop);
  // Таинственный арканум (тикет 03 warlock): уровень КОЛДУНА (не суммарный),
  // пики — строки с меткой arcanum в кругах 6–9. Пипсы кругов с арканумом
  // выводятся из самих пиков (1 заклинание = 1 использование) поверх обычных
  // — тратятся и сбрасываются на долгом отдыхе общим механизмом.
  const warlockLevel = Math.max(
    0,
    ...value.classes.filter((c) => nameMatches(c.className, "Колдун")).map((c) => c.level)
  );
  const arcanumCount = arcanumCountByCircle(value.spellsByLevel);
  const magicPips = shownSlotPips.map((p, i) => (i >= 5 ? p + arcanumCount[i] : p));
  const arcanumTop = arcanumTopCircle(value.spellsByLevel);
  // Круги договора магии тоже разворачиваются: у чистого колдуна обычных
  // ячеек нет вовсе, и без этого раздел «Магия» не показывал бы ни одной
  // секции — заклинаниям негде было бы лежать.
  const magicLevels = Math.max(shownSlotLevels, arcanumTop, computedSlots.pact?.circle ?? 0);
  // Подпись «Арканум» — только кругам, где ВСЕ строки арканумные: у
  // мультикласса в 6–9 могут лежать и настоящие ячейки с обычными
  // заклинаниями, и путать их с арканумом нельзя.
  const arcanumTitles: Record<number, string> = {};
  for (let i = 5; i < 9; i += 1) {
    const rows = value.spellsByLevel[i];
    if (rows.length > 0 && rows.every((s) => s.arcanum)) arcanumTitles[i + 1] = `Арканум (${i + 1} круг)`;
  }
  const arcanumLocked = new Set(Object.keys(arcanumTitles).map(Number));
  // Тип урона от предка вида (Дыхание дракона) — один на лист.
  const lineageDamage = lineageDamageType(value.speciesFeatures, getEntry);
  const liveFeatureGroups = [
    value.classFeatures,
    value.speciesFeatures,
    value.feats,
    value.specialAbilities,
  ].map((g) =>
    g.map((f) => {
      const r = resolveFeature(f, getEntry);
      return r.effects?.length ? { ...r, effects: withLineageDamage(r.effects, lineageDamage) } : r;
    })
  );
  // Умения вида растут с уровнем персонажа (Дыхание дракона: кости и число
  // использований), классовые — с уровнем своего класса.
  const characterLevel = value.classes.reduce((n, c) => n + (c.level || 0), 0) || null;
  // Свои ресурсы умений (структурность): пулы из cost {uses, ownResource}
  // живых (разрешённых) особенностей. Дальше едут одним списком с
  // классовыми: трата, лента, «Ресурсы», сброс на отдыхе.
  // Уровень класса-хозяина умения (для levelSteps): вверх по родителям записи
  // до строки классов листа (фича → подкласс → класс). Умения вида — уровень
  // персонажа; черты ни к чему не привяжутся — там откат к amount.
  const featureClassLevel = (entryId: number): number | null => {
    let cur: number | null | undefined = entryId;
    const seen = new Set<number>();
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      if (value.raceId != null && cur === value.raceId) return characterLevel;
      const hit = value.classes.find((c) => c.classId === cur || c.subclassId === cur);
      if (hit) return hit.level;
      cur = getEntry(cur)?.parent_id ?? null;
    }
    return null;
  };
  const ownPools = featurePools(liveFeatureGroups.flat(), value.abilities, featureClassLevel);
  // Тела спутников (Фаза B): чертежи из живых особенностей с data.companion.
  // Именами не ищем никого — чертёж привязан к записи фичи, лимит — к нему же.
  const entryParentId = (id: number | null | undefined) => getEntry(id)?.parent_id ?? null;
  const ownedFeatureNames = liveFeatureGroups.flat().map((f) => f.name);
  // Неутомимый следопыта (10 ур.) — модалке отдыха: короткий отдых снижает
  // истощение на 1. Именем, как и остальные именные проверки в этом файле.
  const tireless = liveFeatureGroups.flat().some((f) => f.name === "Неутомимость");
  const summonOptions = liveFeatureGroups
    .flat()
    .filter((f): f is DndFeature & { entryId: number } => typeof f.entryId === "number")
    .map((f) => ({
      feature: f,
      blueprint: blueprintFromEntryData(
        getEntry(f.entryId)?.data as Record<string, unknown> | undefined
      ),
    }))
    .filter(
      (o): o is { feature: DndFeature & { entryId: number }; blueprint: CompanionBlueprint } =>
        o.blueprint != null
    );
  const blueprintOfInstance = (c: DndCompanion) => {
    const id = c.featureEntryId ?? c.spellEntryId;
    return id != null
      ? blueprintFromEntryData(getEntry(id)?.data as Record<string, unknown> | undefined)
      : null;
  };
  // Призывы заклинаниями (data.summon): те же тела, хозяин — запись спелла.
  // Круг выбирается при призыве (мощь от круга, а ритуал ячейки не тратит),
  // поэтому кнопка двухшаговая через summonSpell, а не мгновенная.
  const spellSummonOptions = (() => {
    const seen = new Set<number>();
    const out: { spell: DndSpellEntry & { entryId: number }; blueprint: CompanionBlueprint }[] = [];
    for (const sp of [...liveCantrips, ...liveSpellsByLevel.flat()]) {
      if (typeof sp.entryId !== "number" || seen.has(sp.entryId)) continue;
      seen.add(sp.entryId);
      const withId = sp as DndSpellEntry & { entryId: number };
      const blueprint = blueprintFromEntryData(
        getEntry(withId.entryId)?.data as Record<string, unknown> | undefined
      );
      if (blueprint?.hp) out.push({ spell: withId, blueprint });
    }
    return out;
  })();
  const companionsRest = companionsAfterLongRest(value.companions, blueprintOfInstance);
  const allPools = [...allResources(resourceSources, value.abilities), ...ownPools];
  // Бонус к пределам реплик (Лучший бронник: +схема/+предмет только доспехи):
  // суммируем маркеры replicaBonus живых особенностей. Показ, не enforcement.
  const replicaBonus: ReplicaBonus | null = (() => {
    const out: ReplicaBonus = { schemes: 0, items: 0, notes: [], from: [] };
    for (const f of liveFeatureGroups.flat()) {
      if (typeof f.entryId !== "number") continue;
      const b = (
        getEntry(f.entryId)?.data as
          | { replicaBonus?: { schemes?: number; items?: number; note?: string } }
          | undefined
      )?.replicaBonus;
      if (!b) continue;
      out.schemes += b.schemes ?? 0;
      out.items += b.items ?? 0;
      if (b.note && !out.notes.includes(b.note)) out.notes.push(b.note);
      if ((b.schemes || b.items) && !out.from.includes(f.name)) out.from.push(f.name);
    }
    return out.schemes > 0 || out.items > 0 ? out : null;
  })();
  // Гранты короткого отдыха чужим пулам (Отдохнувший гений, Магическое
  // наставление): собираются с живых особенностей, пул ищется названием
  // (прецедент: restore.pool). Модалке отдыха едут готовыми парами.
  const shortRestGrants = (() => {
    const out: { key: string; label: string; amount: number | "full" }[] = [];
    for (const f of liveFeatureGroups.flat()) {
      const g = f.cost?.shortRest;
      if (!g?.pool) continue;
      if (g.needsAttuned && !(value.attunementCount > 0)) continue;
      const pool = allPools.find((r) => r.label.toLowerCase() === g.pool.toLowerCase());
      if (!pool || out.some((o) => o.key === pool.key)) continue;
      out.push({ key: pool.key, label: pool.label, amount: g.amount ?? 1 });
    }
    return out;
  })();
  // Индекс поиска. Порядок групп особенностей здесь и в liveFeatureGroups
  // должен совпадать — подписи результата берутся по индексу группы.
  const searchHits = collectSheetHits(value, liveCantrips, liveSpellsByLevel, liveFeatureGroups);
  const rulesCards = [
    ...value.classes.flatMap((c, index) =>
      c.classId == null
        ? []
        : [{ id: c.classId, name: c.className || `Класс ${index + 1}`, level: c.level, classIndex: index, kind: "class" as const }]
    ),
    ...(value.raceId == null ? [] : [{ id: value.raceId, name: value.raceName || "Вид", kind: "species" as const }]),
  ];
  const activeRulesCard =
    rulesCards.find((c) => c.id === openRulesEntryId) ??
    value.classes.flatMap((c, classIndex) =>
      c.subclassId == null
        ? []
        : [{ id: c.subclassId, name: c.subclassName || "Подкласс", classIndex, kind: "subclass" as const }]
    ).find((c) => c.id === openRulesEntryId) ??
    null;
  function openFeatureFromRules(feature: CompendiumEntry) {
    const own = searchHits.find((hit) => hit.card?.kind === "feature" && hit.card.feature.entryId === feature.id);
    if (own) setOpenSheetCard(own);
    else openMentionPreview("compendium_entry", feature.id);
  }
  // Карты «Особенностей»: вид, класс и подкласс каждой строки, предок
  // (строка видовых умений из записи-линии, её пишет визард). Предка окно
  // правил не знает — он открывается превью записи.
  const featureCards = [
    { id: value.raceId, name: value.raceName || "Вид", lineage: false },
    ...value.classes.flatMap((c) => [
      { id: c.classId, name: c.className || "Класс", lineage: false },
      { id: c.subclassId, name: c.subclassName || "Подкласс", lineage: false },
    ]),
    ...value.speciesFeatures
      .filter((f) => f.entryId != null && (getEntry(f.entryId)?.kind === "lineage" || /^Предок:/.test(f.name)))
      .map((f) => ({ id: f.entryId, name: f.name.replace(/^Предок:\s*/, ""), lineage: true })),
  ].filter((c): c is { id: number; name: string; lineage: boolean } => c.id != null);
  // Правка «Свойств»: выданное видом, предком и чертами — отмеченным и
  // закрытым, с источником. Иначе сопротивление предка было на листе, но
  // не в галочках, и правка читалась как «его нет».
  const liveSheet = deriveSheet(withLiveEffects(value, getEntry));
  const grantedResistances = liveSheet.damageResistances.filter((r) => r.source);
  // Прибавки к ходьбе от черт («Подвижный» +10) — считаются сами; в правке
  // базовой скорости их видно подписью, иначе 30 в поле и 40 на листе.
  const walkBonuses = liveSheet.walkSpeed.parts.slice(1).filter((p) => !/^Истощение/.test(p.label));
  const grantedSenses = withGrantedSenses({ ...value, sensesList: [] }, getEntry).sensesList;
  function saveDraftFeatures() {
    if (!draftFeatures) return;
    onQuickUpdate?.(draftFeatures);
    setDraftFeatures(null);
    // Черту убрали или добавили — её выданные заклинания
    // («Туманный шаг» «Затронутого феями») пересчитываются.
    const ids = (list: DndFeature[]) => list.map((f) => f.entryId ?? "").join(",");
    if (onQuickUpdate && ids(draftFeatures.feats) !== ids(value.feats)) {
      void recomputeGrantedSpells({ ...value, feats: draftFeatures.feats }).then((spells) => onQuickUpdate(spells));
    }
  }
  function rulesCardTile(entryId: number | null, fallbackName: string, onOpen: () => void) {
    if (entryId == null) return null;
    const entry = getEntry(entryId);
    return (
      <div className="dnd-feature-card-link">
        <CardTile
          option={{ id: entryId, name: entry?.name || fallbackName, card: entry?.avatar_image_url ?? null }}
          small
          onClick={onOpen}
        />
      </div>
    );
  }
  const spellAbilityKey = characterSpellcastingAbility(value.classes) ?? subclassSpellcastingAbility();
  function subclassSpellcastingAbility(): DndAbilityKey | null {
    // Заклинатель через подкласс (Мистический рыцарь — Интеллект): у строки
    // Воина своей характеристики нет, берём из записи подкласса. Динамически,
    // а не записью в строку — тогда работает и у старых персонажей, и у
    // пришедших визардом, без миграций строк.
    for (const c of value.classes) {
      if (c.spellcastingAbility) continue;
      const sub =
        c.subclassId != null ? getEntry(c.subclassId)?.data.spellcasting_ability : undefined;
      if (typeof sub === "string" && sub) {
        const key = ABILITY_NAME_TO_KEY[sub] ?? null;
        if (key) return key;
      }
    }
    return null;
  }
  // Производные числа листа считает общий модуль (@shared/dnd/derive): здесь
  // они были константами в теле компонента, вызвать их было нельзя, а бонус
  // мастерства читался из сохранённой строки — и устаревал молча при любой
  // правке класса или уровня.
  // Числа — по эффектам из справочника, а не по сохранённым умениям: иначе
  // разметка записи («Оборона», «Бдительный») до числа не доходила.
  const liveValue = withLiveEffects(value, getEntry);
  const derived = deriveSheet(liveValue);
  const spellAbilityMod = spellAbilityKey ? abilityModifier(value.abilities[spellAbilityKey]) : 0;
  const spellProfBonus = derived.proficiencyBonus.value;
  const spellAttackBonus = derived.spellcasting
    ? derived.spellcasting.attackBonus.value
    : spellAbilityMod + spellProfBonus + parseBonus(value.spellAttackMisc) - value.exhaustion * 2;
  const spellDc = derived.spellcasting
    ? derived.spellcasting.saveDc.value
    : 8 + spellAbilityMod + spellProfBonus + parseBonus(value.spellDcMisc);
  // Своя характеристика заклинания: те же прибавки, другой модификатор.
  const spellNumbersFor = (key: DndAbilityKey) => {
    const delta = abilityModifier(value.abilities[key]) - spellAbilityMod;
    return { attack: spellAttackBonus + delta, dc: spellDc + delta };
  };
  const passivePerception = derived.passivePerception.value;
  // Картуш на портрете: то же, что в шапке листа, но своими строками и без
  // ссылок — на карте это подпись под именем, а не список источников.
  const totalLevel = value.classes.reduce((sum, c) => sum + (c.level || 0), 0);
  const classLine = value.classes
    .filter((c) => c.className)
    .map((c) => [stripLatin(c.className), stripLatin(c.subclassName)].filter(Boolean).join(" · "))
    .join(" / ");
  const originLine = [
    stripLatin(value.raceName),
    stripLatin(value.backgroundName),
    value.proficiencyBonus && `БМ ${value.proficiencyBonus}`,
  ]
    .filter(Boolean)
    .join(" · ");
  // Истощение видно на самом портрете: каждый уровень отнимает 17% цвета,
  // на шестом от лица остаётся чёрно-белое. Число в живом ряду называет
  // уровень, а карта показывает состояние — за столом на неё смотрят
  // урывками и цифру можно не заметить.
  const portraitDrain = `${Math.min(100, value.exhaustion * 17)}%`;
  const pools = hitDicePools(value.hitDice, value.hitDiceUsed);
  // 5.5: каждый уровень истощения — −2 к любому броску к20. Штраф уходит
  // в значения навыков, спасбросков, бонусы атак и пассивное восприятие, но
  // НЕ в КЗ и не в сложность заклинаний: это не броски к20.
  const exhaustionPenalty = value.exhaustion * 2;

  // Всё, что персонаж может применить, из всех источников сразу: оружие,
  // заклинания, умения классов, видов, черт и вручную вписанные атаки.
  // Считается здесь, а не на карте «Действия»: те же строки нужны закладкам
  // на первой карте, а собирать их дважды значит однажды разойтись.
  // Безоружный удар — первой строкой, но только когда его что-то меняет
  // (гриллинг 2026-09-23, Q12): монах бьёт им вместо атаки и Шквалом, а
  // «Сражение голыми руками» даёт свою кость. У остальных строки нет — «1 +
  // Сила» почти никто не бросает, а место в таблице она занимала бы всегда.
  const pb = derived.proficiencyBonus.value;
  const freeHandsForUnarmed =
    !wornArmorState(value.equipmentSections).hasShield &&
    !value.equipmentSections.some((sec) => sec.items.some((it) => it.equipped && !it.transferOut && it.weaponDamage));
  const weaponFx = (use: WeaponUse) => weaponEffects(liveValue, use, pb, freeHandsForUnarmed);
  const unarmedFx = weaponFx({ unarmed: true });
  const monkUnarmed = martial.active && !!martial.die;
  const unarmedRows: AttackRow[] = [];
  if (monkUnarmed || unarmedFx.dice || unarmedFx.attack.length || unarmedFx.damage.length || unarmedFx.notes.length) {
    const strMod = abilityModifier(value.abilities.str);
    const dexMod = abilityModifier(value.abilities.dex);
    // Монах бьёт Ловкостью, если она не хуже; стиль сам по себе — Силой.
    const mod = monkUnarmed ? Math.max(strMod, dexMod) : strMod;
    const styleDie = unarmedFx.dice?.value ?? null;
    const monkDie = monkUnarmed ? martial.die : null;
    // Две кости (монах со стилем) — берётся большая.
    const die = monkDie && styleDie ? (upgradeDamageDie(monkDie, styleDie) ? styleDie : monkDie) : monkDie ?? styleDie;
    const attackExtra = unarmedFx.attack.reduce((n, x) => n + x.value, 0);
    const damageExtra = unarmedFx.damage.reduce((n, x) => n + x.value, 0);
    const dmg = mod + damageExtra;
    unarmedRows.push({
      name: "Безоружный удар",
      bonus: formatModifier(mod + pb + attackExtra - exhaustionPenalty),
      damage: [
        die ? `${die} дробящий${dmg !== 0 ? ` ${formatModifier(dmg)}` : ""}` : `${Math.max(1, 1 + dmg)} дробящий`,
        ...(unarmedFx.dice ? [unarmedFx.dice.source] : []),
        ...unarmedFx.attack.map((x) => `${x.label} ${formatModifier(x.value)} к атаке`),
        ...unarmedFx.notes,
      ].join(" · "),
      range: "Ближний",
      timing: "action" as const,
      entryId: null,
      group: "melee",
    });
  }
  // Переключаемые эффекты умений и черт (Дуэлянт, Q14) — в заголовок
  // «Рукопашного». Список — по сырым эффектам, без учёта выключенного.
  const effectToggles = [...value.speciesFeatures, ...value.classFeatures, ...value.feats, ...value.specialAbilities]
    .map((f) => ({ f, eff: (getEntry(f.entryId)?.data.effects as DndEffect[] | undefined)?.find((e) => e.toggleable) }))
    .filter((x) => x.eff)
    .map(({ f, eff }) => ({
      name: (f.name || "Умение").trim(),
      label: `${(f.name || "Умение").trim()}${eff!.modifier ? ` ${eff!.modifier}` : ""}`,
      title: eff!.text || "Выключите, когда условие не выполняется",
    }));
  const actionRows = [
    ...unarmedRows,
    ...weaponAttackRows(
      value.equipmentSections,
      value.abilities,
      pb,
      exhaustionPenalty,
      martial.active && martial.die
        ? { die: martial.die, isMonkWeapon: monkWeaponOf }
        : null,
      value.masteredWeapons.length > 0
        ? {
            ids: new Set(
              value.masteredWeapons.map((w) => w.entryId).filter((id): id is number => typeof id === "number")
            ),
            names: new Set(value.masteredWeapons.map((w) => w.name.trim().toLowerCase()).filter(Boolean)),
          }
        : null,
      weaponFx
    ),
    ...combatSpellRows(liveCantrips, liveSpellsByLevel, spellAttackBonus, spellDc, spellNumbersFor, {
      spell: spellAbilityKey ? spellAbilityMod : null,
      abilities: value.abilities,
    }),
    // Уровень класса-хозяина для кубов levelDice: строка класса/подкласса
    // по sourceParentId особенности. Ручные (без sourceParentId) — без скейла.
    ...featureActionRows(liveFeatureGroups, spellAttackBonus, spellDc, (pid) => {
      if (pid == null) return null;
      if (value.raceId != null && pid === value.raceId) return characterLevel;
      const hit = value.classes.find((c) => c.classId === pid || c.subclassId === pid);
      return hit ? hit.level : null;
    },
    {
      abilities: value.abilities,
      profBonus: parseBonus(value.proficiencyBonus),
      misc: parseBonus(value.spellDcMisc),
    }),
    ...manualAttackRows(value.attacks),
  ];
  const pinnedNames = (value.pinnedActions ?? []).map((p) => p.name);
  const bookmarkRows = pickBookmarks(actionRows, value.pinnedActions);
  function togglePinned(row: AttackRow) {
    if (!onQuickUpdate) return;
    const current = value.pinnedActions ?? [];
    const already = current.some((p) => p.name === row.name);
    // Снятая последняя закладка возвращает лист к своему предложению — это
    // и есть «сброс», отдельной кнопки для него не нужно.
    if (already) {
      onQuickUpdate({ pinnedActions: current.filter((p) => p.name !== row.name) });
      return;
    }
    const entry: DndPinnedAction = {
      entryId: row.source?.kind === "spell" ? (row.source.spell.entryId ?? null) : null,
      name: row.name,
      kind: row.source?.kind === "spell" ? "spell" : row.source?.kind === "feature" ? "feature" : "weapon",
    };
    // Четвёртая вытесняет самую старую молча: диалог «какую убрать?» посреди
    // боя дороже, чем повторное нажатие.
    onQuickUpdate({ pinnedActions: [...current, entry].slice(-3) });
  }

  // И −5 футов скорости за уровень. Считается только от структурной ходьбы:
  // в свободном тексте («9 клеток, лазание 3») отнимать нечего, и он
  // остаётся примечанием под итогом. Движение без доспехов монаха — плюсом к
  // базе до штрафа: бонус — часть скорости, а не освобождение от истощения.
  const walkDie = walkDieParts(value.speeds, value.exhaustion, prefs.distanceUnit, moveBonus.bonus);
  // Остальные способы передвижения на кость не лезут и туда не нужны: кость
  // отвечает на вопрос «сколько я прохожу», а полёт и лазание есть не у всех
  // и спрашиваются реже. Они уходят подписью под рядом — вместе со старой
  // свободной строкой скорости, если она заполнена.
  const otherSpeeds = formatSpeed({ ...value.speeds, walk: null }, prefs.distanceUnit);
  // Свободная строка скорости печатается, только если добавляет что-то сверх
  // кости: «30 фт.» при walk = 30 — дубль, а не примечание. Проверка строгая
  // (голое число равно ходьбе), чтобы «полёт 60 фт.» и прочие не гасли.
  const legacySpeedNote = (() => {
    const text = (value.speed || "").trim();
    if (!text) return "";
    const num = /(\d+)/.exec(text);
    const hasKind = /пол[её]т|летит|плавани|плывёт|лазани|копани|рыть|ходьб|fly|swim|climb|burrow|walk/i.test(text);
    if (num && !hasKind && value.speeds.walk != null && Number(num[1]) === value.speeds.walk) return "";
    return text;
  })();
  // Список класса по кругам — до старшего круга по уровню самого класса
  // (Q8); без того, что уже в листе. classListIds — весь список, по нему
  // снятая подготовка решает, стереть ли строку из листа (Q7).
  const classListIds = new Set<number>();
  const classListByLevel: DndSpellEntry[][] = Array.from({ length: 9 }, () => []);
  if (spellIndex) {
    const inSheet = new Set(
      [...value.cantrips, ...value.spellsByLevel.flat()].map((sp) => sp.entryId).filter((id): id is number => id != null)
    );
    for (const c of fullListClasses) {
      const data = getEntry(c.classId)?.data;
      if (!data) continue;
      const top = classSpellPicks(data, c.level, 0).topCircle;
      for (const e of spellIndex) {
        const lvl = e.level ?? 0;
        if (lvl < 1 || lvl > top || classListIds.has(e.id)) continue;
        const refs = Array.isArray(e.data?.classes) ? (e.data.classes as { id?: number }[]) : [];
        if (!refs.some((r) => r.id === c.classId)) continue;
        classListIds.add(e.id);
        if (!inSheet.has(e.id)) {
          classListByLevel[lvl - 1].push({ entryId: e.id, name: e.name, prepared: 0, ...spellSnapshotFromEntry(e) });
        }
      }
    }
  }
  // Ромб вне правки: подготовить / снять. Из списка класса — пишется в лист
  // подготовленным; снятое, если оно из списка и ничем не особо, стирается
  // (в списке останется контуром). Взятое через «Добавить», «особое», выдачи
  // и арканум остаются неподготовленными.
  const togglePreparedInView = (level: number, sp: DndSpellEntry, index: number | null) => {
    if (!onQuickUpdate) return;
    const flip = (x: DndSpellEntry): DndSpellEntry => ({ ...x, prepared: x.prepared === 1 ? 0 : 1 });
    if (level === 0) {
      if (index != null) onQuickUpdate({ cantrips: value.cantrips.map((x, i) => (i === index ? flip(x) : x)) });
      return;
    }
    const list = value.spellsByLevel[level - 1] ?? [];
    let nextList: DndSpellEntry[];
    if (index == null) {
      nextList = [...list, { entryId: sp.entryId, name: sp.name, prepared: 1 }];
    } else {
      const cur = list[index];
      if (!cur) return;
      const drop =
        cur.prepared === 1 &&
        cur.entryId != null &&
        classListIds.has(cur.entryId) &&
        !cur.special &&
        !cur.outsideLimit &&
        !cur.arcanum &&
        cur.sourceParentId == null;
      nextList = drop ? list.filter((_, i) => i !== index) : list.map((x, i) => (i === index ? flip(x) : x));
    }
    onQuickUpdate({
      spellsByLevel: value.spellsByLevel.map((l, i) => (i === level - 1 ? nextList : l)),
      spellSlotLevels: Math.max(value.spellSlotLevels, level),
    });
  };
  // Класс и подкласс — источники списка. Многоклассовый персонаж видит
  // объединение: заклинание из любого своего списка он взять вправе.
  const spellListSources = value.classes.flatMap((c) => [
    ...(c.classId != null ? [{ id: c.classId, name: c.className || "Класс" }] : []),
    ...(c.subclassId != null ? [{ id: c.subclassId, name: c.subclassName || "Подкласс" }] : []),
  ]);
  // Считается на каждый рендер намеренно: подписка на кэш уже перерисовывает
  // лист при любой смене его состояния, включая появление и снятие неудач.
  const entriesFailed = hasFailedEntries() && sheetEntryIds(value).some((id) => typeof id === "number");
  // Спасброски от смерти появляются сами, когда становятся нужны. «Хитов нет»
  // — это ноль или меньше: урон уводит текущие хиты в минус (нижняя граница —
  // Этап 2), и лист обязан показать дорожки и в этом случае. Пустое поле
  // хитов у только что заведённого листа за смерть не считается.
  const atZeroHp =
    (value.hitPointsCurrent !== "" && (Number(value.hitPointsCurrent) || 0) <= 0) ||
    value.deathSaveSuccesses > 0 ||
    value.deathSaveFailures > 0;
  const computedAc = derived.armorClass.value;
  return (
    <div className="sb-scope" onClickCapture={() => highlight && setHighlight(null)}>
      <div className="sb-card">
        {activeRulesCard && (
          <Modal wide className="dnd-rules-card-modal" ariaLabel={`Карта: ${activeRulesCard.name}`} onClose={() => setOpenRulesEntryId(null)}>
            <div className="stack">
              <div className="row dnd-rules-card-head">
                <div className="dnd-rules-card-switches" role="tablist" aria-label="Карты персонажа">
                  {rulesCards.map((card) => (
                    <button
                      key={`${card.kind}-${card.id}`}
                      type="button"
                      className={card.id === activeRulesCard.id ? "primary" : ""}
                      aria-selected={card.id === activeRulesCard.id}
                      onClick={() => setOpenRulesEntryId(card.id)}
                    >
                      {card.name}
                    </button>
                  ))}
                </div>
                <button type="button" className="comp-mini" aria-label="Закрыть" onClick={() => setOpenRulesEntryId(null)}>
                  <NavIcon name="close" />
                </button>
              </div>
              <CardSpread
                systemId={value.systemId}
                entryId={activeRulesCard.id}
                currentLevel={activeRulesCard.kind === "class" ? activeRulesCard.level : undefined}
                onOpenFull={openFeatureFromRules}
                strip={
                  activeRulesCard.kind === "class" && activeRulesCard.classIndex != null
                    ? (() => {
                        const cls = value.classes[activeRulesCard.classIndex];
                        return cls?.subclassId != null
                          ? <div className="dc-substrip">{rulesCardTile(cls.subclassId, cls.subclassName || "Подкласс", () => setOpenRulesEntryId(cls.subclassId!))}</div>
                          : undefined;
                      })()
                    : undefined
                }
              />
            </div>
          </Modal>
        )}
        {openSheetCard?.card && (
          <DndCardModal
            title={openSheetCard.name}
            spell={openSheetCard.card.kind === "spell" ? openSheetCard.card.spell : null}
            feature={openSheetCard.card.kind === "feature" ? openSheetCard.card.feature : null}
            getEntry={getEntry}
            onClose={() => setOpenSheetCard(null)}
          />
        )}
        {/* Шапки над картами нет нигде: на лицевой имя стоит в картуше, отдых —
            жетоном в углу карты, а правка уехала на плашку чарника в профиле
            (решение владельца 2026-09-06). Верх страницы — поиск, потом
            полоска карт. Отдых — жетоном с лицевой, происхождение правится
            адресом ?edit=1. */}
        {openAction && !openAction.source && (
          <ActionInfoModal row={openAction} systemId={value.systemId} onClose={() => setOpenAction(null)} />
        )}
        {openAction?.source && (
          <DndCardModal
            title={openAction.name}
            spell={openAction.source.kind === "spell" ? openAction.source.spell : null}
            feature={openAction.source.kind === "feature" ? openAction.source.feature : null}
            getEntry={getEntry}
            onClose={() => setOpenAction(null)}
            extra={
              onQuickUpdate ? (
                <div className="stack" style={{ gap: 10, alignItems: "stretch" }}>
                  <SpendAction
                    row={openAction}
                    value={value}
                    slots={magicPips}
                    pact={computedSlots.pact}
                    resources={allPools}
                    characterId={ownerCharacterId}
                    onQuickUpdate={onQuickUpdate}
                    onDone={() => setOpenAction(null)}
                  />
                  {(() => {
                    // Коробка эликсиров — только у умения с таблицей (алхимик):
                    // что за эффекты на руках после бросков/выбора.
                    const f =
                      openAction.source.kind === "feature" ? openAction.source.feature : null;
                    const table =
                      f?.entryId != null
                        ? (
                            getEntry(f.entryId)?.data as
                              | { elixirTable?: { key: string; name: string; short: string }[] }
                              | undefined
                          )?.elixirTable
                        : null;
                    if (!table || table.length === 0) return null;
                    return (
                      <ElixirBox
                        table={table}
                        elixirs={value.elixirs ?? []}
                        onChange={(elixirs) => onQuickUpdate({ elixirs })}
                      />
                    );
                  })()}
                </div>
              ) : undefined
            }
          />
        )}
        {spellListOpen && (
          <DndClassSpellListModal
            systemId={value.systemId}
            sources={spellListSources}
            cantrips={value.cantrips}
            spellsByLevel={value.spellsByLevel}
            maxCircle={shownSlotLevels}
            titleLine={`${value.characterName || "Без имени"} · ${stripLatin(
              value.classes.find((c) => c.className)?.className ?? "Без класса"
            )} ${totalLevel}`}
            listIds={classListIds}
            onPick={(items) => {
              if (!onQuickUpdate || items.length === 0) return;
              // Берутся неподготовленными: взять в книгу и подготовить на день
              // — разные действия, и приложение не вправе решать второе за
              // игрока. Снапшот не пишем — его подставит resolveSpell из
              // кэша справочника, как и у заклинаний, добавленных поиском.
              // Пачка уходит одним сохранением, а не N подряд.
              const make = (entry: CompendiumEntry, special: boolean): DndSpellEntry => ({
                entryId: entry.id,
                name: entry.name,
                prepared: 0,
                ...(special ? { special: true } : {}),
              });
              const newCantrips = items.filter((i) => i.level <= 0).map((i) => make(i.entry, i.special));
              const topLevel = Math.max(0, ...items.map((i) => i.level));
              const next = value.spellsByLevel.map((lvl, i) => [
                ...lvl,
                ...items.filter((it) => it.level === i + 1).map((it) => make(it.entry, it.special)),
              ]);
              onQuickUpdate({
                cantrips: [...value.cantrips, ...newCantrips],
                spellsByLevel: next,
                // Круг, которого лист ещё не показывал, иначе взятое просто
                // не появится на экране.
                spellSlotLevels: Math.max(value.spellSlotLevels, topLevel),
              });
              setSpellListOpen(false);
            }}
            onClose={() => setSpellListOpen(false)}
          />
        )}
        {arcanumOpen && onQuickUpdate && (
          <DndArcanumPicker
            systemId={value.systemId}
            warlockClassId={value.classes.find((c) => nameMatches(c.className, "Колдун"))?.classId ?? null}
            warlockLevel={warlockLevel}
            characterName={value.characterName}
            spellsByLevel={value.spellsByLevel}
            onPick={(idx, entry) => {
              // Замена арканума круга целиком: свои строки уходят, чужие
              // (настоящие ячейки мультикласса) остаются. Арканум всегда
              // подготовлен и вне лимита — иначе съест бюджет подготовки.
              // Модалка не закрывается: на 17 уровне брать четыре штуки.
              const next = value.spellsByLevel.map((lvl, i) =>
                i === idx
                  ? [
                      ...lvl.filter((s) => !s.arcanum),
                      { entryId: entry.id, name: entry.name, prepared: 2, outsideLimit: true, arcanum: true } as DndSpellEntry,
                    ]
                  : lvl
              );
              onQuickUpdate({ spellsByLevel: next });
            }}
            onClose={() => setArcanumOpen(false)}
          />
        )}
        {originEditing && onQuickUpdate && (
          <DndOriginEditForm origin={origin} value={value} onQuickUpdate={onQuickUpdate} />
        )}
        {fanOpen && (
          <DndDeckFan
            current={tab}
            pendingItems={pendingItems}
            subtitle={`${value.characterName || "Без имени"} · ${stripLatin(
              value.classes.find((c) => c.className)?.className ?? "Без класса"
            )} ${totalLevel}`}
            details={(() => {
              const plural = (n: number, one: string, few: string, many: string) =>
                n % 10 === 1 && n % 100 !== 11
                  ? one
                  : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)
                    ? few
                    : many;
              const short = (s: string, n: number) => {
                const clean = s.replace(/\s+/g, " ").trim();
                return clean.length > n ? `${clean.slice(0, n)}…` : clean;
              };
              const spellCount = value.cantrips.length + value.spellsByLevel.reduce((n, l) => n + l.length, 0);
              const itemCount = value.equipmentSections.reduce((n, s) => n + s.items.length, 0);
              const coinsTotal = (Object.values(value.coins ?? {}) as unknown[]).reduce<number>(
                (sum, v) => sum + (parseInt(String(v ?? ""), 10) || 0),
                0
              );
              const slotLeft = shownSlotPips.map((max, i) => max - (value.spellSlotsUsed[i] ?? 0));
              const slotCircles = shownSlotPips
                .map((max, i) => ({ max, left: Math.max(0, slotLeft[i]) }))
                .filter((c) => c.max > 0);
              const subclassIds = value.classes
                .map((c) => c.subclassId)
                .filter((id): id is number => typeof id === "number");
              const subclassFeats = value.classFeatures.filter(
                (f) => f.sourceParentId != null && subclassIds.includes(f.sourceParentId)
              ).length;
              const dossier: string[] = [];
              for (const { key, label } of NARRATIVE_FIELDS) {
                const text = String(value[key] ?? "").trim();
                if (text) dossier.push(`${label}: ${short(text, 60)}`);
              }
              const pools = allResources(resourceSources, value.abilities).map((r) => {
                const max = r.max + (value.resourceBonus[r.key] ?? 0);
                return `${r.label}: ${Math.max(0, max - Math.min(value.resourceUsed[r.key] ?? 0, max))} из ${max}`;
              });
              if (value.hitDice) pools.push(`Кости хитов: ${value.hitDice}`);
              const byTiming = (t: DndActionTiming) => actionRows.filter((r) => r.timing === t).length;
              return {
                "Карта": [
                  `КЗ ${computedAc}`,
                  `${value.hitPointsCurrent || "—"}/${value.hitPointMax || "—"} хитов`,
                  ...(value.concentration ? [`концентрация: ${short(value.concentration, 30)}`] : []),
                ],
                "Действия": [
                  `действий: ${byTiming("action")}`,
                  `бонусных: ${byTiming("bonus")}`,
                  `реакций: ${byTiming("reaction")}`,
                  ...(byTiming("other") > 0 ? [`особых: ${byTiming("other")}`] : []),
                ],
                "Магия": [
                  ...(spellAbilityKey ? [`АТК ${formatModifier(spellAttackBonus)} · СЛ ${spellDc}`] : []),
                  ...(spellCount > 0
                    ? [`${spellCount} ${plural(spellCount, "заклинание", "заклинания", "заклинаний")}`]
                    : []),
                  ...(slotCircles.length > 0 ? [`ячейки ${slotCircles.map((c) => c.left).join(" / ")}`] : []),
                ],
                "Снаряжение": [
                  `${itemCount} ${plural(itemCount, "предмет", "предмета", "предметов")}`,
                  `настроено: ${value.attunementCount ?? 0}`,
                  `монет: ${coinsTotal}`,
                ],
                "Навыки": [
                  `БМ ${value.proficiencyBonus}`,
                  (() => {
                    const n = Object.values(value.skillProfs).filter((v) => (v as number) > 0).length;
                    return `${n} ${plural(n, "владение", "владения", "владений")}`;
                  })(),
                  (() => {
                    const n = value.proficiencies.length;
                    return `${n} ${plural(n, "инструмент", "инструмента", "инструментов")}`;
                  })(),
                ],
                "Особенности": [
                  ...(value.speciesFeatures.length > 0 ? [`вида: ${value.speciesFeatures.length}`] : []),
                  ...(value.classFeatures.length - subclassFeats > 0
                    ? [`класса: ${value.classFeatures.length - subclassFeats}`]
                    : []),
                  ...(subclassFeats > 0 ? [`подкласса: ${subclassFeats}`] : []),
                  ...(value.feats.length > 0 ? [`черты: ${value.feats.length}`] : []),
                  ...(value.specialAbilities.length > 0 ? [`иное: ${value.specialAbilities.length}`] : []),
                ],
                "Досье": dossier,
                "Ресурсы": pools,
              } as Record<DndViewTab, string[]>;
            })()}
            onPick={setTab}
            onClose={() => setFanOpen(false)}
          />
        )}
        {restOpen && (
          <DndRestModal
            value={value}
            resources={allPools}
            pools={pools}
            companionsAfterRest={companionsRest}
            shortGrants={shortRestGrants}
            tireless={tireless}
            kind={restOpen}
            onQuickUpdate={onQuickUpdate!}
            onClose={() => setRestOpen(false)}
          />
        )}
        {/* Рамка карты: бока тонкие и цветные, верх и низ несут содержимое.
            Цвет — единственная краска на монохромной бумаге листа. */}
        <div
          className="sb-body dnd-card-frame"
          style={{ borderLeftColor: cardColor, borderRightColor: cardColor }}
          onTouchStart={onSheetTouchStart}
          onTouchEnd={onSheetTouchEnd}
        >

          {/* Данные компендиума не доехали: лист рисуется по сохранённым
              именам, но молчать об этом нельзя — иначе «у заклинания пропало
              описание» выглядит как потеря данных, а не как обрыв связи. */}
          {entriesFailed && (
            <div className="sb-entry dnd-entries-failed">
              <span className="sb-prop-label">Компендиум</span> данные не загрузились — показаны сохранённые имена.{" "}
              <button type="button" className="comp-mini" onClick={() => retryFailedEntries()}>
                Повторить
              </button>
            </div>
          )}
          {/* Поиск живёт внизу карт (решение владельца): верх отдан карте,
              а поиск нужен после просмотра, не до. На лицевой его нет вовсе:
              она и так отвечает на «кто я и чем бью», а строка ввода поверх
              портрета читалась как часть карты. */}
          {/* Полоска названий колоды — одна на телефон и на десктоп (Q29).
              Раньше телефон получал выпадающий список, а десктоп — ряд
              кнопок: два разных языка навигации на одном листе. Полоска
              прокручивается вбок, текущая карта подчёркнута цветом класса, и
              Мастеру, впервые открывшему чужой лист, видно, куда нажать —
              свайпов он не знает. */}
          {/* Полоска названий колоды: на телефоне — сверху потоком, на
              десктопе — шапка правой колонки (R2.1, по макету). Та же
              навигация, только место другое: showDesktopFace синхронен
              с CSS-брейкпоинтом 700px через useIsMobile. */}
          {/* На «Карте» телефона полоски нет (макет 2026-09-25): карта встаёт
              от края до края, а в колоду ведут свайп, веер по двойному тапу и
              «Колода карт» в меню «⋯». */}
          {!showDesktopFace && !cardOnly && tab !== "Карта" && (
          <div className="dnd-deck-strip" role="tablist" aria-label="Карты листа" ref={deckStripRef}>
            {DND_VIEW_TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "active" : ""}
                style={tab === t ? { borderBottomColor: cardColor } : undefined}
                onClick={() => setTab(t)}
              >
                {t}
                {/* Точка у «Снаряжения»: кто-то передал предмет, а системы
                    уведомлений в приложении нет — иначе о переданном
                    узнают, только заглянув на карту. */}
                {t === "Снаряжение" && pendingItems > 0 && <span className="dnd-tab-dot" aria-label="есть непринятое" />}
              </button>
            ))}
          </div>
          )}

          {/* Десктопный сплит (этап 7): лицевая/оборот слева в натуральную
              величину, вкладка справа. На телефоне обёртка прозрачна
              (display: contents) — поток как был. */}
          <div className="dnd-desktop-split">
          {/* КАРТА ПЕРСОНАЖА — первая карта колоды (гриллинг 2026-09-04).
              Раньше этот блок висел несворачиваемой шапкой над всеми
              вкладками: чтобы дойти до содержимого любой из них, надо было
              пролистать характеристики и весь список навыков. Теперь это
              своя карта, и она же — то место, куда Мастер заглядывает за
              одним числом. */}
          {(tab === "Карта" || showDesktopFace) && !cardFlipped && (
            <div
              className="stack dnd-card-face"
              style={{ borderLeftColor: cardColor, borderRightColor: cardColor, borderBottomColor: cardColor }}
            >
              {/* Полоса правки видна только когда лист открыт карандашом с
                  плашки: «Готово» убирает параметр из адреса и возвращает
                  карту к чтению. */}
              {editFromUrl && onQuickUpdate && (
                <div className="row dnd-card-editbar">
                  <span className="sb-label">Правка карты</span>
                  {canFrame && portraitUrl && !portraitStale && (
                    <>
                      <span className="muted">Тяните портрет — кадрируется</span>
                      <button
                        type="button"
                        className="comp-mini"
                        title="Вернуть кадр по умолчанию"
                        onClick={() => onQuickUpdate({ portraitFocus: { ...DEFAULT_PORTRAIT_FOCUS } })}
                      >
                        Сброс кадра
                      </button>
                    </>
                  )}
                  <button type="button" className="primary" onClick={leaveEdit}>
                    Готово
                  </button>
                </div>
              )}
              {/* Портрет владеет верхом карты и уходит в бумагу, а под ним
                  лежит он же, отражённый по обеим осям и почти невидимый, —
                  как на фигурных картах. Шва не видно, потому что верхний
                  гаснет не в ноль, а до силы нижнего. Текста поверх нет: имя
                  и класс уже стоят в шапке листа, и дублировать их значило бы
                  написать одно и то же дважды на одном экране. */}
              {/* Двойник — сосед портретной зоны, а не её потомок: он тянется
                  до низа карты, а зона высотой ровно с лицо. Портрет и
                  отражение вдвоём и есть подложка карточки. */}
              {portraitUrl && !portraitStale && (
                <span className="dnd-card-portrait-ghost" aria-hidden="true">
                  <img
                    src={portraitUrl}
                    alt=""
                    style={{ ...portraitImgStyle(frame.shown, value.portraitZoom), filter: `grayscale(${portraitDrain})` }}
                  />
                </span>
              )}
              {/* Зона рисуется и без портрета: картуш с именем — часть карты,
                  а не подпись под фотографией, и шапки листа на этой карте
                  больше нет. Без портрета зона схлопывается по содержимому.
                  Двойной тап по портрету разворачивает колоду веером, а в
                  ?edit=1 портрет тянется для кадрирования (см. useFrameDrag). */}
              {/* Окно кадра — одно на лицевую и оборот: с лицевой его
                  открывает «+ Портрет» пустой зоны (на телефоне оборот
                  прячется за уголком), с оборота — «Новый портрет»/«Кадр». */}
              {frameEdit && onQuickUpdate && (
                <PortraitFrameModal
                  src={frameEdit.src}
                  focus={frameEdit.file ? undefined : value.portraitFocus}
                  zoom={frameEdit.file ? undefined : value.portraitZoom}
                  name={value.characterName}
                  subtitle={classAndLevelSummary(value.classes)}
                  busy={avatarUploading}
                  onClose={closeFrameEdit}
                  onApply={async (focus, zoom) => {
                    if (frameEdit.file && !(await uploadPortrait(frameEdit.file))) return;
                    onQuickUpdate({ portraitFocus: focus, portraitZoom: zoom > 1 ? zoom : undefined });
                    closeFrameEdit();
                  }}
                />
              )}
              <div
                className={`dnd-card-portrait-zone${portraitUrl ? "" : " is-empty"}${canFrame ? " is-framing" : ""}${frame.dragging ? " is-dragging" : ""}${atZeroHp ? " has-death" : ""}`}
                onTouchEnd={onPortraitTouchEnd}
                onPointerDown={frame.handlers.onPointerDown}
                onPointerMove={frame.handlers.onPointerMove}
                onPointerUp={frame.handlers.onPointerUp}
                onPointerCancel={frame.handlers.onPointerCancel}
                onClickCapture={frame.handlers.onClickCapture}
              >
                  {/* Портрета нет — ставится прямо здесь, файл сразу в окно
                      кадра (владелец 2026-09-25: на телефоне до оборота с
                      «Редактировать» было не добраться). */}
                  {!portraitUrl && canUploadPortrait && onQuickUpdate && (
                    <label className="dnd-card-portrait-add">
                      + Портрет
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display: "none" }}
                        disabled={avatarUploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) setFrameEdit({ src: URL.createObjectURL(file), file });
                        }}
                      />
                    </label>
                  )}
                  {portraitUrl && !portraitStale && (
                  <div className="dnd-card-portrait">
                    <img
                      src={portraitUrl}
                      alt=""
                      style={{ ...portraitImgStyle(frame.shown, value.portraitZoom), filter: `var(--portrait-tone) grayscale(${portraitDrain})` }}
                      // Подписанные URL файлов живут 60 секунд: посидев на
                      // другой карте дольше, возвращаемся к протухшей ссылке.
                      // Прячем битую картинку и один раз просим свежий URL —
                      // родитель перезагружает персонажа, ссылка приезжает
                      // новой, стейт сбрасывается по смене portraitUrl.
                      onError={handlePortraitError}
                    />
                    <span className="dnd-card-portrait-grain" aria-hidden="true" />
                    <span className="dnd-card-portrait-fade" aria-hidden="true" />
                  </div>
                  )}
                  {/* Спасброски от смерти (В3): поверх портрета, потому что
                      ноль хитов — это ровно то, на что смотрят, и вводится он
                      здесь же, модалкой хитов. Появляются сами и сами уходят:
                      на здоровом персонаже их нет. */}
                  {atZeroHp && (
                    <DeathSaveOverlay
                      successes={value.deathSaveSuccesses}
                      failures={value.deathSaveFailures}
                      onQuickUpdate={onQuickUpdate}
                    />
                  )}
                  {/* КАРТУШ — имя стоит у нижнего края портретной половины,
                      как на макете: карта должна называть персонажа сама, а
                      не полагаться на шапку листа над ней (её на этой карте
                      теперь и нет — см. sb-head ниже). Уровень числом в
                      картуше цвета класса, под ним вид, предыстория и бонус
                      мастерства — то, что спрашивают редко, но глазами
                      ищут именно здесь. */}
                  <div className="dnd-card-cartouche">
                    <div className="dnd-card-cartouche-name">{value.characterName || "Без имени"}</div>
                    <div className="dnd-card-cartouche-class">
                      {/* Цифра уровня — вход в визард повышения. Она уже стоит
                          на лицевой стороне и означает ровно то, что визард
                          меняет; отдельной кнопки для этого заводить не нужно.
                          Раньше единственным входом был тап по неподписанному
                          загнутому уголку — то есть повышение уровня нельзя
                          было найти, не зная про жест. */}
                      {totalLevel > 0 &&
                        (onQuickUpdate ? (
                          <button
                            type="button"
                            className="dnd-card-level"
                            style={{ background: cardColor, color: textOnClassColor(cardColor) }}
                            aria-label={`Уровень ${totalLevel} — повысить`}
                            disabled={detached}
                            title={detached ? "Повышение уровня доступно в подключённом чарнике" : undefined}
                            onClick={() => setShowLevelUp(true)}
                          >
                            {totalLevel}
                          </button>
                        ) : (
                          <span className="dnd-card-level" style={{ background: cardColor, color: textOnClassColor(cardColor) }}>
                            {totalLevel}
                          </span>
                        ))}
                      <span className="dnd-card-cartouche-classline">
                        {value.classes.filter((c) => c.classId != null && c.className).map((c, i) => (
                          <span key={`${c.classId}-${i}`}>
                            {i > 0 && " / "}
                            <button type="button" className="dnd-card-text-link" onClick={() => setOpenRulesEntryId(c.classId)}>
                              {[stripLatin(c.className), stripLatin(c.subclassName)].filter(Boolean).join(" · ")}
                            </button>
                          </span>
                        ))}
                        {value.classes.every((c) => c.classId == null) && classLine}
                      </span>
                    </div>
                    {originLine && (
                      <div className="dnd-card-cartouche-origin">
                        {value.raceId != null ? (
                          <button type="button" className="dnd-card-text-link" onClick={() => setOpenRulesEntryId(value.raceId)}>
                            {stripLatin(value.raceName) || "Вид"}
                          </button>
                        ) : stripLatin(value.raceName)}
                        {value.backgroundName && <> · {stripLatin(value.backgroundName)}</>}
                        {value.proficiencyBonus && <> · БМ {value.proficiencyBonus}</>}
                      </div>
                    )}
                  </div>
              </div>
              {/* ВДОХНОВЕНИЕ — жетон-звезда в углу карты (гриллинг 2026-09-04);
                  спрятано флагом. Отдых переехал на оборот (макет 2026-09-25):
                  его нажимают раз за сцену, а не посреди хода. */}
              {INSPIRATION_TOKEN_ENABLED && (value.inspiration || onQuickUpdate) && (
                <button
                  type="button"
                  className={`dnd-inspiration-token${value.inspiration ? " is-on" : ""}${portraitUrl ? " on-portrait" : ""}`}
                  style={value.inspiration ? { borderColor: cardColor } : undefined}
                  aria-pressed={value.inspiration}
                  aria-label={value.inspiration ? "Вдохновение есть — потратить" : "Вдохновения нет"}
                  title="Вдохновение"
                  disabled={!onQuickUpdate}
                  onClick={onQuickUpdate ? () => onQuickUpdate({ inspiration: !value.inspiration }) : undefined}
                >
                  <img className="dnd-token-img" src={rasterAsset("tokens", "inspiration") ?? undefined} alt="" aria-hidden="true" draggable={false} />
                </button>
              )}
            {/* §1.11: постоянные ячейки — то, на что игрок смотрит каждый ход.
                Условные показываются, только когда им есть что сказать:
                спасброски от смерти на здоровом персонаже были шумом в самом
                плотном месте листа. Пассивное восприятие и бонус мастерства
                нужны часто, но не каждый ход — бонус мастерства ушёл
                строкой-подписью под ячейками, а пассивное восприятие поднялось
                на кость в ряд к КЗ и хитам. */}
            {/* Пять костей в ряд: КЗ, хиты, инициатива, пассивное восприятие,
                скорость. Это те числа, за которыми к чужому листу заглядывает
                Мастер и на которые чаще всего смотрит игрок; всё остальное из
                витальных ячеек — ниже, обычными плашками. Инициатива добавлена
                пятой 2026-09-10: до этого её вообще не было на лице карты —
                только свободное поле во вкладке «Действия», которое пять
                листов из семи так и оставили пустым. */}
            <div className="dnd-triad">
              <AcQuickBox
                derived={derived.armorClass}
                manualBonus={value.manualAcBonus}
                activeSpells={value.activeSpells ?? []}
                received={RECEIVED_SPELLS_ENABLED ? value.receivedSpells ?? [] : []}
                systemId={value.systemId ?? null}
                sections={value.equipmentSections}
                onQuickUpdate={onQuickUpdate}
              />
              <HpQuickBox value={value} onQuickUpdate={onQuickUpdate} accentColor={cardColor} />
              <InitiativeQuickBox
                derived={derived.initiative}
                misc={value.initiativeMisc}
                local={value.initiative}
                characterId={ownerCharacterId}
                onQuickUpdate={onQuickUpdate}
              />
              <div>
                <DndDie size="lg" textured>
                  <span className="dnd-die-value">{passivePerception}</span>
                </DndDie>
                <div className="sb-label">Пасс. воспр.</div>
              </div>
              <div>
                <DndDie size="lg" textured>
                  <span className="dnd-die-value">{walkDie.value}</span>
                </DndDie>
                <div className="sb-label">
                  {walkDie.sub ? <>Скор. <b>{walkDie.sub}</b></> : "Скорость"}
                </div>
              </div>
            </div>
            {(otherSpeeds || legacySpeedNote || (moveBonus.bonus > 0 && value.speeds.walk != null)) && (
              <div className="muted dnd-triad-note">
                {[
                  otherSpeeds,
                  legacySpeedNote,
                  // Расшифровка бонуса — чтобы игрок, вбивший +10 руками в базу,
                  // увидел двойной учёт, а не молчаливую сумму.
                  moveBonus.bonus > 0 && value.speeds.walk != null
                    ? `ходьба ${value.speeds.walk} + ${moveBonus.bonus} (без доспехов)`
                    : "",
                ].filter(Boolean).join(" · ")}
              </div>
            )}

            {/* Навешанное — иконками строкой над живым рядом: за столом
                «отравлен и лежит» считывают краем глаза, не открывая окно. */}
            <ActiveConditionIcons
              conditions={value.conditions}
              onOpen={onQuickUpdate ? () => setConditionsOpen(true) : undefined}
            />
            {/* Живой ряд: инициатива, концентрация, истощение — то, что
                меняется в бою, строкой плашек, как на макете. */}
            <div className="dnd-live-row">
              {/* СОСТОЯНИЯ — первыми в живом ряду: «отравлен» и «испуган»
                  меняют каждый бросок, а держались до сих пор в голове
                  Мастера. Пустая плашка не исчезает: место постоянное. */}
              <ConditionsBox
                conditions={value.conditions}
                systemId={value.systemId}
                onQuickUpdate={onQuickUpdate}
                open={conditionsOpen}
                onOpenChange={setConditionsOpen}
              />
              {/* Концентрация — там, куда игрок и так смотрит каждый ход.
                  Ставится из окна заклинания, снимается кликом и длинным отдыхом. */}
              {/* Переключатель, а не только «снять»: концентрация бывает и от
                  эффекта, который лист не знает, — Мастер называет её словами,
                  а игроку надо чем-то её отметить. Поставленная из окна
                  заклинания несёт его имя, руками — просто «есть». */}
              <LiveChip
                label="Концентрация"
                value={value.concentration || "—"}
                active={!!value.concentration}
                title={value.concentration ? "Снять концентрацию" : "Отметить концентрацию"}
                ariaLabel={`Концентрация: ${value.concentration || "нет"} — переключить`}
                onClick={
                  onQuickUpdate
                    ? () => onQuickUpdate({ concentration: value.concentration ? "" : "есть" })
                    : undefined
                }
              />
              {/* Истощение — числом, как на макете, а не дорожкой из шести
                  кружков: за столом называют уровень («у тебя два»), а
                  дорожка занимала треть ряда, чтобы сказать то же самое.
                  Клик прибавляет, седьмой — смерть, о чём сказано прямо.
                  Место постоянное, даже когда истощения нет: переезжающая
                  плашка читается как другая. */}
              {/* По кругу 0…6→0: правого клика на телефоне нет, а уровень
                  почти всегда растёт — снимает его длинный отдых сам. */}
              <LiveChip
                label="Истощение"
                value={value.exhaustion >= 6 ? "смерть" : value.exhaustion}
                active={value.exhaustion > 0}
                // Штрафы — подсказкой плашки: строка над именем поднимала
                // картуш, стоило взять первый уровень (владелец, 2026-09-25).
                title={[
                  value.exhaustion > 0 ? `−${exhaustionPenalty} ко всем броскам к20, −${value.exhaustion * 5} фт скорости` : "",
                  onQuickUpdate ? "Клик — следующий уровень истощения" : "",
                ].filter(Boolean).join(". ") || undefined}
                ariaLabel={`Истощение ${value.exhaustion} — сменить уровень`}
                onClick={onQuickUpdate ? () => onQuickUpdate({ exhaustion: (value.exhaustion + 1) % 7 }) : undefined}
                onUndo={
                  onQuickUpdate && value.exhaustion > 0
                    ? () => onQuickUpdate({ exhaustion: value.exhaustion - 1 })
                    : undefined
                }
                undoLabel={`Истощение ${value.exhaustion} → ${value.exhaustion - 1}`}
              />
            </div>

            {/* Характеристики. Карандаша над ними больше нет: он тянулся
                полосой во всю ширину и резал карту пополам. Правка уехала на
                плашку чарника в профиле — там ей и место, лист за столом
                читают, а не заполняют. */}
            {editFromUrl && onQuickUpdate ? (
              <AbilitySavesSkillsEdit
                abilities={value.abilities}
                proficiencyBonus={formatModifier(derived.proficiencyBonus.value)}
                savingThrowProfs={value.savingThrowProfs}
                skillProfs={value.skillProfs}
                classSkillPool={classSkillPool(value.classes)}
                classSkillChoiceCount={classSkillChoiceTotal(value.classes)}
                backgroundSkillNames={value.backgroundSkillNames}
                bonuses={value.abilityBonuses}
            onAbilitiesChange={(v) => onQuickUpdate({ abilities: v })}
                onSavingThrowProfsChange={(v) => onQuickUpdate({ savingThrowProfs: v })}
                onSkillProfsChange={(v) => onQuickUpdate({ skillProfs: v })}
              />
            ) : (
              <AbilitySavesSkillsView
                accentColor={cardColor}
                exhaustionPenalty={exhaustionPenalty}
                abilities={value.abilities}
                proficiencyBonus={formatModifier(derived.proficiencyBonus.value)}
                savingThrowProfs={value.savingThrowProfs}
                skillProfs={value.skillProfs}
                classSkillPool={classSkillPool(value.classes)}
                backgroundSkillNames={value.backgroundSkillNames}
              />
            )}

            {/* ЗАКЛАДКИ — до трёх строк «Действий» прямо на карте: ответ на
                «чем я обычно бью», который за столом задают каждый ход.
                Строка кликается так же, как в таблице действий, и открывает
                то же описание. */}
            {bookmarkRows.length > 0 && (
              <div className="stack dnd-bookmarks">
                {bookmarkRows.map((row) => (
                  <button
                    key={row.name}
                    type="button"
                    className="dnd-bookmark"
                    style={{ borderLeftColor: cardColor }}
                    onClick={() => setOpenAction(row)}
                  >
                    <span className="dnd-bookmark-main">
                      {/* Как и в картуше: оригинал в скобках нужен поиску по
                          книге, а на карте съедает половину строки. */}
                      <span className="dnd-bookmark-name">{stripLatin(row.name)}</span>
                      {/* Числа стоят под именем, а не справа от него: в одну
                          строку на телефоне не влезают ни «5к6 Огненный
                          (полов.) + 5к6 Излучение», ни само название — имя
                          обрезалось до «Небесн…». Прочерки не печатаются:
                          колонок здесь нет, ровнять нечего. */}
                      <span className="dnd-bookmark-meta">
                        {[row.bonus, row.damage, row.range || row.description]
                          .filter((v) => v && v !== "—")
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* ЖЕТОНЫ СПУТНИКОВ — нижняя лента карты. Каждый жетон ведёт на
                статблок существа: за столом спрашивают КЗ фамильяра, а не
                его имя, и лист должен уметь ответить, не заставляя искать
                зверя в бестиарии. */}
            {((value.companions ?? []).length > 0 || onQuickUpdate) && (
              <div
                className={`dnd-companions${(value.companions ?? []).length === 0 && onQuickUpdate && !detached ? " is-empty" : ""}`}
                aria-label="Спутники"
              >
                {/* Пока никого нет — одна строка «подпись [+]»; «+» открывает в
                    ней же поиск с крестиком (владелец, 2026-09-25). */}
                {(value.companions ?? []).length === 0 && !(addingCompanion && onQuickUpdate && !detached) && (
                  <span className="dnd-companions-label">Спутники/фамильяры/призывы</span>
                )}
                {(value.companions ?? []).map((c, i) => {
                  const remove = onQuickUpdate
                    ? () =>
                        onQuickUpdate({
                          companions: (value.companions ?? []).filter((_, j) => j !== i),
                        })
                    : undefined;
                  // Тело по чертежу вместо жетона: пушка/защитник/призыв с хитами.
                  // Чертёж не разобрался (запись уехала) — падаем назад на
                  // жетон, а не в пустоту: имя и так сохранено рядом с id.
                  const bodyBlueprint =
                    c.featureEntryId != null || c.spellEntryId != null ? blueprintOfInstance(c) : null;
                  const bodyView = resolveBlueprintVariant(bodyBlueprint, c.variant);
                  const bodyStats =
                    bodyBlueprint != null && bodyView?.hp != null
                      ? companionStats(bodyBlueprint, value.classes, c.classId, value.abilities, c.spellLevel ?? 0, c.variant)
                      : null;
                  if (bodyBlueprint != null && bodyStats != null && onQuickUpdate) {
                    const ownerName =
                      (c.featureEntryId != null
                        ? summonOptions.find((o) => o.feature.entryId === c.featureEntryId)?.feature.name
                        : spellSummonOptions.find((o) => o.spell.entryId === c.spellEntryId)?.spell.name) ??
                      bodyBlueprint.name ??
                      c.name;
                    return (
                      <CompanionBody
                        key={`body-${c.featureEntryId ?? c.spellEntryId}-${i}`}
                        companion={c}
                        blueprint={{ ...bodyBlueprint, actions: bodyView?.actions ?? bodyBlueprint.actions }}
                        maxHp={bodyStats.maxHp}
                        ac={bodyStats.ac}
                        ownerFeatureName={ownerName}
                        variants={(bodyBlueprint.variants ?? []).map((v) => v.name ?? "").filter(Boolean)}
                        activeVariant={bodyView?.name ?? ""}
                        onVariant={(name) =>
                          onQuickUpdate({
                            companions: (value.companions ?? []).map((x, j) =>
                              j === i
                                ? { ...x, variant: name, name, hpUsed: 0, dead: false, dismissed: false }
                                : x
                            ),
                          })
                        }
                        previewEntryId={c.featureEntryId ?? c.spellEntryId ?? c.entryId}
                        ownsDetonate={
                          !!bodyBlueprint.detonateFeature &&
                          ownedFeatureNames.includes(bodyBlueprint.detonateFeature)
                        }
                        ownsCover={
                          !!bodyBlueprint.coverFeature &&
                          ownedFeatureNames.includes(bodyBlueprint.coverFeature)
                        }
                        onPatch={(patch) =>
                          onQuickUpdate({
                            companions: (value.companions ?? []).map((x, j) =>
                              j === i ? { ...x, ...patch } : x
                            ),
                          })
                        }
                        onRemove={remove ?? (() => {})}
                      />
                    );
                  }
                  return (
                    <CompanionToken
                      key={`${c.entryId ?? "manual"}-${i}`}
                      companion={c}
                      getEntry={getEntry}
                      onRemove={remove}
                      onPatch={
                        onQuickUpdate
                          ? (patch) =>
                              onQuickUpdate({
                                companions: (value.companions ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)),
                              })
                          : undefined
                      }
                    />
                  );
                })}
                {/* Вывод тел по чертежам: кнопка только пока живых меньше
                    лимита (вторая пушка — за «Укреплённую позицию»). */}
                {onQuickUpdate &&
                  summonOptions
                    .filter(
                      (o) =>
                        liveCompanionsOf(value.companions, o.feature.entryId).length <
                        companionMaxCount(o.blueprint, ownedFeatureNames)
                    )
                    .map((o) => (
                      <button
                        key={`summon-${o.feature.entryId}`}
                        type="button"
                        className="comp-mini"
                        title={`Вывести: ${o.blueprint.name ?? o.feature.name}`}
                        onClick={() =>
                          onQuickUpdate({
                            // Развеянное/мёртвое тело того же чертежа уходит:
                            // новый вызов — новое тело, а не второе рядом.
                            companions: [
                              ...(value.companions ?? []).filter(
                                (x) =>
                                  x.featureEntryId !== o.feature.entryId || (!x.dead && !x.dismissed)
                              ),
                              {
                                entryId: null,
                                name: o.blueprint.name ?? o.feature.name,
                                featureEntryId: o.feature.entryId,
                                classId: companionClassId(o.feature.entryId, value.classes, entryParentId),
                              },
                            ],
                          })
                        }
                      >
                        Вывести: {o.blueprint.name ?? o.feature.name}
                      </button>
                    ))}
                {/* Призыв заклинанием (data.summon): двухшаговый — сначала
                    «Призвать», потом круг (мощь от круга, ритуал ячейки не
                    тратит). Живого сверх лимита заменяем, мёртвого — тоже. */}
                {onQuickUpdate &&
                  spellSummonOptions.map((o) => {
                    const live = liveSummonOf(value.companions, o.spell.entryId);
                    const max = companionMaxCount(o.blueprint, ownedFeatureNames);
                    const name = o.blueprint.name ?? o.spell.name;
                    const picking = summonSpell === o.spell.entryId;
                    const circles: number[] = [];
                    for (let ci = 0; ci < shownSlotPips.length; ci++) {
                      if ((shownSlotPips[ci] ?? 0) > 0) circles.push(ci + 1);
                    }
                    if (circles.length === 0) circles.push(1);
                    return (
                      <span key={`spell-summon-${o.spell.entryId}`} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <button
                          type="button"
                          className="comp-mini"
                          title={live.length >= max ? `Пересоздать (заменит живого): ${name}` : `Призвать: ${name}`}
                          onClick={() => setSummonSpell(picking ? null : o.spell.entryId)}
                        >
                          {live.length >= max ? `Пересоздать: ${name}` : `Призвать: ${name}`}
                        </button>
                        {picking &&
                          circles.map((circle) => (
                            <button
                              key={circle}
                              type="button"
                              className="comp-mini"
                              title={`Круг ${circle}: хиты по формуле чертежа`}
                              onClick={() => {
                                const next = [...(value.companions ?? [])];
                                if (live.length >= max && live.length > 0) {
                                  const idx = live[0].index;
                                  next[idx] = {
                                    ...next[idx],
                                    spellLevel: circle,
                                    hpUsed: 0,
                                    dead: false,
                                    dismissed: false,
                                  };
                                } else {
                                  const kept = next.filter(
                                    (x) => x.spellEntryId !== o.spell.entryId || (!x.dead && !x.dismissed)
                                  );
                                  kept.push({
                                    entryId: null,
                                    name,
                                    spellEntryId: o.spell.entryId,
                                    spellLevel: circle,
                                  });
                                  next.length = 0;
                                  next.push(...kept);
                                }
                                onQuickUpdate({ companions: next });
                                setSummonSpell(null);
                              }}
                            >
                              {circle}й
                            </button>
                          ))}
                      </span>
                    );
                  })}
                {/* Каждое существо — своей строкой; когда хоть одно есть,
                    последняя строка — сразу поле поиска, без «+». Пустой
                    подвал — «+», открывающий поиск на месте подписи. */}
                {onQuickUpdate && !detached &&
                  (addingCompanion || (value.companions ?? []).length > 0 ? (
                    <span className="dnd-companion-search">
                    <CompendiumEntryPicker
                      value={null}
                      kind="monster"
                      dropUp
                      placeholder="Спутник из бестиария…"
                      selectedLabel="Спутник"
                      onChange={(entry) => {
                        if (!entry) return;
                        onQuickUpdate({
                          companions: [...(value.companions ?? []), { entryId: entry.id, name: entry.title }],
                        });
                        setAddingCompanion(false);
                      }}
                    />
                    {/* Отмена: случайно открытый поиск не висит на карте. */}
                    {(value.companions ?? []).length === 0 && <button
                      type="button"
                      className="comp-mini dnd-companion-search-close"
                      title="Отменить поиск"
                      aria-label="Отменить поиск спутника"
                      onClick={() => setAddingCompanion(false)}
                    >
                      <NavIcon name="close" />
                    </button>}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="comp-mini dnd-companion-add"
                      title="Добавить спутника"
                      aria-label="Добавить спутника"
                      onClick={() => setAddingCompanion(true)}
                    >
                      +
                    </button>
                  ))}
              </div>
            )}
              {/* Загнутый угол — индикатор «пришло послание» и (только на
                  телефоне) жест переворота тапом. Всегда справа внизу: серый
                  без входящих, цвета класса при непрочитанных, без текста —
                  карту показывают соседям по столу. На десктопе оборот и так
                  стоит в правой колонке, поэтому угол там не кликается. */}
              {/* Таро-рамка владельца (Card_Border2.png) — поверх карты, мимо
                  кликов; уголок ниже лежит на её правом нижнем орнаменте. */}
              <span className="dnd-card-frame-art" aria-hidden="true" />
              {showDesktopFace ? (
                <span
                  className={`dnd-card-corner${unreadTotal > 0 ? " has-unread" : ""}${cornerGlint ? " glint" : ""}`}
                  role="img"
                  aria-label={unreadTotal > 0 ? `${unreadTotal} новых входящих` : "Входящих нет"}
                >
                  {unreadTotal > 0 && <span className="dnd-card-corner-badge">{unreadTotal}</span>}
                </span>
              ) : (
                <button
                  type="button"
                  className={`dnd-card-corner${unreadTotal > 0 ? " has-unread" : ""}${cornerGlint ? " glint" : ""}`}
                  onClick={() => {
                    setCardFlipped(true);
                    if (canUseInbox) {
                      refreshInbox();
                      refreshTransfers();
                    }
                  }}
                  aria-label={
                    unreadTotal > 0
                      ? `Перевернуть карту: отдых, постер, правка; ${unreadTotal} новых входящих`
                      : "Перевернуть карту: отдых, постер, правка"
                  }
                >
                  {unreadTotal > 0 && <span className="dnd-card-corner-badge">{unreadTotal}</span>}
                </button>
              )}
            </div>
          )}
          {/* Оборот первой карты — входящие игрока. Отдельная сторона, а не
              модалка (разбор): возврат — уголком и уходом с карты. На десктопе
              при перевороте оборот встаёт в левую колонку вместо лицевой. */}
          {tab === "Карта" && cardFlipped && renderCardBack(renderFaceEdit())}

          {!cardOnly && (
          <div className="dnd-desktop-tab">
          {showDesktopFace && (
          <div className="dnd-deck-strip" role="tablist" aria-label="Карты листа">
            {DND_VIEW_TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "active" : ""}
                style={tab === t ? { borderBottomColor: cardColor } : undefined}
                onClick={() => setTab(t)}
              >
                {t}
                {t === "Снаряжение" && pendingItems > 0 && <span className="dnd-tab-dot" aria-label="есть непринятое" />}
              </button>
            ))}
          </div>
          )}
          {/* Десктопная правая колонка на «Карте» (этап 7): оборот + вход в
              правку основной информации. На телефоне тут пусто — оборот
              открывается переворотом, правка адресом с плашки профиля. */}
          {showDesktopFace && tab === "Карта" && !cardFlipped && (
            <div className="stack dnd-desktop-back">
              {renderCardBack()}
              {renderFaceEdit()}
            </div>
          )}
          {tab === "Действия" && (
            <div className="stack">
              {/* Инициатива — кнопкой по центру строки: слева правка раздела,
                  справа веер (решение владельца). Кнопки одного размера. */}
              <div className="dnd-tab-tools">
                {onQuickUpdate ? (
                  <TabEditToggle editing={editingActions} onToggle={() => setEditingActions((v) => !v)} />
                ) : (
                  <span className="dnd-tab-btn" aria-hidden="true" />
                )}
                <span className="dnd-tab-center dnd-tab-mid">
                  <InitiativePlate
                    characterId={ownerCharacterId}
                    local={value.initiative}
                    derived={derived.initiative}
                    misc={value.initiativeMisc}
                    onQuickUpdate={onQuickUpdate}
                  />
                </span>
                <DndFanButton onOpen={() => setFanOpen(true)} />
              </div>
              {/* Лента пулов (этап 5): только то, что тратит хоть одна строка
                  этой карты, — ячейки, если тут есть боевые заклинания, и
                  классовые пулы по resourceKey их стоимостей. Остальные пулы
                  живут на «Ресурсах», постоянно все не показываем. Траты —
                  там же, где были (окна строк и дорожки ниже); лента только
                  показывает остаток и пересчитывается после траты. */}
              <DndActionPools
                actionRows={actionRows}
                resourceSources={resourceSources}
                abilities={value.abilities}
                resourceUsed={value.resourceUsed}
                resourceBonus={value.resourceBonus}
                shownSlotPips={magicPips}
                spellSlotsUsed={value.spellSlotsUsed}
                pact={computedSlots.pact}
                pactUsed={value.pactSlotsUsed ?? 0}
                ownPools={ownPools}
                onQuickUpdate={onQuickUpdate}
              />
              {/* Вручную вписанные атаки (то, чего нет ни в оружии, ни в
                  заклинаниях) правились только в форме. Теперь — там же, где
                  показываются. Правка раздела — карандашом в строке выше. */}
              {editingActions && onQuickUpdate && (
                <AttackListEdit values={value.attacks} onChange={(v) => onQuickUpdate({ attacks: v })} />
              )}
              {(() => {
                const byTiming = (t: DndActionTiming) => actionRows.filter((r) => r.timing === t);
                const poolLabels = Object.fromEntries(
                  allResources(resourceSources, value.abilities).map((r) => [r.key, r.label])
                );
                const tableProps = { onOpen: setOpenAction, pinnedNames, onPin: onQuickUpdate ? togglePinned : undefined, resourceLabels: poolLabels, color: cardColor };
                // Оружие — тремя группами (Q17), остальные действия — ниже.
                const actions = byTiming("action");
                const inGroup = (g: AttackRow["group"]) => actions.filter((r) => r.group === g);
                const effectsOff = value.effectsOff ?? [];
                const toggleEl = effectToggles.length > 0 && (
                  <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    {effectToggles.map((t) => (
                      <label key={t.name} className="row" style={{ gap: 4 }} title={t.title}>
                        <input
                          type="checkbox"
                          checked={!effectsOff.includes(t.name)}
                          disabled={!onQuickUpdate}
                          onChange={(e) =>
                            onQuickUpdate?.({
                              effectsOff: e.target.checked ? effectsOff.filter((n) => n !== t.name) : [...effectsOff, t.name],
                            })
                          }
                        />
                        {t.label}
                      </label>
                    ))}
                  </span>
                );
                const mixed = inGroup("mixed");
                return (
                  <>
                    <AttacksTable title="Рукопашное" rows={inGroup("melee")} headExtra={toggleEl} {...tableProps} />
                    <AttacksTable
                      title="Рукопашное и метательное"
                      rows={mixed}
                      headExtra={
                        toggleEl && !inGroup("melee").length ? toggleEl : toggleEl && <span className="muted">переключатель выше</span>
                      }
                      {...tableProps}
                    />
                    <AttacksTable title="Дальнобойное" rows={inGroup("ranged")} {...tableProps} />
                    <AttacksTable title="Действия" rows={actions.filter((r) => !r.group)} {...tableProps} />
                    <AttacksTable title="Бонусные действия" rows={byTiming("bonus")} {...tableProps} />
                    <AttacksTable title="Реакции" rows={byTiming("reaction")} {...tableProps} />
                    <AttacksTable title="Особое" rows={byTiming("other")} {...tableProps} />
                  </>
                );
              })()}
            </div>
          )}

          {tab === "Магия" && (
            // Одна колонка во всю ширину вкладки (решение владельца): круги
            // читаются подряд сверху вниз, строка получает всю ширину блока.
            // Двухколоночная раскладка соседних вкладок здесь выключена —
            // см. .dnd-desktop-single.
            <div className="dnd-desktop-single">
              {/* Шапка вкладки: правка слева, веер справа, по центру СЛ и АТК —
                  то, зачем сюда заглядывают. Полные подписи убраны: строка
                  принадлежит числам, а не словам. */}
              <div className="dnd-tab-tools">
                {onQuickUpdate ? (
                  <TabEditToggle editing={editingSpells} onToggle={() => setEditingSpells((v) => !v)} />
                ) : (
                  <span className="dnd-tab-btn" aria-hidden="true" />
                )}
                <div className="dnd-tab-center dnd-tab-mid">
                  {spellAbilityKey ? (
                    // Плашки чисел и характеристика словом (макет 2026-09-25).
                    <span className="dnd-magic-nums">
                      <span className="dnd-magic-num">
                        {/* Коротко (владелец 2026-09-26): «СЛ» и ИНТ/МДР/ХАР. */}
                        <span title="Сложность спасброска">СЛ</span> <b>{spellDc}</b>
                      </span>
                      <span className="dnd-magic-num">
                        <span>Атака</span> <b>{formatModifier(spellAttackBonus)}</b>
                      </span>
                      <span
                        className="dnd-magic-ability"
                        title={Object.keys(ABILITY_NAME_TO_KEY).find((n) => ABILITY_NAME_TO_KEY[n] === spellAbilityKey)}
                      >
                        {ABILITY_KEY_ABBR[spellAbilityKey]}
                      </span>
                    </span>
                  ) : (
                    <span className="muted">Нет заклинательной характеристики</span>
                  )}
                </div>
                <DndFanButton onOpen={() => setFanOpen(true)} />
              </div>
              {value.spellcasting && !editingSpells && (
                <div className="sb-entry" style={{ whiteSpace: "pre-wrap" }}>
                  <MentionText text={value.spellcasting} />
                </div>
              )}
              {/* Настройки правки одной полосой (владелец 2026-09-26): бонусы
                  к СЛ и атаке (предметы, черты) — плашками, как «СЛ спасброска»
                  над ними; расчёт ячеек — двумя половинами рядом. Раньше тут
                  были голые поля формы. */}
              {editingSpells && onQuickUpdate && (spellAbilityKey || computedSlots.basis !== "none") && (
                <div className="dnd-magic-settings">
                  {spellAbilityKey && (
                    <>
                      <label className="dnd-magic-num dnd-magic-bonus">
                        <span>Бонус к СЛ</span>
                        <input
                          value={value.spellDcMisc}
                          placeholder="+0"
                          onChange={(e) => onQuickUpdate({ spellDcMisc: e.target.value })}
                        />
                      </label>
                      <label className="dnd-magic-num dnd-magic-bonus">
                        <span>Бонус к атаке</span>
                        <input
                          value={value.spellAttackMisc}
                          placeholder="+0"
                          onChange={(e) => onQuickUpdate({ spellAttackMisc: e.target.value })}
                        />
                      </label>
                    </>
                  )}
                  {computedSlots.basis !== "none" && (
                    <span className="dnd-magic-cells">
                      <span className="muted">ячейки</span>
                      <span className="dnd-seg" role="group" aria-label="Ячейки заклинаний">
                        <button
                          type="button"
                          aria-pressed={autoSlots}
                          disabled={!onQuickUpdate}
                          title={
                            computedSlots.basis === "multiclass"
                              ? `По таблице многоклассья (уровень заклинателя ${effectiveCasterLevel(slotSources)})`
                              : "По таблице класса"
                          }
                          onClick={() => !autoSlots && onQuickUpdate?.({ spellSlotsManual: false })}
                        >
                          по классам
                        </button>
                        <button
                          type="button"
                          aria-pressed={!autoSlots}
                          disabled={!onQuickUpdate}
                          // При переходе на ручной режим переносим рассчитанное в
                          // хранимое, иначе ячейки обнулятся у всех, кто их никогда
                          // не вбивал.
                          onClick={() => autoSlots && onQuickUpdate?.({ spellSlotsManual: true, spellSlotPips: computedSlots.slots })}
                        >
                          вручную
                        </button>
                      </span>
                    </span>
                  )}
                </div>
              )}
              {/* Тумблер живёт у самих заклинаний, а не во «Внешнем виде»:
                  утром его выключают, чтобы подготовиться, в бою включают,
                  чтобы не листать книгу. Скрытое всегда посчитано вслух —
                  иначе через сессию это выглядит как пропажа заклинаний.
                  В правке ряда нет (владелец 2026-09-26): там и так видны все
                  заклинания, а добавляют — «+ заклинание» у своего круга.
                  Остаётся только «Арканум» — другого входа к нему нет. */}
              {(!editingSpells || (onQuickUpdate && warlockLevel >= 11)) && (
              <div className="row sb-entry dnd-prepared-filter" style={{ gap: 8, flexWrap: "wrap" }}>
                {!editingSpells && (
                <>
                {/* Режим — двумя половинами (макет): видно, какой включён и
                    какой будет по тапу. Чёрное — только переключатель режима. */}
                <span className="dnd-seg" role="group" aria-label="Какие заклинания показывать">
                  <button
                    type="button"
                    aria-pressed={prefs.spellsPreparedOnly}
                    onClick={() => saveDndPrefs({ ...prefs, spellsPreparedOnly: true })}
                  >
                    <span className="dnd-prepared-filter-long">Подготовленные</span>
                    <span className="dnd-prepared-filter-short">Подгот.</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={!prefs.spellsPreparedOnly}
                    onClick={() => saveDndPrefs({ ...prefs, spellsPreparedOnly: false })}
                  >
                    {/* У готовящих из всего списка «известные» — неправда (Q10). */}
                    <span className="dnd-prepared-filter-long">{fullListClasses.length > 0 ? "Весь список" : "Все известные"}</span>
                    <span className="dnd-prepared-filter-short">Все</span>
                  </button>
                </span>
                {onQuickUpdate && (
                  <button type="button" className="dnd-chip" onClick={() => setSpellListOpen(true)}>
                    Добавить
                  </button>
                )}
                </>
                )}
                {onQuickUpdate && warlockLevel >= 11 && (
                  <button type="button" className="dnd-chip" onClick={() => setArcanumOpen(true)}>
                    Арканум
                  </button>
                )}
              </div>
              )}
              {(spellLimits.cantrips != null || spellLimits.prepared != null) && (
                <div className="row sb-entry" style={{ gap: 10, flexWrap: "wrap" }}>
                  {spellLimits.cantrips != null && (
                    <span className={spellLimits.cantripsUsed > spellLimits.cantrips ? "dnd-limit-over" : "muted"}>
                      Заговоры {spellLimits.cantripsUsed} из {spellLimits.cantrips}
                    </span>
                  )}
                  {spellLimits.prepared != null && (
                    <span className={spellLimits.preparedUsed > spellLimits.prepared ? "dnd-limit-over" : "muted"}>
                      Подготовлено {spellLimits.preparedUsed} из {spellLimits.prepared}
                    </span>
                  )}
                  {spellLimits.outside > 0 && (
                    <span className="muted">вне лимита {spellLimits.outside}</span>
                  )}
                </div>
              )}
              {computedSlots.pact && (
                <div className="row sb-entry" style={{ gap: 8 }}>
                  <span className="sb-prop-label">Договор магии</span>
                  <span>
                    {computedSlots.pact.count} × {computedSlots.pact.circle} круг
                  </span>
                  <span className="row muted" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
                    исп.
                    {/* Те же головы тофу, что у ячеек кругов (владелец, 2026-09-27). */}
                    <PoolMeter
                      max={computedSlots.pact.count}
                      left={Math.max(0, computedSlots.pact.count - (value.pactSlotsUsed ?? 0))}
                      label="Потрачено ячеек договора"
                      onSetLeft={onQuickUpdate ? (next) => onQuickUpdate({ pactSlotsUsed: computedSlots.pact!.count - next }) : undefined}
                    />
                  </span>
                </div>
              )}
              <DndSpellsView
                preparedOnly={prefs.spellsPreparedOnly}
                cantrips={liveCantrips}
                // Q6: в правке — все девять кругов: Мастер может позволить
                // и выше, чем даёт таблица.
                spellSlotLevels={editingSpells ? 9 : magicLevels}
                autoSlots={autoSlots}
                spellSlotPips={magicPips}
                spellSlotsUsed={value.spellSlotsUsed}
                spellsByLevel={liveSpellsByLevel}
                edit={editingSpells}
                systemId={value.systemId}
                levelTitles={arcanumTitles}
                slotsLockedCircles={arcanumLocked}
                onUsedChange={
                  onQuickUpdate
                    ? (i, v) => {
                        const next = value.spellSlotsUsed.slice();
                        next[i] = v;
                        onQuickUpdate({ spellSlotsUsed: next });
                      }
                    : undefined
                }
                onFreeCastToggle={
                  onQuickUpdate
                    ? (circle, idx) => {
                        const flip = (s: DndSpellEntry) => ({ ...s, freeCastUsed: !s.freeCastUsed });
                        if (circle === 0) {
                          onQuickUpdate({ cantrips: value.cantrips.map((s, j) => (j === idx ? flip(s) : s)) });
                        } else {
                          onQuickUpdate({
                            spellsByLevel: value.spellsByLevel.map((lvl, k) =>
                              k === circle - 1 ? lvl.map((s, j) => (j === idx ? flip(s) : s)) : lvl
                            ),
                          });
                        }
                      }
                    : undefined
                }
                onCantripsChange={onQuickUpdate ? (v) => onQuickUpdate({ cantrips: v }) : undefined}
                listByLevel={classListByLevel}
                onTogglePrepared={onQuickUpdate ? togglePreparedInView : undefined}
                onSlotsChange={
                  onQuickUpdate
                    ? (i, v) => {
                        const next = value.spellSlotPips.slice();
                        next[i] = v;
                        onQuickUpdate({ spellSlotPips: next });
                      }
                    : undefined
                }
                onSpellsChange={
                  onQuickUpdate
                    ? (i, v) => {
                        const next = value.spellsByLevel.map((lvl, idx) => (idx === i ? v : lvl));
                        onQuickUpdate({ spellsByLevel: next });
                      }
                    : undefined
                }
                onCast={(row) => setOpenAction(row)}
              />
            </div>
          )}

          {tab === "Навыки" && (
            <>
              {/* Шапка вкладки: слева крупно БМ, справа веер. Карандаша нет —
                  навыки правятся прямо в строках, владение добавляется
                  списком инструментов ниже. */}
              <div className="dnd-tab-tools">
                <span className="dnd-tab-btn" aria-hidden="true" />
                <span className="dnd-tab-center dnd-tab-mid">
                  <span className="dnd-magic-num">
                    <span>Бонус мастерства</span> <b>{value.proficiencyBonus}</b>
                  </span>
                </span>
                <DndFanButton onOpen={() => setFanOpen(true)} />
              </div>
              <DndSkillsView
              exhaustionPenalty={exhaustionPenalty}
              highlight={highlight}
              abilities={value.abilities}
              proficiencyBonus={formatModifier(derived.proficiencyBonus.value)}
              skillProfs={value.skillProfs}
              classSkillPool={classSkillPool(value.classes)}
              backgroundSkillNames={value.backgroundSkillNames}
              proficiencies={value.proficiencies}
              skills={skills}
              systemId={value.systemId}
              onQuickUpdate={onQuickUpdate}
            />
            </>
          )}

          {tab === "Снаряжение" && (
            <div className="stack">
              {/* Шапка вкладки: правка слева, передача по центру, веер справа.
                  Передача открывает то же меню, что оборот карты. */}
              <div className="dnd-tab-tools">
                {onQuickUpdate ? (
                  <TabEditToggle editing={editingInventory} onToggle={() => setEditingInventory((v) => !v)} />
                ) : (
                  <span className="dnd-tab-btn" aria-hidden="true" />
                )}
                <div className="dnd-tab-center dnd-tab-mid">
                  <EquipmentLoadPlate
                    sections={value.equipmentSections}
                    coins={value.coins}
                    strength={value.abilities.str}
                    doublings={findCarryDoublings([
                      ...value.speciesFeatures,
                      ...value.classFeatures,
                      ...value.feats,
                      ...value.specialAbilities,
                    ]).length}
                  />
                  {canUseInbox && ownerCharacterId != null && (
                    <button type="button" className="dnd-transfer-btn" onClick={() => setTransferModalOpen(true)}>
                      Передать предмет
                    </button>
                  )}
                </div>
                <DndFanButton onOpen={() => setFanOpen(true)} />
              </div>
              {editingInventory ? (
                <>
                  <DndEquipmentEdit
                    sections={value.equipmentSections}
                    onChange={(next) => onQuickUpdate?.({ equipmentSections: next })}
                  />
                  {/* Монеты хранились, но в просмотре их не было вовсе —
                      правились только в форме. */}
                </>
              ) : (
                <>
                  <DndEquipmentQuickView
                    sections={value.equipmentSections}
                    systemId={value.systemId}
                    coins={value.coins}
                    accentColor={cardColor}
                    armorProfs={armorProfNames(value.proficiencies)}
                    calcCampaignId={campaignId}
                    calcSenderId={ownerCharacterId}
                    calcSenderName={value.characterName}
                    onCalcChanged={() => {
                      refreshTransfers();
                      refreshInbox();
                    }}
                    attunementMax={3 + (value.attunementExtra ?? 0)}
                    attunement={renderAttunement()}
                    onTransferItem={
                      canUseInbox && ownerCharacterId != null
                        ? (key) => {
                            setTransferPreselect(key);
                            setTransferModalOpen(true);
                          }
                        : undefined
                    }
                    onQuickUpdate={onQuickUpdate}
                  />
                </>
              )}
              {editingInventory && renderAttunement()}
              {transferModalOpen && canUseInbox && ownerCharacterId != null && (
                <Modal
                  onClose={() => {
                    setTransferModalOpen(false);
                    setTransferPreselect("");
                  }}
                >
                  <DndTransferBox
                    initialItemKey={transferPreselect}
                    color={cardColor}
                    campaignId={campaignId}
                    characterId={ownerCharacterId}
                    characterName={value.characterName}
                    equipment={value.equipmentSections}
                    ownCoins={value.coins}
                    incoming={transfers?.incoming ?? []}
                    outgoing={transfers?.outgoing ?? []}
                    loading={transfersLoading}
                    loadError={transfersError}
                    notice={transferNotice}
                    busyId={transferBusyId}
                    onAction={(id, action) => void handleTransferAction(id, action)}
                    onSendItem={(args) => void handleTransferSend(args)}
                    onSendMoney={(args) => void handleMoneySend(args)}
                    onCommitCoins={(c) => onQuickUpdate?.({ coins: c })}
                    onCalcChanged={() => {
                      refreshTransfers();
                      refreshInbox();
                    }}
                    onRetry={refreshTransfers}
                  />
                </Modal>
              )}
            </div>
          )}

          {tab === "Ресурсы" && (
            <>
            {/* Кости хитов — в одной строке с веером, высотой как веер
                (решение владельца): это первое, что ищут на «Ресурсах».
                Спасброски ниже — они нужны только при нуле хитов. */}
            <div className="dnd-tab-tools">
              {pools.length > 0 ? (
                <div className="dnd-tab-mid dnd-hitdice-row">
                  <span className="sb-label">Кости хитов</span>
                  {pools.map((pool) => (
                    <span key={pool.die} className="row dnd-hitdice-pool">
                      <span className="dnd-hitdice-die">{pool.die}</span>
                      {/* Как у всех запасов листа: тофу на ПК, «− N/M +» на телефоне. */}
                      <PoolMeter
                        max={pool.total}
                        left={pool.total - pool.used}
                        label={`Кости хитов ${pool.die}`}
                        onSetLeft={
                          onQuickUpdate
                            ? (left) =>
                                onQuickUpdate({ hitDiceUsed: { ...value.hitDiceUsed, [pool.die]: pool.total - left } })
                            : undefined
                        }
                      />
                    </span>
                  ))}
                </div>
              ) : (
                <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
              )}
              <DndFanButton onOpen={() => setFanOpen(true)} />
            </div>
            {atZeroHp && (
              <div>
                <div className="sb-label">Спас от смерти</div>
                {(() => {
                  const cheat = liveFeatureGroups.flat().find((f) => f.cost?.deathCheat)?.cost?.deathCheat;
                  if (!cheat || !onQuickUpdate) return null;
                  return (
                    <SoulCheat
                      rarities={cheat.rarities}
                      hpPer={cheat.hpPer}
                      items={value.replicaItems ?? []}
                      getEntry={getEntry}
                      onCheat={(count, ids) => {
                        const gone = new Set(ids);
                        onQuickUpdate({
                          hitPointsCurrent: String(cheat.hpPer * count),
                          deathSaveSuccesses: 0,
                          deathSaveFailures: 0,
                          replicaItems: (value.replicaItems ?? []).filter((it) => !gone.has(it.id)),
                          equipmentSections: value.equipmentSections.map((sec) => ({
                            ...sec,
                            items: sec.items.filter((row) => !gone.has(row.replicaId ?? "")),
                          })),
                        });
                      }}
                    />
                  );
                })()}
                {/* Дорожек здесь больше нет: спасброски отмечаются поверх
                    портрета на «Карте» (В3). Одно состояние — одно место,
                    иначе это два места, где искать, и два, где промахиваться.
                    Чит смерти остаётся тут: он привязан к репликам, а они
                    живут на «Ресурсах». */}
                <span className="muted">
                  Успехи {value.deathSaveSuccesses} · провалы {value.deathSaveFailures} — отмечаются на карте
                  «Карта», поверх портрета.
                </span>
              </div>
            )}
            {/* Кости хитов и спасброски от смерти стоят здесь, а не на карте:
                гриллинг 2026-09-04 оставил на лицевой стороне только КЗ,
                хиты, пассивное восприятие, скорость, характеристики, живой
                ряд, закладки и спутников. Кости хитов тратят на коротком
                отдыхе, а не каждый ход, и их место — среди ресурсов. */}
            <DndResourcesView
              sources={resourceSources}
              abilities={value.abilities}
              resourceUsed={value.resourceUsed}
              resourceBonus={value.resourceBonus}
              value={value}
              systemId={value.systemId}
              campaignId={campaignId}
              ownerCharacterId={ownerCharacterId}
              ownPools={ownPools}
              replicaBonus={replicaBonus}
              onQuickUpdate={onQuickUpdate}
            />
            </>
          )}

          {tab === "Особенности" && (
            // Одна колонка, как и «Магия»: умения — такой же список строк с
            // раскрытием, и делить его на две колонки нечем.
            <div className="dnd-desktop-single">
              {/* Шапка вкладки: обе правки наверху — «Свойства» (скорость,
                  чувства, защиты) и «умения» (видовые/классовые/черты/особые),
                  справа веер. Сохранение умений — строкой внизу, как было. */}
              <div className="dnd-tab-tools">
                <div className="row dnd-tab-mid" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-start" }}>
                  {onQuickUpdate && (
                    <LabeledEditButton
                      label="Свойства"
                      editing={editingTraits}
                      onToggle={() => setEditingTraits((v) => !v)}
                    />
                  )}
                  {/* «умения» в правке — «Сохранить» на том же месте, как у
                      «Свойств» (владелец 2026-09-26); «Отмена» — рядом. */}
                  {onQuickUpdate && (
                    <LabeledEditButton
                      label="умения"
                      editing={!!draftFeatures}
                      onToggle={() => (draftFeatures ? saveDraftFeatures() : setDraftFeatures({
                          speciesFeatures: [...value.speciesFeatures],
                          classFeatures: [...value.classFeatures],
                          feats: [...value.feats],
                          specialAbilities: [...value.specialAbilities],
                        }))
                      }
                    />
                  )}
                  {draftFeatures && (
                    <button type="button" className="dnd-chip" onClick={() => setDraftFeatures(null)}>
                      Отмена
                    </button>
                  )}
                </div>
                <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
                <DndFanButton onOpen={() => setFanOpen(true)} />
              </div>
              {/* Чувства, скорости, защиты и заметки класса жили только внутри
                  формы правки и в просмотре не показывались вовсе — то есть
                  введённое было не увидеть, не открыв форму. После её роспуска
                  им дом здесь: сопротивление огню по природе ничем не
                  отличается от видовой особенности (гриллинг 2026-09-03).
                  Правка — на месте, значения сохраняются сразу. Карандаш —
                  в шапке вкладки. */}
              {editingTraits && onQuickUpdate ? (
                <div className="stack">
                  <SpeedEditor value={value.speeds} onChange={(v) => onQuickUpdate({ speeds: v })} />
                  {walkBonuses.length > 0 && (
                    <span className="muted">
                      К ходьбе само: {walkBonuses.map((p) => `${p.label} ${p.value > 0 ? "+" : ""}${p.value}`).join(", ")}
                    </span>
                  )}
                  <SensesEditor
                    value={value.sensesList}
                    onChange={(v) => onQuickUpdate({ sensesList: v })}
                    options={origin.senseOptions}
                    granted={grantedSenses}
                  />
                  <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
                    <ChecklistEditor
                      label="Уязвимости к урону"
                      value={value.damageVulnerabilities}
                      onChange={(v) => onQuickUpdate({ damageVulnerabilities: v })}
                      options={origin.damageTypes}
                    />
                    <ChecklistEditor
                      label="Сопротивления урону"
                      value={value.damageResistances}
                      onChange={(v) => onQuickUpdate({ damageResistances: v })}
                      options={origin.damageTypes}
                      locked={grantedResistances}
                    />
                    <ChecklistEditor
                      label="Иммунитет к урону"
                      value={value.damageImmunities}
                      onChange={(v) => onQuickUpdate({ damageImmunities: v })}
                      options={origin.damageTypes}
                    />
                    <ChecklistEditor
                      label="Иммунитет к состояниям"
                      value={value.conditionImmunities}
                      onChange={(v) => onQuickUpdate({ conditionImmunities: v })}
                      options={origin.conditionOptions}
                    />
                  </div>
                </div>
              ) : (
                <DndTraitsView value={withGrantedSenses(withLiveEffects(value, getEntry), getEntry)} />
              )}
              {draftFeatures ? (
                <>
                  <AutoFeatureListEdit
                    title="Видовые особенности"
                    values={draftFeatures.speciesFeatures}
                    onChange={(v) => setDraftFeatures({ ...draftFeatures, speciesFeatures: v })}
                  />
                  <AutoFeatureListEdit
                    title="Классовые особенности"
                    values={draftFeatures.classFeatures}
                    onChange={(v) => setDraftFeatures({ ...draftFeatures, classFeatures: v })}
                  />
                  <AutoFeatureListEdit
                    title="Черты"
                    values={draftFeatures.feats}
                    onChange={(v) => setDraftFeatures({ ...draftFeatures, feats: v })}
                    allowSearchDrop
                  />
                  <FightingStyleCounter classes={value.classes} feats={draftFeatures.feats} getEntry={getEntry} />
                  <FeatureListEdit
                    title="Особые умения"
                    values={draftFeatures.specialAbilities}
                    onChange={(v) => setDraftFeatures({ ...draftFeatures, specialAbilities: v })}
                    allowSearchDrop
                  />
                  <EntryChoiceCounter
                    classes={value.classes}
                    abilities={draftFeatures.specialAbilities}
                    feats={draftFeatures.feats}
                    systemId={value.systemId}
                  />
                  <WeaponMasteryEdit
                    classes={value.classes}
                    mastered={value.masteredWeapons}
                    systemId={value.systemId}
                    onChange={onQuickUpdate ? (v) => onQuickUpdate({ masteredWeapons: v }) : undefined}
                  />
                </>
              ) : (
                <>
                  {/* Живые строки (liveFeatureGroups: класс, вид, черты, особые):
                      пустое описание подставляется из справочника. */}
                  <SbFeatureGroup title="Видовые особенности" values={liveFeatureGroups[1]} />
                  <SbFeatureGroup title="Классовые особенности" values={liveFeatureGroups[0]} />
                  <SbFeatureGroup title="Черты" values={liveFeatureGroups[2]} />
                  {/* Черта без сделанного выбора (+1, список, навыки) — строкой с
                      кнопкой (гриллинг черт 2026-09-24, Q8, Q9). */}
                  {onQuickUpdate && <FeatPending value={value} getEntry={getEntry} onApply={onQuickUpdate} />}
                  <SbFeatureGroup title="Особые умения" values={liveFeatureGroups[3]} />
                </>
              )}
              {/* Карты правил — одной строкой в самом низу (владелец
                  2026-09-26): вид, классы, подклассы, предок. */}
              <div className="dnd-feature-card-strip">
                {featureCards.map((c) => (
                  <div key={c.id}>
                    {rulesCardTile(c.id, c.name, () =>
                      c.lineage ? openMentionPreview("compendium_entry", c.id) : setOpenRulesEntryId(c.id)
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "Досье" && draftDossier && (
            <div className="dnd-personality-grid">
              {NARRATIVE_FIELDS.map(({ key, label }) => {
                const dossierKey = key as keyof typeof draftDossier;
                return (
                  <div key={key} className="sb-entry">
                    <span className="sb-prop-label">{label}</span>
                    {/* Без кампании (OneShot) — простое поле: панель форматирования
                        и @-ссылки на мир там не к чему (владелец 2026-09-26). */}
                    {campaignConnected ? (
                      <MentionTextarea
                        value={draftDossier[dossierKey] ?? ""}
                        onChange={narrativeCallbacks[key]}
                        rows={3}
                      />
                    ) : (
                      <textarea
                        className="dnd-dossier-input"
                        value={draftDossier[dossierKey] ?? ""}
                        onChange={(e) => narrativeCallbacks[key](e.target.value)}
                        rows={4}
                        aria-label={label}
                      />
                    )}
                  </div>
                );
              })}
              <div className="row" style={{ marginTop: 6, alignItems: "center" }}>
                <TabEditToggle
                  editing
                  onToggle={() => {
                    onQuickUpdate?.(draftDossier);
                    setDraftDossier(null);
                  }}
                />
                <button type="button" className="dnd-quiet-link" onClick={() => setDraftDossier(null)}>
                  отмена
                </button>
              </div>
            </div>
          )}

          {tab === "Досье" && !draftDossier && (
            <div className="dnd-personality-grid">
              <div className="dnd-tab-tools" style={{ gridColumn: "1 / -1" }}>
                {onQuickUpdate ? (
                  <TabEditToggle
                    editing={false}
                    onToggle={() =>
                      setDraftDossier({
                        personalityTraits: value.personalityTraits ?? "",
                        ideals: value.ideals ?? "",
                        bonds: value.bonds ?? "",
                        flaws: value.flaws ?? "",
                      })
                    }
                  />
                ) : (
                  <span className="dnd-tab-btn" aria-hidden="true" />
                )}
                <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
                <DndFanButton onOpen={() => setFanOpen(true)} />
              </div>
              {NARRATIVE_FIELDS.map(
                ({ key, label }) =>
                  value[key] && (
                    <div key={key} className="sb-entry">
                      <span className="sb-prop-label">{label}</span>{" "}
                      <span style={{ whiteSpace: "pre-wrap" }}>
                        <MentionText text={value[key] as string} />
                      </span>
                    </div>
                  )
              )}
              {NARRATIVE_FIELDS.every(({ key }) => !value[key]) && (
                <span className="muted">Пока ничего не заполнено.</span>
              )}
            </div>
          )}
          {tab === "Досье" && dossierExtra}
          {/* Низ карты: поиск и возврат в профиль (решение владельца). Поиск
              после просмотра, а не до; возврат — тем же жестом, что свайп
              «назад» с лицевой (onSheetBack задаёт полноэкранная страница). */}
          {tab !== "Карта" && (
            <div className="stack dnd-sheet-foot">
              <DndSheetSearch
                hits={searchHits}
                getEntry={getEntry}
                openCard={openSheetCard}
                setOpenCard={setOpenSheetCard}
                onGo={(hit) => {
                  setTab(hit.tab);
                  setHighlight(hit.highlight ?? null);
                }}
              />
              {onSheetBack && campaignConnected && (
                <button type="button" className="dnd-sheet-back" onClick={onSheetBack}>
                  ← Назад
                </button>
              )}
            </div>
          )}
          {/* Сводка мёртвых ссылок (этап 8, вид — канвас Actions): запросили
              пачкой, сервер не вернул — записи больше нет в компендиуме
              (снесли или переустановили модуль). Значок-треугольник и кнопка
              «Показать»: имена нужны для починки, но не каждый раз.
              Значками по строкам и оборотом не показываем (разбор): оборот —
              личное игроку, а значок у каждой строки — шум. */}
          {deadIds.length > 0 && (
            <div className="dnd-dead-links" role="status">
              <span className="muted" aria-hidden="true" style={{ flex: "none", display: "inline-flex" }}>
                <NavIcon name="warning" />
              </span>
              <span className="sb-prop-label" style={{ flex: "1 1 auto" }}>
                {(() => {
                  const n = deadIds.length;
                  const noun =
                    n % 10 === 1 && n % 100 !== 11 ? "ссылка" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "ссылки" : "ссылок";
                  return `${n} ${noun} на справочник ${n === 1 ? "потеряна" : "потеряны"}`;
                })()}
              </span>
              <button
                type="button"
                className="comp-mini"
                aria-expanded={deadOpen}
                onClick={() => setDeadOpen((v) => !v)}
              >
                {deadOpen ? "Скрыть" : "Показать"}
              </button>
              {deadOpen && (
                <span className="muted dnd-dead-names">
                  {deadNames.length > 0 ? deadNames.join(" · ") : "имена не опознаны"}
                </span>
              )}
            </div>
          )}
          </div>
          )}
          {showDesktopFace && !cardOnly && sideColumn}
        </div>
      </div>
    </div>
    {/* Визард повышения уровня — на верхнем уровне листа, а не внутри
        оборота карты: вход в него теперь цифра уровня в картуше, и открыт он
        должен быть с любой карты, а не только пока карта перевёрнута. */}
    {showLevelUp && onQuickUpdate && (
      <DndLevelUpWizard
        value={value}
        onApply={onLevelUpApply ?? ((p) => onQuickUpdate(p))}
        onClose={() => setShowLevelUp(false)}
        levelUpDraft={levelUpDraft}
      />
    )}
  </div>
  );
}
