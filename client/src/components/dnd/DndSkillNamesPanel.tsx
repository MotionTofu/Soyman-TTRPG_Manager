import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { Character, CompendiumEntry, Statblock, SystemSection } from "../../types";
import { useConfirm } from "../../hooks/useConfirm";
import { NavIcon } from "../NavIcons";
import { ABILITY_NAME_TO_KEY } from "./AbilityScores";
import { errorMessage, isAbortError, loadDndSkillEntries, type DndSkillEntry } from "./dndCompendium";
import { normalizeSkillKey, resolveSkillOriginal } from "./skillCatalog";

/**
 * Сверка имён навыков.
 *
 * Зачем экран вообще нужен. Навык в листе персонажа опознаётся по ключу
 * (`name_original`), а классы, предыстории и импорты пишут имя как придётся —
 * «Расследование», «Анализ», «Внимательность», «Тайная магия». Известные
 * написания сводит встроенный каталог, но следующая книга или чужой модуль
 * принесёт своё, и тогда владение молча не выдастся. Здесь эти имена видно
 * списком, и здесь же они сводятся — один раз и для всей системы.
 *
 * Почему не в самом листе. Правка общего справочника из карточки персонажа —
 * это настройка в момент вождения: мастер открыл лист игрока посреди боя и
 * получил предложение переименовать навык во всей системе. Лист только
 * называет проблему и отсылает сюда (гриллинг 2026-09-04).
 */

interface Unresolved {
  /** Имя, как оно написано в источнике. */
  name: string;
  /** Где встретилось — для строки «откуда пришло». */
  where: string[];
  /** Записи-источники и поле, чтобы уметь переименовать на месте. */
  sources: { entryId: number; entryName: string; field: "skills" | "skill_choice_options" }[];
}

const ABILITY_NAMES = Object.keys(ABILITY_NAME_TO_KEY);

