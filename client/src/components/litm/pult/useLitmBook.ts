import { useMemo } from "react";
import { useResource } from "../../../data/hooks";
import { compendiumPaths } from "../../../data/compendiumEntries";
import type { CompendiumEntry, Statblock } from "../../../types";
import { challengeProfile, type LitmChallengeProfileData } from "../litmChallenge";

export interface LitmBookEntry {
  entry: CompendiumEntry;
  profile: LitmChallengeProfileData;
}

const NO_ENTRIES: CompendiumEntry[] = [];
const NO_STATBLOCKS: Statblock[] = [];

/** Вызовы книги системы с профилями (раздел `monster`): каталог «Добавить
 *  вызов» и надстройки гнезда (Q16, Q17). */
export function useLitmBook(systemId: number | null): LitmBookEntry[] {
  const sections = useResource<{ id: number; kind: string }[]>(systemId ? compendiumPaths.sections(systemId) : null).data;
  const sectionId = sections?.find((s) => s.kind === "monster")?.id ?? null;
  const entries = useResource<CompendiumEntry[]>(systemId && sectionId ? compendiumPaths.sectionEntries(systemId, sectionId) : null).data ?? NO_ENTRIES;
  const ids = useMemo(() => entries.map((e) => e.id).sort((a, b) => a - b).join(","), [entries]);
  const statblocks = useResource<Statblock[]>(ids ? `/statblocks?owner_type=compendium_entry&owner_ids=${ids}` : null).data ?? NO_STATBLOCKS;
  return useMemo(() => {
    const byOwner = new Map<number, Statblock>();
    for (const s of statblocks) if (s.format === "litm_challenge" && !byOwner.has(s.owner_id)) byOwner.set(s.owner_id, s);
    return entries.map((entry) => ({ entry, profile: challengeProfile(entry, byOwner.get(entry.id)) }));
  }, [entries, statblocks]);
}
