// Лист D&D: владения, боевые стили, выборы умений, мастерство оружия и навыки.
import type { DndClassEntry, DndFeature, CompendiumEntry, DndMasteredWeapon, DndProficiencyKind, DndProficiencyEntry, DndCharacterData, DndSkillProfLevel, DndAbilityKey } from "../../types";
import { nameMatches } from "./dndResources";
import { useState, useEffect, useMemo } from "react";
import { type ChoiceDef, choicesFromEntries, sumEntrySlots } from "./dndFeatures";
import { loadDndClassFeatures, loadDndMechanicsGroupEntries, loadDndEquipmentEntries } from "./dndCompendium";
import { readResource } from "../../data/imperative";
import { totalCharacterLevel, ABILITY_NAME_TO_KEY, parseBonus, ABILITY_LABELS, abilityModifier, formatModifier } from "./AbilityScores";
import { isMasterableWeapon, WeaponMasteryPicker } from "./StartingEquipmentPicker";
import { useCompendiumEntries } from "./useCompendiumEntries";
import { Modal } from "../Modal";
import { NavIcon } from "../NavIcons";
import { MentionText } from "../mentions/MentionText";
import type { DndSkills, SkillRow } from "./useDndSkills";
import { loadDndPrefs } from "../../dndPrefs";
import { SKILL_TITLES, computed as computeSkillValue, SKILL_DOTS } from "./AbilitySavesSkills";
import { SheetModalHead } from "./sheetShared";

// Счётчик черт боевого стиля (тикет 03): положено — 1 за Воина + 1 за
// Чемпиона 7+; есть — строки с entryId из категории «Боевой Стиль».
// Пик — дропом черты в «Черты» выше (с entryId строка живёт связанной);
// замена черты при уровне — тикет 08.
export function FightingStyleCounter({
  classes,
  feats,
  getEntry,
}: {
  classes: DndClassEntry[];
  feats: DndFeature[];
  getEntry: (id: number | null | undefined) => CompendiumEntry | undefined;
}) {
  const owed = classes.reduce(
    (n, c) =>
      n +
      // classId не требуем: freehand-строка «Воин» без ссылки — тоже воин.
      (nameMatches(c.className, "Воин") ? 1 : 0) +
      (c.subclassName && nameMatches(c.subclassName, "Чемпион") && c.level >= 7 ? 1 : 0),
    0
  );
  if (owed === 0) return null;
  const have = feats.filter(
    (f) =>
      typeof f.entryId === "number" &&
      (getEntry(f.entryId)?.data.category as string | undefined) === "Боевой Стиль"
  ).length;
  return (
    <span className="muted">
      Боевой стиль: {have} из {owed}
      {have < owed ? " — перетяни черту из поиска в «Черты» выше" : ""}
      {have > owed ? " — лишние убери руками" : ""}
    </span>
  );
}