export function DndSkillNamesPanel({ systemId }: { systemId: number }) {
  const [skills, setSkills] = useState<DndSkillEntry[] | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [sectionId, setSectionId] = useState<number | null>(null);
  const [sourceEntries, setSourceEntries] = useState<CompendiumEntry[] | null>(null);
  const [sheetNames, setSheetNames] = useState<Map<string, string[]> | null>(null);
  const [scanningSheets, setScanningSheets] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const opts = { signal };
      const [entries, sections] = await Promise.all([
        loadDndSkillEntries(systemId, opts),
        api.get<SystemSection[]>(`/systems/${systemId}/sections`, { signal }),
      ]);
      setSkills(entries);
      // Разделов «Справочник» может быть несколько (базовый плюс приехавший
      // импортом) — группу «Навыки» ищем во всех, а новый навык заводим в тот
      // раздел, где группа и нашлась.
      const mechSections = sections.filter((s) => s.kind === "mechanics");
      setGroupId(null);
      setSectionId(null);
      for (const mech of mechSections) {
        const all = await api.get<CompendiumEntry[]>(
          `/systems/${systemId}/entries?section_id=${mech.id}`,
          { signal }
        );
        const group = all.find((e) => e.parent_id === null && e.name === "Навыки");
        if (group) {
          setGroupId(group.id);
          setSectionId(mech.id);
          break;
        }
      }
      // Классы и предыстории — источники имён. Их разделы отдельные от
      // Справочника, поэтому забираем оба.
      const kinds = sections.filter((s) => s.kind === "class" || s.kind === "background");
      const lists = await Promise.all(
        kinds.map((s) =>
          api.get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${s.id}`, { signal })
        )
      );
      setSourceEntries(lists.flat());
    },
    [systemId]
  );

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal).catch((e) => {
      if (!isAbortError(e)) setError(errorMessage(e));
    });
    return () => ac.abort();
  }, [load]);

  // Алиасы справочника → ключ. Тем же занят `useDndSkills`, но здесь нужен и
  // обратный ответ «кем занято», поэтому карта своя.
  const holderByKey = useMemo(() => {
    const map = new Map<string, DndSkillEntry>();
    for (const e of skills ?? []) {
      for (const key of [e.name, ...e.aliases]) map.set(normalizeSkillKey(key), e);
    }
    return map;
  }, [skills]);

  const resolve = useCallback(
    (raw: string): string | null => {
      const viaBuiltin = resolveSkillOriginal(raw);
      if (viaBuiltin) return viaBuiltin;
      const holder = holderByKey.get(normalizeSkillKey(raw));
      return holder ? holder.nameOriginal || holder.name : null;
    },
    [holderByKey]
  );

  const unresolved = useMemo(() => {
    const byName = new Map<string, Unresolved>();
    const add = (
      raw: unknown,
      where: string,
      source?: Unresolved["sources"][number]
    ) => {
      if (typeof raw !== "string" || !raw.trim()) return;
      const name = raw.trim();
      if (resolve(name)) return;
      const item = byName.get(name) ?? { name, where: [], sources: [] };
      if (!item.where.includes(where)) item.where.push(where);
      if (source) item.sources.push(source);
      byName.set(name, item);
    };
    for (const e of sourceEntries ?? []) {
      if (e.kind === "background" && Array.isArray(e.data.skills)) {
        for (const s of e.data.skills as unknown[])
          add(s, `предыстория «${e.name}»`, { entryId: e.id, entryName: e.name, field: "skills" });
      }
      if (e.kind === "class" && Array.isArray(e.data.skill_choice_options)) {
        for (const s of e.data.skill_choice_options as unknown[])
          add(s, `класс «${e.name}»`, {
            entryId: e.id,
            entryName: e.name,
            field: "skill_choice_options",
          });
      }
    }
    for (const [name, who] of sheetNames ?? []) add(name, `листы: ${who.join(", ")}`);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [sourceEntries, sheetNames, resolve]);

  // Листы читаются вторым шагом и по кнопке: справочники — причина, листы —
  // следствие, и тянуть все статблоки базы при открытии экрана незачем
  // (гриллинг 2026-09-04).
  async function scanSheets() {
    setScanningSheets(true);
    setError(null);
    try {
      const characters = await api.get<Character[]>("/characters");
      const found = new Map<string, string[]>();
      for (const c of characters) {
        const statblocks = await api.get<Statblock[]>(
          `/statblocks?owner_type=character&owner_id=${c.id}`
        );
        for (const sb of statblocks) {
          if (sb.format !== "dnd_character") continue;
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(sb.content || "{}") as Record<string, unknown>;
          } catch {
            continue;
          }
          const profs = (data.skillProfs ?? {}) as Record<string, number>;
          for (const [key, level] of Object.entries(profs)) {
            if (!level) continue;
            const list = found.get(key) ?? [];
            const who = c.character_name || `персонаж ${c.id}`;
            if (!list.includes(who)) list.push(who);
            found.set(key, list);
          }
        }
      }
      setSheetNames(found);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setScanningSheets(false);
    }
  }

  async function addAlias(item: Unresolved, target: DndSkillEntry) {
    // Занятый алиас — не выбор, а ошибка ввода: единственное честное
    // поведение в момент ввода — не дать её сделать и назвать, где занято.
    const holder = holderByKey.get(normalizeSkillKey(item.name));
    if (holder && holder.id !== target.id) {
      setError(`«${item.name}» уже стоит у навыка «${holder.name}». Уберите оттуда, если имя нужно здесь.`);
      return;
    }
    setBusyName(item.name);
    setError(null);
    try {
      await api.put(`/systems/entries/${target.id}`, {
        aliases: [...new Set([...target.aliases, item.name])],
      });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyName(null);
    }
  }

  async function renameInSources(item: Unresolved, target: DndSkillEntry) {
    if (item.sources.length === 0) {
      setError("Это имя встретилось только в листах — переписывать нечего, добавьте его алиасом.");
      return;
    }
    const n = item.sources.length;
    const word = n % 10 === 1 && n % 100 !== 11 ? "записи" : "записях";
    const ok = await confirm({
      title: "Переписать имя в источниках?",
      message:
        `«${item.name}» → «${target.name}» в ${n} ${word}: ` +
        item.sources.map((s) => s.entryName).join(", ") +
        ". Правка общая для всей системы.",
      confirmLabel: "Переписать",
    });
    if (!ok) return;
    setBusyName(item.name);
    setError(null);
    try {
      for (const src of item.sources) {
        const entry = await api.get<CompendiumEntry>(`/systems/entries/${src.entryId}`);
        const list = Array.isArray(entry.data[src.field]) ? (entry.data[src.field] as string[]) : [];
        const next = list.map((s) => (s.trim() === item.name ? target.name : s));
        await api.put(`/systems/entries/${src.entryId}`, {
          data: { ...entry.data, [src.field]: next },
        });
      }
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyName(null);
    }
  }

  async function createSkill(item: Unresolved, ability: string) {
    if (!groupId || !sectionId) {
      setError("В этой системе нет группы «Навыки» в Справочнике — создать навык некуда.");
      return;
    }
    setBusyName(item.name);
    setError(null);
    try {
      await api.post(`/systems/${systemId}/entries`, {
        section_id: sectionId,
        parent_id: groupId,
        kind: "mechanic_item",
        name: item.name,
        // Характеристика обязательна: без неё лист посчитал бы модификатор
        // только от бонуса мастерства и соврал числом (гриллинг 2026-09-04).
        data: { ability },
      });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyName(null);
    }
  }

  if (skills === null || sourceEntries === null) {
    return error ? <div className="sb-save-status is-error">{error}</div> : null;
  }

  return (
    <div className="card stack">
      {confirmDialog}
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div className="sb-section" style={{ margin: 0 }}>
          Сверка имён навыков
        </div>
        <button type="button" onClick={scanSheets} disabled={scanningSheets}>
          {scanningSheets ? "Читаю листы…" : sheetNames ? "Перечитать листы" : "Проверить листы"}
        </button>
      </div>
      {error && (
        <div className="sb-save-status is-error" role="alert">
          {error}
        </div>
      )}
      {unresolved.length === 0 ? (
        <span className="muted">
          Все имена сведены{sheetNames ? " — и в справочниках, и в листах" : ""}. Классы и
          предыстории выдают владения, ничего не теряя.
          {!sheetNames && " Листы ещё не проверялись."}
        </span>
      ) : (
        <>
          <span className="muted">
            Эти имена лист не узнаёт: выданное под ними владение не поставится. Сведите каждое с
            навыком справочника — или заведите новый навык.
          </span>
          <div className="stack" style={{ gap: 10 }}>
            {unresolved.map((item) => (
              <UnresolvedRow
                key={item.name}
                item={item}
                skills={skills}
                busy={busyName === item.name}
                onAddAlias={(target) => addAlias(item, target)}
                onRename={(target) => renameInSources(item, target)}
                onCreate={(ability) => createSkill(item, ability)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function UnresolvedRow({
  item,
  skills,
  busy,
  onAddAlias,
  onRename,
  onCreate,
}: {
  item: Unresolved;
  skills: DndSkillEntry[];
  busy: boolean;
  onAddAlias: (target: DndSkillEntry) => void;
  onRename: (target: DndSkillEntry) => void;
  onCreate: (ability: string) => void;
}) {
  const [targetId, setTargetId] = useState<number | "">("");
  const [ability, setAbility] = useState(ABILITY_NAMES[0]);
  const target = skills.find((s) => s.id === targetId);

  return (
    <div className="stack" style={{ gap: 4, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <strong>{item.name}</strong>
        <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          {item.where.join(" · ")}
        </span>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : "")}
          aria-label={`Навык, с которым свести «${item.name}»`}
        >
          <option value="">Свести с навыком…</option>
          {skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="button" disabled={!target || busy} onClick={() => target && onAddAlias(target)}>
          Добавить алиасом
        </button>
        <button
          type="button"
          disabled={!target || busy || item.sources.length === 0}
          title={
            item.sources.length === 0
              ? "Имя встретилось только в листах — переписывать нечего"
              : `Переписать имя в источниках: ${item.sources.map((s) => s.entryName).join(", ")}`
          }
          onClick={() => target && onRename(target)}
        >
          Переписать в источнике
        </button>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          или завести новый навык:
        </span>
        <select
          value={ability}
          onChange={(e) => setAbility(e.target.value)}
          aria-label={`Характеристика нового навыка «${item.name}»`}
        >
          {ABILITY_NAMES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button type="button" className="comp-mini" disabled={busy} onClick={() => onCreate(ability)}>
          <NavIcon name="plus" /> Завести «{item.name}»
        </button>
      </div>
    </div>
  );
}
