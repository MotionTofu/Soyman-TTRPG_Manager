import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { CompendiumEntry, DndAbilityScores, DndCharacterData } from "../../types";
import { Modal } from "../Modal";
import { EntryBlurb } from "./DndCharacterWizard";
import { featuresFromEntries } from "./dndFeatures";
import {
  ABILITY_LABELS,
  ABILITY_NAME_TO_KEY,
  abilityModifier,
  computeProficiencyBonus,
  formatModifier,
} from "./AbilityScores";
import {
  errorMessage,
  findDndSystemId,
  isAbortError,
  loadDndClassFeatures,
  loadDndClassHierarchy,
  loadDndFeatsByCategory,
  type DndClassHierarchy,
  type DndFeatOption,
} from "./dndCompendium";
import { recomputeGrantedSpells } from "./DndCharacterForm";
import {
  cantripsAtLevel,
  preparedAtLevel,
  resourcesAtLevel,
  spellSlotsAtLevel,
  type ClassProgression,
} from "./progression";

// Визард левелапа: один уровень вверх (N→N+1) за раз, модалкой с оборота
// заглавной карты. Скелет — правилами (хиты, чертоуровни, подкласс),
// мясо — данными (новые умения, заклинания). Мультикласс не разводит:
// качается выбранная строка класса, слоты многоклассовья — на листе.
const FEAT_LEVELS_BASE = [4, 8, 12, 16, 19];
function featLevelsFor(className: string): number[] {
  // Матчим и русские, и английские имена: хоумбрю-классы иначе пролетают
  // мимо чертоуровней молча.
  const cn = className.toLowerCase();
  const isFighter = cn.includes("воин") || cn.includes("fighter");
  const isRogue = cn.includes("плут") || cn.includes("rogue");
  const extra = isFighter ? [6, 14] : isRogue ? [10] : [];
  return [...FEAT_LEVELS_BASE, ...extra];
}
const ASI_NAMES = ["Улучшение характеристик", "Увеличение характеристик"];

function parseDie(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = /\d+/.exec(raw);
  return m ? Number(m[0]) : null;
}
function parseFeatMinLevel(prereq: unknown): number | null {
  if (typeof prereq !== "string") return null;
  const m = /Уровень\s*(\d+)\s*\+/.exec(prereq);
  return m ? Number(m[1]) : null;
}

interface Props {
  value: DndCharacterData;
  onApply: (patch: Partial<DndCharacterData>) => void;
  onClose: () => void;
}

type HpMode = "roll" | "average" | "manual";

