// Лист D&D, «Магия»: круги заклинаний, описание, список класса, арканум,
// полученные заклинания и отметка активных.
import type { DndSpellEntry, CompendiumEntry, DndSpellPreparedState, DndAbilityKey, DndCharacterData } from "../../types";
import { type ReactNode, useState, useEffect, type DragEvent, useRef, Fragment } from "react";
import { extractEnglishName } from "../../compendium";
import { checkLabel, effectsLabel, ABILITY_KEY_ABBR, isNumericDefense, type DndEffect } from "./effects";
import { TIMING_KEY_TO_LABEL, spellTimingFromData } from "./dndFeatures";
import { MentionText } from "../mentions/MentionText";
import { spellSchoolName, readSearchDrop, MAX_SPELL_SLOTS, useOneShotOverlayFocus, stripLatin } from "./sheetShared";
import type { AttackRow } from "./SheetCombat";
import { type DndSpellOption, loadDndSpellsByLevel, loadDndSpellIndex } from "./dndCompendium";
import { useDndRuntime } from "./DndRuntime";
import { useConfirm } from "../../hooks/useConfirm";
import { ensureEntries, getCachedEntry } from "./entryCache";
import { PoolMeter } from "./TofuPips";
import { NavIcon } from "../NavIcons";
import { schoolIconSrc } from "./schoolIcons";
import { arcanumUnlockedCircles, ARCANUM_UNLOCKS } from "./dndSlots";

const SPELL_PREPARED_TITLES = ["Не подготовлено", "Подготовлено", "Всегда подготовлено"];

// Prepared spells float to the top of their level's list, always-prepared
// ones above merely-prepared ones (stable within each group, so drag/search
// order otherwise stays put).
function sortSpells(spells: DndSpellEntry[]): DndSpellEntry[] {
  return [...spells].sort(
    (a, b) => b.prepared - a.prepared || a.name.localeCompare(b.name, "ru")
  );
}

// One spell-level section: slot pips (requirement 11), a droppable/searchable
// spell list, and the always-prepared toggle (requirement 12).
// Builds the В/С/М component letters (only the ones that apply), with a
// tooltip on "М" showing the material component text (requirement 3).
function spellComponentLetters(
  s: Pick<DndSpellEntry, "componentV" | "componentS" | "componentM" | "materialComponent">
): ReactNode {
  if (!s.componentV && !s.componentS && !s.componentM) return null;
  return (
    <>
      {s.componentV && "В"}
      {s.componentS && "С"}
      {s.componentM && (
        <span title={s.materialComponent || undefined}>М</span>
      )}
    </>
  );
}

// Русское имя и оригинал: имя звучит в полный голос, оригинал стоит рядом
// тихой подписью. Оригинал берётся из снимка (`nameOriginal`), а если лист
// записан до появления поля — из «[English]»-хвоста имени тем же разбором,
// что и везде в справочнике (extractEnglishName).
export function spellNameParts(s: Pick<DndSpellEntry, "name" | "nameOriginal">): { ru: string; en: string } {
  const fromName = extractEnglishName(s.name);
  return { ru: fromName.name || s.name, en: s.nameOriginal?.trim() || fromName.en };
}

// «Школа · Время накладывания · компоненты · Концентрация · Ритуал» — only
// the pieces that apply, matching how the compendium editor shows spell
// flags (requirement 2 moves school/casting time into this same line).
// Школа вынута из ленты в отдельную плашку-категорию: между «Воплощением»,
// «Иллюзией» и «Ограждением» в столбце строк появляется ритм, которого у
// первого слова серой ленты не было.
function SpellMetaLine({ s }: { s: DndSpellEntry }) {
  const letters = spellComponentLetters(s);
  const parts: ReactNode[] = [];
  const timingLabel = spellTimingLabel(s);
  if (timingLabel) parts.push(timingLabel);
  if (letters) parts.push(letters);
  if (s.ritual) parts.push("Ритуал");
  if (s.concentration) parts.push("Концентрация");
  // Броски и эффекты — из структуры; старые attackSave/damage/healing
  // остаются только как запасной путь для листов, сохранённых до перехода.
  if (s.checks && s.checks.length > 0) parts.push(s.checks.map((c) => checkLabel(c)).join(" / "));
  else if (s.attackSave) parts.push(s.attackSave);
  if (s.effects && s.effects.length > 0) {
    parts.push(<span title={s.upcast || undefined}>{effectsLabel(s.effects, s.checks ?? [])}</span>);
  } else if (s.damage || s.healing) {
    parts.push(<span title={s.upcast || undefined}>{s.damage || `Лечение ${s.healing}`}</span>);
  }
  if (parts.length === 0 && !s.school) return null;
  // Два слоя намеренно: внешний — коробка обрезки в две строки, и у неё
  // должен быть ровно один ребёнок. `-webkit-box` считает каждого прямого
  // ребёнка отдельной «строкой» коробки, поэтому с плоским списком кусков
  // обрезка выбрасывала куски целиком вместо переноса текста.
  return (
    <span className="dnd-spell-meta">
      <span className="dnd-spell-meta-text">
        {s.school && <span className="dnd-spell-school">{s.school}</span>}
        {parts.map((p, i) => (
          <span key={i}>
            {(i > 0 || s.school) && <span className="dnd-spell-meta-sep">·</span>}
            {p}
          </span>
        ))}
      </span>
    </span>
  );
}

// Display label for a spell's casting timing — prefers the new structured
// field, falls back to the legacy free-text castingTime for rows added
// before this existed and never re-fetched.
function spellTimingLabel(s: Pick<DndSpellEntry, "castingTiming" | "castingTimingOther" | "castingTime">): string | undefined {
  if (s.castingTiming) {
    return s.castingTiming === "other" ? s.castingTimingOther || "Иное" : TIMING_KEY_TO_LABEL[s.castingTiming];
  }
  return s.castingTime;
}

// Full field set shown when a spell name is clicked (requirement 2).
interface SpellDetail {
  school?: string;
  castingTime?: string;
  range?: string;
  duration?: string;
  componentsText?: ReactNode;
  /** Круг записи компендиума: 0 — заговор. В списке он известен из якоря
   *  секции, а в окне, открытом поиском по листу, взяться ему неоткуда. */
  level?: number;
  description: string;
}

