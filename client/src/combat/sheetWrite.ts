import { normalizeDndCharacter } from "@shared/dnd/normalize";
import { write } from "../data/hooks";
import { afterWriteAnywhere, readResource } from "../data/imperative";
import { showSaveError } from "../data/notices";
import { statblockAffects, statblockListPath } from "../data/statblocks";
import type { DndCharacterData, Statblock } from "../types";

/**
 * Патч листа персонажа не из его гнезда — из смены хода, срыва чужой
 * концентрации, «Конца боя» (шаг 3). Поля считаются от свежего листа, пишутся
 * патчем, как у гнезда (useCharacterSheet): игрок может держать лист открытым.
 * `fields` вернул null — менять нечего.
 */
export async function patchCharacterSheet(
  characterId: number,
  label: string,
  fields: (data: DndCharacterData) => Partial<DndCharacterData> | null
): Promise<void> {
  try {
    const path = statblockListPath("character", characterId);
    const rows = await readResource<Statblock[]>(path, { fresh: true });
    const sb = rows.find((s) => s.format === "dnd_character");
    if (!sb) return;
    let raw: unknown = {};
    try {
      raw = JSON.parse(sb.content || "{}");
    } catch {
      /* битый лист — считаем от пустого, как нормализатор */
    }
    const patch = fields(normalizeDndCharacter(raw));
    if (!patch) return;
    await write.put(`/statblocks/${sb.id}`, { contentPatch: patch });
    afterWriteAnywhere(statblockAffects("character", characterId));
  } catch (error) {
    showSaveError(`${label} — ${error instanceof Error ? error.message : String(error)}`, () =>
      patchCharacterSheet(characterId, label, fields)
    );
  }
}
