import { write } from "../../../data/hooks";
import { afterWriteAnywhere, readResource } from "../../../data/imperative";
import { showSaveError } from "../../../data/notices";
import { statblockAffects, statblockListPath } from "../../../data/statblocks";
import type { LitMCharacterData, Statblock } from "../../../types";
import { normalizeCharacter } from "../LitMCharacterForm";

/**
 * Правка листа героя LitM с пульта (Q5, Q10): статусы, вычеркнутые теги.
 * Поля считаются от свежего листа и пишутся патчем — игрок может держать
 * свой лист открытым и править его сам (как sheetWrite.ts боя D&D).
 */
export async function patchLitmSheet(
  characterId: number,
  label: string,
  fields: (data: LitMCharacterData) => Partial<LitMCharacterData> | null
): Promise<void> {
  try {
    const rows = await readResource<Statblock[]>(statblockListPath("character", characterId), { fresh: true });
    const sb = rows.find((s) => s.format === "litm_character");
    if (!sb) return;
    let raw: unknown = {};
    try {
      raw = JSON.parse(sb.content || "{}");
    } catch {
      /* битый лист — считаем от пустого, как нормализатор */
    }
    const patch = fields(normalizeCharacter(raw));
    if (!patch) return;
    await write.put(`/statblocks/${sb.id}`, { contentPatch: patch });
    afterWriteAnywhere(statblockAffects("character", characterId));
  } catch (error) {
    showSaveError(`${label} — ${error instanceof Error ? error.message : String(error)}`, () => patchLitmSheet(characterId, label, fields));
  }
}

/** Привал (Q11, A179): вычеркнутые теги силы всех тем героя возвращаются. */
export function restoreScratched(d: LitMCharacterData): Partial<LitMCharacterData> | null {
  const clear = <T extends { scratchedTags?: string[] }>(t: T): T => (t.scratchedTags?.length ? { ...t, scratchedTags: [] } : t);
  const any = [...d.themes, ...d.storyThemes, d.fellowshipTheme].some((t) => t.scratchedTags?.length);
  if (!any) return null;
  return { themes: d.themes.map(clear), storyThemes: d.storyThemes.map(clear), fellowshipTheme: clear(d.fellowshipTheme) };
}