// Раскрытое описание заклинания — под строкой списка, тем же блоком, что и
// у предмета инвентаря. Раньше было модалкой; она закрывала лист целиком,
// и чтобы сравнить два заклинания, приходилось открывать и закрывать её
// дважды (решение владельца 2026-09-04).
// Характеристики заклинания парой колонок: подписи слева, значения ровным
// левым краем. Раньше они шли списком «Подпись: значение», и левый край
// значений скакал вслед за длиной подписи. Своя сетка, а не общая
// .comp-fields: та стоит ещё в десятке мест компендиума и меняться не должна.
// «Время накладывания» ужато до «Накладывание» — подпись в колонке не
// обязана быть предложением, а значение рядом договаривает.
export function SpellFields({ detail }: { detail: SpellDetail }) {
  const fields: [string, ReactNode][] = (
    [
      ["Школа", detail.school],
      ["Круг", detail.level == null ? undefined : detail.level === 0 ? "Заговор" : String(detail.level)],
      ["Накладывание", detail.castingTime],
      ["Дистанция", detail.range],
      ["Компоненты", detail.componentsText],
      ["Длительность", detail.duration],
    ] as [string, ReactNode][]
  ).filter(([, v]) => !!v);
  if (fields.length === 0) return null;
  return (
    <div className="dnd-spell-fields">
      {fields.map(([label, value]) => (
        <div key={label} className="dnd-spell-field">
          <span className="dnd-spell-field-label">{label}</span>
          <span className="dnd-spell-field-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

function SpellDescription({ detail }: { detail: SpellDetail | undefined }) {
  if (!detail) return <div className="dnd-spell-description muted">Загрузка…</div>;
  return (
    <div className="dnd-spell-description">
      <SpellFields detail={detail} />
      <MentionText text={detail.description} />
    </div>
  );
}

export function buildSpellDetail(entry: CompendiumEntry): SpellDetail {
  const materialComponent =
    typeof entry.data.material_component === "string" ? entry.data.material_component : undefined;
  const letters = spellComponentLetters({
    componentV: !!entry.data.component_v,
    componentS: !!entry.data.component_s,
    componentM: !!entry.data.component_m,
    materialComponent,
  });
  // Unlike the compact meta line (tooltip-only, to save space), the full
  // "Компоненты" field spells the material component text out inline —
  // it's the whole point of expanding a spell's details.
  const componentsText = letters && (
    <>
      {letters}
      {entry.data.component_m && materialComponent && ` (${materialComponent})`}
    </>
  );
  const timing = spellTimingFromData(entry.data);
  return {
    school: spellSchoolName(entry.data.school),
    castingTime:
      timing.castingTiming === "other"
        ? timing.castingTimingOther || "Иное"
        : timing.castingTiming
        ? TIMING_KEY_TO_LABEL[timing.castingTiming]
        : typeof entry.data.casting_time === "string"
        ? entry.data.casting_time
        : undefined,
    range: typeof entry.data.range === "string" ? entry.data.range : undefined,
    duration: typeof entry.data.duration === "string" ? entry.data.duration : undefined,
    componentsText,
    level: entry.level ?? undefined,
    description: entry.description || "Нет описания.",
  };
}

// Классы, что готовят из всего своего списка (гриллинг 2026-09-26, Q1):
// на «Магии» им виден весь список класса доступных кругов. Узнаются по
// имени, как Колдун и Воин ниже (nameMatches).
export const FULL_LIST_CLASSES = ["Артефактор", "Друид", "Жрец", "Паладин", "Следопыт"];

function DndSpellLevelSection({
  level,
  title,
  systemId,
  slots,
  spells,
  edit,
  showSlots,
  onSlotsChange,
  onSpellsChange,
  used,
  onUsedChange,
  onFreeCastToggle,
  preparedOnly,
  onCast,
  slotsLocked,
  autoSlots,
  listSpells,
  onTogglePrepared,
}: {
  level: number;
  /** Переименование секции (арканум): по умолчанию «Заговоры»/«N круг». */
  title?: string;
  systemId: number | null;
  slots: number;
  spells: DndSpellEntry[];
  edit: boolean;
  showSlots: boolean;
  onSlotsChange: (v: number) => void;
  onSpellsChange: (v: DndSpellEntry[]) => void;
  // View-mode-only: tracks slots expended this rest, separate from `slots`
  // (the max, only editable via onSlotsChange in edit mode).
  used?: number;
  onUsedChange?: (v: number) => void;
  /** Погасить/вернуть бесплатное сотворение (черты) — индекс в `spells`. */
  onFreeCastToggle?: (index: number) => void;
  preparedOnly?: boolean;
  /** Тап по названию — модалка использования (трата ячейки). */
  onCast?: (row: AttackRow) => void;
  /** Пипсы деривационные (считаются из строк, не из хранилища): редактор
   *  числа прячем, иначе задвоим счётчик. */
  slotsLocked?: boolean;
  /** Ячейки считаются по классам: в правке вместо счётчика — число. */
  autoSlots?: boolean;
  /** Весь список класса (гриллинг 2026-09-26): заклинания круга, которых нет
   *  в листе, — только показ, неподготовленными; в правке их не видно. */
  listSpells?: DndSpellEntry[];
  /** Ромб — кнопка подготовки вне правки. index — место в `spells`,
   *  null — строка из списка класса (её ещё нет в листе). */
  onTogglePrepared?: (spell: DndSpellEntry, index: number | null) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<DndSpellOption[]>([]);
  const { detached } = useDndRuntime();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, SpellDetail>>({});
  const [confirmDialog, confirm] = useConfirm();

  useEffect(() => {
    if (!adding || !systemId || detached) return;
    loadDndSpellsByLevel(systemId, level).then(setOptions);
  }, [adding, systemId, level]);

  // Клик по названию раскрывает полные поля заклинания. Запись берётся из
  // общего кэша листа (entryCache), а не отдельным GET на каждое открытие:
  // тот же кэш уже вытянул её пачкой ради мета-строки, и поштучный запрос
  // был ровно тем, что entryCache и заводился устранить. Заодно правка в
  // компендиуме теперь доходит и сюда — кэш сбрасывается на сохранении.
  async function toggleDescription(realIndex: number, entryId: number | null) {
    if (!entryId) return;
    if (expandedIndex === realIndex) {
      setExpandedIndex(null);
      return;
    }
    setExpandedIndex(realIndex);
    if (!(entryId in details)) {
      await ensureEntries([entryId]);
      const entry = getCachedEntry(entryId);
      setDetails((d) => ({
        ...d,
        [entryId]: entry ? buildSpellDetail(entry) : { description: "Описание не загрузилось." },
      }));
    }
  }

  // Ни запроса за метой, ни снапшота: всё, кроме ссылки и имени, лист берёт
  // из компендиума при отрисовке (см. resolveSpell). Раньше здесь был GET на
  // каждое добавляемое заклинание, и он же был источником устаревания.
  // Дубль в том же круге не добавляем (тикет 08: замена не должна плодить
  // дубли): сверяем ссылку, без неё — имя.
  function addSpell(entryId: number | null, name: string) {
    setAdding(false);
    setQuery("");
    if (spells.some((s) => (entryId != null && s.entryId === entryId) || s.name === name)) return;
    onSpellsChange([...spells, { entryId, name, prepared: 0 }]);
  }
  // Cycles the same star through not prepared → prepared → always prepared.
  function togglePrepared(i: number) {
    const next = spells.slice();
    next[i] = { ...next[i], prepared: ((next[i].prepared + 1) % 3) as DndSpellPreparedState };
    onSpellsChange(next);
  }
  function toggleOutsideLimit(i: number) {
    const next = spells.slice();
    next[i] = { ...next[i], outsideLimit: !next[i].outsideLimit };
    onSpellsChange(next);
  }
  // Своя характеристика по кругу: классовая → Инт → Мдр → Хар (Q4).
  function cycleAbility(i: number) {
    const order: (DndAbilityKey | undefined)[] = [undefined, "int", "wis", "cha"];
    const next = spells.slice();
    const ability = order[(order.indexOf(next[i].ability) + 1) % order.length];
    next[i] = { ...next[i], ability };
    onSpellsChange(next);
  }
  async function remove(i: number) {
    const name = spells[i]?.name?.trim();
    if (!(await confirm({
      message: name ? `Убрать «${name}» из списка заклинаний?` : "Убрать это заклинание?",
      confirmLabel: "Убрать",
      danger: true,
    }))) return;
    onSpellsChange(spells.filter((_, idx) => idx !== i));
  }
  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const result = readSearchDrop(e);
    if (!result || result.kind !== "spell") return;
    if (spells.some((s) => s.entryId === result.id || s.name === result.title)) return;
    onSpellsChange([...spells, { entryId: result.id, name: result.title, prepared: 0 }]);
  }

  const filtered = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : options;
  const fromList = edit ? [] : (listSpells ?? []);
  const ordered = edit ? spells : sortSpells([...spells, ...fromList]);
  // В режиме правки фильтр не применяется: подготовить нельзя то, чего не
  // видно. Круг при этом не прячется целиком даже когда всё скрыто — в его
  // заголовке живут ячейки, и они нужны независимо от подготовки.
  const sorted = preparedOnly && !edit ? ordered.filter((sp) => sp.prepared > 0) : ordered;
  const hiddenCount = ordered.length - sorted.length;
  const label = title ?? (level === 0 ? "Заговоры" : `${level} круг`);
  // Счётчик считает по всему кругу, а не по видимому: фильтр «только
  // подготовленные» не должен занижать «сколько у меня всего в круге».
  const preparedCount = ordered.filter((sp) => sp.prepared > 0).length;

  // Круг, в котором что-то есть, открыт с самого начала. Раскрытие ставится
  // ровно один раз при монтировании и дальше не трогается: заклинатель 9
  // уровня открывал «Магию» и видел шесть пустых заголовков, но управлять
  // раскрытием после этого — его дело, и повторный `open` из рендера отменял
  // бы каждое его сворачивание. Памяти между уходами с карты не заводим —
  // вкладка размонтируется, и восстанавливать нечего.
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const openedOnce = useRef(false);
  useEffect(() => {
    if (openedOnce.current) return;
    openedOnce.current = true;
    if (detailsRef.current && ordered.length > 0) detailsRef.current.open = true;
  }, [ordered.length]);
  // В правке раскрыты все круги: у пустого тело — «+ заклинание» (Q13).
  useEffect(() => {
    if (edit && detailsRef.current) detailsRef.current.open = true;
  }, [edit]);

  return (
    <details className="dnd-spell-level-card" ref={detailsRef}>
      {confirmDialog}
      <summary className="row dnd-spell-level-summary" style={{ justifyContent: "space-between" }}>
        <span className="dnd-spell-level-label">
          {/* Число и слово разведены по весу: круг — цифрой в полный голос,
              «круг» — тихим капсом. Заголовок не вырос, вырос воздух над ним
              (см. .dnd-spell-level-summary) — раздел стал оглавлением
              гримуара, а не шапкой таблицы. У «Заговоров» и у переименованных
              секций (арканум) числа нет: слово встаёт на место числа. */}
          {title == null && level > 0 ? (
            <>
              <span className="dnd-spell-level-no">{level}</span>
              <span className="dnd-spell-level-word">круг</span>
            </>
          ) : (
            <span className="dnd-spell-level-solo">{label}</span>
          )}
          {/* §1.11: кругу, в котором ничего нет, счётчик показывать нечем. */}
          {ordered.length > 0 && (
            <span className="dnd-spell-level-count">
              {ordered.length}
              {/* «подг. N» — только когда оно отличается от общего числа.
                  У колдуна с пятью заклинаниями, все из которых подготовлены,
                  приписка «· подг. 5» повторяет соседнее число и ничего не
                  добавляет; вопрос, ради которого счётчик заводился, — это
                  «12 известно, 6 подготовлено». */}
              {preparedCount > 0 && preparedCount < ordered.length && ` · подг. ${preparedCount}`}
            </span>
          )}
        </span>
        {showSlots && (
          // Clicking a pip must not also toggle the <details> open/closed.
          // stopPropagation alone doesn't suppress that — <summary>'s toggle
          // is the click event's default action, not a bubbled listener, so
          // preventDefault is required too.
          <span
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="row"
            style={{ gap: 10 }}
          >
            {/* Один трек вместо двух: максимум виден числом кругов, а ячейки —
                тофу (есть голова — цела, потратили — съели). Дубль «макс + исп»
                сбивал с толку. Без правки — только показ. */}
            {!edit && slots > 0 && (
              <span className="row muted" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
                исп.
                <PoolMeter
                  max={slots}
                  left={Math.max(0, slots - (used ?? 0))}
                  label={`Потрачено ячеек, ${label}`}
                  onSetLeft={onUsedChange ? (next) => onUsedChange(slots - next) : undefined}
                />
              </span>
            )}
            {/* Q11: при расчёте по классам править нечего — только число;
                счётчик — после «задать вручную». */}
            {edit && !slotsLocked && (autoSlots ? (
              <span className="muted dnd-slots-auto">
                ячеек: <b>{slots}</b> · по классам
              </span>
            ) : (
              <span className="dnd-slot-stepper">
                <span className="muted">ячеек</span>
                <button
                  type="button"
                  className="dnd-pool-step"
                  disabled={slots <= 0}
                  aria-label={`${label}: меньше ячеек`}
                  onClick={() => onSlotsChange(slots - 1)}
                >
                  <NavIcon name="minus" />
                </button>
                <b className="dnd-pool-meter-left">{slots}</b>
                <button
                  type="button"
                  className="dnd-pool-step"
                  disabled={slots >= MAX_SPELL_SLOTS}
                  aria-label={`${label}: больше ячеек`}
                  onClick={() => onSlotsChange(slots + 1)}
                >
                  <NavIcon name="plus" />
                </button>
              </span>
            ))}
          </span>
        )}
      </summary>
      <div
        className={`dnd-spell-list${dragOver ? " drag-over" : ""}`}
        style={{ marginTop: 6 }}
        onDragOver={edit ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
        onDragLeave={edit ? () => setDragOver(false) : undefined}
        onDrop={edit ? handleDrop : undefined}
      >
        {/* В правке у пустого круга тело — «+ заклинание» (Q13), подпись лишняя. */}
        {sorted.length === 0 && !edit && (
          <span className="muted">{hiddenCount > 0 ? "Ничего не подготовлено" : "Пусто"}</span>
        )}
        {sorted.map((s) => {
          const realIndex = spells.indexOf(s);
          // Строка из списка класса в `spells` не лежит: ключ — после них.
          const rowKey = realIndex >= 0 ? realIndex : spells.length + fromList.indexOf(s);
          const { ru, en } = spellNameParts(s);
          const schoolSrc = s.school ? schoolIconSrc(s.school) : null;
          // Вне лимита и не от класса/вида — скорее всего черта: спросить,
          // чем колдует, пока не отмечено (Q4, 2026-09-24).
          const abilityMark = s.ability ? (
            <span className="dnd-outside-mark" title="Своя заклинательная характеристика">{ABILITY_KEY_ABBR[s.ability]}</span>
          ) : s.outsideLimit && s.sourceParentId == null ? (
            <span className="dnd-outside-mark" title="Отметьте характеристику в правке раздела">чем колдует?</span>
          ) : null;
          // Раз в долгий отдых без ячейки: тофу — есть или съедено.
          const freeCast = s.freeCast ? (
            <button
              type="button"
              className={`dnd-free-cast${s.freeCastUsed ? " is-used" : ""}`}
              disabled={!onFreeCastToggle}
              aria-pressed={!!s.freeCastUsed}
              title={s.freeCastUsed ? "Бесплатное сотворение потрачено — вернётся после долгого отдыха" : "Можно сотворить 1 раз без ячейки"}
              aria-label={`${s.name}: бесплатное сотворение ${s.freeCastUsed ? "потрачено" : "есть"}`}
              onClick={() => onFreeCastToggle?.(realIndex)}
            >
              {s.freeCastUsed ? "без ячейки: 0" : "без ячейки: 1"}
            </button>
          ) : null;
          return (
            <div key={rowKey}>
              <div
                className={`comp-row dnd-spell-row${edit ? " is-edit" : ""}${s.prepared === 2 ? " is-prepared" : ""}${s.prepared === 1 ? " is-prepared-once" : ""}`}
              >
                {/* Две ступени вместо одной ленты: имя — объект, параметры —
                    подпись под ним. Раньше и то и другое стояло в строку
                    одним кеглем, и глаз читал всё подряд. Мишень одна
                    (владелец 2026-09-26): вся строка открывает окно — там и
                    описание, и трата; в правке строка не нажимается. */}
                {/* Значок школы — слева от названия, высотой в обе строки
                    (имя + подпись): школа уже есть текстом в подписи, значок
                    её дублирует графикой, поэтому скрыт от скринридера. */}
                {schoolSrc && (
                  <span className="dnd-spell-school-icon" title={s.school} aria-hidden="true">
                    <img src={schoolSrc} alt="" draggable={false} />
                  </span>
                )}
                <span className="dnd-spell-main">
                  {s.entryId && onCast && !edit ? (
                    <button
                      type="button"
                      className="dnd-spell-title dnd-spell-name-link"
                      aria-label={`${s.name} — описание и использование`}
                      onClick={() =>
                        onCast({
                          name: s.name,
                          bonus: "",
                          damage: "",
                          range: "",
                          timing: "action",
                          source: { kind: "spell", spell: s, level },
                        })
                      }
                    >
                      <span className="comp-name dnd-spell-name">{ru}</span>
                      {en && <span className="dnd-spell-en">{en}</span>}
                      {s.outsideLimit && <span className="dnd-outside-mark" title="Не в счёт подготовленных">∞</span>}
                      {abilityMark}
                      {s.special && <span className="dnd-special-mark" title="Взято по разрешению Мастера">особое</span>}
                    </button>
                  ) : (
                    // В правке — одно имя с метками (гриллинг правки «Магии»
                    // 2026-09-26, Q1): англ. имя, подпись и «чем колдует»
                    // уходят — последнее видно на своей плашке справа.
                    <span className="dnd-spell-title">
                      <span className="comp-name dnd-spell-name">{ru}</span>
                      {!edit && en && <span className="dnd-spell-en">{en}</span>}
                      {s.outsideLimit && <span className="dnd-outside-mark" title="Не в счёт подготовленных">∞</span>}
                      {!edit && abilityMark}
                      {s.special && <span className="dnd-special-mark" title="Взято по разрешению Мастера">особое</span>}
                    </span>
                  )}
                  {!edit && freeCast}
                  {edit ? null : s.entryId && !onCast ? (
                    <button
                      type="button"
                      className="dnd-spell-meta-link"
                      aria-expanded={expandedIndex === rowKey}
                      aria-label={`${s.name} — открыть описание`}
                      onClick={() => toggleDescription(rowKey, s.entryId!)}
                    >
                      <SpellMetaLine s={s} />
                    </button>
                  ) : (
                    <SpellMetaLine s={s} />
                  )}
                </span>
                {edit ? (
                  // Четыре мишени на виду (Q2: прятать в «⋯» — лишний тап):
                  // ромб крутит «нет → подготовлено → всегда», ∞ — вне лимита,
                  // плашка — чем колдует (КЛ → ИНТ → МДР → ХАР), крест — убрать.
                  // Звезды больше нет: знак подготовки на листе один — ромб (Q3).
                  <span className="dnd-spell-actions">
                    <button
                      type="button"
                      className={`dnd-spell-act dnd-prep-diamond is-${s.prepared}`}
                      title={`${SPELL_PREPARED_TITLES[s.prepared]} — сменить`}
                      aria-label={`${s.name}: ${SPELL_PREPARED_TITLES[s.prepared]} — сменить`}
                      onClick={() => togglePrepared(realIndex)}
                    />
                    {/* «Вне лимита» ставится и руками: выдач в D&D много —
                        предмет, черта, благословение Мастера, — и все они
                        приходят по-своему. Пометка от источника (вид, класс,
                        подкласс) приезжает сама, эта — для всего остального. */}
                    <button
                      type="button"
                      className={`dnd-spell-act is-inf-${s.outsideLimit ? "on" : "off"}`}
                      title="Не в счёт подготовленных"
                      aria-pressed={!!s.outsideLimit}
                      aria-label={`${s.name}: не в счёт подготовленных`}
                      onClick={() => toggleOutsideLimit(realIndex)}
                    />
                    <button
                      type="button"
                      className={`dnd-spell-act is-ab-${s.ability ?? "class"}`}
                      title="Чем колдует: по классу, Инт, Мдр, Хар"
                      aria-label={`${s.name}: чем колдует — ${s.ability ? ABILITY_KEY_ABBR[s.ability] : "по классу"}, сменить`}
                      onClick={() => cycleAbility(realIndex)}
                    />
                    <button
                      type="button"
                      className="dnd-spell-act is-remove"
                      title="Убрать"
                      aria-label={`Убрать «${s.name}» из списка`}
                      onClick={() => remove(realIndex)}
                    />
                  </span>
                ) : onTogglePrepared && s.prepared !== 2 ? (
                  // Ромб подготовки (макет 2026-09-25; справа по центру строки):
                  // пустой — нет, залитый — подготовлено, с кислотной
                  // сердцевиной — всегда (тогда он не кнопка).
                  <button
                    type="button"
                    className={`dnd-prep-diamond is-${s.prepared}`}
                    aria-pressed={s.prepared === 1}
                    aria-label={`${s.name}: ${s.prepared === 1 ? "подготовлено — снять" : "подготовить"}`}
                    title={s.prepared === 1 ? "Подготовлено — снять" : "Подготовить"}
                    onClick={() => onTogglePrepared(s, realIndex >= 0 ? realIndex : null)}
                  />
                ) : (
                  <span
                    className={`dnd-prep-diamond is-${s.prepared}`}
                    role="img"
                    aria-label={SPELL_PREPARED_TITLES[s.prepared]}
                    title={SPELL_PREPARED_TITLES[s.prepared]}
                  />
                )}
              </div>
              {expandedIndex === rowKey && s.entryId && (
                <SpellDescription detail={details[s.entryId]} />
              )}
            </div>
          );
        })}
        {hiddenCount > 0 && sorted.length > 0 && (
          <span className="muted dnd-spell-hidden-note">Скрыто неподготовленных: {hiddenCount}</span>
        )}
        {edit && (
          <div>
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
                  отмена
                </button>
              </div>
            ) : (
              // Пунктирная строка в конце круга — как «+ выбрать схемы» у
              // реплик (Q5); у пустого круга это всё его тело (Q13).
              <button type="button" className="dnd-replica-add dnd-spell-add-btn" onClick={() => setAdding(true)}>
                + заклинание
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

// Memoized: with up to 10 level sections (each its own search/drop UI), this
// is one of the largest subtrees on the sheet — without memo it fully
// re-renders on every keystroke anywhere else in the form.
export function DndSpellsView({
  cantrips,
  spellSlotLevels,
  spellSlotPips,
  spellSlotsUsed,
  spellsByLevel,
  onUsedChange,
  onFreeCastToggle,
  edit,
  systemId,
  onCantripsChange,
  onSlotsChange,
  onSpellsChange,
  preparedOnly,
  onCast,
  levelTitles,
  slotsLockedCircles,
  autoSlots,
  listByLevel,
  onTogglePrepared,
}: {
  cantrips: DndSpellEntry[];
  spellSlotLevels: number;
  spellSlotPips: number[];
  spellSlotsUsed?: number[];
  spellsByLevel: DndSpellEntry[][];
  onUsedChange?: (level0idx: number, v: number) => void;
  /** Бесплатное сотворение: круг (0 — заговоры) и индекс заклинания. */
  onFreeCastToggle?: (level: number, index: number) => void;
  // Local per-tab edit toggle (see TabEditToggle/editingSpells in
  // DndCharacterView) — when set, this is otherwise the same view but with
  // add-spell/drag-drop/slot-count editing turned on directly, no need for
  // the full DndCharacterEdit form just to add a spell from the bag.
  edit?: boolean;
  systemId?: number | null;
  onCantripsChange?: (v: DndSpellEntry[]) => void;
  onSlotsChange?: (level0idx: number, v: number) => void;
  onSpellsChange?: (level0idx: number, v: DndSpellEntry[]) => void;
  preparedOnly?: boolean;
  /** Тап по названию — модалка использования (трата ячейки). */
  onCast?: (row: AttackRow) => void;
  /** Переименование секций (арканум колдуна): круг → подпись. */
  levelTitles?: Record<number, string>;
  /** Круги с деривационными пипсами (арканум): ручную правку числа прячем,
   *  чтобы не задвоить счётчик. */
  slotsLockedCircles?: ReadonlySet<number>;
  autoSlots?: boolean;
  /** Весь список класса по кругам (индекс 0 — 1 круг), без того, что в листе. */
  listByLevel?: DndSpellEntry[][];
  /** Подготовка ромбом вне правки: круг (0 — заговоры), заклинание, место. */
  onTogglePrepared?: (level: number, spell: DndSpellEntry, index: number | null) => void;
}) {
  const activeLevels = Array.from({ length: spellSlotLevels }, (_, i) => i).filter(
    (i) => edit || (spellSlotPips[i] ?? 0) > 0 || (spellsByLevel[i]?.length ?? 0) > 0 || (listByLevel?.[i]?.length ?? 0) > 0
  );
  if (!edit && activeLevels.length === 0 && cantrips.length === 0) return null;
  // Не `.stack`: на широком экране вкладка раскладывается в две колонки
  // (`.dnd-desktop-tab > div { columns: 2 }`), а флексовая стопка — один
  // неразрывный блок, и весь список кругов уезжал во вторую колонку
  // целиком, оставляя первую пустой. Обычный блок колонки делят по
  // кругам; зазор между кругами даёт отбивка круга, а не gap стопки.
  return (
    <div className="dnd-spell-sections">
      {(edit || cantrips.length > 0) && (
        <DndSpellLevelSection
          level={0}
          systemId={edit ? systemId ?? null : null}
          slots={0}
          spells={cantrips}
          edit={!!edit}
          preparedOnly={preparedOnly}
          showSlots={false}
          onSlotsChange={() => {}}
          onSpellsChange={edit && onCantripsChange ? onCantripsChange : () => {}}
          onFreeCastToggle={onFreeCastToggle ? (idx) => onFreeCastToggle(0, idx) : undefined}
          onCast={onCast}
          onTogglePrepared={onTogglePrepared ? (sp, idx) => onTogglePrepared(0, sp, idx) : undefined}
        />
      )}
      {activeLevels.map((i) => (
        <DndSpellLevelSection
          key={i}
          level={i + 1}
          title={levelTitles?.[i + 1]}
          systemId={edit ? systemId ?? null : null}
          slots={spellSlotPips[i] ?? 0}
          spells={spellsByLevel[i] ?? []}
          used={spellSlotsUsed?.[i]}
          onUsedChange={onUsedChange ? (v) => onUsedChange(i, v) : undefined}
          edit={!!edit}
          preparedOnly={preparedOnly}
          showSlots
          slotsLocked={slotsLockedCircles?.has(i + 1) ?? false}
          onSlotsChange={edit && onSlotsChange ? (v) => onSlotsChange(i, v) : () => {}}
          onSpellsChange={edit && onSpellsChange ? (v) => onSpellsChange(i, v) : () => {}}
          onFreeCastToggle={onFreeCastToggle ? (idx) => onFreeCastToggle(i + 1, idx) : undefined}
          onCast={onCast}
          autoSlots={autoSlots}
          listSpells={listByLevel?.[i]}
          onTogglePrepared={onTogglePrepared ? (sp, idx) => onTogglePrepared(i + 1, sp, idx) : undefined}
        />
      ))}
    </div>
  );
}

// Карточка предмета листа — одна на поиск и на вкладку «Действия», чтобы у
// заклинания было ровно одно окно, откуда бы его ни открыли.
// Кнопка «Потратить» в карточке действия — только там, где источник траты
// однозначен: у заклинания это ячейка его круга (а если её нет — ближайшая
// доступная выше, повышение круга штатный приём 5.5), у умения — пул,
// заданный в его стоимости. Где источник неоднозначен, кнопки нет.
// Метка охотника и Сглаз: заявление столу с выбором «с тратой /
// перевесить». Механика та же у обоих: первое наложение тратит ресурс
// (у следопыта — использование Избранного врага, иначе ячейка; у Сглаза
// только ячейка), перевешивание на новую цель после смерти старой —
// бонусным действием без траты. Обе кнопки ставят концентрацию и шлют
// сигнал мастеру (напоминалка + живое событие), цель выбирает мастер.
export const MARK_SPELLS = ["Метка охотника", "Сглаз"];

// Наложенное заклинание начинает действовать (гриллинг 2026-09-23, Q16):
// заклинание на концентрации становится концентрацией (по правилам вторая
// снимает первую), числовая защита без концентрации («Доспехи мага», «Щит»)
// — действующим, чтобы КЗ посчитал её сам. Остальное лист не отслеживает.
// На другого (Q6, 2026-09-24): ячейка и концентрация — у заклинателя, числа
// его листа не меняются.
export function spellActivationPatch(spell: DndSpellEntry, value: DndCharacterData, onOther = false): Partial<DndCharacterData> {
  if (spell.concentration) return { concentration: spell.name, concentrationOnOther: onOther ? spell.name : "" };
  if (onOther) return {};
  if ((spell.effects ?? []).some(isNumericDefense)) {
    const active = value.activeSpells ?? [];
    return active.includes(spell.name) ? {} : { activeSpells: [...active, spell.name] };
  }
  return {};
}

// Заклинание меняет числа листа: защита или плоская прибавка к броскам.
// Действующее (activeSpells/концентрация) лист считает сам — effectCarriers.
export function spellChangesSheet(spell: DndSpellEntry): boolean {
  return (spell.effects ?? []).some(
    (e) => isNumericDefense(e) || (e.type === "roll_modifier" && typeof e.flat === "number")
  );
}

// Отметка «действует» руками — для наложенного без ячейки (воззвание
// «Доспехи теней», свиток) и чтобы снять досрочно. Только у меняющего лист:
// у остального отметка ничего бы не меняла. Подпись «Уже действует —
// отметить» читалась как «уже действует» — владелец снял Щит и решил, что
// снятие не сработало (2026-09-26).
export function ActiveSpellToggle({
  spell,
  value,
  free,
  onQuickUpdate,
}: {
  spell: DndSpellEntry;
  value: DndCharacterData;
  /** Заговор: ячейки у него нет вовсе, «без траты ячейки» — лишнее. */
  free?: boolean;
  onQuickUpdate: (patch: Partial<DndCharacterData>) => void;
}) {
  if (!spellChangesSheet(spell)) return null;
  const on = spell.concentration ? value.concentration === spell.name : (value.activeSpells ?? []).includes(spell.name);
  const toggle = () => {
    if (spell.concentration) onQuickUpdate({ concentration: on ? "" : spell.name, concentrationOnOther: "" });
    else {
      const active = value.activeSpells ?? [];
      onQuickUpdate({ activeSpells: on ? active.filter((n) => n !== spell.name) : [...active, spell.name] });
    }
  };
  return (
    <button type="button" className="comp-mini" aria-pressed={on} onClick={toggle}>
      {on ? "Действует — снять" : free ? "Применить" : "Применить без траты ячейки"}
    </button>
  );
}

export function DndClassSpellListModal({
  systemId,
  sources,
  cantrips,
  spellsByLevel,
  maxCircle,
  titleLine,
  listIds,
  onPick,
  onClose,
}: {
  systemId: number | null;
  /** Класс и подкласс персонажа: по их id и отбираются заклинания. */
  sources: { id: number; name: string }[];
  cantrips: DndSpellEntry[];
  spellsByLevel: DndSpellEntry[][];
  /** Старший доступный круг: выкладка по умолчанию — заговоры и круги не
      выше него («что обычно берут на этом уровне», этап 6). */
  maxCircle: number;
  /** «Имя · Класс N» в шапку (канвас SpellPicker). */
  titleLine: string;
  /** Весь список класса, уже видный на «Магии» (готовящие из списка):
   *  брать его незачем — строка помечена «в списке». */
  listIds?: ReadonlySet<number>;
  /** Пачка: отметить несколько и добавить разом, одним сохранением.
   *  special — недоступное персонажу, взятое по разрешению Мастера. */
  onPick: (items: { level: number; entry: CompendiumEntry; special: boolean }[]) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<CompendiumEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [myCircle, setMyCircle] = useState(true);
  const [circleSel, setCircleSel] = useState<number | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [failed, setFailed] = useState(false);
  /** Круги с раскрытым «уже есть: N». */
  const [openTaken, setOpenTaken] = useState<ReadonlySet<number>>(new Set());
  const dialogRef = useOneShotOverlayFocus('.dnd-spell-picker-search input');

  useEffect(() => {
    if (!systemId) {
      setAll([]);
      return;
    }
    const ac = new AbortController();
    loadDndSpellIndex(systemId, { signal: ac.signal })
      .then(setAll)
      .catch((e) => {
        if ((e as Error)?.name !== "AbortError") setFailed(true);
      });
    return () => ac.abort();
  }, [systemId]);

  // Escape закрывает полноэкранный подборщик (крестик — для пальца).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sourceIds = new Set(sources.map((s) => s.id));
  // Уже в листе — по entryId: показывать «взять» у того, что уже взято,
  // значит собирать двойники руками пользователя.
  const owned = new Set(
    [...cantrips, ...spellsByLevel.flat()].map((s) => s.entryId).filter((id): id is number => typeof id === "number")
  );

  const classSpells = (all ?? []).filter((e) => {
    const refs = Array.isArray(e.data?.classes) ? (e.data.classes as { id?: number }[]) : [];
    return refs.some((r) => typeof r.id === "number" && sourceIds.has(r.id));
  });
  // Круги в чипах — только те, что есть у класса (пустых кнопок не надо).
  const presentCircles = [...new Set(classSpells.map((e) => e.level ?? 0))].sort((a, b) => a - b);

  const q = query.trim().toLowerCase();
  // Круг: конкретный перекрывает «мой круг», «Все» снимает оба. Поиск
  // перекрывает круги: пустое поле — выкладка, а не пустой экран.
  const passes = (e: CompendiumEntry) => {
    const lvl = e.level ?? 0;
    if (q) return e.name.toLowerCase().includes(q);
    if (circleSel != null) return lvl === circleSel;
    if (myCircle) return lvl <= Math.max(0, maxCircle);
    return true;
  };
  const overCircle = (e: CompendiumEntry) => (e.level ?? 0) > maxCircle;
  const classIdSet = new Set(classSpells.map((e) => e.id));
  const isSpecial = (e: CompendiumEntry) => !classIdSet.has(e.id) || overCircle(e);
  // Недоступное (гриллинг 2026-09-26, Q3–Q5): выше доступного круга — из
  // своего списка по фильтру, чужое — только поиском (иначе сотни строк).
  // Брать можно: Мастер разрешает; в листе будет пометка «особое».
  const matching = classSpells.filter((e) => !overCircle(e) && passes(e));
  const unavailable = (all ?? []).filter((e) =>
    classIdSet.has(e.id) ? overCircle(e) && passes(e) : q !== "" && passes(e)
  );
  const unavailableReason = (e: CompendiumEntry) =>
    classIdSet.has(e.id) ? `${e.level} круг — пока нет ячеек` : "не из списка класса";
  const byLevel = new Map<number, CompendiumEntry[]>();
  for (const e of matching) {
    const lvl = e.level ?? 0;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(e);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  const byId = new Map((all ?? []).map((e) => [e.id, e]));
  const pickedSpecial = [...picked].filter((id) => {
    const e = byId.get(id);
    return !!e && isSpecial(e);
  }).length;

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Короткое действие для подписи строки (канвас: «действие», «реакция»).
  const actionWord = (e: CompendiumEntry): string | undefined => {
    const t = spellTimingFromData(e.data).castingTiming;
    if (t === "action") return "действие";
    if (t === "bonus") return "бонусное";
    if (t === "reaction") return "реакция";
    return undefined;
  };
  const spellMeta = (e: CompendiumEntry): string =>
    [
      spellSchoolName(e.data?.school),
      actionWord(e),
      typeof e.data?.range === "string" ? e.data.range : undefined,
    ]
      .filter(Boolean)
      .join(" · ");

  // Строка в одну линию (макет 2026-09-26): галочка, школа, имя, подпись,
  // справа — «в листе», «в списке» или причина недоступности.
  const pickRow = (e: CompendiumEntry, note: string, isUnavailable: boolean) => {
    const locked = owned.has(e.id) || (!isUnavailable && !!listIds?.has(e.id));
    const isPicked = picked.has(e.id);
    const meta = spellMeta(e);
    const school = schoolIconSrc(spellSchoolName(e.data?.school));
    return (
      <button
        key={e.id}
        type="button"
        className={`dnd-spell-pick-row${isPicked ? " is-picked" : ""}${isUnavailable ? " is-unavailable" : ""}${locked ? " is-owned" : ""}`}
        disabled={locked}
        aria-pressed={isPicked || locked}
        onClick={() => toggle(e.id)}
      >
        <span className="dnd-pick-box" aria-hidden="true">
          {(isPicked || locked) && (
            <svg viewBox="0 0 18 18">
              <path d="M3 9 L7 13 L15 4" fill="none" stroke="currentColor" strokeWidth="3" />
            </svg>
          )}
        </span>
        {school ? (
          <img className="dnd-spell-pick-school" src={school} alt="" draggable={false} />
        ) : (
          <span className="dnd-spell-pick-school" aria-hidden="true" />
        )}
        <span className="dnd-spell-pick-main">
          <span className="dnd-spell-pick-name">{stripLatin(e.name)}</span>
          {meta && <span className="dnd-spell-pick-meta">{meta}</span>}
        </span>
        {isUnavailable && isPicked && <span className="dnd-spell-pick-special">особое</span>}
        {note && <span className="dnd-spell-pick-circle">{note}</span>}
      </button>
    );
  };

  return (
    <>
    <div className="dnd-spell-picker-backdrop" aria-hidden="true" onClick={onClose} />
    <div ref={dialogRef} className="dnd-spell-picker" role="dialog" aria-modal="true" aria-label="Взять заклинания" tabIndex={-1}>
      <div className="dnd-spell-picker-head">
        <div className="dnd-spell-picker-title-row">
          <div>
            <div className="dnd-spell-picker-title">Взять заклинания</div>
            <div className="dnd-spell-picker-sub">
              {titleLine} · в листе {owned.size}
            </div>
          </div>
          <button type="button" className="dnd-spell-picker-close" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        {/* Одна бумажная полоса с лупой, как «Найти на листе» (рестайл Q5). */}
        <label className="dnd-spell-picker-search">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            type="search"
            placeholder="Название — найдёт и недоступные"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Поиск заклинаний по названию"
          />
        </label>
        {/* Круги — язычками, как вкладки листа (рестайл Q6). «Мой круг» стал
            «Доступные»: это все круги, до которых есть ячейки. */}
        <div className="dnd-spell-picker-chips" role="group" aria-label="Круги">
          <button
            type="button"
            className={`dnd-pick-chip${myCircle && circleSel == null ? " is-on" : ""}`}
            aria-pressed={myCircle && circleSel == null}
            onClick={() => {
              setMyCircle((v) => !v);
              setCircleSel(null);
            }}
          >
            Доступные
          </button>
          {presentCircles
            .filter((lvl) => lvl > 0)
            .map((lvl) => (
              <button
                key={lvl}
                type="button"
                className={`dnd-pick-chip${circleSel === lvl ? " is-on" : ""}`}
                aria-pressed={circleSel === lvl}
                aria-label={`${lvl} круг`}
                onClick={() => setCircleSel((prev) => (prev === lvl ? null : lvl))}
              >
                {lvl}
              </button>
            ))}
          <button
            type="button"
            className={`dnd-pick-chip${!myCircle && circleSel == null ? " is-on" : ""}`}
            aria-pressed={!myCircle && circleSel == null}
            onClick={() => {
              setMyCircle(false);
              setCircleSel(null);
            }}
          >
            Все
          </button>
        </div>
      </div>
      <div className="dnd-spell-picker-list">
        {failed && <p className="muted">Не удалось загрузить справочник заклинаний.</p>}
        {!failed && all === null && <p className="muted">Загрузка…</p>}
        {all !== null && levels.length === 0 && unavailable.length === 0 && (
          <p className="muted">
            {sources.length === 0
              ? "Сначала выберите класс — список строится по нему."
              : "Ничего не нашлось: у класса нет заклинаний в справочнике либо не подходит поиск."}
          </p>
        )}
        {levels.map((lvl) => {
          // Уже взятое — не вперемешку, а свёрнутой строкой в конце круга
          // (рестайл Q1–Q2): отметить его нельзя, выбору оно только мешает.
          const isTaken = (e: CompendiumEntry) => owned.has(e.id) || !!listIds?.has(e.id);
          const fresh = byLevel.get(lvl)!.filter((e) => !isTaken(e));
          const taken = byLevel.get(lvl)!.filter(isTaken);
          const open = openTaken.has(lvl);
          return (
            <div key={lvl}>
              <div className="dnd-spell-picker-group">
                {lvl > 0 && <b>{lvl}</b>}
                <span>{lvl === 0 ? "Заговоры" : "круг"}</span>
              </div>
              {fresh.map((e) => pickRow(e, "", false))}
              {taken.length > 0 && (
                <button
                  type="button"
                  className="dnd-spell-picker-taken"
                  aria-expanded={open}
                  onClick={() =>
                    setOpenTaken((prev) => {
                      const next = new Set(prev);
                      if (next.has(lvl)) next.delete(lvl);
                      else next.add(lvl);
                      return next;
                    })
                  }
                >
                  уже есть: {taken.length} <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                </button>
              )}
              {open && taken.map((e) => pickRow(e, owned.has(e.id) ? "в листе" : "в списке", false))}
            </div>
          );
        })}
        {unavailable.length > 0 && (
          <div className="dnd-spell-picker-unavailable">
            <div className="dnd-spell-picker-group">
              <span>Недоступные</span>
              <em>берите, если разрешил Мастер</em>
            </div>
            {unavailable.map((e) => pickRow(e, owned.has(e.id) ? "в листе" : unavailableReason(e), true))}
          </div>
        )}
      </div>
      {/* Низ (рестайл Q3–Q4): «снять отметки» — только когда есть что
          снимать; «Добавить N» — чёрной плашкой, пустая — пунктиром. Число
          на кнопке, отдельной строки «Отмечено N» больше нет. */}
      <div className="dnd-spell-picker-foot">
        {pickedSpecial > 0 && (
          <span className="dnd-spell-picker-warn" role="status">
            <span className="dnd-spell-pick-special">особое</span>
            {pickedSpecial === 1 ? "1 недоступное" : `Недоступных: ${pickedSpecial}`} — берите, если разрешил Мастер. В
            листе будет пометка «особое».
          </span>
        )}
        <div className="dnd-spell-picker-actions">
          {picked.size > 0 && (
            <button type="button" className="dnd-spell-picker-clear" onClick={() => setPicked(new Set())}>
              снять отметки
            </button>
          )}
          <button
            type="button"
            className="dnd-spell-picker-add"
            disabled={picked.size === 0}
            onClick={() => {
              onPick(
                [...picked]
                  .map((id) => byId.get(id))
                  .filter((e): e is CompendiumEntry => !!e)
                  .map((e) => ({ level: e.level ?? 0, entry: e, special: isSpecial(e) }))
              );
            }}
          >
            {picked.size > 0 ? `Добавить ${picked.size}` : "отметьте заклинания"}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}

/**
 * Пикер Таинственного арканума (гриллинг 2026-09-27, Q1–Q5, макет на холсте):
 * один экран — вкладки кругов 6/7/8/9 (на вкладке — что взято; закрытые
 * видны «с N ур.» и не нажимаются), под ними список колдуна этого круга
 * строками «Взять заклинания». Щелчок отмечает и раскрывает описание, внизу
 * чёрная плашка «Взять «X»» / «Заменить старое → новое». Окно не
 * закрывается: на 17 уровне брать четыре штуки. Удаления нет — по книге
 * арканум только заменяется.
 */
export function DndArcanumPicker({
  systemId,
  warlockClassId,
  warlockLevel,
  characterName,
  spellsByLevel,
  onPick,
  onClose,
}: {
  systemId: number | null;
  warlockClassId: number | null;
  warlockLevel: number;
  characterName: string;
  spellsByLevel: DndSpellEntry[][];
  /** Замена арканума круга целиком; чужие строки круга не трогаем. */
  onPick: (circleIdx0: number, entry: CompendiumEntry) => void;
  onClose: () => void;
}) {
  const unlocked = arcanumUnlockedCircles(warlockLevel);
  const current = (circle: number) => spellsByLevel[circle - 1]?.find((s) => s.arcanum);
  // Открывается на первом пустом открытом круге: его и пришли заполнять.
  const [circle, setCircle] = useState(() => unlocked.find((c) => !current(c)) ?? unlocked[0] ?? 6);
  const [all, setAll] = useState<CompendiumEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const dialogRef = useOneShotOverlayFocus(".dnd-spell-picker-close");

  useEffect(() => {
    if (!systemId) {
      setAll([]);
      return;
    }
    const ac = new AbortController();
    loadDndSpellIndex(systemId, { signal: ac.signal })
      .then(setAll)
      .catch((e) => {
        if ((e as Error)?.name !== "AbortError") setFailed(true);
      });
    return () => ac.abort();
  }, [systemId]);

  // Escape закрывает (крестик — для пальца), как у списка заклинаний.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cur = current(circle);
  const options =
    warlockClassId == null
      ? []
      : (all ?? []).filter((e) => {
          const refs = Array.isArray(e.data?.classes) ? (e.data.classes as { id?: number }[]) : [];
          return (e.level ?? 0) === circle && refs.some((r) => r.id === warlockClassId);
        });
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((e) => e.name.toLowerCase().includes(q)) : options;
  const chosenEntry = chosen != null ? options.find((e) => e.id === chosen) : undefined;

  const spellMeta = (e: CompendiumEntry): string => {
    const t = spellTimingFromData(e.data).castingTiming;
    return [
      spellSchoolName(e.data?.school),
      t === "action" ? "действие" : t === "bonus" ? "бонусное" : t === "reaction" ? "реакция" : undefined,
      typeof e.data?.range === "string" ? e.data.range : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  };

  return (
    <>
      <div className="dnd-spell-picker-backdrop" aria-hidden="true" onClick={onClose} />
      <div ref={dialogRef} className="dnd-spell-picker dnd-arcanum-picker" role="dialog" aria-modal="true" aria-label="Таинственный арканум" tabIndex={-1}>
        <div className="dnd-spell-picker-head">
          <div className="dnd-spell-picker-title-row">
            <div>
              <div className="dnd-spell-picker-title">Таинственный арканум</div>
              <div className="dnd-spell-picker-sub">
                {characterName && <span className="dnd-arcanum-sub-long">{characterName} · </span>}Колдун {warlockLevel} · по одному на круг<span className="dnd-arcanum-sub-long"> · раз в долгий отдых без ячейки</span>
              </div>
            </div>
            <button type="button" className="dnd-spell-picker-close" onClick={onClose} aria-label="Закрыть">
              <NavIcon name="close" />
            </button>
          </div>
          <div className="dnd-spell-picker-chips dnd-arcanum-tabs" role="tablist" aria-label="Круги арканума">
            {ARCANUM_UNLOCKS.map(({ circle: c, warlockLevel: need }) => {
              const open = unlocked.includes(c);
              const on = open && c === circle;
              return (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  disabled={!open}
                  className={`dnd-pick-chip dnd-arcanum-tab${on ? " is-on" : ""}`}
                  onClick={() => {
                    setCircle(c);
                    setChosen(null);
                    setQuery("");
                  }}
                >
                  <b>{c} круг</b>
                  <span>{open ? stripLatin(current(c)?.name ?? "—") : `с ${need} ур.`}</span>
                </button>
              );
            })}
          </div>
          <label className="dnd-spell-picker-search">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <input
              type="search"
              placeholder="Искать по названию"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Поиск заклинаний по названию"
            />
          </label>
        </div>
        <div className="dnd-spell-picker-list">
          <div className="dnd-spell-picker-group">
            <b>{circle}</b>
            <span>круг · список колдуна</span>
          </div>
          {warlockClassId == null && <p className="muted">Класс без записи справочника — список колдуна не собрать.</p>}
          {failed && <p className="muted">Не удалось загрузить справочник заклинаний.</p>}
          {!failed && all === null && <p className="muted">Загрузка…</p>}
          {!failed && all !== null && warlockClassId != null && shown.length === 0 && (
            <p className="muted">{q ? "Ничего не нашлось." : "В списке колдуна нет заклинаний этого круга."}</p>
          )}
          {shown.map((e) => {
            const taken = cur?.entryId === e.id;
            const isPicked = chosen === e.id;
            const meta = spellMeta(e);
            const school = schoolIconSrc(spellSchoolName(e.data?.school));
            return (
              <Fragment key={e.id}>
                <button
                  type="button"
                  className={`dnd-spell-pick-row${isPicked ? " is-picked" : ""}${taken ? " is-owned" : ""}`}
                  disabled={taken}
                  aria-pressed={isPicked}
                  onClick={() => setChosen((prev) => (prev === e.id ? null : e.id))}
                >
                  <span className="dnd-pick-box" aria-hidden="true">
                    {isPicked && (
                      <svg viewBox="0 0 18 18">
                        <path d="M3 9 L7 13 L15 4" fill="none" stroke="currentColor" strokeWidth="3" />
                      </svg>
                    )}
                  </span>
                  {school ? (
                    <img className="dnd-spell-pick-school" src={school} alt="" draggable={false} />
                  ) : (
                    <span className="dnd-spell-pick-school" aria-hidden="true" />
                  )}
                  <span className="dnd-spell-pick-main">
                    <span className="dnd-spell-pick-name">{stripLatin(e.name)}</span>
                    {meta && <span className="dnd-spell-pick-meta">{meta}</span>}
                  </span>
                  {taken && <span className="dnd-arcanum-taken">взято</span>}
                </button>
                {isPicked && e.description?.trim() && (
                  <div className="dnd-arcanum-desc">
                    <MentionText text={e.description} />
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
        <div className="dnd-spell-picker-foot">
          <div className="dnd-spell-picker-actions">
            {chosenEntry && (
              <button type="button" className="dnd-spell-picker-clear" onClick={() => setChosen(null)}>
                снять отметку
              </button>
            )}
            <button
              type="button"
              className="dnd-spell-picker-add"
              disabled={!chosenEntry}
              onClick={() => {
                if (!chosenEntry) return;
                onPick(circle - 1, chosenEntry);
                setChosen(null);
              }}
            >
              {!chosenEntry ? (
                "отметьте заклинание"
              ) : cur ? (
                <>
                  Заменить <s>{stripLatin(cur.name)}</s> → {stripLatin(chosenEntry.name)}
                </>
              ) : (
                `Взять «${stripLatin(chosenEntry.name)}»`
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// Заклинание, которое на тебя наложил другой (Q10, Q15): в списке только те,
// что меняют числа листа, — остальное листу знать незачем.
export function ReceivedSpellPicker({
  systemId,
  onPick,
  onCancel,
}: {
  systemId: number;
  onPick: (entry: CompendiumEntry) => void;
  onCancel: () => void;
}) {
  const [options, setOptions] = useState<CompendiumEntry[] | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let alive = true;
    loadDndSpellIndex(systemId)
      .then((all) => {
        if (!alive) return;
        const numeric = (e: CompendiumEntry) =>
          ((e.data.effects as DndEffect[] | undefined) ?? []).some(
            (x) => isNumericDefense(x) || (x.type === "roll_modifier" && typeof x.flat === "number")
          );
        setOptions(all.filter(numeric).sort((a, b) => a.name.localeCompare(b.name, "ru")));
      })
      .catch(() => alive && setOptions([]));
    return () => {
      alive = false;
    };
  }, [systemId]);
  const q = query.trim().toLowerCase();
  const rows = (options ?? []).filter((e) => !q || e.name.toLowerCase().includes(q));
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row" style={{ gap: 6 }}>
        <input autoFocus placeholder="Заклинание" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="comp-mini" onClick={onCancel} aria-label="Отмена">
          <NavIcon name="close" />
        </button>
      </div>
      {options === null && <span className="muted">Загрузка…</span>}
      {options !== null && rows.length === 0 && <span className="muted">Ничего не нашлось.</span>}
      {rows.map((e) => (
        <button key={e.id} type="button" className="comp-mini" style={{ alignSelf: "flex-start" }} onClick={() => onPick(e)}>
          {e.name}
        </button>
      ))}
    </div>
  );
}
