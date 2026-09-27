// Лист D&D: происхождение (классы, вид, предыстория) — хук useDndOrigin,
// форма правки, строки классов, заметки классов и снятие выдач.
import type { DndFeature, DndCharacterData, DndClassEntry, System, CompendiumEntry, DndManualAttack, DndEquipmentSection, DndProficiencyEntry } from "../../types";
import { type SourceGrants, mergeGrants, grantsFromEntry } from "./dndGrants";
import { ensureEntries, getCachedEntry } from "./entryCache";
import { memo, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { type DndClassHierarchy, type DndSpeciesOption, type DndBackgroundOption, type DndMechanicsOption, loadDndClassFeatures, isAbortError, errorMessage, findDndSystemId, loadDndMechanicsGroup, loadDndClassHierarchy, loadDndSpeciesOptions, loadDndBackgroundOptions, loadDndSpeciesFeatures } from "./dndCompendium";
import { useConfirm } from "../../hooks/useConfirm";
import { NavIcon } from "../NavIcons";
import { useLatest } from "../../hooks/useEvent";
import { useDndSkills } from "./useDndSkills";
import { computeHitDice, classHitDieCache } from "./SheetRest";
import { computeProficiencyBonus, parseAbilityNames, ABILITY_NAME_TO_KEY } from "./AbilityScores";
import { readResource } from "../../data/imperative";
import { featuresFromEntries } from "./dndFeatures";
import { recomputeGrantedSpells } from "./grantedSpells";

// Поле, чей справочник не загрузился. Остаётся списком — нерабочим, но
// списком, и с кнопкой «Повторить». Свободный ввод на этом месте читается
// как «так и задумано»: мастер вписывает класс руками и теряет связь с
// компендиумом навсегда, а причина (сеть, права, упавший сервер) так и не
// названа (P1-Р8).
function CompendiumFieldError({
  current,
  error,
  onRetry,
}: {
  current: string;
  error: string;
  onRetry: () => void;
}) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <select disabled value="" style={{ flex: 1 }} title={`Справочник не загрузился: ${error}`}>
        <option value="">{current || "Справочник не загрузился"}</option>
      </select>
      <button type="button" className="comp-mini" onClick={onRetry} title={error}>
        Повторить
      </button>
    </span>
  );
}

// Picking a class also writes its "Владения навыками"/"Снаряжение А"/
// "Снаряжение Б" fields into the character's free-text Заметки (labeled, so
// the player can see where they came from), and removing the class removes
// that same block again. The block always starts with a "[Класс: Имя]"
// marker line so it can be found/removed later without touching the rest of
// the player's own notes.
const CLASS_NOTES_LABELS = ["Владения навыками:", "Снаряжение А:", "Снаряжение Б:"];

function classNotesMarker(className: string): string {
  return `[Класс: ${className}]`;
}

function buildClassNotesBlock(className: string, data: Record<string, unknown>): string {
  const skillChoice = Array.isArray(data.skill_choice_options) ? (data.skill_choice_options as string[]) : [];
  const equipmentA = typeof data.equipment_a === "string" ? data.equipment_a : "";
  const equipmentB = typeof data.equipment_b === "string" ? data.equipment_b : "";
  return [
    classNotesMarker(className),
    `Владения навыками: ${skillChoice.join(", ")}`,
    `Снаряжение А: ${equipmentA}`,
    `Снаряжение Б: ${equipmentB}`,
  ].join("\n");
}