export function DndLevelUpWizard({ value, onApply, onClose }: Props) {
  const [clsIdx, setClsIdx] = useState(0);
  const cls = value.classes[Math.min(clsIdx, Math.max(0, value.classes.length - 1))] ?? null;
  const oldLevel = cls?.level ?? 1;
  // Выше 20 некуда: визард показывает потолок, а не ломается.
  const newLevel = Math.min(20, oldLevel + 1);
  const capped = oldLevel >= 20;

  const [systemId, setSystemId] = useState<number | null>(value.systemId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hierarchy, setHierarchy] = useState<DndClassHierarchy>({ classes: [], subclassesByClass: {} });
  const [classEntry, setClassEntry] = useState<CompendiumEntry | null>(null);
  const [classFeatureEntries, setClassFeatureEntries] = useState<CompendiumEntry[]>([]);
  const [subFeatureEntries, setSubFeatureEntries] = useState<CompendiumEntry[]>([]);
  const [featPool, setFeatPool] = useState<DndFeatOption[]>([]);
  const [featEntry, setFeatEntry] = useState<CompendiumEntry | null>(null);

  const [step, setStep] = useState("Хиты");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [hpMode, setHpMode] = useState<HpMode>("average");
  const [rolled, setRolled] = useState<number | null>(null);
  const [manualTotal, setManualTotal] = useState("");
  const [misc, setMisc] = useState(value.hpMiscPerLevel ?? 0);

  const [subclassId, setSubclassId] = useState<number | null>(null);
  const [featId, setFeatId] = useState<number | null>(null);
  const [asiPrimary, setAsiPrimary] = useState<string | null>(null);
  const [asiSecondary, setAsiSecondary] = useState<string | null>(null);

  useEffect(() => {
    if (value.systemId != null) return;
    let alive = true;
    findDndSystemId()
      .then((sid) => alive && setSystemId(sid))
      .catch((e) => alive && !isAbortError(e) && setLoadError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [value.systemId]);

  useEffect(() => {
    if (!systemId || !cls?.classId) {
      setHierarchy({ classes: [], subclassesByClass: {} });
      setClassEntry(null);
      setClassFeatureEntries([]);
      return;
    }
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    loadDndClassHierarchy(systemId, opts)
      .then(setHierarchy)
      .catch((e) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    api
      .get<CompendiumEntry>(`/systems/entries/${cls.classId}`, { signal: ac.signal })
      .then(setClassEntry)
      .catch((e) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    loadDndClassFeatures(systemId, cls.classId, opts)
      .then(setClassFeatureEntries)
      .catch((e) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [systemId, cls?.classId]);

  const classOption = hierarchy.classes.find((c) => c.id === cls?.classId);
  const die =
    parseDie(classEntry?.data.hit_die) ?? parseDie(classEntry?.data.hitDie) ?? parseDie(classOption?.hitDie);
  const subclassLevel =
    typeof classEntry?.data.subclass_level === "number"
      ? (classEntry.data.subclass_level as number)
      : (classOption?.subclassLevel ?? 3);
  const subclassOptions = cls?.classId ? hierarchy.subclassesByClass[cls.classId] ?? [] : [];
  const subclassOffered = !capped && subclassOptions.length > 0 && !cls?.subclassId && subclassLevel <= newLevel;

  const featLevels = featLevelsFor(cls?.className ?? "");
  const isFeatLevel = !capped && featLevels.includes(newLevel);

  useEffect(() => {
    if (!systemId || !isFeatLevel) {
      setFeatPool([]);
      return;
    }
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    const cats = ["Универсальная Черта", ...(newLevel >= 19 ? ["Эпический дар", "Эпическая черта"] : [])];
    Promise.all(cats.map((c) => loadDndFeatsByCategory(systemId, c, opts)))
      .then((lists) => {
        const seen = new Set<string>();
        setFeatPool(
          lists.flat().filter((f) => {
            if (seen.has(f.name)) return false;
            seen.add(f.name);
            return true;
          })
        );
      })
      .catch((e) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [systemId, isFeatLevel, newLevel]);

  useEffect(() => {
    if (!featId) {
      setFeatEntry(null);
      return;
    }
    const ac = new AbortController();
    api
      .get<CompendiumEntry>(`/systems/entries/${featId}`, { signal: ac.signal })
      .then(setFeatEntry)
      .catch((e) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [featId]);

  useEffect(() => {
    const sid = subclassId ?? cls?.subclassId;
    if (!systemId || !sid) {
      setSubFeatureEntries([]);
      return;
    }
    const ac = new AbortController();
    loadDndClassFeatures(systemId, sid, { signal: ac.signal })
      .then(setSubFeatureEntries)
      .catch((e) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, subclassId, cls?.subclassId]);

  // Новые умения уровня: записи с level === newLevel минус уже лежащие.
  // Новый подкласс — всё положенное ≤ уровню; существующий — только этот
  // уровень (иначе ап 6→7 молча не давал умений подкласса, а новый
  // подкласс сыпал всё до 18-го — аудит).
  const existingFeatureIds = new Set([
    ...value.classFeatures.map((f) => f.entryId),
    ...value.speciesFeatures.map((f) => f.entryId),
  ]);
  const newClassFeatures = classFeatureEntries.filter(
    (e) => e.level === newLevel && !existingFeatureIds.has(e.id)
  );
  const pickedSubId = subclassId ?? cls?.subclassId ?? null;
  const newSubFeatures = (pickedSubId ? subFeatureEntries : []).filter((e) => {
    const lvl = e.level ?? 0;
    if (subclassId) return lvl <= newLevel && !existingFeatureIds.has(e.id);
    return lvl === newLevel && !existingFeatureIds.has(e.id);
  });
  const newFeatureNames = [...newClassFeatures, ...newSubFeatures].map((e) => e.name);

  // Таблица прогрессии класса: дельта ячеек, заговоров, подготовленных, ресурсов.
  const progression = classEntry?.data.progression as ClassProgression | undefined;
  const slotDelta = (() => {
    if (!progression) return null;
    const before = spellSlotsAtLevel(progression, oldLevel) ?? [];
    const after = spellSlotsAtLevel(progression, newLevel) ?? [];
    const parts: string[] = [];
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      const b = before[i] ?? 0;
      const a = after[i] ?? 0;
      if (a !== b) parts.push(`${i + 1} круг: ${b} → ${a}`);
    }
    return parts;
  })();
  const cantripDelta = (() => {
    if (!progression) return null;
    const b = cantripsAtLevel(progression, oldLevel);
    const a = cantripsAtLevel(progression, newLevel);
    return b != null && a != null && a !== b ? { before: b, after: a } : null;
  })();
  const preparedDelta = (() => {
    if (!progression) return null;
    const b = preparedAtLevel(progression, oldLevel);
    const a = preparedAtLevel(progression, newLevel);
    return b != null && a != null && a !== b ? { before: b, after: a } : null;
  })();
  const resourceDelta = (() => {
    if (!progression) return [];
    const b = resourcesAtLevel(progression, oldLevel);
    const a = resourcesAtLevel(progression, newLevel);
    return a.filter((r) => !b.some((x) => x.key === r.key && x.value === r.value));
  })();

  // Черта шага: фильтр по парсимому «Уровень N+», остальное текстом.
  //
  // Требования берутся из самого списка (`prerequisite` едет в DndFeatOption).
  // Раньше запись догружалась только для УЖЕ выбранной черты, поэтому до
  // выбора список был полным: игрок выбирал недоступную, она исчезала из
  // списка, селект обнулялся, а объяснением была приглушённая строка
  // (аудит 09.09, В4). Теперь недоступного в списке нет вовсе.
  const blockedFeats = new Set(
    featPool.filter((f) => (parseFeatMinLevel(f.prerequisite) ?? 0) > newLevel).map((f) => f.id)
  );
  const availableFeats = featPool.filter((f) => !blockedFeats.has(f.id));
  const chosenFeat = availableFeats.find((f) => f.id === featId) ?? null;
  const chosenFeatEntry = featId != null ? featEntry : null;
  const isAsi = chosenFeat != null && ASI_NAMES.includes(chosenFeat.name);

  // ВЫН после возможного ПУХ в этом же визарде — превью честное.
  const conBonus = isAsi
    ? (asiPrimary === "Телосложение" ? 2 : 0) + (asiSecondary === "Телосложение" ? 1 : 0)
    : 0;
  const conMod = abilityModifier(Math.min(20, (value.abilities.con ?? 10) + conBonus));
  const hasTough =
    value.feats.some((f) => f.name.includes("Крепкий")) || (chosenFeat?.name.includes("Крепкий") ?? false);

  // Движок хитов знает две модели, и путать их нельзя.
  //
  // 1. Разобранный лист (визард создания, любой прошлый левелап): `hpLump` —
  //    ТОЛЬКО кубовая часть, без ВЫН. Полный максимум собирается здесь:
  //    lump + броски + ВЫН×уровень + прочее×уровень.
  // 2. Легаси-лист (`hpLump` нет вовсе): импорт из LSS, ручное заведение, всё
  //    старше реворка. В `hitPointMax` лежит ПОЛНЫЙ максимум, где ВЫН за все
  //    прошлые уровни уже посчитан.
  //
  // Раньше вторая модель подставлялась в первую формулу — и ВЫН прибавлялся
  // вторично за каждый уровень: Колдун 9 с ВЫН 16 и максимумом 81 получал
  // «81 → 116» вместо «81 → 89» (аудит 09.09, К1). Прошлое такого листа
  // неизвестно и восстановлению не подлежит, поэтому легаси считается
  // дельтой: к сохранённому максимуму прибавляется только то, что даёт ЭТОТ
  // уровень. Ретро-часть добавляется отдельно и только за то, что изменилось
  // прямо сейчас (ПУХ в Телосложение, взятый «Крепкий», правка «прочих») —
  // такие прибавки по правилам ложатся на все уровни разом.
  // ВЫН и «за уровень» считаются от уровня ПЕРСОНАЖА, а не качаемой строки:
  // хиты за Телосложение даёт каждый уровень, чей бы он ни был. С одним
  // классом эти числа совпадают, поэтому промах был не виден; у мультикласса
  // ап второй строки 2→3 давал «89 → 73» — минус шестнадцать хитов
  // (найдено при проверке К2, 09.09).
  const totalLevelBefore = value.classes.reduce((n, c) => n + (c.level || 0), 0);
  const totalLevelAfter = value.classes.reduce(
    (n, c, i) => n + (i === clsIdx ? newLevel : c.level || 0),
    0
  );
  const isLegacyHp = value.hpLump == null;
  const baseLump = value.hpLump ?? 0;
  const baseRolls = value.hpRolls ?? [];
  const perLevelBonus = (hasTough ? 2 : 0) + (misc || 0);
  const dieAvg = die != null ? Math.floor(die / 2) + 1 : null;

  const gainDie = hpMode === "roll" ? rolled : hpMode === "average" ? dieAvg : null;
  const curMax = Number.parseInt(value.hitPointMax || "0", 10) || 0;
  // Что у листа было до этого визарда — точка отсчёта ретро-части.
  const conModBefore = abilityModifier(value.abilities.con ?? 10);
  const perLevelBonusBefore =
    (value.feats.some((f) => f.name.includes("Крепкий")) ? 2 : 0) + (value.hpMiscPerLevel ?? 0);
  const retroPerLevel = conMod - conModBefore + (perLevelBonus - perLevelBonusBefore);
  const autoMaxRaw =
    die == null
      ? null
      : isLegacyHp
        ? curMax + (gainDie ?? 0) + conMod + perLevelBonus + retroPerLevel * totalLevelBefore
        : baseLump +
          baseRolls.reduce((a, b) => a + b, 0) +
          (gainDie ?? 0) +
          conMod * totalLevelAfter +
          perLevelBonus * totalLevelAfter;
  // Итог хитов не может уйти в ноль/минус (отрицательный ВЫН + misc).
  const autoMax = autoMaxRaw != null ? Math.max(1, autoMaxRaw) : null;
  // Ручной итог: история бросков сносится, lump пересчитывается из математики —
  // число не магия, формула видна.
  const manualNum = Number.parseInt(manualTotal.trim(), 10);
  const manualValid = manualTotal.trim() !== "" && Number.isFinite(manualNum) && manualNum > 0;
  const manualLump =
    manualValid && die != null
      ? manualNum - (conMod + perLevelBonus) * totalLevelAfter
      : null;
  const newMax = hpMode === "manual" ? (manualValid ? manualNum : null) : autoMax;
  const delta = newMax != null ? newMax - curMax : null;

  const STEPS = [
    "Хиты",
    "Новое",
    ...(subclassOffered ? ["Подкласс"] : []),
    ...(isFeatLevel ? ["Черта"] : []),
    "Заклинания",
    "Обзор",
  ];
  const stepIndex = Math.max(0, STEPS.indexOf(step));
  // Набор шагов условный (Подкласс/Черта): смена класса может убрать шаг,
  // на котором стоим, — тогда откатываемся на первый, а не в пустоту.
  useEffect(() => {
    if (!STEPS.includes(step)) setStep(STEPS[0]);
    // STEPS собирается каждый рендер — зависимость по флагам, а не по ней.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subclassOffered, isFeatLevel]);
  // Бросок привязан к кости: смена кости делает старый бросок чужим.
  useEffect(() => {
    setRolled(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [die]);
  function go(s: string) {
    setStep(s);
  }
  function next() {
    setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]);
  }
  function back() {
    setStep(STEPS[Math.max(0, stepIndex - 1)]);
  }
  const hpReady =
    die == null ? hpMode === "manual" && manualValid : hpMode === "roll" ? rolled != null : hpMode === "average" ? true : manualValid;
  const featReady = !isFeatLevel || (featId != null && (!isAsi || asiPrimary != null));
  const subReady = !subclassOffered || subclassId != null;
  // Шаги не залочены (можно заглянуть вперёд), поэтому готовность нужна
  // и на кнопке «Взять уровень», а не только на «Далее» шагов.
  const applyBlocked = !hpReady || !subReady || !featReady;
  const nextBlocked =
    (step === "Хиты" && !hpReady) ||
    (step === "Подкласс" && !subReady) ||
    (step === "Черта" && !featReady);

  function rollDie() {
    if (die == null) return;
    setRolled(1 + Math.floor(Math.random() * die));
  }

  async function finish() {
    if (capped) return;
    setSaving(true);
    setSaveError(null);
    try {
      const nextClasses = value.classes.map((c, i) =>
        i === clsIdx
          ? {
              ...c,
              level: newLevel,
              subclassId: subclassId ?? c.subclassId,
              // Имя подкласса затираем только при новом выборе; иначе сносили
              // существующее (аудит: ап ЭК 4→5 стирал «Мистический рыцарь»).
              subclassName: subclassId ? "" : (c.subclassName ?? ""),
            }
          : c
      );
      if (subclassId) {
        const sub = subclassOptions.find((s) => s.id === subclassId);
        nextClasses[clsIdx] = { ...nextClasses[clsIdx], subclassName: sub?.name ?? "" };
      }
      const addedFeatures = [
        ...featuresFromEntries(classFeatureEntries, cls?.classId ?? 0, newLevel).filter(
          (f) => f.level === newLevel && !existingFeatureIds.has(f.entryId)
        ),
        // Новый подкласс — всё положенное на уровень и ниже; существующий —
        // только умения нового уровня. Раньше было наоборот: новому
        // сыпалось всё до 18-го, существующему — ничего (аудит).
        ...(subclassId
          ? featuresFromEntries(subFeatureEntries, subclassId, newLevel).filter(
              (f) => !existingFeatureIds.has(f.entryId)
            )
          : cls?.subclassId
            ? featuresFromEntries(subFeatureEntries, cls.subclassId, newLevel).filter(
                (f) => f.level === newLevel && !existingFeatureIds.has(f.entryId)
              )
            : []),
      ];
      const nextAbilities: DndAbilityScores = { ...value.abilities };
      if (isAsi) {
        const bump = (name: string | null, by: number) => {
          if (!name) return;
          const key = ABILITY_NAME_TO_KEY[name];
          if (!key) return;
          nextAbilities[key] = Math.min(20, (nextAbilities[key] ?? 10) + by);
        };
        bump(asiPrimary, 2);
        bump(asiSecondary, 1);
      }
      // Кость хитов качаемой СТРОКИ, а не «всех сегментов этой кости».
      // Раньше выбрасывались все сегменты с текущей костью и дописывался один:
      // у Воина 3 (к10) + Паладина 2 (к10) ап паладина превращал «3к10 + 2к10»
      // в «3к10» — пять костей хитов молча становились тремя (аудит 09.09, К2).
      // Понимаем и кириллическую «к», и латинскую k (старые записи).
      const segRe = /(\d+)\s*[кk]\s*(\d+)/g;
      const segs = [...value.hitDice.matchAll(segRe)].map((m) => ({
        n: Number(m[1]),
        d: Number(m[2]),
      }));
      let nextSegs = segs;
      if (die != null) {
        if (segs.length === value.classes.length) {
          // Строка строке: сегменты собраны в порядке классов (computeHitDice),
          // поэтому качаемый — просто свой по счёту.
          nextSegs = segs.map((s, i) => (i === clsIdx ? { n: newLevel, d: die } : s));
        } else {
          // Поровну не набралось (импорт из LSS пишет одну строку, старые листы
          // правились руками): меняем ОДИН сегмент своей кости, у которого счёт
          // совпал со старым уровнем; не нашли — дописываем свой, чужие целы.
          const at = segs.findIndex((s) => s.d === die && s.n === oldLevel);
          nextSegs =
            at >= 0
              ? segs.map((s, i) => (i === at ? { n: newLevel, d: die } : s))
              : [...segs, { n: newLevel, d: die }];
        }
      }
      const hitDice = die != null ? nextSegs.map((s) => `${s.n}к${s.d}`).join(" + ") : value.hitDice;

      const finalMax = newMax ?? curMax;
      // Новый уровень поднимает и текущие хиты, а не только максимум: иначе
      // персонаж, вставший на уровень целым, оказывается 81/89 (аудит 09.09, В5).
      // Раненый лечится ровно на прибавку, а не «до полных» — уровень хиты
      // прибавляет, но ран не залечивает.
      const curNow = Number.parseInt(value.hitPointsCurrent || "", 10);
      const nextCurrent = Number.isFinite(curNow)
        ? String(Math.min(finalMax, curNow + Math.max(0, finalMax - curMax)))
        : String(finalMax);

      let hpPatch: Partial<DndCharacterData>;
      if (hpMode === "manual" && manualLump != null) {
        hpPatch = {
          hitPointMax: String(manualNum),
          hitPointsCurrent: nextCurrent,
          hpLump: manualLump,
          hpRolls: [],
          hpMiscPerLevel: misc || 0,
        };
      } else if (isLegacyHp) {
        // Легаси-лист переводится на общую модель прямо здесь: кубовую часть
        // выводим обратной формулой из уже посчитанного честного максимума,
        // бросок этого уровня сохраняем историей. Со следующего апа лист
        // считается общей веткой — модель самолечится за один уровень.
        hpPatch = {
          hitPointMax: String(finalMax),
          hitPointsCurrent: nextCurrent,
          hpLump: finalMax - (gainDie ?? 0) - (conMod + perLevelBonus) * totalLevelAfter,
          hpRolls: gainDie != null ? [gainDie] : [],
          hpMiscPerLevel: misc || 0,
        };
      } else {
        hpPatch = {
          hitPointMax: String(finalMax),
          hitPointsCurrent: nextCurrent,
          hpLump: baseLump,
          hpRolls: [...baseRolls, ...(gainDie != null ? [gainDie] : [])],
          hpMiscPerLevel: misc || 0,
        };
      }

      const nextFeats = [...value.feats];
      // Дубль черты не кладём (аудит: повторный заход плодил строки).
      if (chosenFeat && !value.feats.some((f) => f.name === chosenFeat.name)) {
        nextFeats.push({
          name: chosenFeat.name,
          description: chosenFeatEntry?.description ?? "",
          entryId: chosenFeat.id,
        });
      }

      const nextValue: DndCharacterData = {
        ...value,
        classes: nextClasses,
        abilities: nextAbilities,
        classFeatures: [...value.classFeatures, ...addedFeatures],
        proficiencyBonus: computeProficiencyBonus(nextClasses),
        hitDice,
        feats: nextFeats,
        ...hpPatch,
      };
      const { cantrips, spellsByLevel, spellSlotLevels } = await recomputeGrantedSpells(nextValue);
      onApply({ ...hpPatch, classes: nextClasses, abilities: nextAbilities, classFeatures: nextValue.classFeatures, proficiencyBonus: nextValue.proficiencyBonus, hitDice, feats: nextFeats, cantrips, spellsByLevel, spellSlotLevels });
      onClose();
    } catch (e) {
      setSaveError(
        e instanceof Error && e.message
          ? `Не удалось применить уровень: ${e.message}`
          : "Не удалось применить уровень — попробуйте ещё раз."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} closeOnBackdropClick={false} ariaLabel="Новый уровень">
      <div className="card stack wizard">
        <div className="campaign-player-header">
          <span>Новый уровень</span>
          <span>
            {cls?.className ?? "Класс"} {oldLevel} → {newLevel} · Шаг {stepIndex + 1} из {STEPS.length}
          </span>
        </div>
        <div className="row wizard-step-row">
          {/* Мобильный пикер вместо ленты табов — тот же приём, что в визарде создания. */}
          <select
            className="wizard-step-picker"
            aria-label="Шаг повышения уровня"
            value={STEPS.includes(step) ? step : STEPS[0]}
            onChange={(e) => go(e.target.value)}
          >
            {STEPS.map((s, i) => (
              <option key={s} value={s}>
                {i + 1}. {s}
              </option>
            ))}
          </select>
        </div>
        <div className="tabs wizard-steps-tabs" role="tablist" aria-label="Шаги левелапа">
          {STEPS.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={step === s}
              aria-current={step === s ? "step" : undefined}
              className={step === s ? "active" : ""}
              onClick={() => go(s)}
            >
              {s}
            </button>
          ))}
        </div>

        {value.classes.length > 1 && (
          <label className="row">
            Класс
            <select
              value={clsIdx}
              onChange={(e) => {
                // Смена строки — новый контекст: подкласс, черта и прибавки
                // от старой строки недействительны (аудит: чужой подкласс
                // применялся к другому классу).
                setClsIdx(Number(e.target.value));
                setSubclassId(null);
                setFeatId(null);
                setAsiPrimary(null);
                setAsiSecondary(null);
                setRolled(null);
              }}
            >
              {value.classes.map((c, i) => (
                <option key={i} value={i}>
                  {c.className} {c.level}
                </option>
              ))}
            </select>
          </label>
        )}

        {capped ? (
          <span className="muted">20-й уровень — потолок, дальше только эпические дары вручную на листе.</span>
        ) : (
          <>
            {step === "Хиты" && (
              <div className="stack">
                <fieldset className="row wizard-fieldset">
                  <legend className="muted wizard-legend">Как получить хиты уровня</legend>
                  <label className="row">
                    <input type="radio" name="lvl-hp-mode" checked={hpMode === "average"} onChange={() => setHpMode("average")} />
                    Среднее ({die != null ? `к${die} → ${dieAvg}` : "—"})
                  </label>
                  <label className="row">
                    <input type="radio" name="lvl-hp-mode" checked={hpMode === "roll"} onChange={() => setHpMode("roll")} />
                    Бросить кость
                  </label>
                  <label className="row">
                    <input type="radio" name="lvl-hp-mode" checked={hpMode === "manual"} onChange={() => setHpMode("manual")} />
                    Вписать своё
                  </label>
                </fieldset>
                {hpMode === "roll" && (
                  <div className="row">
                    <button type="button" onClick={rollDie} disabled={die == null}>
                      Бросить к{die}
                    </button>
                    {rolled != null && <span className="muted">Выпало: {rolled}</span>}
                  </div>
                )}
                {hpMode === "manual" && (
                  <>
                    <label className="row">
                      Новый максимум
                      <input
                        type="number"
                        min={1}
                        className="wizard-level-input"
                        value={manualTotal}
                        onChange={(e) => setManualTotal(e.target.value)}
                      />
                    </label>
                    <span className="muted">
                      История бросков сотрётся; lump пересчитается из математики. Сейчас: {curMax}.
                    </span>
                  </>
                )}
                <label className="row">
                  Прочие бонусы за уровень
                  <input
                    type="number"
                    className="wizard-level-input"
                    value={misc}
                    onChange={(e) => setMisc(Number(e.target.value) || 0)}
                  />
                </label>
                <div className="stack" style={{ gap: "var(--sp-1)" }}>
                  <span className="muted">
                    Кость {die != null ? `к${die}` : "—"} + ВЫН {formatModifier(conMod)}
                    {hasTough && " + Крепкий 2"}
                    {misc ? ` + прочие ${misc}` : ""}
                    {/* Легаси-лист (импорт из LSS, ручное заведение) прибавляет
                        за ЭТОТ уровень к сохранённому максимуму, а разобранный
                        пересчитывает всю сумму. Формула на экране обязана
                        называть ту, по которой считают. */}
                    {isLegacyHp ? " за этот уровень" : " за уровень"}
                  </span>
                  {isLegacyHp && (
                    <span className="muted">
                      Разбора хитов у этого листа нет — считаем от сохранённого максимума ({curMax}).
                      После применения лист перейдёт на общий счёт.
                    </span>
                  )}
                  <span>
                    <strong>
                      {curMax} → {newMax ?? "—"}
                    </strong>
                    {delta != null && delta !== 0 && <span className="muted"> ({delta > 0 ? `+${delta}` : delta})</span>}
                  </span>
                </div>
              </div>
            )}

            {step === "Новое" && (
              <div className="stack">
                {newFeatureNames.length === 0 &&
                  (slotDelta ?? []).length === 0 &&
                  !cantripDelta &&
                  !preparedDelta &&
                  resourceDelta.length === 0 && (
                    <span className="muted">На этом уровне класс ничего нового не даёт — только хиты и бонус мастерства.</span>
                  )}
                {newFeatureNames.length > 0 && (
                  <div>
                    <strong>Новые умения:</strong> <span>{newFeatureNames.join(", ")}</span>
                  </div>
                )}
                {slotDelta && slotDelta.length > 0 && (
                  <div>
                    <strong>Ячейки:</strong> <span>{slotDelta.join(" · ")}</span>
                  </div>
                )}
                {cantripDelta && (
                  <div>
                    <strong>Заговоры:</strong>{" "}
                    <span className="wizard-data">
                      {cantripDelta.before} → {cantripDelta.after}
                    </span>
                  </div>
                )}
                {preparedDelta && (
                  <div>
                    <strong>Подготовленные:</strong>{" "}
                    <span className="wizard-data">
                      {preparedDelta.before} → {preparedDelta.after}
                    </span>{" "}
                    — отметьте звёздочками на листе
                  </div>
                )}
                {resourceDelta.length > 0 && (
                  <div>
                    <strong>Ресурсы:</strong>{" "}
                    <span>{resourceDelta.map((r) => `${r.label}: ${r.value}`).join(" · ")}</span>
                  </div>
                )}
              </div>
            )}

            {step === "Подкласс" && (
              <div className="stack">
                <span className="muted">На {newLevel}-м уровне {cls?.className} выбирает подкласс.</span>
                <select value={subclassId ?? ""} onChange={(e) => setSubclassId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— подкласс —</option>
                  {subclassOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {step === "Черта" && (
              <div className="stack">
                <span className="muted">На {newLevel}-м уровне — черта на выбор.</span>
                <select
                  value={featId ?? ""}
                  onChange={(e) => {
                    setFeatId(e.target.value ? Number(e.target.value) : null);
                    setAsiPrimary(null);
                    setAsiSecondary(null);
                  }}
                >
                  <option value="">— черта —</option>
                  {availableFeats.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                {/* Сказать сразу, а не после неудачного выбора: список теперь
                    честно неполон с самого начала, и молчать об этом нельзя. */}
                {blockedFeats.size > 0 && (
                  <span className="muted">
                    Скрыто черт по уровню требований: {blockedFeats.size}.
                  </span>
                )}
                {chosenFeatEntry?.description && <EntryBlurb text={chosenFeatEntry.description} />}
                {isAsi && (
                  <div className="stack" style={{ gap: "var(--sp-1)" }}>
                    <span className="muted">+2 одной или +1 двум (потолок 20):</span>
                    <div className="row">
                      <label className="row">
                        +2
                        <select value={asiPrimary ?? ""} onChange={(e) => setAsiPrimary(e.target.value || null)}>
                          <option value="">—</option>
                          {ABILITY_LABELS.map(({ label }) => (
                            <option key={label} value={label}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="row">
                        +1
                        <select value={asiSecondary ?? ""} onChange={(e) => setAsiSecondary(e.target.value || null)}>
                          <option value="">—</option>
                          {ABILITY_LABELS.filter(({ label }) => label !== (asiPrimary ?? "")).map(({ label }) => (
                            <option key={label} value={label}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === "Заклинания" && (
              <div className="stack">
                <span className="muted">
                  Новые ячейки — выше на шаге «Новое». Выучить и подготовить — звёздочками на листе:
                  пикер новых заклинаний в левелапе ещё не живёт, лимит ниже.
                </span>
                {cantripDelta && (
                  <div>
                    <strong>Заговоры:</strong>{" "}
                    <span className="wizard-data">
                      {cantripDelta.before} → {cantripDelta.after}
                    </span>
                  </div>
                )}
                {preparedDelta && (
                  <div>
                    <strong>Подготовленные:</strong>{" "}
                    <span className="wizard-data">
                      {preparedDelta.before} → {preparedDelta.after}
                    </span>
                  </div>
                )}
                {!cantripDelta && !preparedDelta && (
                  <span className="muted">Лимиты заклинаний не изменились.</span>
                )}
              </div>
            )}

            {step === "Обзор" && (
              <div className="stack">
                <div>
                  <strong>
                    {cls?.className} {oldLevel} → {newLevel}
                  </strong>
                </div>
                {applyBlocked && (
                  <span className="muted">
                    Перед применением осталось:{" "}
                    {[
                      !hpReady && "хиты (шаг «Хиты»)",
                      !subReady && "подкласс",
                      !featReady && "черта",
                    ]
                      .filter(Boolean)
                      .join("; ")}.
                  </span>
                )}
                <div>
                  Хиты: <strong className="wizard-data">{curMax} → {newMax ?? "—"}</strong>
                </div>
                {newFeatureNames.length > 0 && <div>Умения: {newFeatureNames.join(", ")}</div>}
                {subclassId && (
                  <div>Подкласс: {subclassOptions.find((s) => s.id === subclassId)?.name}</div>
                )}
                {chosenFeat && <div>Черта: {chosenFeat.name}</div>}
                {isAsi && (asiPrimary || asiSecondary) && (
                  <div className="muted">
                    Прибавки:{" "}
                    {[
                      asiPrimary ? `${asiPrimary} +2` : null,
                      asiSecondary ? `${asiSecondary} +1` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {loadError && (
          <div className="sb-save-status is-error" role="alert">
            Справочник не загрузился: {loadError}. Умения и черты выбираются вслепую — можно применить уровень, а
            выдачи добрать на листе.
          </div>
        )}
        {saveError && (
          <div className="sb-save-status is-error" role="alert">
            {saveError}
          </div>
        )}

        <div className="row wizard-footer wizard-spread">
          <div className="row">
            <button onClick={onClose} disabled={saving}>Отмена</button>
            {stepIndex > 0 && <button onClick={back} disabled={saving}>Назад</button>}
          </div>
          {!capped &&
            (step === "Обзор" ? (
              <button className="primary" onClick={() => void finish()} disabled={saving || applyBlocked}>
                {saving ? "Применяю…" : "Взять уровень"}
              </button>
            ) : (
              <button className="primary" onClick={next} disabled={nextBlocked || saving}>
                Далее
              </button>
            ))}
        </div>
      </div>
    </Modal>
  );
}
