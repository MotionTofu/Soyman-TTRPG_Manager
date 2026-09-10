import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../../api/client";
import type {
  CompendiumEntry,
  DndAbilityKey,
  DndActionTiming,
  DndCharacterData,
  DndClassEntry,
  DndEquipmentItem,
  DndFeature,
  DndManualAttack,
  DndSkillProfLevel,
  DndSpellEntry,
} from "../../types";
import { normalizeDndCharacter, recomputeGrantedSpells } from "./DndCharacterForm";
import { EMPTY_EQUIPMENT_ITEM, fetchEquipmentMeta } from "./dndEquipment";
import { useDndSkills } from "./useDndSkills";
import { ABILITY_LABELS, computeProficiencyBonus } from "./AbilityScores";
import {
  findDndSystemId,
  loadDndBackgroundOptions,
  loadDndClassFeatures,
  loadDndClassHierarchy,
  loadDndEquipmentEntries,
  loadDndFeats,
  loadDndOriginFeats,
  loadDndSpeciesFeatures,
  loadDndSpeciesOptions,
  loadDndSpellIndex,
  type DndBackgroundOption,
  type DndClassHierarchy,
  type DndFeatOption,
  type DndSpeciesOption,
} from "./dndCompendium";
import { featuresFromEntries } from "./dndFeatures";

// Визард подтверждений импорта из Long Story Short (тикет 06): сверка
// распознанного, а не создание с нуля (см. DndCharacterWizard). Каждый шаг —
// «вот что мы поняли → подтверди или поправь». Сохранение — обычным
// POST /statblocks, черновиков в БД нет: отмена бесплатна.

export interface LssPreviewExtras {
  coinsRaw: unknown;
  preparedIds: string[];
  edition: string;
  proficiencySource: string;
  slotsRaw: unknown;
  spellsInfo: { baseCode: string; availableClasses: string[] };
  sizeRaw: string;
  avatarJpeg: string;
  avatarWebp: string;
  bonusesRaw: Record<string, unknown>;
  homelessSections: { key: string; label: string; body: string }[];
}

export interface LssImportWarning {
  field: string;
  message: string;
}

interface Props {
  ownerType: "character" | "being";
  ownerId: number;
  initial: Record<string, unknown>;
  rawExtras: LssPreviewExtras;
  warnings: LssImportWarning[];
  shortText: string;
  existingCount: number;
  onDone: () => void;
  onCancel: () => void;
  onCreateFresh?: () => void;
}

const STEPS = [
  "Начало",
  "Личность",
  "Происхождение",
  "Характеристики",
  "Бой",
  "Снаряжение",
  "Заклинания",
  "Текст",
  "Обзор",
] as const;
type Step = (typeof STEPS)[number];

function draftKey(ownerType: string, ownerId: number) {
  return `lss-wizard-draft:${ownerType}:${ownerId}`;
}
function draftSig(name: string, shortText: string) {
  return `${name}|${shortText.length}`;
}
function norm(s: string) {
  return s.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}
function clampScore(v: number) {
  return Number.isFinite(v) ? Math.min(30, Math.max(1, Math.round(v))) : 10;
}
/** "Болты (15)" → qty 15; "8x листы Пергамента" → qty 8. */
function splitQty(rawName: string): { name: string; qty: string } {
  const mQty = /^(\d+)\s*[x×]\s*(.+)$/i.exec(rawName.trim());
  if (mQty) return { name: mQty[2].trim(), qty: mQty[1] };
  const mParen = /^(.*)\(\s*(\d+)\s*\)\s*$/.exec(rawName.trim());
  if (mParen && mParen[1].trim()) return { name: mParen[1].trim(), qty: mParen[2] };
  return { name: rawName, qty: "" };
}
function isProbablyEmpty(value: DndCharacterData): boolean {
  const c = value.classes[0];
  const noCombat =
    !value.armorClass && !value.hitPointMax && value.attacks.length === 0 &&
    value.equipmentSections.every((s) => s.items.length === 0);
  return (
    !value.characterName && !value.raceName && !(c?.className ?? "") &&
    (Object.keys(value.skillProfs).length === 0) &&
    (Object.values(value.abilities) as number[]).every((v) => v === 10) &&
    value.cantrips.length === 0 && value.spellsByLevel.every((l) => l.length === 0) && noCombat
  );
}
function defaultClassEntry(): DndClassEntry {
  return {
    classId: null, className: "", subclassId: null, subclassName: "",
    level: 1, skillChoiceOptions: [], skillChoiceCount: 0, spellcastingAbility: "",
  };
}

