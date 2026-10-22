import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { normalizeDndCharacter } from "@shared/dnd/normalize";
import { deriveSheet } from "@shared/dnd/derive";
import { dataKeys } from "../data/entities";
import { useResource, write } from "../data/hooks";
import { afterWriteAnywhere } from "../data/imperative";
import { showSaveError } from "../data/notices";
import { statblockAffects, statblockListPath } from "../data/statblocks";
import { ensureEntries, getCachedEntry, subscribeEntryCache } from "../components/dnd/entryCache";
import { liveEffectEntryIds, withLiveEffects } from "../components/dnd/dndFeatures";
import { allResources, featurePools, type ClassResourceSource, type DndResourceDef } from "../components/dnd/dndResources";
import { resolveFeature } from "../components/dnd/grantedSpells";
import { computeSpellSlots, isRoundUpCaster } from "../components/dnd/dndSlots";
import type { ClassProgression } from "../components/dnd/progression";
import type { DndCharacterData, InitiativeEntry, Statblock } from "../types";
import { parseNestState } from "./nestState";

const NO_STATBLOCKS: Statblock[] = [];

export interface CharacterSheetNest {
  data: DndCharacterData;
  ac: number;
  passivePerception: number;
  /** Как на листе: сохранённый максимум плюс временная поправка. */
  maxHp: number;
  cur: number;
  temp: number;
  /** Максимум ячеек по кругам 1–9. */
  slots: number[];
  pact: { count: number; circle: number } | null;
  pools: DndResourceDef[];
  /** Патч верхних полей листа — тот же `contentPatch`, что у чужого листа. */
  patch: (label: string, fields: Partial<DndCharacterData>) => void;
}

/**
 * Гнездо персонажа читает и пишет ЛИСТ (Q3/Q28). Лист пишется патчем полей,
 * а не снимком: игрок может держать его открытым в эту же минуту.
 *
 * Ячейки и классовые запасы — теми же функциями, что лист (dndSlots,
 * dndResources), по таблицам классов из справочника.
 */
