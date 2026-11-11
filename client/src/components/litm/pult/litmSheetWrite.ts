import { write } from "../../../data/hooks";
import { afterWriteAnywhere, readResource } from "../../../data/imperative";
import { showSaveError } from "../../../data/notices";
import { statblockAffects, statblockListPath } from "../../../data/statblocks";
import type { LitMCharacterData, LitMThemeCard, Statblock } from "../../../types";
import { normalizeCharacter } from "../LitMCharacterForm";
import { logLitm, sheetChange } from "./litmLog";

/** С пульта правка идёт ещё и в лог конфликта (Q15): сессия и имя героя для строки. */
export interface SheetLog {
  sessionId: number;
  name: string;
}

/**
 * Правка листа героя LitM с пульта (Q5, Q10): статусы, вычеркнутые теги.
 * Поля считаются от свежего листа и пишутся патчем — игрок может держать
 * свой лист открытым и править его сам (как sheetWrite.ts боя D&D).
 * Правки одного листа идут по очереди: две подряд («Смягчить» и следующее
 * последствие) иначе читают лист до записи друг друга, и вторая затирает первую.
 */
export function patchLitmSheet(
  characterId: number,
  label: string,
  fields: (data: LitMCharacterData) => Partial<LitMCharacterData> | null,
  log?: SheetLog
): Promise<void> {
  const run = (queue.get(characterId) ?? Promise.resolve()).then(() => patchNow(characterId, label, fields, log));
  queue.set(characterId, run);
  return run;
}

const queue = new Map<number, Promise<void>>();

async function patchNow(
  characterId: number,
  label: string,
  fields: (data: LitMCharacterData) => Partial<LitMCharacterData> | null,
  log?: SheetLog
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
    const data = normalizeCharacter(raw);
    const patch = fields(data);
    if (!patch) return;
    await write.put(`/statblocks/${sb.id}`, { contentPatch: patch });
    afterWriteAnywhere(statblockAffects("character", characterId));
    if (log) logLitm(log.sessionId, label, sheetChange(characterId, log.name, data, { ...data, ...patch }));
  } catch (error) {
    showSaveError(`${label} — ${error instanceof Error ? error.message : String(error)}`, () => patchLitmSheet(characterId, label, fields, log));
  }
}

/** Привал (Q11, A179): вычеркнутые теги силы всех тем героя возвращаются. */
export function restoreScratched(d: LitMCharacterData): Partial<LitMCharacterData> | null {
  const clear = <T extends { scratchedTags?: string[] }>(t: T): T => (t.scratchedTags?.length ? { ...t, scratchedTags: [] } : t);
  const any = [...d.themes, ...d.storyThemes, d.fellowshipTheme].some((t) => t.scratchedTags?.length);
  if (!any) return null;
  return { themes: d.themes.map(clear), storyThemes: d.storyThemes.map(clear), fellowshipTheme: clear(d.fellowshipTheme) };
}

/** Вычеркнуть или вернуть тег силы темы героя (Q10, «вычеркнуть тег» Q12). */
export function toggleScratch(kind: "themes" | "storyThemes", index: number, tag: string) {
  return (d: LitMCharacterData): Partial<LitMCharacterData> => {
    const flip = (t: LitMThemeCard): LitMThemeCard => {
      const s = t.scratchedTags ?? [];
      return { ...t, scratchedTags: s.includes(tag) ? s.filter((x) => x !== tag) : [...s, tag] };
    };
    return { [kind]: d[kind].map((t, k) => (k === index ? flip(t) : t)) };
  };
}