function removeClassNotesBlock(notes: string, className: string): string {
  const marker = classNotesMarker(className);
  const lines = notes.split("\n");
  const idx = lines.findIndex((l) => l.trim() === marker);
  if (idx === -1) return notes;
  let end = idx + 1;
  while (end < lines.length && CLASS_NOTES_LABELS.some((label) => lines[end].startsWith(label))) end++;
  lines.splice(idx, end - idx);
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function upsertClassNotesBlock(notes: string, className: string, block: string): string {
  const cleaned = removeClassNotesBlock(notes, className).trim();
  return cleaned ? `${cleaned}\n\n${block}` : block;
}

// Removes any auto-filled features tagged with the given source id(s),
// keeping hand-added features (sourceParentId is unset) and features from
// other sources (other classes, in a multiclass character) untouched.
function removeFeaturesBySource(features: DndFeature[], ...sourceParentIds: (number | null | undefined)[]): DndFeature[] {
  const ids = new Set(sourceParentIds.filter((id): id is number => id != null));
  if (ids.size === 0) return features;
  return features.filter((f) => f.sourceParentId == null || !ids.has(f.sourceParentId));
}

// ---------------------------------------------------------------------------
// Снятие выданного при смене источника.
//
// Класс, подкласс и предыстория не только дают (особенности, спасброски,
// инструменты, навыки, черту происхождения) — их ещё и меняют. Раньше
// снимались только особенности (removeFeaturesBySource); всё остальное
// оставалось навсегда: три смены предыстории давали три черты в списке, а
// Волшебник, побывавший Воином, навсегда сохранял владение спасбросками Силы
// и Телосложения. Ниже — общий разбор «что дал этот источник», чтобы при
// смене снять ровно это и ровно тогда, когда того же не даёт никто другой.
/**
 * Снимает то, что давал ушедший источник, оставляя всё, что подтверждает
 * хоть один из оставшихся (`kept`) — иначе у мультикласса смена одного класса
 * забрала бы спасбросок, положенный по второму.
 *
 * Экспертизу (уровень 2) не трогаем: её ставит не предыстория, а игрок.
 */
function revokeGrants(
  value: DndCharacterData,
  revoked: SourceGrants,
  kept: SourceGrants[]
): Pick<DndCharacterData, "savingThrowProfs" | "proficiencies" | "skillProfs" | "feats"> {
  const keep = mergeGrants(kept);
  const savingThrowProfs = { ...value.savingThrowProfs };
  for (const k of revoked.savingThrows) {
    if (!keep.savingThrows.includes(k)) savingThrowProfs[k] = false;
  }
  const skillProfs = { ...value.skillProfs };
  for (const skill of revoked.skills) {
    if (keep.skills.includes(skill)) continue;
    if ((skillProfs[skill] ?? 0) === 1) skillProfs[skill] = 0;
  }
  const proficiencies = value.proficiencies.filter((p) => {
    const byId = p.entryId != null && revoked.toolIds.includes(p.entryId);
    const byName = !!p.name && revoked.toolNames.includes(p.name);
    if (!byId && !byName) return true;
    const keptById = p.entryId != null && keep.toolIds.includes(p.entryId);
    const keptByName = !!p.name && keep.toolNames.includes(p.name);
    return keptById || keptByName;
  });
  const feats = value.feats.filter(
    (f) => !revoked.featNames.includes(f.name) || keep.featNames.includes(f.name)
  );
  return { savingThrowProfs, proficiencies, skillProfs, feats };
}

// Записи всех источников, кроме уходящего: по ним решается, что оставить.
async function loadGrants(
  ids: (number | null | undefined)[],
  resolve: (raw: string) => string | null
): Promise<SourceGrants[]> {
  const real = ids.filter((id): id is number => typeof id === "number");
  if (real.length === 0) return [];
  await ensureEntries(real);
  return real.map((id) => grantsFromEntry(getCachedEntry(id), resolve));
}

export const NARRATIVE_FIELDS: { key: keyof DndCharacterData; label: string }[] = [
  { key: "personalityTraits", label: "Черты характера" },
  { key: "ideals", label: "Идеалы" },
  { key: "bonds", label: "Привязанности" },
  { key: "flaws", label: "Слабости" },
];

function blankClassRow(): DndClassEntry {
  return { classId: null, className: "", subclassId: null, subclassName: "", level: 1, skillChoiceOptions: [], skillChoiceCount: 0, spellcastingAbility: "" };
}

// Memoized for the same reason as the other heavy sub-sections — needs all
// callback props to be stable-identity (see the ref-backed useMemo block in
// DndCharacterEdit) or the memo is defeated.
const DndClassesEdit = memo(function DndClassesEdit({
  classes,
  hierarchy,
  onChange,
  onPickClass,
  onPickSubclass,
  onLevelChange,
  onRemoveClass,
  loadError,
  onRetryLoad,
}: {
  classes: DndClassEntry[];
  hierarchy: DndClassHierarchy;
  onChange: (v: DndClassEntry[]) => void;
  // Picking/removing a class or subclass, or changing a row's level, also
  // needs to sync the character's Заметки and Классовые особенности, which
  // need the full character value/onChange this sub-component doesn't
  // otherwise have — the parent supplies these handlers for just those
  // interactions.
  onPickClass: (i: number, classId: number | null) => void;
  onPickSubclass: (i: number, subclassId: number | null) => void;
  onLevelChange: (i: number, level: number) => void;
  onRemoveClass: (i: number) => void;
  // Справочник классов не загрузился — поле остаётся списком с причиной,
  // а не подменяется свободным вводом (P1-Р8).
  loadError?: string | null;
  onRetryLoad?: () => void;
}) {
  const [confirmDialog, confirm] = useConfirm();
  const hasCompendiumClasses = hierarchy.classes.length > 0;
  // Lets the level input sit empty mid-edit (so the user can clear it and
  // type a fresh number) without every keystroke snapping back to "1" —
  // that only happens once, on blur, if the field was left empty.
  const [levelText, setLevelText] = useState<Record<number, string>>({});
  // Уровень, который у этой строки уже запрошен, но ещё не вернулся пропом.
  // Уровень — controlled-значение сверху, и несколько щелчков «+» в одном
  // такте видят один и тот же `classes[i].level`: пять щелчков давали 2
  // вместо 6. Считаем от последнего запрошенного, а на приходе нового
  // `classes` (то есть после коммита) память сбрасываем — дальше
  // авторитетен проп.
  const pendingLevels = useRef<Record<number, number>>({});
  useEffect(() => {
    pendingLevels.current = {};
  }, [classes]);

  function update(i: number, patch: Partial<DndClassEntry>) {
    const next = classes.slice();
    next[i] = { ...(next[i] ?? blankClassRow()), ...patch };
    onChange(next);
  }
  function commitLevel(i: number, raw: string) {
    const n = Math.min(20, Math.max(1, Math.round(Number(raw)) || 1));
    setLevelText((prev) => {
      const next = { ...prev };
      delete next[i];
      return next;
    });
    pendingLevels.current[i] = n;
    update(i, { level: n });
    onLevelChange(i, n);
  }
  function stepLevel(i: number, delta: number) {
    const base = pendingLevels.current[i] ?? classes[i].level;
    const n = Math.min(20, Math.max(1, base + delta));
    if (n === base) return;
    pendingLevels.current[i] = n;
    update(i, { level: n });
    onLevelChange(i, n);
  }
  function add() {
    onChange([...classes, blankClassRow()]);
  }

  // Пустой лист показывает строку класса сразу, как вид и предысторию: раньше
  // тут была одна кнопка «+ Добавить класс», и блок читался как «здесь ничего
  // нет» — персонаж без класса уезжал в игру. Строка-заготовка живёт только на
  // экране; в лист она попадает выбранным классом (pickClass достраивает её).
  const rows = classes.length ? classes : [blankClassRow()];
  const blank = classes.length === 0;

  return (
    <div className="stack dnd-classes-block">
      <div className="sb-section" style={{ margin: 0 }}>
        Класс и уровень
      </div>
      {rows.map((c, i) => {
        const subclasses = c.classId != null ? hierarchy.subclassesByClass[c.classId] ?? [] : [];
        const subclassLevelFor = (row: DndClassEntry) =>
          hierarchy.classes.find((cl) => cl.id === row.classId)?.subclassLevel ?? 0;
        // Требования мультикласса — подсказкой у второго и следующих классов.
        // Гейта нет сознательно: домашние правила сплошь и рядом, а лист не
        // вправе запрещать. Первый класс требований не имеет по определению.
        const prereq =
          i > 0 && c.classId != null
            ? (hierarchy.classes.find((cl) => cl.id === c.classId)?.multiclassPrereq ?? "")
            : "";
        return (
          <div key={i} className="row dnd-class-row">
            {hasCompendiumClasses ? (
              <select
                value={c.classId ?? ""}
                onChange={(e) => onPickClass(i, e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Выбрать класс…</option>
                {hierarchy.classes.map((cl) => (
                  <option key={cl.id} value={cl.id}>
                    {cl.name}
                  </option>
                ))}
              </select>
            ) : loadError && onRetryLoad ? (
              <CompendiumFieldError current={c.className} error={loadError} onRetry={onRetryLoad} />
            ) : (
              <input
                placeholder="Класс"
                value={c.className}
                onChange={(e) => update(i, { className: e.target.value })}
              />
            )}
            {!blank &&
              c.classId != null &&
              subclasses.length > 0 &&
              // Подкласс доступен не с первого уровня. Раньше выпадающий
              // список стоял всегда, и ничто не мешало выбрать подкласс
              // Варвару 1 уровня; теперь до нужного уровня вместо списка
              // стоит подсказка, а уже выбранный подкласс не прячем — иначе
              // персонаж с понижённым уровнем потерял бы его молча.
              (subclassLevelFor(c) > c.level && c.subclassId == null ? (
                <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                  подкласс с {subclassLevelFor(c)} уровня
                </span>
              ) : (
                <select
                  value={c.subclassId ?? ""}
                  onChange={(e) => onPickSubclass(i, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Подкласс…</option>
                  {subclasses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ))}
            {!blank && (
            <span className="dnd-class-level-stepper">
              <button
                type="button"
                className="dnd-level-step-btn dnd-level-step-btn-down"
                aria-label="Уровень −1"
                disabled={c.level <= 1}
                onClick={() => stepLevel(i, -1)}
              >
                <NavIcon name="navDown" />
              </button>
              <input
                type="number"
                min={1}
                max={20}
                className="dnd-class-level-input"
                value={levelText[i] ?? c.level}
                // Keystrokes only update local text (instant, no network) —
                // the model level (and the feature/granted-spell resync, which
                // needs a compendium fetch) only commit on blur, so clearing
                // the field to type a fresh number doesn't get stomped by a
                // re-render forcing it back to "1" after every keystroke.
                onChange={(e) => setLevelText((prev) => ({ ...prev, [i]: e.target.value }))}
                onBlur={(e) => commitLevel(i, e.target.value)}
              />
              <button
                type="button"
                className="dnd-level-step-btn dnd-level-step-btn-up"
                aria-label="Уровень +1"
                disabled={c.level >= 20}
                onClick={() => stepLevel(i, 1)}
              >
                <NavIcon name="navUp" />
              </button>
            </span>
            )}
            {!blank && (
            <button
              type="button"
              className="comp-mini"
              title="Убрать класс"
              aria-label="Убрать класс"
              onClick={async () => {
                const ok = await confirm({
                  title: "Убрать класс?",
                  message: c.className
                    ? `«${c.className}» уйдёт из листа вместе со своими особенностями, спасбросками, навыками и инструментами.`
                    : "Строка класса будет убрана.",
                  confirmLabel: "Убрать",
                  danger: true,
                });
                if (ok) onRemoveClass(i);
              }}
            >
              <NavIcon name="close" />
            </button>
            )}
            {prereq && (
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }} title="Требования мультикласса (PHB 2024): домашние правила могут отменять">
                нужно: {prereq}
              </span>
            )}
          </div>
        );
      })}
      {!blank && (
        <button type="button" onClick={add} style={{ alignSelf: "flex-start" }}>
          + Добавить класс
        </button>
      )}
      {confirmDialog}
    </div>
  );
});

// Происхождение персонажа — классы, вид, предыстория — и всё, что они за
// собой тянут: справочники компендиума, выдача и снятие особенностей,
// спасбросков, владений и заклинаний, гашение гонок. Вынесено в хук, потому
// что после роспуска формы правки (гриллинг 2026-09-03) этим пользуется
// карандаш в плашке-шапке, а не только сама форма: происхождение правится
// там, где оно написано.
export function useDndOrigin(
  value: DndCharacterData,
  onChange: (v: DndCharacterData) => void,
  // Справочники компендиума (системы, иерархия классов, виды, предыстории,
  // механики) нужны только когда происхождение действительно правят. Без
  // этого флага каждый открытый лист — включая список статблоков бестиария —
  // лез бы в сеть за пятью справочниками просто чтобы показаться.
  enabled = true
) {
  const [systems, setSystems] = useState<System[]>([]);
  const [hierarchy, setHierarchy] = useState<DndClassHierarchy>({ classes: [], subclassesByClass: {} });
  const [species, setSpecies] = useState<DndSpeciesOption[]>([]);
  const [backgrounds, setBackgrounds] = useState<DndBackgroundOption[]>([]);
  const [damageTypes, setDamageTypes] = useState<DndMechanicsOption[]>([]);
  const [conditionOptions, setConditionOptions] = useState<DndMechanicsOption[]>([]);
  const [senseOptions, setSenseOptions] = useState<DndMechanicsOption[]>([]);
  // Справочник не загрузился. Раньше это было неотличимо от «в компендиуме
  // ничего нет»: пустой список подменял выпадающий список свободным вводом,
  // и мастер вписывал класс руками, теряя связь с компендиумом навсегда
  // (P1-Р8). Теперь поле остаётся списком и говорит, что случилось.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Бампается кнопкой «Повторить» — перезапускает эффекты загрузки.
  const [reloadKey, setReloadKey] = useState(0);
  const reloadOrigin = useCallback(() => {
    setLoadError(null);
    setReloadKey((n) => n + 1);
  }, []);

  // Kept in sync every commit so the field-setter callbacks below can have a
  // permanently stable identity (empty deps) while still always acting on the
  // latest value/onChange — required for React.memo on the heavy child
  // sections (FeatureListEdit ×4, DndEquipmentEdit, DndSpellsEdit,
  // DndProficienciesEdit) to actually skip re-rendering them when an
  // unrelated field on the sheet changes. Without this, a fresh inline
  // arrow function as `onChange` on every render would defeat memo just as
  // much as a fresh `value` object would.
  //
  // Именно `useLatest`, а не присваивание в теле компонента: сеттеры ниже
  // читают реф после `await`, а запись во время рендера отдаёт им значение
  // прохода, который React мог выбросить.
  const valueRef = useLatest(value);
  const onChangeRef = useLatest(onChange);
  const hierarchyRef = useLatest(hierarchy);
  // Сведение имён навыков: встроенные алиасы плюс те, что мастер добавил в
  // справочник. Через реф — сеттеры ниже читают его после `await`.
  const skillsRef = useLatest(useDndSkills(value.systemId));
  // Все пикеры ниже ходят в сеть, а потом пишут в лист. Раньше побеждал тот,
  // чей запрос доехал последним, а не тот, который нажали последним: щёлкнув
  // уровень 1→5 подряд, можно было получить набор особенностей от третьего
  // щелчка. Номер операции отсекает всё, что пришло после начала следующей.
  const opSeqRef = useRef(0);
  const {
    setAttacks,
    setEquipmentSections,
    setSpeciesFeatures,
    setClassFeatures,
    setFeats,
    setSpecialAbilities,
    setProficiencies,
    setSpellsPatch,
    setAbilities,
    setSavingThrowProfs,
    setSkillProfs,
    setNarrativeField,
    setSpellcasting,
    setClasses,
    pickClass,
    pickSubclass,
    changeClassLevel,
    removeClass,
  } = useMemo(() => {
    function set<K extends keyof DndCharacterData>(key: K, v: DndCharacterData[K]) {
      onChangeRef.current({ ...valueRef.current, [key]: v });
    }

    function setClasses(classes: DndClassEntry[]) {
      onChangeRef.current({
        ...valueRef.current,
        classes,
        hitDice: computeHitDice(classes),
        proficiencyBonus: computeProficiencyBonus(classes),
      });
    }

    // Picking a class from the dropdown also fills its Владения
    // навыками/Снаряжение А/Снаряжение Б into Заметки, and its features (up
    // to the row's current level) into Классовые особенности; switching away
    // from a class (or clearing the row) removes both again — including any
    // subclass features, since the subclass resets when the class changes.
    async function pickClass(i: number, classId: number | null) {
      const seq = ++opSeqRef.current;
      const value = valueRef.current;
      const hierarchy = hierarchyRef.current;
      const oldClass = value.classes[i];
      let notes = oldClass?.className ? removeClassNotesBlock(value.notes, oldClass.className) : value.notes;
      let classFeatures = removeFeaturesBySource(value.classFeatures, oldClass?.classId, oldClass?.subclassId);
      // Уходящий класс забирает свои спасброски и инструменты — но только те,
      // которых не даёт ни один из оставшихся источников.
      const revoked = mergeGrants(await loadGrants([oldClass?.classId, oldClass?.subclassId], skillsRef.current.resolve));
      const kept = await loadGrants([
        ...value.classes.filter((_, idx) => idx !== i).flatMap((c) => [c.classId, c.subclassId]),
        value.backgroundId,
      ], skillsRef.current.resolve);
      const cleared = revokeGrants(value, revoked, kept);
      let savingThrowProfs = cleared.savingThrowProfs;
      let proficiencies = cleared.proficiencies;
      const opt = hierarchy.classes.find((cl) => cl.id === classId);
      const nextClasses = value.classes.slice();
      // Строка-заготовка на пустом листе в модели ещё не существует — первый
      // выбранный класс её и создаёт (см. DndClassesEdit).
      nextClasses[i] = {
        ...(nextClasses[i] ?? blankClassRow()),
        classId,
        className: opt?.name ?? "",
        subclassId: null,
        subclassName: "",
        skillChoiceOptions: [],
        skillChoiceCount: 0,
        spellcastingAbility: "",
      };
      if (classId && opt && value.systemId) {
        try {
          const entry = await readResource<CompendiumEntry>(`/systems/entries/${classId}`);
          notes = upsertClassNotesBlock(notes, opt.name, buildClassNotesBlock(opt.name, entry.data));
          nextClasses[i] = {
            ...nextClasses[i],
            // Ключами: из 103 имён в `skill_choice_options` классов по базе
            // владельца 19 не совпадали с листом, и подсветка «от класса» у
            // этих навыков просто не загоралась.
            skillChoiceOptions: (Array.isArray(entry.data.skill_choice_options)
              ? (entry.data.skill_choice_options as string[])
              : []
            )
              .filter((s) => typeof s === "string" && s.trim())
              .map((s) => skillsRef.current.resolve(s) ?? s.trim()),
            skillChoiceCount: typeof entry.data.skill_choice_count === "number" ? entry.data.skill_choice_count : 0,
            spellcastingAbility:
              typeof entry.data.spellcasting_ability === "string" ? entry.data.spellcasting_ability : "",
          };
          const savingThrowKeys = parseAbilityNames(entry.data.saving_throws);
          if (savingThrowKeys.length > 0) {
            savingThrowProfs = { ...savingThrowProfs };
            for (const k of savingThrowKeys) savingThrowProfs[k] = true;
          }
          const toolPicks = Array.isArray(entry.data.tool_profs)
            ? (entry.data.tool_profs as { id: number; name: string }[])
            : [];
          const newTools = toolPicks.filter((t) => !proficiencies.some((p) => p.name === t.name));
          if (newTools.length > 0) {
            // Each tool's governing ability lives on its own compendium
            // entry (data.ability, see CompendiumSection's TOOL_ABILITY_FIELD),
            // not on the class's tool_profs pick — fetch it so the row
            // doesn't come in with the ability unset.
            const abilityKeys = await Promise.all(
              newTools.map(async (t) => {
                try {
                  const toolEntry = await readResource<CompendiumEntry>(`/systems/entries/${t.id}`);
                  const ability = typeof toolEntry.data.ability === "string" ? toolEntry.data.ability : "";
                  return ability ? ABILITY_NAME_TO_KEY[ability] ?? null : null;
                } catch {
                  return null;
                }
              })
            );
            proficiencies = [
              ...proficiencies,
              ...newTools.map((t, idx) => ({ entryId: t.id, name: t.name, abilityKey: abilityKeys[idx] })),
            ];
          }
          // Доспехи — только от первого класса: мультикласс в 5.5 даёт их
          // урезанно, а строки ниже лист читает как полное владение.
          const armorPicks = i === 0 && Array.isArray(entry.data.armor_profs)
            ? (entry.data.armor_profs as { id: number; name: string }[])
            : [];
          const newArmor = armorPicks.filter((a) => a?.name && !proficiencies.some((p) => p.name === a.name));
          if (newArmor.length > 0) {
            proficiencies = [...proficiencies, ...newArmor.map((a) => ({ entryId: a.id ?? null, name: a.name, abilityKey: null }))];
          }
        } catch {
          /* class has no compendium entry — nothing to fill */
        }
        const featureEntries = await loadDndClassFeatures(value.systemId, classId);
        classFeatures = [...classFeatures, ...featuresFromEntries(featureEntries, classId, nextClasses[i].level)];
      }
      const nextValue = {
        ...valueRef.current,
        classes: nextClasses,
        hitDice: computeHitDice(nextClasses),
        notes,
        classFeatures,
        savingThrowProfs,
        proficiencies,
        proficiencyBonus: computeProficiencyBonus(nextClasses),
      };
      // Clearing/reassigning the row's subclass above already dropped its
      // granted spells from nextClasses; recompute picks up that removal
      // (and any species grant that a level change made newly eligible).
      const { cantrips, spellsByLevel, spellSlotLevels } = await recomputeGrantedSpells(nextValue);
      if (seq !== opSeqRef.current) return;
      onChangeRef.current({ ...nextValue, cantrips, spellsByLevel, spellSlotLevels });
    }

    // Same idea as pickClass, but subclasses don't affect Заметки — only
    // Классовые особенности (and any "Обретаемые заклинания", filtered to
    // this class row's own level).
    async function pickSubclass(i: number, subclassId: number | null) {
      const seq = ++opSeqRef.current;
      const value = valueRef.current;
      const hierarchy = hierarchyRef.current;
      const oldClass = value.classes[i];
      let classFeatures = removeFeaturesBySource(value.classFeatures, oldClass?.subclassId);
      // Выдачи подкласса (навыки и инструменты — напр. Орудия милосердия):
      // уходящий подкласс забирает своё, кроме того, что подтверждает
      // оставшееся (класс строки, остальные строки, предыстория). Тем же
      // приёмом, что смена класса и предыстории выше.
      const revoked = mergeGrants(await loadGrants([oldClass?.subclassId], skillsRef.current.resolve));
      const kept = await loadGrants(
        [
          ...value.classes.filter((_, idx) => idx !== i).flatMap((c) => [c.classId, c.subclassId]),
          oldClass?.classId,
          value.backgroundId,
        ],
        skillsRef.current.resolve
      );
      const cleared = revokeGrants(value, revoked, kept);
      let skillProfs = cleared.skillProfs;
      let proficiencies = cleared.proficiencies;
      const subclasses = oldClass?.classId != null ? hierarchy.subclassesByClass[oldClass.classId] ?? [] : [];
      const opt = subclasses.find((s) => s.id === subclassId);
      const nextClasses = value.classes.slice();
      nextClasses[i] = { ...nextClasses[i], subclassId, subclassName: opt?.name ?? "" };
      if (subclassId && value.systemId) {
        const featureEntries = await loadDndClassFeatures(value.systemId, subclassId);
        classFeatures = [
          ...classFeatures,
          ...featuresFromEntries(featureEntries, subclassId, nextClasses[i].level),
        ];
        // Выдача нового подкласса: навыки — владением (не затирая экспертизу
        // и ручные), инструменты — строками (способность подтягивается с
        // записи, как при смене класса).
        try {
          const entry = await readResource<CompendiumEntry>(`/systems/entries/${subclassId}`);
          const grantedSkills = (Array.isArray(entry.data.skills) ? (entry.data.skills as unknown[]) : [])
            .filter((s): s is string => typeof s === "string" && !!s.trim())
            .map((s) => skillsRef.current.resolve(s) ?? s.trim());
          if (grantedSkills.length > 0) {
            const nextSkillProfs = { ...skillProfs };
            for (const s of grantedSkills) if (!nextSkillProfs[s]) nextSkillProfs[s] = 1;
            skillProfs = nextSkillProfs;
          }
          const toolPicks = Array.isArray(entry.data.tool_profs)
            ? (entry.data.tool_profs as { id: number; name: string }[])
            : [];
          const newTools = toolPicks.filter((t) => !proficiencies.some((p) => p.name === t.name));
          if (newTools.length > 0) {
            const abilityKeys = await Promise.all(
              newTools.map(async (t) => {
                try {
                  const toolEntry = await readResource<CompendiumEntry>(`/systems/entries/${t.id}`);
                  const ability = typeof toolEntry.data.ability === "string" ? toolEntry.data.ability : "";
                  return ability ? ABILITY_NAME_TO_KEY[ability] ?? null : null;
                } catch {
                  return null;
                }
              })
            );
            proficiencies = [
              ...proficiencies,
              ...newTools.map((t, idx) => ({ entryId: t.id, name: t.name, abilityKey: abilityKeys[idx] })),
            ];
          }
        } catch {
          /* subclass has no compendium entry — nothing to grant */
        }
      }
      const nextValue = { ...valueRef.current, classes: nextClasses, classFeatures, skillProfs, proficiencies };
      const { cantrips, spellsByLevel, spellSlotLevels } = await recomputeGrantedSpells(nextValue);
      if (seq !== opSeqRef.current) return;
      onChangeRef.current({ ...nextValue, cantrips, spellsByLevel, spellSlotLevels });
    }

    // Re-filters this row's class/subclass features against its new level —
    // raising the level can unlock more, lowering it can drop some. A level
    // change also shifts total character level (species grants) and this
    // row's own level (subclass grants), so granted spells get recomputed
    // in every branch below.
    async function changeClassLevel(i: number, level: number) {
      const seq = ++opSeqRef.current;
      const value = valueRef.current;
      const c = value.classes[i];
      const nextClasses = value.classes.slice();
      nextClasses[i] = { ...c, level };
      const proficiencyBonus = computeProficiencyBonus(nextClasses);
      if (!value.systemId || (c.classId == null && c.subclassId == null)) {
        const nextValue = {
          ...valueRef.current,
          classes: nextClasses,
          hitDice: computeHitDice(nextClasses),
          proficiencyBonus,
        };
        const { cantrips, spellsByLevel, spellSlotLevels } = await recomputeGrantedSpells(nextValue);
        if (seq !== opSeqRef.current) return;
        onChangeRef.current({ ...nextValue, cantrips, spellsByLevel, spellSlotLevels });
        return;
      }
      let classFeatures = removeFeaturesBySource(value.classFeatures, c.classId, c.subclassId);
      if (c.classId != null) {
        const featureEntries = await loadDndClassFeatures(value.systemId, c.classId);
        classFeatures = [...classFeatures, ...featuresFromEntries(featureEntries, c.classId, level)];
      }
      if (c.subclassId != null) {
        const featureEntries = await loadDndClassFeatures(value.systemId, c.subclassId);
        classFeatures = [...classFeatures, ...featuresFromEntries(featureEntries, c.subclassId, level)];
      }
      const nextValue = {
        ...valueRef.current,
        classes: nextClasses,
        hitDice: computeHitDice(nextClasses),
        classFeatures,
        proficiencyBonus,
      };
      const { cantrips, spellsByLevel, spellSlotLevels } = await recomputeGrantedSpells(nextValue);
      if (seq !== opSeqRef.current) return;
      onChangeRef.current({ ...nextValue, cantrips, spellsByLevel, spellSlotLevels });
    }

    // Подтверждение спрашивает вызывающая сторона (DndClassesEdit) — из
    // useMemo-фабрики модалку не показать, а `confirm("удалить ЭТО?")` здесь
    // и был тем самым системным окном, от которого уходим.
    async function removeClass(i: number) {
      const seq = ++opSeqRef.current;
      const value = valueRef.current;
      const removed = value.classes[i];
      const notes = removed?.className ? removeClassNotesBlock(value.notes, removed.className) : value.notes;
      const classFeatures = removeFeaturesBySource(value.classFeatures, removed?.classId, removed?.subclassId);
      const nextClasses = value.classes.filter((_, idx) => idx !== i);
      // Убранный класс забирает спасброски и инструменты с собой.
      const revoked = mergeGrants(await loadGrants([removed?.classId, removed?.subclassId], skillsRef.current.resolve));
      const kept = await loadGrants([
        ...nextClasses.flatMap((c) => [c.classId, c.subclassId]),
        value.backgroundId,
      ], skillsRef.current.resolve);
      const cleared = revokeGrants(value, revoked, kept);
      const nextValue = {
        ...valueRef.current,
        classes: nextClasses,
        hitDice: computeHitDice(nextClasses),
        notes,
        classFeatures,
        savingThrowProfs: cleared.savingThrowProfs,
        proficiencies: cleared.proficiencies,
        proficiencyBonus: computeProficiencyBonus(nextClasses),
      };
      const { cantrips, spellsByLevel, spellSlotLevels } = await recomputeGrantedSpells(nextValue);
      if (seq !== opSeqRef.current) return;
      onChangeRef.current({ ...nextValue, cantrips, spellsByLevel, spellSlotLevels });
    }

    return {
      setAttacks: (v: DndManualAttack[]) => set("attacks", v),
      setEquipmentSections: (v: DndEquipmentSection[]) => set("equipmentSections", v),
      setSpeciesFeatures: (v: DndFeature[]) => set("speciesFeatures", v),
      setClassFeatures: (v: DndFeature[]) => set("classFeatures", v),
      setFeats: (v: DndFeature[]) => set("feats", v),
      setSpecialAbilities: (v: DndFeature[]) => set("specialAbilities", v),
      setProficiencies: (v: DndProficiencyEntry[]) => set("proficiencies", v),
      setSpellsPatch: (
        patch: Partial<Pick<DndCharacterData, "cantrips" | "spellSlotLevels" | "spellSlotPips" | "spellsByLevel">>
      ) => onChangeRef.current({ ...valueRef.current, ...patch }),
      setAbilities: (v: DndCharacterData["abilities"]) => set("abilities", v),
      setSavingThrowProfs: (v: DndCharacterData["savingThrowProfs"]) => set("savingThrowProfs", v),
      setSkillProfs: (v: DndCharacterData["skillProfs"]) => set("skillProfs", v),
      setNarrativeField: (key: keyof DndCharacterData, v: string) => set(key, v as DndCharacterData[typeof key]),
      setSpellcasting: (v: string) => set("spellcasting", v),
      setClasses,
      pickClass,
      pickSubclass,
      changeClassLevel,
      removeClass,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Все три эффекта ниже ходят в сеть и пишут в состояние. Без отмены запрос,
  // начатый до размонтирования или до смены системы, дописывал форму, которой
  // уже нет; без `catch` любая сетевая ошибка уходила в unhandled rejection и
  // на экране выглядела как «в компендиуме пусто».
  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    readResource<System[]>("/systems")
      .then((list) => {
        if (!ac.signal.aborted) setSystems(list);
      })
      .catch((e) => {
        if (!ac.signal.aborted && !isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [enabled, reloadKey]);

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    findDndSystemId()
      .then((sid) => {
        if (!sid || ac.signal.aborted) return;
        const opts = { signal: ac.signal };
        return Promise.all([
          loadDndMechanicsGroup(sid, "Типы урона", opts).then(setDamageTypes),
          loadDndMechanicsGroup(sid, "Состояния", opts).then(setConditionOptions),
          loadDndMechanicsGroup(sid, "Особое восприятие", opts).then(setSenseOptions),
        ]);
      })
      .catch((e) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [enabled, reloadKey]);

  useEffect(() => {
    if (!enabled) return;
    if (!value.systemId) {
      setHierarchy({ classes: [], subclassesByClass: {} });
      setSpecies([]);
      setBackgrounds([]);
      return;
    }
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    const systemId = value.systemId;
    Promise.all([
      loadDndClassHierarchy(systemId, opts).then((h) => {
        setHierarchy(h);
        for (const c of h.classes) classHitDieCache.set(c.id, c.hitDie);
        // Classes picked before the hierarchy finished loading (e.g. a saved
        // statblock reopened) had no hit die available yet — recompute now
        // that classHitDieCache is populated.
        // Через ref, а не через захваченный эффектом `value`: иерархия грузится
        // заметное время, и всё, что мастер успел набрать за это время,
        // затиралось устаревшим снимком.
        const fresh = valueRef.current;
        if (fresh.classes.some((c) => c.classId != null)) {
          onChangeRef.current({ ...fresh, hitDice: computeHitDice(fresh.classes) });
        }
      }),
      loadDndSpeciesOptions(systemId, opts).then(setSpecies),
      loadDndBackgroundOptions(systemId, opts).then(setBackgrounds),
    ]).catch((e) => {
      if (!isAbortError(e)) setLoadError(errorMessage(e));
    });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.systemId, enabled, reloadKey]);

  // Picking a species also fills its Видовые особенности and any
  // "Обретаемые заклинания" the character's total level already qualifies
  // for (always marked prepared); switching away removes the old species'
  // features and granted spells again.
  async function pickRace(id: number | null) {
    const seq = ++opSeqRef.current;
    const opt = species.find((s) => s.id === id);
    let speciesFeatures = removeFeaturesBySource(value.speciesFeatures, value.raceId);
    if (id && value.systemId) {
      const featureEntries = await loadDndSpeciesFeatures(value.systemId, id);
      speciesFeatures = [...speciesFeatures, ...featuresFromEntries(featureEntries, id)];
    }
    const nextValue = {
      ...value,
      speciesFeatures,
      raceId: id,
      raceName: opt?.name ?? "",
      raceTypeName: opt?.creatureTypeName ?? "",
      speed: opt?.walkSpeed ? `${opt.walkSpeed} фт.` : value.speed,
      // Кость скорости читает структуру, а не строку: без этого ходьба вида
      // уходила подписью, а в кости оставался прочерк. walkSpeed вида —
      // строка, в структуру ложится числом.
      speeds: opt?.walkSpeed && Number.isFinite(Number(opt.walkSpeed))
        ? { ...value.speeds, walk: Number(opt.walkSpeed) }
        : value.speeds,
    };
    const { cantrips, spellsByLevel, spellSlotLevels } = await recomputeGrantedSpells(nextValue);
    if (seq !== opSeqRef.current) return;
    // Снимок, от которого считали, устарел на время загрузки — накладываем
    // посчитанное на свежий лист, а не подменяем его целиком.
    onChange({
      ...valueRef.current,
      speciesFeatures: nextValue.speciesFeatures,
      raceId: nextValue.raceId,
      raceName: nextValue.raceName,
      raceTypeName: nextValue.raceTypeName,
      speed: nextValue.speed,
      speeds: nextValue.speeds,
      cantrips,
      spellsByLevel,
      spellSlotLevels,
    });
  }

  // Requirement 5: picking a background also fills in what it grants —
  // skill proficiencies (checked), tool proficiencies (appended as a
  // proficiency row) and the origin feat (appended to Черты, with its full
  // description) — so the player doesn't have to re-enter them by hand.
  async function pickBackground(id: number | null) {
    const seq = ++opSeqRef.current;
    const opt = backgrounds.find((b) => b.id === id);
    // Прежняя предыстория забирает своё: навыки, инструмент и черту
    // происхождения. Раньше не снималось ничего — три смены предыстории
    // оставляли три черты и все накопленные навыки.
    const previous = mergeGrants(await loadGrants([value.backgroundId], skillsRef.current.resolve));
    const revoked: SourceGrants = {
      ...previous,
      // backgroundSkillNames — то, что реально было применено к листу;
      // запись компендиума могла с тех пор измениться.
      skills: [...new Set([...previous.skills, ...value.backgroundSkillNames])],
    };
    const kept = await loadGrants(value.classes.flatMap((c) => [c.classId, c.subclassId]), skillsRef.current.resolve);
    const cleared = revokeGrants(value, revoked, kept);
    const base: DndCharacterData = { ...value, ...cleared };

    const patch: Partial<DndCharacterData> = { backgroundId: id, backgroundName: opt?.name ?? "", backgroundSkillNames: [] };
    if (id) {
      try {
        const entry = await readResource<CompendiumEntry>(`/systems/entries/${id}`);
        // Ключами, а не именами. Здесь и жил дефект: владение ставилось
        // только `if (s in nextSkillProfs)`, то есть если имя из компендиума
        // дословно совпало с именем в листе. По базе владельца из 72 выдач
        // так молча терялись 15 — «Расследование», «Внимательность»,
        // «Аркана» и прочие написания того же навыка.
        const grantedSkills = (Array.isArray(entry.data.skills) ? (entry.data.skills as string[]) : [])
          .filter((s) => typeof s === "string" && s.trim())
          .map((s) => skillsRef.current.resolve(s) ?? s.trim());
        patch.backgroundSkillNames = grantedSkills;
        if (grantedSkills.length > 0) {
          const nextSkillProfs = { ...base.skillProfs };
          // Ставим владение и тому навыку, которого в листе ещё нет: иначе
          // навык, заведённый мастером, предысторией не выдавался бы.
          for (const s of grantedSkills) if (!nextSkillProfs[s]) nextSkillProfs[s] = 1;
          patch.skillProfs = nextSkillProfs;
        }
        const tools = typeof entry.data.tools === "string" ? entry.data.tools : "";
        if (tools && !base.proficiencies.some((p) => p.name === tools)) {
          patch.proficiencies = [...base.proficiencies, { entryId: null, name: tools, abilityKey: null }];
        }
        const originFeat = entry.data.origin_feat as { id: number; name: string } | undefined;
        if (originFeat && !base.feats.some((f) => f.name === originFeat.name)) {
          let description = "";
          try {
            const featEntry = await readResource<CompendiumEntry>(`/systems/entries/${originFeat.id}`);
            description = featEntry.description || "";
          } catch {
            /* feat entry missing — leave description blank */
          }
          patch.feats = [...base.feats, { name: originFeat.name, description, entryId: originFeat.id }];
        }
      } catch {
        /* background has no compendium entry (freehand) — nothing to fill */
      }
    }
    if (seq !== opSeqRef.current) return;
    onChange({ ...valueRef.current, ...cleared, ...patch });
  }

  return {
    systems,
    hierarchy,
    species,
    backgrounds,
    damageTypes,
    conditionOptions,
    senseOptions,
    loadError,
    reloadOrigin,
    setAttacks,
    setEquipmentSections,
    setSpeciesFeatures,
    setClassFeatures,
    setFeats,
    setSpecialAbilities,
    setProficiencies,
    setSpellsPatch,
    setAbilities,
    setSavingThrowProfs,
    setSkillProfs,
    setNarrativeField,
    setSpellcasting,
    setClasses,
    pickClass,
    pickSubclass,
    changeClassLevel,
    removeClass,
    pickRace,
    pickBackground,
  };
}

/**
 * Правка основной информации карты: имя, игрок, классы, вид, предыстория,
 * мировоззрение, система. Поля сохраняются мгновенно (тот же onQuickUpdate,
 * что у всего листа), поэтому кнопки «сохранить данные» здесь нет: внешний
 * «Сохранить» лишь закрывает панель. Одна на два входа — ?edit=1 и
 * десктопную раскрывашку в правой колонке, чтобы не разъехались.
 */
export function DndOriginEditForm({
  origin,
  value,
  onQuickUpdate,
  identityOnly,
}: {
  origin: ReturnType<typeof useDndOrigin>;
  value: DndCharacterData;
  onQuickUpdate: (patch: Partial<DndCharacterData>) => void;
  // «Редактировать» на обороте: только имя, игрок и мировоззрение. Класс, вид
  // и предыстория меняются пересборкой в визарде — строкой их менять
  // бессмысленно, механика оставалась прежней (гриллинг 2026-09-25, Q1).
  identityOnly?: boolean;
}) {
  return (
    <div className="sb-origin-edit stack">
      <div className="row">
        <label style={{ flex: 1 }}>
          Имя персонажа
          <input
            value={value.characterName}
            onChange={(e) => onQuickUpdate({ characterName: e.target.value })}
          />
        </label>
        <label style={{ flex: 1 }}>
          Игрок
          <input value={value.playerName} onChange={(e) => onQuickUpdate({ playerName: e.target.value })} />
        </label>
      </div>

      {!identityOnly && (
      <DndClassesEdit
        classes={value.classes}
        hierarchy={origin.hierarchy}
        onChange={origin.setClasses}
        onPickClass={origin.pickClass}
        onPickSubclass={origin.pickSubclass}
        onLevelChange={origin.changeClassLevel}
        onRemoveClass={origin.removeClass}
        loadError={origin.loadError}
        onRetryLoad={origin.reloadOrigin}
      />
      )}

      <div className="row">
        {!identityOnly && (
        <>
        <label style={{ flex: 1 }}>
          Вид
          {origin.species.length > 0 ? (
            <select
              value={value.raceId ?? ""}
              onChange={(e) => origin.pickRace(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Выбрать вид…</option>
              {origin.species.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.creatureTypeName ? `${sp.name}, ${sp.creatureTypeName}` : sp.name}
                </option>
              ))}
            </select>
          ) : origin.loadError ? (
            <CompendiumFieldError
              current={value.raceName}
              error={origin.loadError}
              onRetry={origin.reloadOrigin}
            />
          ) : (
            <input value={value.raceName} onChange={(e) => onQuickUpdate({ raceName: e.target.value })} />
          )}
        </label>
        <label style={{ flex: 1 }}>
          Предыстория
          {origin.backgrounds.length > 0 ? (
            <select
              value={value.backgroundId ?? ""}
              onChange={(e) => origin.pickBackground(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Выбрать предысторию…</option>
              {origin.backgrounds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : origin.loadError ? (
            <CompendiumFieldError
              current={value.backgroundName}
              error={origin.loadError}
              onRetry={origin.reloadOrigin}
            />
          ) : (
            <input
              value={value.backgroundName}
              onChange={(e) => onQuickUpdate({ backgroundName: e.target.value })}
            />
          )}
        </label>
        </>
        )}
        <label>
          Мировоззрение
          <input value={value.alignment} onChange={(e) => onQuickUpdate({ alignment: e.target.value })} />
        </label>
      </div>

    </div>
  );
}