export function useCharacterSheet(entry: InitiativeEntry): CharacterSheetNest | null {
  const client = useQueryClient();
  // Двойник (Q43) живёт строкой, а не листом — лист игрока он не трогает.
  const characterId = entry.entity_type === "character" && !parseNestState(entry).double ? entry.entity_id : null;
  const listPath = characterId != null ? statblockListPath("character", characterId) : null;
  const rows = useResource<Statblock[]>(listPath).data ?? NO_STATBLOCKS;
  const sb = rows.find((s) => s.format === "dnd_character") ?? null;
  const data = useMemo(() => {
    if (!sb) return null;
    try {
      return normalizeDndCharacter(JSON.parse(sb.content || "{}"));
    } catch {
      return normalizeDndCharacter({});
    }
  }, [sb]);

  // Таблицы классов и записи эффектов — из общего кэша справочника.
  const entryIds = useMemo(
    () =>
      data
        ? [...data.classes.flatMap((c) => [c.classId, c.subclassId]), ...liveEffectEntryIds(data)].filter(
            (id): id is number => typeof id === "number"
          )
        : [],
    [data]
  );
  useEffect(() => {
    if (entryIds.length) void ensureEntries(entryIds);
  }, [entryIds]);
  const cacheTick = useSyncExternalStore(subscribeEntryCache, () => entryIds.filter((id) => getCachedEntry(id)).length);

  return useMemo(() => {
    if (!sb || !data || listPath == null) return null;
    const sheet = deriveSheet(withLiveEffects(data, getCachedEntry));
    const slotSources = data.classes
      .filter((c) => c.classId != null && c.level > 0)
      .map((c) => ({
        classId: c.classId,
        level: c.level,
        progression: getCachedEntry(c.classId)?.data.progression as ClassProgression | undefined,
        subProgression:
          c.subclassId != null
            ? (getCachedEntry(c.subclassId)?.data.progression as ClassProgression | undefined)
            : undefined,
        roundUp: isRoundUpCaster(getCachedEntry(c.classId)?.data as Record<string, unknown> | undefined),
      }));
    // ponytail: без запасной таблицы многоклассья (Паладин + Следопыт без
    // полного заклинателя) — там лист догружает её из справочника; у такой
    // пары ячейки здесь будут по таблице первого класса.
    const computed = computeSpellSlots(slotSources);
    const slots = data.spellSlotsManual ? data.spellSlotPips : computed.slots;
    const sources: ClassResourceSource[] = data.classes.flatMap((c) => {
      const own: ClassResourceSource = {
        entry: c,
        progression: getCachedEntry(c.classId)?.data.progression as ClassProgression | undefined,
      };
      if (c.subclassId == null) return [own];
      return [
        own,
        {
          entry: { ...c, classId: c.subclassId, className: c.subclassName || "Подкласс", subclassId: null, subclassName: "" },
          progression: getCachedEntry(c.subclassId)?.data.progression as ClassProgression | undefined,
          subOf: c.classId,
        },
      ];
    });
    // Свои пулы умений — как на листе: из cost {uses, ownResource} разрешённых
    // особенностей; levelSteps — по уровню класса-хозяина (вверх по родителям).
    const characterLevel = data.classes.reduce((n, c) => n + (c.level || 0), 0) || null;
    const featureClassLevel = (entryId: number): number | null => {
      let cur: number | null | undefined = entryId;
      const seen = new Set<number>();
      while (cur != null && !seen.has(cur)) {
        seen.add(cur);
        if (data.raceId != null && cur === data.raceId) return characterLevel;
        const hit = data.classes.find((c) => c.classId === cur || c.subclassId === cur);
        if (hit) return hit.level;
        cur = getCachedEntry(cur)?.parent_id ?? null;
      }
      return null;
    };
    const features = [...data.classFeatures, ...data.speciesFeatures, ...data.feats, ...data.specialAbilities].map((f) =>
      resolveFeature(f, getCachedEntry)
    );
    const pools = [...allResources(sources, data.abilities), ...featurePools(features, data.abilities, featureClassLevel)]
      .map((r) => ({ ...r, max: r.max + (data.resourceBonus[r.key] ?? 0) }))
      .filter((r) => r.max > 0);

    const key = dataKeys.resource(listPath);
    const id = sb.id;
    async function patch(label: string, fields: Partial<DndCharacterData>) {
      // На экране сразу: в кэше списка — склеенный лист.
      const previous = client.getQueryData<Statblock[]>(key);
      client.setQueryData<Statblock[]>(key, (list) =>
        list?.map((s) => {
          if (s.id !== id) return s;
          let raw: Record<string, unknown> = {};
          try {
            raw = JSON.parse(s.content || "{}");
          } catch {
            /* битый лист — патч ляжет поверх пустого, как на сервере */
          }
          return { ...s, content: JSON.stringify({ ...raw, ...fields }) };
        })
      );
      try {
        await write.put(`/statblocks/${id}`, { contentPatch: fields });
        afterWriteAnywhere(statblockAffects("character", characterId!).filter((a) => !("path" in a) || a.path !== listPath));
      } catch (error) {
        if (previous) client.setQueryData(key, previous);
        showSaveError(`${label} — ${error instanceof Error ? error.message : String(error)}`, () => patch(label, fields));
      }
    }

    return {
      data,
      ac: sheet.armorClass.value,
      passivePerception: sheet.passivePerception.value,
      maxHp: (Number(data.hitPointMax) || 0) + (Number(data.hitPointMaxTemp) || 0),
      cur: Number(data.hitPointsCurrent) || 0,
      temp: Number(data.hitPointsTemp) || 0,
      slots,
      pact: computed.pact,
      pools,
      patch: (label, fields) => void patch(label, fields),
    };
    // cacheTick — пересчёт, когда догрузились таблицы классов.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, data, cacheTick, listPath, client]);
}