// Счётчик выборов из каталога (приёмы/выстрелы, тикет 05): лимит — сумма
// count открытых уровнем дефов kind entry на умениях классов, подклассов
// и черт (черты — бонусные пики вроде воззваний, тикет 02 warlock); есть —
// строки «Особых умений» с entryId из группы дефа. Пик — дропом из поиска
// (с entryId строка живёт связанной); замена — тикет 08.
export function EntryChoiceCounter({
  classes,
  abilities,
  feats,
  systemId,
}: {
  classes: DndClassEntry[];
  abilities: DndFeature[];
  feats: DndFeature[];
  systemId: number | null;
}) {
  const [defsBySub, setDefsBySub] = useState<Record<number, ChoiceDef[]>>({});
  const [defsByClass, setDefsByClass] = useState<Record<number, ChoiceDef[]>>({});
  const [featDefs, setFeatDefs] = useState<ChoiceDef[]>([]);
  const [catalogs, setCatalogs] = useState<Record<string, CompendiumEntry[]>>({});
  const subKey = classes.map((c) => `${c.subclassId ?? ""}:${c.level}`).join(",");
  useEffect(() => {
    if (!systemId) return;
    const ids = [...new Set(classes.map((c) => c.subclassId).filter((id): id is number => typeof id === "number"))];
    if (ids.length === 0) return;
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    Promise.all(
      ids.map((id) => loadDndClassFeatures(systemId, id, opts).then((es) => [id, choicesFromEntries(es, false)] as const))
    )
      .then((pairs) => {
        setDefsBySub((prev) => {
          const next = { ...prev };
          for (const [id, defs] of pairs) next[id] = defs.filter((d) => d.kind === "entry" && d.group);
          return next;
        });
      })
      .catch(() => {
        /* тихий пропуск: без дефов счётчика нет, лист работает */
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, subKey]);
  // Дефы классов (воззвания колдуна живут на классовом умении, а не на
  // подклассе, как приёмы БМ) — тем же приёмом, ключом classId.
  const classKey = classes.map((c) => `${c.classId ?? ""}:${c.level}`).join(",");
  useEffect(() => {
    if (!systemId) return;
    const ids = [...new Set(classes.map((c) => c.classId).filter((id): id is number => typeof id === "number"))];
    if (ids.length === 0) return;
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    Promise.all(
      ids.map((id) => loadDndClassFeatures(systemId, id, opts).then((es) => [id, choicesFromEntries(es, true)] as const))
    )
      .then((pairs) => {
        setDefsByClass((prev) => {
          const next = { ...prev };
          for (const [id, defs] of pairs) next[id] = defs.filter((d) => d.kind === "entry" && d.group);
          return next;
        });
      })
      .catch(() => {
        /* тихий пропуск */
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, classKey]);
  // Дефы черт (бонусные пики): уровень гейта — суммарный уровень персонажа,
  // черты ни к какому классу не привязаны.
  const featKey = feats.map((f) => f.entryId ?? "").join(",");
  useEffect(() => {
    if (!systemId) return;
    const ids = [...new Set(feats.map((f) => f.entryId).filter((id): id is number => typeof id === "number"))];
    if (ids.length === 0) {
      setFeatDefs([]);
      return;
    }
    const ac = new AbortController();
    Promise.all(
      ids.map((id) =>
        readResource<CompendiumEntry>(`/systems/entries/${id}`)
          .then((e) => choicesFromEntries([e], false))
          .catch(() => [] as ChoiceDef[])
      )
    )
      .then((lists) => {
        if (ac.signal.aborted) return;
        setFeatDefs(lists.flat().filter((d) => d.kind === "entry" && d.group));
      })
      .catch(() => {
        /* тихий пропуск */
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, featKey]);
  const groupsKey = [...Object.values(defsBySub), ...Object.values(defsByClass), featDefs]
    .flat()
    .map((d) => d.group ?? "")
    .filter(Boolean)
    .sort()
    .join("|");
  useEffect(() => {
    if (!systemId || !groupsKey) return;
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    Promise.all(
      groupsKey.split("|").map((g) => loadDndMechanicsGroupEntries(systemId, g, opts).then((es) => [g, es] as const))
    )
      .then((pairs) => {
        setCatalogs((prev) => {
          const next = { ...prev };
          for (const [g, es] of pairs) if (!(g in next)) next[g] = es;
          return next;
        });
      })
      .catch(() => {
        /* тихий пропуск */
      });
    return () => ac.abort();
  }, [systemId, groupsKey]);
  // Лимиты — общим хелпером sumEntrySlots (он же у визарда): классовые и
  // подклассовые дефы открываются уровнем своего класса, дефы черт —
  // суммарным уровнем персонажа.
  const slotSources = [
    ...classes.flatMap((c) => [
      ...(defsByClass[c.classId ?? -1] ?? []).map((def) => ({ def, level: c.level })),
      ...(c.subclassId != null ? (defsBySub[c.subclassId] ?? []) : []).map((def) => ({ def, level: c.level })),
    ]),
    ...featDefs.map((def) => ({ def, level: totalCharacterLevel(classes) })),
  ];
  const rows: { key: string; group: string; picked: number; total: number }[] = [];
  {
    const slots = sumEntrySlots(slotSources);
    const pickIds = new Set(
      abilities.map((f) => f.entryId).filter((id): id is number => typeof id === "number")
    );
    for (const g of slots) {
      const inGroup = new Set((catalogs[g.group] ?? []).map((e) => e.id));
      // Каталог ещё грузится — строку не показываем, чтобы не врать нулями.
      if (!(g.group in catalogs)) continue;
      const picked = [...pickIds].filter((id) => inGroup.has(id)).length;
      rows.push({ key: g.key, group: g.group, picked, total: g.total });
    }
  }
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((r) => (
        <span key={r.key} className="muted">
          {r.group}: {r.picked} из {r.total}
          {r.picked < r.total ? " — добери дропом из поиска в «Особые умения»" : ""}
          {r.picked > r.total ? " — лишние убери руками" : ""}
        </span>
      ))}
    </>
  );
}

// Правка освоенного оружия (тикет 06): лимит — сумма count открытых
// уровнем дефов kind weapon на умениях классов; пик — общим пикером.
// Смена оружия на долгом отдыхе — напоминанием в 08, здесь поле и пик.
export function WeaponMasteryEdit({
  classes,
  mastered,
  systemId,
  onChange,
}: {
  classes: DndClassEntry[];
  mastered: DndMasteredWeapon[];
  systemId: number | null;
  onChange?: (v: DndMasteredWeapon[]) => void;
}) {
  const [defs, setDefs] = useState<{ level: number; def: ChoiceDef }[]>([]);
  const [catalog, setCatalog] = useState<CompendiumEntry[] | null>(null);
  const classKey = classes.map((c) => `${c.classId ?? ""}:${c.level}`).join(",");
  useEffect(() => {
    if (!systemId) return;
    const rows = classes.filter((c) => c.classId != null) as { classId: number; level: number }[];
    if (rows.length === 0) return;
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    Promise.all(
      rows.map((c) =>
        loadDndClassFeatures(systemId, c.classId, opts).then(
          (es) => ({ level: c.level, defs: choicesFromEntries(es, true) }) as const
        )
      )
    )
      .then((lists) => {
        setDefs(lists.flatMap((l) => l.defs.filter((d) => d.kind === "weapon").map((def) => ({ level: l.level, def }))));
      })
      .catch(() => {
        /* тихий пропуск: без дефов правки нет, лист работает */
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, classKey]);
  // Справочник оружия грузится один раз, когда появились выборы мастерства, —
  // не на каждую их перечитку.
  const hasDefs = defs.length > 0;
  useEffect(() => {
    if (!systemId || !hasDefs) return;
    const ac = new AbortController();
    loadDndEquipmentEntries(systemId, { signal: ac.signal })
      .then((rows) => setCatalog(rows.filter(isMasterableWeapon)))
      .catch(() => {
        setCatalog([]);
      });
    return () => ac.abort();
  }, [systemId, hasDefs]);
  if (defs.length === 0) return null;
  const limit = defs.reduce((n, { level, def }) => n + (def.minLevel <= level ? def.count : 0), 0);
  if (limit <= 0) return null;
  const pickedIds = mastered.map((w) => w.entryId).filter((id): id is number => typeof id === "number");
  function toggle(entry: CompendiumEntry) {
    if (!onChange) return;
    if (pickedIds.includes(entry.id)) {
      onChange(mastered.filter((w) => w.entryId !== entry.id));
      return;
    }
    if (pickedIds.length >= limit) return;
    onChange([...mastered, { entryId: entry.id, name: entry.name }]);
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
      {catalog === null ? (
        <span className="muted">Загружаю оружие…</span>
      ) : (
        <WeaponMasteryPicker
          title="Оружейные приёмы"
          entries={catalog}
          pickedIds={pickedIds}
          limit={limit}
          onToggle={toggle}
        />
      )}
    </div>
  );
}

// Владения тремя группами (гриллинг 2026-09-26): оружие и доспехи,
// инструменты и игровые наборы, языки. Категория пишется в строку списком,
// из которого её взяли (kind); у старых листов и вписанного руками без неё —
// угадывается по имени.
const PROF_KINDS: { kind: DndProficiencyKind; title: string }[] = [
  { kind: "gear", title: "Оружие и доспехи" },
  { kind: "tools", title: "Инструменты и игровые наборы" },
  { kind: "language", title: "Языки" },
];
const LANGUAGE_NAME_RE =
  /язык|жаргон|речь|^(общий|драконий|дварфский|эльфийский|великаний|гномий|гоблинский|полуросликов|орочий|бездны|небесный|друидический|инфернальный|первичный|сильван|подземный)$/i;
function proficiencyKind(p: DndProficiencyEntry): DndProficiencyKind {
  if (p.kind) return p.kind;
  const name = p.name.trim();
  if (LANGUAGE_NAME_RE.test(name)) return "language";
  if (/оружи|доспех|щит/i.test(name)) return "gear";
  return "tools";
}

// Окно владения: описание из справочника (если есть) и «Убрать владение»
// (Q4: крестика на плашке больше нет).
function ProficiencyInfoModal({
  prof,
  onRemove,
  onClose,
}: {
  prof: DndProficiencyEntry;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const getEntry = useCompendiumEntries([prof.entryId]);
  const entry = getEntry(prof.entryId);
  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-spell-modal">
        <SheetModalHead title={prof.name} onClose={onClose} />
        {prof.entryId != null && (entry ? entry.description?.trim() ? <MentionText text={entry.description} /> : null : <span className="muted">Загрузка…</span>)}
        {onRemove && (
          <button type="button" style={{ alignSelf: "flex-start" }} onClick={onRemove}>
            Убрать владение
          </button>
        )}
      </div>
    </Modal>
  );
}

// Выбор владений: три списка рядом (телефон — друг под другом), общий
// поиск, отметить несколько и «Добавить N»; под каждым списком — «Своё…».
function ProficiencyPickerModal({
  systemId,
  owned,
  onPick,
  onClose,
}: {
  systemId: number | null;
  owned: DndProficiencyEntry[];
  onPick: (items: DndProficiencyEntry[]) => void;
  onClose: () => void;
}) {
  const [lists, setLists] = useState<Record<DndProficiencyKind, CompendiumEntry[]> | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlyMap<string, DndProficiencyEntry>>(new Map());
  const [custom, setCustom] = useState<Record<DndProficiencyKind, string>>({ gear: "", tools: "", language: "" });
  useEffect(() => {
    if (!systemId) {
      setLists({ gear: [], tools: [], language: [] });
      return;
    }
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    const safe = (pr: Promise<CompendiumEntry[]>) => pr.catch(() => [] as CompendiumEntry[]);
    Promise.all([
      safe(loadDndMechanicsGroupEntries(systemId, "Владения оружием", opts)),
      safe(loadDndMechanicsGroupEntries(systemId, "Владения доспехами", opts)),
      safe(loadDndEquipmentEntries(systemId, opts)),
      safe(loadDndMechanicsGroupEntries(systemId, "Языки", opts)),
    ]).then(([weapons, armor, equipment, languages]) => {
      if (ac.signal.aborted) return;
      const tools = equipment
        .filter(
          (e) =>
            e.kind === "equipment" &&
            (e.data.category === "Инструменты" || e.data.category === "Ремесленные инструменты")
        )
        .sort((x, y) => x.name.localeCompare(y.name, "ru"));
      setLists({ gear: [...weapons, ...armor], tools, language: languages });
    });
    return () => ac.abort();
  }, [systemId]);
  const ownedIds = new Set(owned.map((p) => p.entryId).filter((id): id is number => id != null));
  const ownedNames = new Set(owned.map((p) => p.name.trim().toLowerCase()));
  const isOwned = (e: CompendiumEntry) => ownedIds.has(e.id) || ownedNames.has(e.name.trim().toLowerCase());
  const q = query.trim().toLowerCase();
  function toggle(kind: DndProficiencyKind, e: CompendiumEntry) {
    setPicked((prev) => {
      const next = new Map(prev);
      const key = `e${e.id}`;
      if (next.has(key)) next.delete(key);
      else
        next.set(key, {
          entryId: e.id,
          name: e.name,
          abilityKey: typeof e.data.ability === "string" ? (ABILITY_NAME_TO_KEY[e.data.ability] ?? null) : null,
          kind,
        });
      return next;
    });
  }
  function addCustom(kind: DndProficiencyKind) {
    const name = custom[kind].trim();
    if (!name) return;
    setPicked((prev) => new Map(prev).set(`c${kind}:${name.toLowerCase()}`, { entryId: null, name, abilityKey: null, kind }));
    setCustom((c) => ({ ...c, [kind]: "" }));
  }
  const customPicked = [...picked.entries()].filter(([k]) => k.startsWith("c"));
  return (
    <Modal wide className="dnd-prof-picker-modal" onClose={onClose}>
      <div className="stack dnd-prof-picker">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Добавить владение</h3>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        <input type="search" placeholder="Поиск по всем трём спискам" value={query} onChange={(e) => setQuery(e.target.value)} />
        {lists === null ? (
          <span className="muted">Загрузка…</span>
        ) : (
          <div className="dnd-prof-picker-cols">
            {PROF_KINDS.map(({ kind, title }) => (
              <section key={kind} className="dnd-prof-picker-col" aria-label={title}>
                <div className="dnd-spell-picker-group">
                  <span>{title}</span>
                </div>
                {lists[kind]
                  .filter((e) => !q || e.name.toLowerCase().includes(q))
                  .map((e) => {
                    const locked = isOwned(e);
                    const on = locked || picked.has(`e${e.id}`);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        className={`dnd-spell-pick-row${on && !locked ? " is-picked" : ""}`}
                        disabled={locked}
                        aria-pressed={on}
                        onClick={() => toggle(kind, e)}
                      >
                        <span className="dnd-pick-box" aria-hidden="true">
                          {on && (
                            <svg viewBox="0 0 18 18">
                              <path d="M3 9 L7 13 L15 4" fill="none" stroke="currentColor" strokeWidth="2.6" />
                            </svg>
                          )}
                        </span>
                        <span className="dnd-spell-pick-name">{e.name}</span>
                        {locked && <span className="dnd-spell-pick-circle">есть</span>}
                      </button>
                    );
                  })}
                {customPicked
                  .filter(([, p]) => p.kind === kind)
                  .map(([k, p]) => (
                    <button
                      key={k}
                      type="button"
                      className="dnd-spell-pick-row is-picked"
                      aria-pressed
                      onClick={() =>
                        setPicked((prev) => {
                          const next = new Map(prev);
                          next.delete(k);
                          return next;
                        })
                      }
                    >
                      <span className="dnd-pick-box" aria-hidden="true">
                        <svg viewBox="0 0 18 18">
                          <path d="M3 9 L7 13 L15 4" fill="none" stroke="currentColor" strokeWidth="2.6" />
                        </svg>
                      </span>
                      <span className="dnd-spell-pick-name">{p.name}</span>
                      <span className="dnd-spell-pick-circle">своё</span>
                    </button>
                  ))}
                <input
                  className="dnd-prof-picker-custom"
                  placeholder="Своё… (Enter)"
                  aria-label={`${title}: своё`}
                  value={custom[kind]}
                  onChange={(e) => setCustom((c) => ({ ...c, [kind]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addCustom(kind);
                  }}
                  onBlur={() => addCustom(kind)}
                />
              </section>
            ))}
          </div>
        )}
        <div className="row picker-footer" style={{ gap: 8, justifyContent: "flex-end" }}>
          <span className="muted" style={{ marginRight: "auto" }}>
            Отмечено <strong>{picked.size}</strong>
          </span>
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="primary" disabled={picked.size === 0} onClick={() => onPick([...picked.values()])}>
            Добавить{picked.size > 0 ? ` ${picked.size}` : ""}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DndProficienciesView({
  value,
  systemId,
  onChange,
}: {
  value: DndProficiencyEntry[];
  systemId: number | null;
  onChange?: (v: DndProficiencyEntry[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (value.length === 0 && !onChange) return null;
  const open = openIndex != null ? value[openIndex] : undefined;
  return (
    <div className="sb-entry">
      <span className="sb-prop-label">Владения и языки</span>
      {PROF_KINDS.map(({ kind, title }) => {
        const rows = value.map((p, i) => ({ p, i })).filter(({ p }) => proficiencyKind(p) === kind);
        if (rows.length === 0) return null;
        return (
          <div key={kind} className="dnd-prof-group">
            <span className="dnd-prof-group-title">{title}</span>
            <div className="dnd-proficiency-chips">
              {rows.map(({ p, i }) =>
                p.entryId != null || onChange ? (
                  <button key={i} type="button" className="dnd-proficiency-chip" onClick={() => setOpenIndex(i)}>
                    {p.name}
                  </button>
                ) : (
                  <span key={i} className="dnd-proficiency-chip">
                    {p.name}
                  </span>
                )
              )}
            </div>
          </div>
        );
      })}
      {onChange && (
        <button type="button" className="dnd-chip dnd-prof-add" onClick={() => setPicking(true)}>
          + добавить владение
        </button>
      )}
      {open && (
        <ProficiencyInfoModal
          prof={open}
          onClose={() => setOpenIndex(null)}
          onRemove={
            onChange
              ? () => {
                  onChange(value.filter((_, idx) => idx !== openIndex));
                  setOpenIndex(null);
                }
              : undefined
          }
        />
      )}
      {picking && onChange && (
        <ProficiencyPickerModal
          systemId={systemId}
          owned={value}
          onClose={() => setPicking(false)}
          onPick={(items) => {
            onChange([...value, ...items]);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

// Flat list of all skills — either grouped by governing ability (default,
// matches the old nested-under-ability order) or alphabetical, per the
// "ДнД 5.5" section in Настройки → Внешний вид (dndPrefs.ts).
export function DndSkillsView({
  abilities,
  proficiencyBonus,
  skillProfs,
  classSkillPool: pool,
  backgroundSkillNames,
  proficiencies,
  skills,
  systemId,
  onQuickUpdate,
  highlight,
  exhaustionPenalty = 0,
}: {
  abilities: DndCharacterData["abilities"];
  proficiencyBonus: string;
  skillProfs: Record<string, DndSkillProfLevel>;
  classSkillPool: string[];
  backgroundSkillNames: string[];
  proficiencies: DndProficiencyEntry[];
  /** Встроенный каталог навыков, уточнённый справочником (useDndSkills). */
  skills: DndSkills;
  /** Система — для списка инструментов (добавить владение). */
  systemId: number | null;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
  /** Ключ строки, на которую увёл поиск (см. DndSheetSearch). */
  highlight?: string | null;
  /** Штраф истощения: −2 за уровень к любому броску к20 (5.5). */
  exhaustionPenalty?: number;
}) {
  const profBonus = parseBonus(proficiencyBonus);
  const rows = useMemo(() => {
    // Порядок — по характеристикам, как мастер ищет строку глазами; навык,
    // заведённый мастером, встроенного порядка не знает и идёт в конец своей
    // группы, а без характеристики — в самый конец (гриллинг 2026-09-04).
    const byAbility = new Map<DndAbilityKey, typeof skills.rows>();
    const tail: typeof skills.rows = [];
    for (const row of skills.rows) {
      if (!row.ability) {
        tail.push(row);
        continue;
      }
      const list = byAbility.get(row.ability) ?? [];
      list.push(row);
      byAbility.set(row.ability, list);
    }
    const all: { row: SkillRow; abilityLabel: string }[] = [];
    for (const { key, label } of ABILITY_LABELS) {
      for (const row of byAbility.get(key) ?? []) all.push({ row, abilityLabel: label });
    }
    for (const row of tail) all.push({ row, abilityLabel: "—" });
    const prefs = loadDndPrefs();
    if (prefs.skillSortMode === "alphabet") {
      return [...all].sort((a, b) => a.row.name.localeCompare(b.row.name, "ru"));
    }
    return all;
  }, [skills.rows]);

  // Владения, которые лист сохранил, но свести не смог — например навык из
  // чужого модуля. Раньше такие просто не показывались: строки с таким именем
  // в списке нет, и владение исчезало с глаз, оставаясь в данных.
  const unresolved = useMemo(() => {
    const known = new Set(skills.rows.map((r) => r.original));
    return Object.entries(skillProfs)
      .filter(([key, level]) => (level ?? 0) > 0 && !known.has(key))
      .map(([key, level]) => ({ key, level: level as DndSkillProfLevel }));
  }, [skillProfs, skills.rows]);

  return (
    <div className="stack">
      {/* Легенда (макет 2026-09-25): квадрат владения и источник в скобках
          заменили заливку строки — тона темы делали её нечитаемой на бумаге. */}
      <div className="dnd-skills-legend">
        <span><span className="dnd-prof-box is-0" aria-hidden="true" /> нет</span>
        <span><span className="dnd-prof-box is-1" aria-hidden="true" /> владение</span>
        <span><span className="dnd-prof-box is-2" aria-hidden="true" /> экспертиза</span>
        <span>· тап по квадрату — сменить · [в скобках] — откуда навык</span>
      </div>
      <div className="dnd-skills-groups">
        {(() => {
          // Группы по характеристике — как строки уже упорядочены; при
          // сортировке по алфавиту группа одна, без заголовка.
          const alphabet = loadDndPrefs().skillSortMode === "alphabet";
          const groups: { label: string; items: typeof rows }[] = [];
          for (const item of rows) {
            const key = alphabet ? "" : item.abilityLabel;
            const last = groups[groups.length - 1];
            if (last && last.label === key) last.items.push(item);
            else groups.push({ label: key, items: [item] });
          }
          const sourceTag = (skill: string) => {
            const fromClass = pool.includes(skill);
            const fromBackground = backgroundSkillNames.includes(skill);
            if (fromClass && fromBackground) return "класс · предыст.";
            if (fromClass) return "класс";
            if (fromBackground) return "предыст.";
            return "";
          };
          return groups.map((g) => {
            const ab = ABILITY_LABELS.find((a) => a.label === g.label);
            const mod = ab ? abilityModifier(abilities[ab.key]) : null;
            const full = ab ? Object.keys(ABILITY_NAME_TO_KEY).find((n) => ABILITY_NAME_TO_KEY[n] === ab.key) : null;
            return (
              <section key={g.label || "all"} className="dnd-skills-group">
                {g.label && (
                  <h3 className="dnd-skills-group-head">
                    {full ?? g.label}
                    {mod != null && (
                      <span>
                        {g.label} {formatModifier(mod)}
                      </span>
                    )}
                  </h3>
                )}
                <div className="dnd-save-skill-col dnd-skills-tab">
                  {g.items.map(({ row, abilityLabel }) => {
                    const skill = row.original;
                    // Без характеристики (навык мастера, у которого её не задали)
                    // модификатор считается только от бонуса мастерства: врать
                    // числом хуже, чем показать меньшее.
                    const mod = row.ability ? abilityModifier(abilities[row.ability]) : 0;
                    const level = skillProfs[skill] ?? 0;
                    const tag = sourceTag(skill);
                    return (
                      <div
                        key={skill}
                        className={`dnd-save-row${level > 0 ? " is-proficient" : ""}${level === 2 ? " is-expertise" : ""}${highlight === `skill-${skill}` ? " is-search-hit" : ""}`}
                      >
                        <button
                          type="button"
                          className="dnd-save-dot-btn dnd-prof-btn"
                          title={SKILL_TITLES[level]}
                          aria-label={`${row.name}: ${SKILL_TITLES[level]} — сменить`}
                          disabled={!onQuickUpdate}
                          onClick={() =>
                            onQuickUpdate?.({
                              skillProfs: { ...skillProfs, [skill]: ((level + 1) % 3) as DndSkillProfLevel },
                            })
                          }
                        >
                          <span className={`dnd-prof-box is-${level}`} aria-hidden="true" />
                        </button>
                        <span className="dnd-save-name">
                          {row.name}
                          {(alphabet || !row.ability) && <span className="muted"> ({abilityLabel})</span>}
                          {tag && <span className="dnd-skill-tag"> [{tag}]</span>}
                        </span>
                        <span className="dnd-save-value">{computeSkillValue(mod, level, profBonus, exhaustionPenalty)}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          });
        })()}
      </div>
      {unresolved.length > 0 && (
        <div className="dnd-save-skill-col dnd-skills-unresolved">
          <div className="sb-label">Нет в справочнике</div>
          {unresolved.map(({ key, level }) => (
            <div
              key={key}
              className={`dnd-save-row${level > 0 ? " is-proficient" : ""}${level === 2 ? " is-expertise" : ""}`}
            >
              <button
                type="button"
                className="dnd-save-dot-btn"
                title={SKILL_TITLES[level]}
                aria-label={`${key}: ${SKILL_TITLES[level]} — сменить`}
                disabled={!onQuickUpdate}
                onClick={() =>
                  onQuickUpdate?.({
                    skillProfs: { ...skillProfs, [key]: ((level + 1) % 3) as DndSkillProfLevel },
                  })
                }
              >
                {SKILL_DOTS[level]}
              </button>
              <span className="dnd-save-name">{key}</span>
            </div>
          ))}
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
            Владение сохранено, но такого навыка в справочнике системы нет. Свести
            имена — Системы → D&D 5.5 → Справочник → Навыки.
          </span>
        </div>
      )}
      <DndProficienciesView
        value={proficiencies}
        systemId={systemId}
        onChange={onQuickUpdate ? (v) => onQuickUpdate({ proficiencies: v }) : undefined}
      />
    </div>
  );
}