export function LssImportWizard({
  ownerType, ownerId, initial, rawExtras, warnings, shortText,
  existingCount, onDone, onCancel, onCreateFresh,
}: Props) {
  const sig = useMemo(
    () => draftSig(String(initial.characterName ?? ""), shortText),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [value, setValue] = useState<DndCharacterData>(() => {
    try {
      const raw = localStorage.getItem(draftKey(ownerType, ownerId));
      if (raw) {
        const parsed = JSON.parse(raw) as { sig?: string; value?: unknown };
        if (parsed?.sig === sig && parsed?.value) return normalizeDndCharacter(parsed.value);
      }
    } catch {
      /* битый черновик — начинаем с импорта */
    }
    return normalizeDndCharacter(initial);
  });
  const [step, setStep] = useState<Step>(() => {
    try {
      const raw = localStorage.getItem(draftKey(ownerType, ownerId));
      if (raw) {
        const parsed = JSON.parse(raw) as { sig?: string; step?: string };
        if (parsed?.sig === sig && parsed?.step && (STEPS as readonly string[]).includes(parsed.step)) {
          return parsed.step as Step;
        }
      }
    } catch {
      /* ignore */
    }
    return "Начало";
  });
  useEffect(() => {
    try {
      localStorage.setItem(draftKey(ownerType, ownerId), JSON.stringify({ sig, value, step }));
    } catch {
      /* localStorage переполнен/закрыт — визард работает и без черновика */
    }
  }, [value, step, sig, ownerType, ownerId]);
  function clearDraft() {
    try {
      localStorage.removeItem(draftKey(ownerType, ownerId));
    } catch {
      /* ignore */
    }
  }

  const [systemId, setSystemId] = useState<number | null>(value.systemId ?? null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [avatarWanted, setAvatarWanted] = useState(!!(rawExtras.avatarJpeg || rawExtras.avatarWebp));
  const [avatarNote, setAvatarNote] = useState("");
  const [ackWarnings, setAckWarnings] = useState<Record<number, boolean>>({});
  const [homelessDone, setHomelessDone] = useState<Record<string, boolean>>({});
  const [grantedNote, setGrantedNote] = useState("");
  const [enrichNote, setEnrichNote] = useState("");

  const skills = useDndSkills(systemId);
  const [hierarchy, setHierarchy] = useState<DndClassHierarchy>({ classes: [], subclassesByClass: {} });
  const [speciesOptions, setSpeciesOptions] = useState<DndSpeciesOption[]>([]);
  const [backgroundOptions, setBackgroundOptions] = useState<DndBackgroundOption[]>([]);
  const [originFeats, setOriginFeats] = useState<DndFeatOption[]>([]);
  const [spellIndex, setSpellIndex] = useState<CompendiumEntry[] | null>(null);
  const [spellQuery, setSpellQuery] = useState("");
  const [featChoices, setFeatChoices] = useState<Record<number, { entry: CompendiumEntry; picked: number[] }>>({});

  // ——— Выдачи вместо текста (аудит 09.09, В8) ———
  //
  // Импорт опознаёт raceId/classId/subclassId, но умения кладёт одним комом
  // свободного текста из LSS (`lssImport.ts` featureBlock). Текст выглядит
  // как лист, но не работает: на `entryId` у способностей висит вся живая
  // механика — пулы ресурсов, кубы по уровню, строки на «Действиях», чертежи
  // спутников, а «Защита без доспехов» вообще ищется по имени способности.
  // Поэтому здесь мы заменяем ком настоящими выдачами справочника.
  //
  // Исходный текст не удаляется, а уезжает в «Заметки» под маркером: в нём
  // почти всегда есть личные пометки игрока («+заговор починка; могу создать
  // действием предмет из списка в заметках») и хоумбрю, которых в справочнике
  // нет и восстановить их будет неоткуда (решение владельца 09.09).
  const [replaceGrants, setReplaceGrants] = useState(true);
  const [grants, setGrants] = useState<{ species: DndFeature[]; cls: DndFeature[] } | null>(null);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [allFeats, setAllFeats] = useState<DndFeatOption[] | null>(null);
  // Имя из текста LSS → выбранная запись черты (id) либо "text" — оставить
  // строкой. Ключ — сырое имя: другого устойчивого у текста нет.
  const [featPicks, setFeatPicks] = useState<Record<string, number | "text">>({});
  // Что приехало из LSS до всякой замены. Снимок один на визард: галочку
  // можно щёлкать туда-сюда, и текст обязан вернуться тем же.
  const lssTextRef = useRef<{ species: DndFeature[]; cls: DndFeature[]; feats: DndFeature[] } | null>(null);
  if (lssTextRef.current == null) {
    const src = normalizeDndCharacter(initial);
    lssTextRef.current = {
      species: src.speciesFeatures,
      cls: src.classFeatures,
      feats: src.feats,
    };
  }

  const emptySheet = useMemo(() => isProbablyEmpty(normalizeDndCharacter(initial)), [initial]);
  const avatarUrl = rawExtras.avatarJpeg || rawExtras.avatarWebp;
  const cls: DndClassEntry = value.classes[0] ?? defaultClassEntry();
  function patch(p: Partial<DndCharacterData>) {
    setValue((v) => ({ ...v, ...p }));
  }
  function patchClass(p: Partial<DndClassEntry>) {
    setValue((v) => {
      const list = v.classes.length > 0 ? v.classes.slice() : [defaultClassEntry()];
      list[0] = { ...list[0], ...p };
      return { ...v, classes: list };
    });
  }

  // Система из импорта, иначе автоопределение. Справочники — тем же набором,
  // что визард создания (шаг Происхождение без них слеп).
  useEffect(() => {
    if (value.systemId != null) return;
    let alive = true;
    findDndSystemId()
      .then((sid) => {
        if (!alive) return;
        setSystemId(sid);
        if (sid != null) patch({ systemId: sid });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!systemId) return;
    let alive = true;
    Promise.all([
      loadDndClassHierarchy(systemId).then((h) => alive && setHierarchy(h)),
      loadDndSpeciesOptions(systemId).then((o) => alive && setSpeciesOptions(o)),
      loadDndBackgroundOptions(systemId).then((o) => alive && setBackgroundOptions(o)),
      loadDndOriginFeats(systemId).then((o) => alive && setOriginFeats(o)),
    ]).catch(() => alive && setLoadError("Не загрузился справочник — линковку можно пропустить, лист сохранится текстом."));
    return () => {
      alive = false;
    };
  }, [systemId]);

  // Выдачи справочника под опознанные id. Грузим лениво — только когда галочка
  // включена: отказавшемуся от замены лишние запросы ни к чему.
  const raceId = value.raceId ?? null;
  const classIdForGrants = cls.classId ?? null;
  const subclassIdForGrants = cls.subclassId ?? null;
  const classLevel = cls.level || 1;
  useEffect(() => {
    if (!replaceGrants || !systemId) return;
    if (classIdForGrants == null && raceId == null) return;
    let alive = true;
    setGrantsLoading(true);
    setGrantsError(null);
    Promise.all([
      raceId != null ? loadDndSpeciesFeatures(systemId, raceId) : Promise.resolve([]),
      classIdForGrants != null ? loadDndClassFeatures(systemId, classIdForGrants) : Promise.resolve([]),
      subclassIdForGrants != null ? loadDndClassFeatures(systemId, subclassIdForGrants) : Promise.resolve([]),
      loadDndFeats(systemId),
    ])
      .then(([sp, cl, sub, feats]) => {
        if (!alive) return;
        setGrants({
          // У вида уровня нет — берём всё; у класса и подкласса режем по уровню.
          species: raceId != null ? featuresFromEntries(sp, raceId, undefined) : [],
          cls: [
            ...(classIdForGrants != null ? featuresFromEntries(cl, classIdForGrants, classLevel) : []),
            ...(subclassIdForGrants != null ? featuresFromEntries(sub, subclassIdForGrants, classLevel) : []),
          ],
        });
        setAllFeats(feats);
        setGrantsLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setGrantsError("Справочник не ответил — умения останутся текстом из LSS.");
        setGrantsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [replaceGrants, systemId, raceId, classIdForGrants, subclassIdForGrants, classLevel]);

  // Имена черт из текста LSS. В экспорте они лежат жирными строками (часто
  // ссылкой на dnd.su), поэтому построчного разбора хватает; уточнение в
  // скобках («Посвящённый в магию (Волшебник)») при сопоставлении отбрасываем,
  // но в строке сохраняем — оно и есть выбор игрока.
  const lssFeatNames = useMemo(() => {
    const out: string[] = [];
    for (const f of lssTextRef.current?.feats ?? []) {
      for (const raw of `${f.description ?? ""}`.split("\n")) {
        const line = raw.replace(/^[-–—•*\s]+/, "").trim();
        if (line && line.length <= 120 && !out.includes(line)) out.push(line);
      }
    }
    return out;
  }, []);
  const featMatchOf = (raw: string): DndFeatOption | null => {
    if (!allFeats) return null;
    const bare = norm(raw.replace(/\([^)]*\)/g, ""));
    return allFeats.find((f) => norm(f.name) === norm(raw)) ?? allFeats.find((f) => norm(f.name) === bare) ?? null;
  };
  const featRows = lssFeatNames.map((raw) => {
    const auto = featMatchOf(raw);
    const pick = featPicks[raw];
    const chosen = pick === "text" ? null : pick != null ? (allFeats?.find((f) => f.id === pick) ?? null) : auto;
    return { raw, auto, chosen, asText: pick === "text" };
  });
  const unmatchedFeats = featRows.filter((r) => !r.chosen && !r.asText);

  // Замена и возврат — одним местом, чтобы галочка была обратимой.
  // Считаем желаемое состояние и патчим только при расхождении: эффект,
  // который пишет в то же значение, от которого зависит, иначе зациклится.
  const grantsReady = replaceGrants && grants != null && allFeats != null;
  // Заменяем ТОЛЬКО то, чему нашлась замена. Класс «Изобретатель» в
  // справочнике не значится — при слепой замене его текст уезжал в заметки, а
  // на листе оставался ноль умений: хуже, чем было (поймано на живом прогоне
  // фикстуры lss-filled.json, 09.09).
  const replacedSpecies = grantsReady && raceId != null && grants!.species.length > 0;
  const replacedCls = grantsReady && classIdForGrants != null && grants!.cls.length > 0;
  useEffect(() => {
    const lss = lssTextRef.current;
    if (!lss) return;
    const wantSpecies = replacedSpecies ? grants!.species : lss.species;
    const wantCls = replacedCls ? grants!.cls : lss.cls;
    const wantFeats = grantsReady
      ? [
          ...featRows
            .filter((r) => r.chosen)
            .map((r) => ({ name: r.chosen!.name, description: "", entryId: r.chosen!.id })),
          ...featRows.filter((r) => !r.chosen).map((r) => ({ name: r.raw, description: "" })),
        ]
      : lss.feats;
    const same = (a: DndFeature[], b: DndFeature[]) => JSON.stringify(a) === JSON.stringify(b);
    setValue((v) => {
      if (same(v.speciesFeatures, wantSpecies) && same(v.classFeatures, wantCls) && same(v.feats, wantFeats)) {
        return v;
      }
      return { ...v, speciesFeatures: wantSpecies, classFeatures: wantCls, feats: wantFeats };
    });
    // featRows пересобирается каждый рендер — зависимости по её содержимому.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    grantsReady,
    replacedSpecies,
    replacedCls,
    grants,
    JSON.stringify(featRows.map((r) => [r.raw, r.chosen?.id ?? null, r.asText])),
  ]);

  // Текст LSS в «Заметки» под маркером: приём тот же, что у блока заметок
  // класса на листе (upsertClassNotesBlock) — маркер делает вставку обратимой.
  const LSS_TEXT_MARK = "— Умения из LSS (заменены выдачами 5.5) —";
  const lssTextBlock = useMemo(() => {
    const lss = lssTextRef.current;
    if (!lss) return "";
    // В заметки уходит только то, что действительно заменено: оставшийся на
    // листе текст дублировать в заметках незачем.
    const parts = [
      ...(replacedSpecies ? lss.species : []),
      ...(replacedCls ? lss.cls : []),
      ...(grantsReady ? lss.feats : []),
    ]
      .map((f) => `${f.name}\n${f.description ?? ""}`.trim())
      .filter(Boolean);
    return parts.length > 0 ? `${LSS_TEXT_MARK}\n${parts.join("\n\n")}` : "";
  }, [replacedSpecies, replacedCls, grantsReady]);
  useEffect(() => {
    setValue((v) => {
      const has = v.notes.includes(LSS_TEXT_MARK);
      if (lssTextBlock && !has) {
        return { ...v, notes: v.notes.trim() ? `${v.notes.trim()}\n\n${lssTextBlock}` : lssTextBlock };
      }
      if (has) {
        const cut = v.notes.indexOf(LSS_TEXT_MARK);
        const head = v.notes.slice(0, cut).trimEnd();
        if (!lssTextBlock) return { ...v, notes: head };
        const rebuilt = head ? `${head}\n\n${lssTextBlock}` : lssTextBlock;
        return rebuilt === v.notes ? v : { ...v, notes: rebuilt };
      }
      return v;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lssTextBlock]);

  async function fetchEntry(id: number): Promise<CompendiumEntry | null> {
    try {
      return await api.get<CompendiumEntry>(`/systems/entries/${id}`);
    } catch {
      return null;
    }
  }

  // --- Происхождение: перелинковка с подтягиванием выдач записи ---
  async function pickSpecies(id: number | null) {
    if (id == null) {
      patch({ raceId: null });
      return;
    }
    const opt = speciesOptions.find((s) => s.id === id);
    patch({ raceId: id, raceName: opt?.name ?? value.raceName, raceTypeName: opt?.creatureTypeName ?? value.raceTypeName });
    const walk = Number(opt?.walkSpeed ?? "");
    if (Number.isFinite(walk) && walk > 0 && !value.speed) {
      setValue((v) => ({ ...v, speed: `${opt!.walkSpeed} фт.`, speeds: { ...v.speeds, walk } }));
    }
  }
  async function pickClass(id: number | null) {
    if (id == null) {
      patchClass({ classId: null, subclassId: null });
      return;
    }
    const opt = hierarchy.classes.find((c) => c.id === id);
    const entry = await fetchEntry(id);
    const d = (entry?.data ?? {}) as Record<string, unknown>;
    patchClass({
      classId: id,
      className: opt?.name ?? cls.className,
      subclassId: null,
      subclassName: "",
      skillChoiceOptions: Array.isArray(d.skill_choice_options) ? (d.skill_choice_options as string[]) : cls.skillChoiceOptions,
      skillChoiceCount: typeof d.skill_choice_count === "number" ? d.skill_choice_count : cls.skillChoiceCount,
      spellcastingAbility: typeof d.spellcasting_ability === "string" ? d.spellcasting_ability : cls.spellcastingAbility,
    });
  }
  function pickSubclass(id: number | null) {
    if (cls.classId == null) return;
    if (id == null) {
      patchClass({ subclassId: null, subclassName: "" });
      return;
    }
    const opt = (hierarchy.subclassesByClass[cls.classId] ?? []).find((s) => s.id === id);
    patchClass({ subclassId: id, subclassName: opt?.name ?? cls.subclassName });
  }
  async function pickBackground(id: number | null) {
    if (id == null) {
      patch({ backgroundId: null });
      return;
    }
    const opt = backgroundOptions.find((b) => b.id === id);
    const entry = await fetchEntry(id);
    const d = (entry?.data ?? {}) as Record<string, unknown>;
    patch({
      backgroundId: id,
      backgroundName: opt?.name ?? value.backgroundName,
      backgroundSkillNames: Array.isArray(d.skills) ? (d.skills as string[]) : value.backgroundSkillNames,
    });
  }

  // --- Заклинания ---
  async function ensureSpellIndex(): Promise<CompendiumEntry[]> {
    if (spellIndex) return spellIndex;
    if (!systemId) return [];
    const idx = await loadDndSpellIndex(systemId);
    setSpellIndex(idx);
    return idx;
  }
  function mergeAfterRecompute(res: { cantrips: DndSpellEntry[]; spellsByLevel: DndSpellEntry[][]; spellSlotLevels: number }) {
    // Ручные дубли дарованных (та же entryId без sourceParentId) — убрать:
    // recompute сам такого не делает, а визард вписавшую «Починку» рукой
    // после линка иначе задвоит.
    const grantedIds = new Set(
      [...res.cantrips, ...res.spellsByLevel.flat()].map((s) => s.entryId).filter((id): id is number => id != null)
    );
    const keepManual = (list: DndSpellEntry[]) =>
      list.filter((s) => s.sourceParentId == null && (s.entryId == null || !grantedIds.has(s.entryId)));
    setValue((v) => ({
      ...v,
      cantrips: [...res.cantrips, ...keepManual(v.cantrips)],
      spellsByLevel: res.spellsByLevel.map((lvl, i) => [...lvl, ...keepManual(v.spellsByLevel[i] ?? [])]),
      spellSlotLevels: res.spellSlotLevels,
    }));
  }
  async function recomputeGrants() {
    setGrantedNote("Считаю выдачи…");
    try {
      const res = await recomputeGrantedSpells(value);
      mergeAfterRecompute(res);
      const n = res.cantrips.length + res.spellsByLevel.flat().length;
      setGrantedNote(n > 0 ? `Пришло само: ${n} (метка ∞ — не в счёт лимита).` : "Источники заклинаний не дают — всё руками ниже.");
    } catch {
      setGrantedNote("Не удалось посчитать выдачи (справочник недоступен) — добавьте руками.");
    }
  }
  function addSpell(entry: CompendiumEntry, outsideLimit: boolean) {
    const lvl = entry.level ?? 0;
    const row: DndSpellEntry = {
      entryId: entry.id, name: entry.name, prepared: 1,
      sourceParentId: null, outsideLimit: outsideLimit || undefined,
    };
    setValue((v) => {
      if (lvl <= 0) return { ...v, cantrips: [...v.cantrips, row] };
      const next = v.spellsByLevel.map((l) => l.slice());
      while (next.length < lvl) next.push([]);
      next[lvl - 1] = [...next[lvl - 1], row];
      return { ...v, spellsByLevel: next, spellSlotLevels: Math.max(v.spellSlotLevels, lvl) };
    });
  }
  function removeSpell(level: number, idx: number) {
    setValue((v) => {
      if (level <= 0) return { ...v, cantrips: v.cantrips.filter((_, i) => i !== idx) };
      const next = v.spellsByLevel.map((l) => l.slice());
      next[level - 1] = next[level - 1].filter((_, i) => i !== idx);
      return { ...v, spellsByLevel: next };
    });
  }
  // Вставка списком из LSS (тикет 07): в экспорте только ID, а на экране LSS
  // у каждого заклинания оба имени — «Огненный шар [Fireball]». Оригинал
  // сводим с name_original справочника (как fetchGrantedSpells), русское имя —
  // запасным кругом. Повторный прогон не двоит (сверка с owned).
  const [pasteText, setPasteText] = useState("");
  const [pasteReport, setPasteReport] = useState("");
  const [pasteMissed, setPasteMissed] = useState<string[]>([]);
  function splitBracket(raw: string): { name: string; original: string } {
    const m = /^(.*?)\s*\[(.+)\]\s*$/.exec(raw ?? "");
    return m ? { name: m[1].trim(), original: m[2].trim() } : { name: (raw ?? "").trim(), original: "" };
  }
  async function matchPastedSpells() {
    const lines = pasteText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) {
      setPasteReport("Вставьте список — по одному заклинанию на строку.");
      return;
    }
    let idx: CompendiumEntry[];
    try {
      idx = await ensureSpellIndex();
    } catch {
      setPasteReport("Справочник недоступен.");
      return;
    }
    if (idx.length === 0) {
      setPasteReport("В справочнике нет заклинаний (не определилась система?).");
      return;
    }
    const byOriginal = new Map(
      idx.map((e) => [String(e.name_original ?? "").trim().toLowerCase(), e]).filter(([k]) => k) as [string, CompendiumEntry][]
    );
    const byName = new Map(idx.map((e) => [e.name.trim().toLowerCase(), e]));
    const owned = new Set(
      [...value.cantrips, ...value.spellsByLevel.flat()].map((s) => s.entryId).filter((id): id is number => id != null)
    );
    let ok = 0;
    let dup = 0;
    const missed: string[] = [];
    for (const line of lines) {
      const { name, original } = splitBracket(line);
      const hit =
        (original ? byOriginal.get(original.toLowerCase()) : undefined) ??
        (name ? byName.get(name.toLowerCase()) : undefined) ??
        null;
      if (!hit) {
        missed.push(line);
        continue;
      }
      if (owned.has(hit.id)) {
        dup++;
        continue;
      }
      owned.add(hit.id);
      ok++;
      addSpell(hit, false);
    }
    setPasteMissed(missed);
    const parts = [`Сопоставлено: ${ok} из ${lines.length}.`];
    if (dup > 0) parts.push(`Уже были: ${dup}.`);
    if (missed.length > 0) parts.push(`Не распознано: ${missed.length} — доберите поиском ниже.`);
    setPasteReport(parts.join(" "));
  }
  const spellMatches = useMemo(() => {
    if (!spellIndex) return [];
    const q = spellQuery.trim().toLowerCase();
    const owned = new Set(
      [...value.cantrips, ...value.spellsByLevel.flat()].map((s) => s.entryId).filter((id): id is number => id != null)
    );
    return spellIndex
      .filter((e) => !owned.has(e.id))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .slice(0, 40);
  }, [spellIndex, spellQuery, value.cantrips, value.spellsByLevel]);

  // Черты из импорта → записи справочника (для пикера spell_choices).
  const featMatches = useMemo(
    () =>
      value.feats.map((f) => {
        const hit = originFeats.find((o) => norm(o.name) === norm(f.name));
        return { feat: f, option: hit ?? null };
      }),
    [value.feats, originFeats]
  );
  async function loadFeatChoices(featEntryId: number) {
    const entry = await fetchEntry(featEntryId);
    if (!entry) return;
    const raw = Array.isArray((entry.data as Record<string, unknown>).spell_choices)
      ? ((entry.data as Record<string, unknown>).spell_choices as {
          count?: number; classIds?: number[]; schools?: string[]; level?: number; outsideLimit?: boolean;
        }[])
      : [];
    if (raw.length === 0) {
      setFeatChoices((m) => ({ ...m, [featEntryId]: { entry, picked: [] } }));
      return;
    }
    setFeatChoices((m) => ({ ...m, [featEntryId]: { entry, picked: [] } }));
  }

  // --- Снаряжение: qty из названий + обогащение метой ---
  function applyQtyParse() {
    setValue((v) => ({
      ...v,
      equipmentSections: v.equipmentSections.map((sec, si) =>
        si === 0
          ? {
              ...sec,
              items: sec.items.map((it) => {
                if (it.qty) return it;
                const { name, qty } = splitQty(it.name);
                return qty ? { ...it, name, qty } : it;
              }),
            }
          : sec
      ),
    }));
  }
  async function enrichEquipment() {
    if (!systemId) {
      setEnrichNote("Нет системы — нечего искать.");
      return;
    }
    setEnrichNote("Ищу совпадения…");
    try {
      const entries = await loadDndEquipmentEntries(systemId);
      const byName = new Map(entries.map((e) => [norm(e.name), e] as const));
      // Второй круг — без уточнения в скобках: «Кольчуга (средняя)» → «Кольчуга».
      // Алиасы записей тоже участвуют (механизм уже ищет по ним пикер инвентаря).
      const aliasMap = new Map<string, CompendiumEntry>();
      for (const e of entries) {
        const al = Array.isArray(e.aliases) ? e.aliases : [];
        for (const a of al) if (typeof a === "string" && a.trim() && !aliasMap.has(norm(a))) aliasMap.set(norm(a), e);
        if (e.name_original && !aliasMap.has(norm(e.name_original))) aliasMap.set(norm(e.name_original), e);
      }
      const findEntry = (rawName: string): CompendiumEntry | null => {
        const { name } = splitQty(rawName);
        const n = norm(name);
        return byName.get(n) ?? aliasMap.get(n) ?? byName.get(norm(n.replace(/\s*\(.*?\)\s*$/, ""))) ?? null;
      };
      let matched = 0;
      const missed: string[] = [];
      const items = value.equipmentSections[0]?.items ?? [];
      const next: DndEquipmentItem[] = [];
      for (const it of items) {
        if (it.entryId) {
          next.push(it);
          continue;
        }
        const hit = findEntry(it.name);
        if (!hit) {
          missed.push(it.name);
          next.push(it);
          continue;
        }
        matched++;
        try {
          const meta = await fetchEquipmentMeta(hit.id).catch(() => ({}));
          next.push({ ...it, entryId: hit.id, ...meta });
        } catch {
          next.push({ ...it, entryId: hit.id });
        }
      }
      setValue((v) => ({
        ...v,
        equipmentSections: v.equipmentSections.map((sec, si) => (si === 0 ? { ...sec, items: next } : sec)),
      }));
      const missTxt = missed.length > 0 ? ` Не нашлось: ${missed.slice(0, 5).join(" · ")}${missed.length > 5 ? ` и ещё ${missed.length - 5}` : ""}.` : "";
      setEnrichNote(matched > 0 ? `Обогащено: ${matched}.${missTxt}` : `Совпадений нет.${missTxt}`);
    } catch {
      setEnrichNote("Справочник недоступен.");
    }
  }

  // --- Сохранение ---
  async function finish() {
    setSaving(true);
    setSaveError(null);
    setAvatarNote("");
    try {
      const note = `Импортировано из Long Story Short${value.characterName ? ` (${value.characterName})` : ""}${
        warnings.length ? ` — ${warnings.length} замечаний (см. визард)` : ""
      }`;
      const created = await api.post<{ id: number }>("/statblocks", {
        owner_type: ownerType,
        owner_id: ownerId,
        format: "dnd_character",
        kind: "full",
        content: JSON.stringify(value),
        note,
      });
      if (avatarWanted && avatarUrl) {
        try {
          const resp = await fetch(avatarUrl);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          if (blob.size > 15 * 1024 * 1024) throw new Error("больше 15 МБ");
          const form = new FormData();
          form.append("file", new File([blob], "lss-avatar", { type: blob.type || "image/jpeg" }));
          await api.post(`/statblocks/${created.id}/avatar`, form);
        } catch {
          setAvatarNote("Портрет не подтянулся (hotbox не отдал файл) — скачайте картинку из LSS и загрузите вручную.");
        }
      }
      clearDraft();
      onDone();
    } catch (e) {
      setSaveError(e instanceof Error && e.message ? `Не удалось сохранить: ${e.message}` : "Не удалось сохранить — проверьте связь.");
    } finally {
      setSaving(false);
    }
  }

  const stepIndex = STEPS.indexOf(step);
  function next() {
    setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]);
  }
  function back() {
    setStep(STEPS[Math.max(0, stepIndex - 1)]);
  }

  const skillKeys = useMemo(() => {
    const fromCatalog = skills.rows.map((r) => r.original);
    const unknown = Object.keys(value.skillProfs).filter((k) => !fromCatalog.includes(k));
    return [...fromCatalog, ...unknown];
  }, [skills.rows, value.skillProfs]);
  const grantedSpells = useMemo(
    () => [...value.cantrips, ...value.spellsByLevel.flat()].filter((s) => s.sourceParentId != null),
    [value.cantrips, value.spellsByLevel]
  );
  const manualSpellCount = useMemo(
    () => [...value.cantrips, ...value.spellsByLevel.flat()].filter((s) => s.sourceParentId == null).length,
    [value.cantrips, value.spellsByLevel]
  );
  const allAcked = warnings.every((_, i) => ackWarnings[i]);
  const homelessRemaining = rawExtras.homelessSections.filter((s) => !homelessDone[s.key]).length;

  return (
    <div className="stack" style={{ minWidth: 320 }}>
      <div className="tabs" style={{ flexWrap: "wrap" }}>
        {STEPS.map((s, i) => (
          <button key={s} type="button" className={step === s ? "active" : ""} disabled={i > stepIndex} onClick={() => setStep(s)}>
            {s}
          </button>
        ))}
      </div>
      {loadError && <div className="backup-info error">{loadError}</div>}

      {step === "Начало" && (
        <div className="stack">
          <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", whiteSpace: "pre-wrap" }}>{shortText}</div>
          {emptySheet && (
            <div className="backup-info" role="status">
              Похоже, лист пустой (без имени, расы, класса, все характеристики по 10). Можно продолжить как заготовку —
              а можно создать персонажа визардом с нуля, так будет полнее.
              {onCreateFresh && (
                <div className="row" style={{ marginTop: 6 }}>
                  <button type="button" onClick={onCreateFresh}>Создать визардом</button>
                </div>
              )}
            </div>
          )}
          <div className="card" style={{ padding: 10, fontSize: "var(--fs-meta)" }}>
            <div><span className="muted">Заклинаний в LSS:</span> {rawExtras.preparedIds.length} (ID не мапятся — шаг «Заклинания»)</div>
            <div><span className="muted">Редакция:</span> {rawExtras.edition || "—"} · <span className="muted">Бонус мастерства из:</span> {rawExtras.proficiencySource}</div>
            <div><span className="muted">Замечаний:</span> {warnings.length} (чеклист на «Обзоре»)</div>
            {rawExtras.sizeRaw && <div><span className="muted">Размер LSS:</span> {rawExtras.sizeRaw} (в листе поля нет)</div>}
          </div>
          {avatarUrl && (
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <img src={avatarUrl} alt="Портрет из LSS" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8 }} />
              <label className="row"><input type="checkbox" checked={avatarWanted} onChange={(e) => setAvatarWanted(e.target.checked)} /> Подтянуть портрет при сохранении</label>
            </div>
          )}
        </div>
      )}

      {step === "Личность" && (
        <div className="stack">
          <label>Имя персонажа<input value={value.characterName} onChange={(e) => patch({ characterName: e.target.value })} /></label>
          <label>Имя игрока<input value={value.playerName} onChange={(e) => patch({ playerName: e.target.value })} placeholder="В LSS было пусто — спросить у игрока" /></label>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label>Мировоззрение<input value={value.alignment} onChange={(e) => patch({ alignment: e.target.value })} /></label>
            <label>Опыт<input value={value.experiencePoints} onChange={(e) => patch({ experiencePoints: e.target.value })} /></label>
            <label>Уровень<input type="number" min={1} max={20} style={{ width: 70 }} value={cls.level} onChange={(e) => patchClass({ level: Math.min(20, Math.max(1, Math.round(Number(e.target.value)) || 1)) })} /></label>
            <label className="row"><input type="checkbox" checked={value.inspiration} onChange={(e) => patch({ inspiration: e.target.checked })} /> Вдохновение</label>
          </div>
        </div>
      )}

      {step === "Происхождение" && (
        <div className="stack">
          {!systemId && <span className="muted">Система не определилась — линковка недоступна, всё останется текстом.</span>}
          <div>
            <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
              Вид: {value.raceName || "—"} {value.raceId ? "✓ в справочнике" : value.raceName ? "⚠ текстом" : ""}
              {value.raceTypeName ? ` · тип ${value.raceTypeName}` : ""}
            </div>
            <select value={value.raceId ?? ""} onChange={(e) => void pickSpecies(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— текстом —</option>
              {speciesOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
              Класс: {cls.className || "—"} {cls.classId ? "✓" : cls.className ? "⚠ текстом" : ""} · Ур. {cls.level}
              {cls.spellcastingAbility ? ` · заклинания: ${cls.spellcastingAbility}` : ""}
              {cls.skillChoiceCount > 0 ? ` · навыков на выбор: ${cls.skillChoiceCount}` : ""}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <select value={cls.classId ?? ""} onChange={(e) => void pickClass(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— текстом —</option>
                {hierarchy.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select
                value={cls.subclassId ?? ""} disabled={cls.classId == null}
                onChange={(e) => pickSubclass(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">{cls.subclassName && cls.subclassId == null ? `⚠ ${cls.subclassName} (текстом)` : "— подкласс —"}</option>
                {(cls.classId != null ? hierarchy.subclassesByClass[cls.classId] ?? [] : []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            {cls.subclassName && cls.subclassId == null && (
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Подкласс «{cls.subclassName}» не слинкован — выдачи подкласса не посчитаются. Выберите из списка или оставьте текстом.</span>
            )}
          </div>
          <div>
            <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
              Предыстория: {value.backgroundName || "—"} {value.backgroundId ? "✓" : value.backgroundName ? "⚠ текстом" : ""}
            </div>
            <select value={value.backgroundId ?? ""} onChange={(e) => void pickBackground(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— текстом —</option>
              {backgroundOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {step === "Характеристики" && (
        <div className="stack">
          <div className="dnd-abilities-row">
            {ABILITY_LABELS.map(({ key, label }) => (
              <div key={key} className="dnd-ability-box">
                <span className="dnd-ability-label">{label}</span>
                <input
                  type="number" className="dnd-ability-input" style={{ width: 56 }}
                  value={value.abilities[key as DndAbilityKey]}
                  onChange={(e) => patch({ abilities: { ...value.abilities, [key]: clampScore(Number(e.target.value)) } })}
                />
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label>Бонус мастерства<input value={value.proficiencyBonus} style={{ width: 70 }} onChange={(e) => patch({ proficiencyBonus: e.target.value })} /></label>
            <button
              type="button"
              onClick={() => patch({ proficiencyBonus: computeProficiencyBonus(value.classes) })}
              title={`Источник LSS: ${rawExtras.proficiencySource}`}
            >
              Пересчитать ({computeProficiencyBonus(value.classes)})
            </button>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>из LSS: {rawExtras.proficiencySource}</span>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Спасброски</span>
            {ABILITY_LABELS.map(({ key, label }) => (
              <label key={key} className="row">
                <input
                  type="checkbox" checked={!!value.savingThrowProfs[key as DndAbilityKey]}
                  onChange={(e) => patch({ savingThrowProfs: { ...value.savingThrowProfs, [key]: e.target.checked } })}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Навыки (0 — нет, 1 — владение, 2 — экспертиза)</span>
            {skillKeys.map((k) => {
              const known = skills.rows.some((r) => r.original === k);
              const lvl = (value.skillProfs[k] ?? 0) as DndSkillProfLevel;
              return (
                <div key={k} className="row" style={{ gap: 8, alignItems: "center" }}>
                  <select value={lvl} onChange={(e) => patch({ skillProfs: { ...value.skillProfs, [k]: Number(e.target.value) as DndSkillProfLevel } })}>
                    <option value={0}>0</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                  </select>
                  <span>{known ? skills.nameOf(k) : k}{!known && <span className="muted"> — нет в справочнике</span>}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === "Бой" && (
        <div className="stack">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label>КЗ<input value={value.armorClass} style={{ width: 70 }} onChange={(e) => patch({ armorClass: e.target.value })} /></label>
            <label>+КЗ вручную<input value={value.manualAcBonus} style={{ width: 70 }} onChange={(e) => patch({ manualAcBonus: e.target.value })} /></label>
            {/* Бонус инициативы считается сам (Ловкость + умения); руками
                задаётся только поправка — как «+КЗ вручную» слева. Поля под
                брошенное число здесь нет: бросок называют за столом, а не
                при импорте. */}
            <label>+Иниц. вручную<input value={value.initiativeMisc} style={{ width: 70 }} onChange={(e) => patch({ initiativeMisc: e.target.value })} /></label>
            <label>Скорость<input value={value.speed} style={{ width: 90 }} onChange={(e) => patch({ speed: e.target.value })} /></label>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label>Хиты макс<input value={value.hitPointMax} style={{ width: 70 }} onChange={(e) => patch({ hitPointMax: e.target.value })} /></label>
            <label>Текущие<input value={value.hitPointsCurrent} style={{ width: 70 }} onChange={(e) => patch({ hitPointsCurrent: e.target.value })} /></label>
            <label>Временные<input value={value.hitPointsTemp} style={{ width: 70 }} onChange={(e) => patch({ hitPointsTemp: e.target.value })} /></label>
            <label>Кости хитов<input value={value.hitDice} style={{ width: 90 }} onChange={(e) => patch({ hitDice: e.target.value })} /></label>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
              Атаки ({value.attacks.length}). Время из LSS всегда «действие» — поправьте где не так. Заметки оружия (свойства, дистанция) допишите в описание.
            </span>
            {value.attacks.map((a, i) => (
              <AttackRow
                key={i} attack={a}
                onChange={(na) => patch({ attacks: value.attacks.map((x, j) => (j === i ? na : x)) })}
                onRemove={() => patch({ attacks: value.attacks.filter((_, j) => j !== i) })}
              />
            ))}
            <button
              type="button" style={{ alignSelf: "flex-start" }}
              onClick={() => patch({ attacks: [...value.attacks, { name: "", description: "", timing: "action" as DndActionTiming }] })}
            >
              + Атака
            </button>
          </div>
        </div>
      )}

      {step === "Снаряжение" && (
        <GearStep
          value={value} patch={patch} setValue={setValue}
          enrichNote={enrichNote} onQty={applyQtyParse} onEnrich={() => void enrichEquipment()}
          rawCoins={rawExtras.coinsRaw}
        />
      )}

      {step === "Заклинания" && (
        <div className="stack">
          <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
            В LSS было подготовленных: {rawExtras.preparedIds.length} (ID из экспорта не мапятся).
            На листе сейчас вручную: {manualSpellCount}. Быстрее всего — скопировать список из LSS
            (там у каждого оба имени) и вставить ниже.
          </div>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => void recomputeGrants()}>Пересчитать выдачи</button>
            {grantedNote && <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>{grantedNote}</span>}
          </div>
          {grantedSpells.length > 0 && (
            <div className="stack" style={{ gap: 2 }}>
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Пришло само (∞ — не в счёт лимита):</span>
              {grantedSpells.map((s, i) => (
                <span key={i} style={{ fontSize: "var(--fs-meta)" }}>{s.name}{s.outsideLimit ? " ∞" : ""}</span>
              ))}
            </div>
          )}
          <label>Заклинательная характеристика (класс)<input value={cls.spellcastingAbility} onChange={(e) => patchClass({ spellcastingAbility: e.target.value })} placeholder="Интеллект / Мудрость / Харизма" /></label>
          {rawExtras.spellsInfo.baseCode && (
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
              В LSS spellsInfo: base {rawExtras.spellsInfo.baseCode}
              {rawExtras.spellsInfo.availableClasses.length > 0 ? ` · списки: ${rawExtras.spellsInfo.availableClasses.join(", ")}` : ""} —
              сверьте с характеристикой выше.
            </span>
          )}
          <div className="stack" style={{ gap: 4 }}>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Вставка списком из LSS (по одному на строку, вид «Огненный шар [Fireball]»)</span>
            <textarea value={pasteText} rows={4} onChange={(e) => setPasteText(e.target.value)} placeholder={"Огненный шар [Fireball]\nЛечащее слово [Healing Word]"} />
            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={() => void matchPastedSpells()}>Сопоставить</button>
              {pasteReport && <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>{pasteReport}</span>}
            </div>
            {pasteMissed.length > 0 && (
              <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                Не распознано: {pasteMissed.join(" · ")}
              </div>
            )}
          </div>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <label>Кругов заклинаний<input type="number" min={0} max={9} style={{ width: 60 }} value={value.spellSlotLevels} onChange={(e) => patch({ spellSlotLevels: Math.min(9, Math.max(0, Number(e.target.value) || 0)) })} /></label>
            <ApplyLssSlots raw={rawExtras.slotsRaw} current={value.spellSlotLevels} onApply={(levels, pips) => patch({ spellSlotLevels: levels, spellSlotPips: pips })} pips={value.spellSlotPips} />
          </div>
          {featMatches.some((m) => m.option) && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Черты с выбором заклинаний:</span>
              {featMatches.filter((m) => m.option).map((m) => (
                <FeatChoicePicker
                  key={m.option!.id} featName={m.feat.name} featEntryId={m.option!.id}
                  ensureIndex={ensureSpellIndex}
                  loaded={featChoices[m.option!.id] ?? null}
                  onLoad={() => void loadFeatChoices(m.option!.id)}
                  onPick={(ids, outsideLimit) => {
                    const st = featChoices[m.option!.id];
                    if (!st) return;
                    void ensureSpellIndex().then((idx) => {
                      const byId = new Map(idx.map((e) => [e.id, e]));
                      ids.forEach((id) => {
                        const e = byId.get(id);
                        if (e) addSpell(e, outsideLimit);
                      });
                      setFeatChoices((mm) => ({ ...mm, [m.option!.id]: { ...st, picked: [...st.picked, ...ids] } }));
                    });
                  }}
                />
              ))}
            </div>
          )}
          <SpellPicker
            systemId={systemId} query={spellQuery} setQuery={setSpellQuery}
            matches={spellMatches} ensureIndex={() => void ensureSpellIndex().then(() => {})}
            loaded={spellIndex != null} onAdd={(e) => addSpell(e, false)}
          />
          <SpellLists value={value} onRemove={removeSpell} />
        </div>
      )}

      {step === "Текст" && (
        <div className="stack">
          {/* Замена текста выдачами (В8). Галочка включена: цель импорта —
              рабочий лист, а комом текста лист не работает. */}
          <div className="stack sb-entry" style={{ gap: 6 }}>
            <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={replaceGrants}
                onChange={(e) => setReplaceGrants(e.target.checked)}
              />
              <span>
                Заменить умения выдачами ДнД 5.5
                <br />
                <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                  Текст из LSS уедет в «Заметки» целиком — в нём остаются ваши пометки.
                </span>
              </span>
            </label>
            {/* Что именно не заменится — назвать поимённо. Молчаливый ноль
                умений класса читается как потеря, а не как «класса нет в
                справочнике». */}
            {replaceGrants && classIdForGrants == null && (
              <span className="muted">
                Класс не опознан на шаге «Происхождение» — его умения останутся текстом из LSS.
              </span>
            )}
            {replaceGrants && raceId == null && (
              <span className="muted">
                Вид не опознан на шаге «Происхождение» — видовые особенности останутся текстом из LSS.
              </span>
            )}
            {replaceGrants && grantsLoading && <span className="muted">Читаю справочник…</span>}
            {replaceGrants && grantsError && (
              <span className="sb-save-status is-error" role="alert">{grantsError}</span>
            )}
            {replaceGrants && grants && (
              <span className="muted">
                Заменяется: {replacedSpecies ? `видовых ${grants.species.length}` : "видовых нет"},{" "}
                {replacedCls ? `классовых и подкласса ${grants.cls.length}` : "классовых нет"}
                {lssFeatNames.length > 0 &&
                  `, черт опознано ${featRows.filter((r) => r.chosen).length} из ${lssFeatNames.length}`}
                . Заменённый текст уходит в «Заметки».
              </span>
            )}
            {/* Черта, которой не нашлось в справочнике: выбрать вручную или
                оставить строкой. Угадывать за игрока нельзя — промах по имени
                привяжет чужую механику. */}
            {replaceGrants && allFeats && unmatchedFeats.length > 0 && (
              <div className="stack" style={{ gap: 4 }}>
                <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                  Не нашлись в справочнике — выберите запись или оставьте текстом:
                </span>
                {unmatchedFeats.map((r) => (
                  <div key={r.raw} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <span style={{ flex: "1 1 160px" }}>{r.raw}</span>
                    <select
                      value=""
                      onChange={(e) =>
                        setFeatPicks((prev) => ({
                          ...prev,
                          [r.raw]: e.target.value === "text" ? "text" : Number(e.target.value),
                        }))
                      }
                    >
                      <option value="">— выбрать черту —</option>
                      <option value="text">оставить текстом</option>
                      {allFeats.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
          <FeatureList title="Особенности вида" items={value.speciesFeatures} onChange={(items) => patch({ speciesFeatures: items })} />
          <FeatureList title="Умения класса" items={value.classFeatures} onChange={(items) => patch({ classFeatures: items })} />
          <FeatureList title="Черты" items={value.feats} onChange={(items) => patch({ feats: items })} />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label style={{ flex: 1, minWidth: 200 }}>Личность<textarea value={value.personalityTraits} rows={2} onChange={(e) => patch({ personalityTraits: e.target.value })} /></label>
            <label style={{ flex: 1, minWidth: 200 }}>Идеалы<textarea value={value.ideals} rows={2} onChange={(e) => patch({ ideals: e.target.value })} /></label>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label style={{ flex: 1, minWidth: 200 }}>Узы<textarea value={value.bonds} rows={2} onChange={(e) => patch({ bonds: e.target.value })} /></label>
            <label style={{ flex: 1, minWidth: 200 }}>Пороки<textarea value={value.flaws} rows={2} onChange={(e) => patch({ flaws: e.target.value })} /></label>
          </div>
          <label>Заметки<textarea value={value.notes} rows={6} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }} onChange={(e) => patch({ notes: e.target.value })} /></label>
          {rawExtras.homelessSections.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                Разделы без дома ({homelessRemaining} осталось): каждый — в Заметки или пропустить.
              </span>
              {rawExtras.homelessSections.map((s) => (
                <details key={s.key} className="card" style={{ padding: 8 }}>
                  <summary style={{ cursor: "pointer", fontSize: "var(--fs-meta)" }}>
                    {s.label} {homelessDone[s.key] ? "✓" : ""}
                  </summary>
                  <div className="muted" style={{ whiteSpace: "pre-wrap", fontSize: "var(--fs-meta)", maxHeight: 160, overflow: "auto" }}>{s.body}</div>
                  {!homelessDone[s.key] && (
                    <div className="row" style={{ gap: 8, marginTop: 6 }}>
                      <button
                        type="button"
                        onClick={() => {
                          patch({ notes: [value.notes, `## ${s.label}\n${s.body}`].filter(Boolean).join("\n\n") });
                          setHomelessDone((m) => ({ ...m, [s.key]: true }));
                        }}
                      >
                        → в Заметки
                      </button>
                      <button type="button" onClick={() => setHomelessDone((m) => ({ ...m, [s.key]: true }))}>Пропустить</button>
                    </div>
                  )}
                </details>
              ))}
            </div>
          )}
        </div>
      )}

      {step === "Обзор" && (
        <div className="stack">
          <div className="card" style={{ padding: 10, fontSize: "var(--fs-meta)" }}>
            <div><strong>{value.characterName || "Без имени"}</strong> · {cls.className} {cls.level} · {value.raceName} · {value.backgroundName}</div>
            <div className="muted">
              Навыков: {Object.keys(value.skillProfs).length} · Атак: {value.attacks.length} ·
              Снаряжения: {value.equipmentSections.reduce((n, s) => n + s.items.length, 0)} ·
              Заклинаний вручную: {manualSpellCount} · Дарованных: {grantedSpells.length} ·
              Бесхозных не разобрано: {homelessRemaining}
            </div>
            {existingCount > 0 && (
              <div className="muted">У персонажа уже {existingCount} чарник(а, ов) — создастся ещё один; лишний удалите после.</div>
            )}
          </div>
          {warnings.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Замечания — прочитайте все ({Object.values(ackWarnings).filter(Boolean).length}/{warnings.length})
              </span>
              {warnings.map((w, i) => (
                <label key={i} className="row" style={{ gap: 8, alignItems: "flex-start", fontSize: "var(--fs-meta)" }}>
                  <input type="checkbox" checked={!!ackWarnings[i]} onChange={(e) => setAckWarnings((m) => ({ ...m, [i]: e.target.checked }))} />
                  <span className="muted"><strong>{w.field}:</strong> {w.message}</span>
                </label>
              ))}
            </div>
          )}
          {avatarNote && <div className="backup-info">{avatarNote}</div>}
          {saveError && <div className="backup-info error" role="alert">{saveError}</div>}
          <div className="row" style={{ justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={onCancel}>Отмена</button>
            <button
              type="button" className="primary" disabled={saving || (warnings.length > 0 && !allAcked)}
              title={warnings.length > 0 && !allAcked ? "Отметьте все замечания прочитанными" : undefined}
              onClick={() => void finish()}
            >
              {saving ? "Сохраняю…" : "Сохранить чарник"}
            </button>
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
        <button type="button" disabled={stepIndex === 0} onClick={back}>← Назад</button>
        {stepIndex < STEPS.length - 1 && <button type="button" className="primary" onClick={next}>Далее →</button>}
      </div>
    </div>
  );
}

// --- Подкомпоненты ---

function AttackRow({ attack, onChange, onRemove }: {
  attack: DndManualAttack;
  onChange: (a: DndManualAttack) => void;
  onRemove: () => void;
}) {
  return (
    <div className="card" style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <input value={attack.name} placeholder="Название" onChange={(e) => onChange({ ...attack, name: e.target.value })} />
        <select value={attack.timing} onChange={(e) => onChange({ ...attack, timing: e.target.value as DndActionTiming })}>
          <option value="action">действие</option>
          <option value="bonus">бонусное</option>
          <option value="reaction">реакция</option>
          <option value="other">прочее</option>
        </select>
        <button type="button" onClick={onRemove}>✕</button>
      </div>
      <input value={attack.description} placeholder="Модификатор и урон" onChange={(e) => onChange({ ...attack, description: e.target.value })} />
      {attack.timing === "other" && (
        <input value={attack.timingOther ?? ""} placeholder="Когда (напр. 10 минут)" onChange={(e) => onChange({ ...attack, timingOther: e.target.value })} />
      )}
    </div>
  );
}

function GearStep({ value, patch, setValue, enrichNote, onQty, onEnrich, rawCoins }: {
  value: DndCharacterData;
  patch: (p: Partial<DndCharacterData>) => void;
  setValue: Dispatch<SetStateAction<DndCharacterData>>;
  enrichNote: string;
  onQty: () => void;
  onEnrich: () => void;
  rawCoins: unknown;
}) {
  const [newItem, setNewItem] = useState("");
  const [newProf, setNewProf] = useState("");
  const items = value.equipmentSections[0]?.items ?? [];
  function setItems(next: DndEquipmentItem[]) {
    setValue((v) => {
      const secs = v.equipmentSections.length > 0 ? v.equipmentSections.slice() : [{ name: "Снаряжение", items: [] }];
      secs[0] = { ...secs[0], items: next };
      return { ...v, equipmentSections: secs };
    });
  }
  return (
    <div className="stack">
      <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
        Предметов: {items.length}. Количество вида «Болты (15)» / «8x» вытаскивается кнопкой; дубли с оружием — удалить.
      </span>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={onQty}>Количество из названий</button>
        <button type="button" onClick={onEnrich}>Обогатить из справочника</button>
        {enrichNote && <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>{enrichNote}</span>}
      </div>
      {items.map((it, i) => (
        <div key={i} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input value={it.name} style={{ flex: 2, minWidth: 140 }} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input value={it.qty} style={{ width: 52 }} placeholder="кол" onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
          <input value={it.notes} style={{ flex: 1, minWidth: 100 }} placeholder="заметка" onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))} />
          {it.entryId ? <span className="muted" title="Слинковано со справочником">✓</span> : null}
          <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="row" style={{ gap: 8 }}>
        <input value={newItem} placeholder="Новый предмет" onChange={(e) => setNewItem(e.target.value)} />
        <button type="button" onClick={() => { if (newItem.trim()) { setItems([...items, { ...EMPTY_EQUIPMENT_ITEM, name: newItem.trim() }]); setNewItem(""); } }}>+</button>
      </div>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label>Настройка<input type="number" min={0} max={9} style={{ width: 60 }} value={value.attunementCount} onChange={(e) => patch({ attunementCount: Math.max(0, Number(e.target.value) || 0) })} /></label>
        {(["cp", "sp", "ep", "gp", "pp"] as const).map((k) => (
          <label key={k}>{k.toUpperCase()}<input value={value.coins[k]} style={{ width: 60 }} onChange={(e) => patch({ coins: { ...value.coins, [k]: e.target.value } })} /></label>
        ))}
      </div>
      {rawCoins != null && typeof rawCoins === "object" && "total" in (rawCoins as object) && (
        <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>В LSS было поле total — значение не трактуем, смотрите сырьё на шаге «Начало».</span>
      )}
      <div className="stack" style={{ gap: 4 }}>
        <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Владения ({value.proficiencies.length})</span>
        {value.proficiencies.map((p, i) => (
          <div key={i} className="row" style={{ gap: 8 }}>
            <input value={p.name} style={{ flex: 1 }} onChange={(e) => patch({ proficiencies: value.proficiencies.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <button type="button" onClick={() => patch({ proficiencies: value.proficiencies.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <div className="row" style={{ gap: 8 }}>
          <input value={newProf} placeholder="Новое владение" onChange={(e) => setNewProf(e.target.value)} />
          <button type="button" onClick={() => { if (newProf.trim()) { patch({ proficiencies: [...value.proficiencies, { entryId: null, name: newProf.trim(), abilityKey: null }] }); setNewProf(""); } }}>+</button>
        </div>
      </div>
    </div>
  );
}

function ApplyLssSlots({ raw, current, pips, onApply }: {
  raw: unknown;
  current: number;
  pips: number[];
  onApply: (levels: number, pips: number[]) => void;
}) {
  if (!raw || typeof raw !== "object") return null;
  const found: { level: number; value: number }[] = [];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const m = /^slots-(\d+)$/.exec(k);
    const val = (v as { value?: unknown } | null)?.value;
    if (m && typeof val === "number" && val > 0) found.push({ level: Number(m[1]), value: val });
  }
  if (found.length === 0) return null;
  return (
    <button
      type="button"
      title={found.map((f) => `${f.value}×${f.level} круг`).join(", ")}
      onClick={() => {
        const next = pips.slice();
        let top = current;
        for (const f of found) {
          if (f.level >= 1 && f.level <= 9) {
            while (next.length < 9) next.push(0);
            next[f.level - 1] = f.value;
            top = Math.max(top, f.level);
          }
        }
        onApply(top, next);
      }}
    >
      Ячейки из LSS ({found.map((f) => `${f.value}×${f.level}`).join(", ")})
    </button>
  );
}

function SpellPicker({ systemId, query, setQuery, matches, ensureIndex, loaded, onAdd }: {
  systemId: number | null;
  query: string;
  setQuery: (q: string) => void;
  matches: CompendiumEntry[];
  ensureIndex: () => void;
  loaded: boolean;
  onAdd: (e: CompendiumEntry) => void;
}) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Добор вручную (поиск по справочнику{systemId ? "" : " — нет системы"})</span>
      <div className="row" style={{ gap: 8 }}>
        <input value={query} placeholder="Название заклинания…" onChange={(e) => setQuery(e.target.value)} onFocus={ensureIndex} />
        {!loaded && <button type="button" onClick={ensureIndex}>Загрузить список</button>}
      </div>
      {loaded && matches.map((e) => (
        <div key={e.id} className="row" style={{ gap: 8, alignItems: "center", fontSize: "var(--fs-meta)" }}>
          <button type="button" onClick={() => onAdd(e)}>+</button>
          <span>{e.name}</span>
          <span className="muted">{(e.level ?? 0) === 0 ? "заговор" : `${e.level} круг`}</span>
        </div>
      ))}
    </div>
  );
}

function FeatChoicePicker({ featName, featEntryId, ensureIndex, loaded, onLoad, onPick }: {
  featName: string;
  featEntryId: number;
  ensureIndex: () => Promise<CompendiumEntry[]>;
  loaded: { entry: CompendiumEntry; picked: number[] } | null;
  onLoad: () => void;
  onPick: (ids: number[], outsideLimit: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number[]>([]);
  const choices = (() => {
    if (!loaded) return [];
    const raw = (loaded.entry.data as Record<string, unknown>).spell_choices;
    return Array.isArray(raw) ? (raw as { count?: number; classIds?: number[]; schools?: string[]; level?: number | null; outsideLimit?: boolean }[]) : [];
  })();
  const [choiceIdx, setChoiceIdx] = useState(0);
  const choice = choices[choiceIdx];
  const [index, setIndex] = useState<CompendiumEntry[] | null>(null);
  useEffect(() => {
    if (open && !index) ensureIndex().then(setIndex).catch(() => setIndex([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);
  const options = (index ?? []).filter((e) => {
    if (loaded && loaded.picked.includes(e.id)) return false;
    if (choice?.level != null && (e.level ?? 0) !== choice.level) return false;
    if (choice?.classIds && choice.classIds.length > 0) {
      const refs = Array.isArray(e.data?.classes) ? (e.data.classes as { id?: number }[]) : [];
      if (!refs.some((r) => typeof r.id === "number" && choice.classIds!.includes(r.id))) return false;
    }
    const qq = q.trim().toLowerCase();
    if (qq && !e.name.toLowerCase().includes(qq)) return false;
    return true;
  }).slice(0, 30);
  return (
    <div className="card" style={{ padding: 8 }}>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: "var(--fs-meta)" }}>✓ {featName} — в справочнике</span>
        <button type="button" onClick={() => { if (!loaded) onLoad(); setOpen((o) => !o); }}>{open ? "Скрыть" : "Подобрать"}</button>
      </div>
      {open && (
        <div className="stack" style={{ gap: 4, marginTop: 6 }}>
          {loaded && choices.length === 0 && <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>У черты нет выборов заклинаний в данных.</span>}
          {choices.length > 1 && (
            <select value={choiceIdx} onChange={(e) => { setChoiceIdx(Number(e.target.value)); setSel([]); }}>
              {choices.map((c, i) => (
                <option key={i} value={i}>Выбор {i + 1}: {c.count ?? 1} шт{c.level != null ? (c.level === 0 ? " (заговоры)" : ` (${c.level} круг)`) : ""}</option>
              ))}
            </select>
          )}
          {choice && (
            <>
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                Выбрать: {sel.length}/{choice.count ?? 1}
                {choice.schools && choice.schools.length > 0 ? ` · школы: ${choice.schools.join(", ")}` : ""}
              </span>
              <input value={q} placeholder="Поиск…" onChange={(e) => setQ(e.target.value)} />
              {options.map((e) => (
                <label key={e.id} className="row" style={{ gap: 6, fontSize: "var(--fs-meta)" }}>
                  <input
                    type="checkbox" checked={sel.includes(e.id)}
                    onChange={() => setSel((prev) => {
                      if (prev.includes(e.id)) return prev.filter((x) => x !== e.id);
                      return prev.length < (choice.count ?? 1) ? [...prev, e.id] : prev;
                    })}
                  />
                  {e.name}
                </label>
              ))}
              <button
                type="button" disabled={sel.length === 0}
                onClick={() => { onPick(sel, choice.outsideLimit !== false); setSel([]); }}
              >
                Добавить выбранные ({sel.length})
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SpellLists({ value, onRemove }: {
  value: DndCharacterData;
  onRemove: (level: number, idx: number) => void;
}) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      {value.cantrips.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Заговоры ({value.cantrips.length})</span>
          {value.cantrips.map((s, i) => (
            <div key={i} className="row" style={{ gap: 8, fontSize: "var(--fs-meta)" }}>
              <button type="button" onClick={() => onRemove(0, i)}>✕</button>
              <span>{s.name}{s.outsideLimit ? " ∞" : ""}{s.sourceParentId ? " (выдача)" : ""}</span>
            </div>
          ))}
        </div>
      )}
      {value.spellsByLevel.map((lvl, li) =>
        lvl.length > 0 ? (
          <div key={li} className="stack" style={{ gap: 2 }}>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>{li + 1} круг ({lvl.length})</span>
            {lvl.map((s, i) => (
              <div key={i} className="row" style={{ gap: 8, fontSize: "var(--fs-meta)" }}>
                <button type="button" onClick={() => onRemove(li + 1, i)}>✕</button>
                <span>{s.name}{s.outsideLimit ? " ∞" : ""}{s.sourceParentId ? " (выдача)" : ""}</span>
              </div>
            ))}
          </div>
        ) : null
      )}
    </div>
  );
}

function FeatureList({ title, items, onChange }: {
  title: string;
  items: DndFeature[];
  onChange: (items: DndFeature[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>{title} ({items.length})</span>
      {items.map((f, i) => (
        <div key={i} className="card" style={{ padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="row" style={{ gap: 8 }}>
            <input value={f.name} style={{ flex: 1 }} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
          </div>
          <textarea value={f.description} rows={3} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
          <button
            type="button" style={{ alignSelf: "flex-start" }}
            title="Разбить описание по строкам на отдельные умения"
            onClick={() => {
              const parts = f.description.split("\n").map((s) => s.trim()).filter(Boolean);
              if (parts.length < 2) return;
              const split: DndFeature[] = parts.map((p, k) => ({
                name: k === 0 ? f.name : `${f.name} · ${k + 1}`,
                description: k === 0 ? p : p,
              }));
              onChange([...items.slice(0, i), ...split, ...items.slice(i + 1)]);
            }}
          >
            Разбить по строкам
          </button>
        </div>
      ))}
      <div className="row" style={{ gap: 8 }}>
        <input value={draft} placeholder="Новое умение" onChange={(e) => setDraft(e.target.value)} />
        <button type="button" onClick={() => { if (draft.trim()) { onChange([...items, { name: draft.trim(), description: "" }]); setDraft(""); } }}>+</button>
      </div>
    </div>
  );
}
