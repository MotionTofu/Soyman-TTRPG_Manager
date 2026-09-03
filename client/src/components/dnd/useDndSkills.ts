import { useEffect, useMemo, useState } from "react";
import type { DndAbilityKey } from "../../types";
import { ABILITY_NAME_TO_KEY } from "./AbilityScores";
import { isAbortError, loadDndSkillEntries, type DndSkillEntry } from "./dndCompendium";
import { normalizeSkillKey, resolveSkillOriginal, SKILL_CATALOG } from "./skillCatalog";

export interface SkillRow {
  /** Ключ владения в данных листа. */
  original: string;
  /** Имя для показа: из справочника, если он его знает, иначе встроенное. */
  name: string;
  /** null — навык мастера без характеристики: модификатор считать не от чего. */
  ability: DndAbilityKey | null;
  /** Навыка нет во встроенном списке — завёл мастер. */
  custom: boolean;
}

export interface DndSkills {
  /** Восемнадцать книжных навыков плюс заведённые мастером. */
  rows: SkillRow[];
  /** Имя навыка по ключу — для строк, которых нет в списке (поиск, шпаргалка). */
  nameOf: (original: string) => string;
  /**
   * Свести любое написание к ключу, зная и справочник тоже.
   *
   * `resolveSkillOriginal` из каталога знает только встроенные алиасы и
   * работает синхронно (им сводит `normalizeDndCharacter` в момент разбора
   * JSON). Этот — знает ещё и алиасы, которые мастер добавил в справочник.
   */
  resolve: (raw: string) => string | null;
  loaded: boolean;
}

/**
 * Навыки листа: встроенный каталог, уточнённый справочником.
 *
 * Встроенный список остаётся всегда — за столом лист обязан показать навыки,
 * даже когда сервер лёг, система не выбрана или компендиум не загрузился
 * (гриллинг 2026-09-04). Справочник, когда он есть, задаёт имена, добавляет
 * алиасы и может принести навык, которого в книге нет.
 */
export function useDndSkills(systemId: number | null | undefined): DndSkills {
  const [entries, setEntries] = useState<DndSkillEntry[] | null>(null);

  useEffect(() => {
    if (!systemId) {
      setEntries(null);
      return;
    }
    const ac = new AbortController();
    loadDndSkillEntries(systemId, { signal: ac.signal })
      .then(setEntries)
      .catch((e) => {
        // Молча: лист и без справочника полон, а плашку об ошибке компендиума
        // уже показывает форма правки. Второе сообщение о том же — шум.
        if (!isAbortError(e)) setEntries(null);
      });
    return () => ac.abort();
  }, [systemId]);

  return useMemo(() => {
    const byOriginal = new Map<string, DndSkillEntry>();
    for (const e of entries ?? []) if (e.nameOriginal) byOriginal.set(e.nameOriginal, e);

    // Алиасы и имена справочника → ключ. Записи без оригинала (справочник
    // старее миграции) сводим через встроенный каталог по их имени.
    const fromCompendium = new Map<string, string>();
    for (const e of entries ?? []) {
      const original = e.nameOriginal || resolveSkillOriginal(e.name);
      if (!original) continue;
      for (const key of [e.name, ...e.aliases]) fromCompendium.set(normalizeSkillKey(key), original);
    }

    const rows: SkillRow[] = SKILL_CATALOG.map((def) => ({
      original: def.original,
      name: byOriginal.get(def.original)?.name || def.name,
      ability: def.ability,
      custom: false,
    }));

    // Навыки, заведённые мастером: их во встроенном списке нет, характеристику
    // они несут в `data.ability` — экран сверки её и спрашивает. Без неё
    // модификатор считается только от бонуса мастерства, поэтому такие строки
    // идут в конце (гриллинг 2026-09-04).
    for (const e of entries ?? []) {
      const original = e.nameOriginal || e.name;
      if (rows.some((r) => r.original === original)) continue;
      if (resolveSkillOriginal(e.name)) continue;
      rows.push({
        original,
        name: e.name,
        ability: ABILITY_NAME_TO_KEY[e.ability] ?? null,
        custom: true,
      });
    }

    return {
      rows,
      nameOf: (original) =>
        byOriginal.get(original)?.name ??
        SKILL_CATALOG.find((s) => s.original === original)?.name ??
        original,
      resolve: (raw) => resolveSkillOriginal(raw, fromCompendium),
      loaded: entries !== null,
    };
  }, [entries]);
}
