import { useMemo } from "react";
import { useResource, write } from "../../../data/hooks";
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
  log?: SheetLog,
  retry = true,
): Promise<boolean> {
  const run = (queue.get(characterId) ?? Promise.resolve()).then(() => patchNow(characterId, label, fields, log, retry));
  queue.set(characterId, run);
  return run;
}

const queue = new Map<number, Promise<boolean>>();

export function findLitmSheet(rows: readonly Statblock[] | undefined): Statblock | undefined {
  return rows?.find((row) => row.format === "litm_character" && !row.archived_at);
}

async function patchNow(
  characterId: number,
  label: string,
  fields: (data: LitMCharacterData) => Partial<LitMCharacterData> | null,
  log: SheetLog | undefined,
  retry: boolean,
): Promise<boolean> {
  try {
    const rows = await readResource<Statblock[]>(statblockListPath("character", characterId), { fresh: true });
    const sb = findLitmSheet(rows);
    if (!sb) {
      showSaveError(`${label} — у героя нет листа`);
      return false;
    }
    let raw: unknown = {};
    try {
      raw = JSON.parse(sb.content || "{}");
    } catch {
      /* битый лист — считаем от пустого, как нормализатор */
    }
    const data = normalizeCharacter(raw);
    const patch = fields(data);
    if (!patch || !Object.keys(patch).length) return true;
    await write.put(`/statblocks/${sb.id}`, { contentPatch: patch });
    afterWriteAnywhere(statblockAffects("character", characterId));
    if (log) logLitm(log.sessionId, label, sheetChange(characterId, log.name, data, { ...data, ...patch }));
    return true;
  } catch (error) {
    showSaveError(`${label} — ${error instanceof Error ? error.message : String(error)}`,
      retry ? () => patchLitmSheet(characterId, label, fields, log) : undefined);
    return false;
  }
}

const NO_STATBLOCKS: Statblock[] = [];

/** Лист героя LitM для пульта: читается сам, `null` — листа нет. */
export function useLitmSheet(characterId: number | undefined): LitMCharacterData | null {
  const rows = useResource<Statblock[]>(characterId ? statblockListPath("character", characterId) : null).data ?? NO_STATBLOCKS;
  const sb = findLitmSheet(rows);
  return useMemo(() => {
    if (!sb) return null;
    try {
      return normalizeCharacter(JSON.parse(sb.content || "{}"));
    } catch {
      return normalizeCharacter({});
    }
  }, [sb]);
}

/** Ключ вычеркнутого тега своей или сюжетной темы: «themes:0:тег». */
export const scratchKey = (kind: "themes" | "storyThemes", index: number, tag: string) => `${kind}:${index}:${tag}`;

/** Привал, шаг «Рюкзак» (A179): отмеченные сюжетные теги рюкзака истекают. */
export function expireBackpack(tags: string[]) {
  return (d: LitMCharacterData): Partial<LitMCharacterData> | null => {
    const backpack = d.backpack.filter((t) => !tags.includes(t));
    return backpack.length === d.backpack.length ? null : { backpack };
  };
}

/** Отдых (A181): отмеченные статусы истекают, отмеченные вычеркнутые теги (`scratchKey`) возвращаются. */
export function restHero(statuses: string[], tags: string[]) {
  return (d: LitMCharacterData): Partial<LitMCharacterData> | null => {
    if (!statuses.length && !tags.length) return null;
    const back = (kind: "themes" | "storyThemes") =>
      d[kind].map((t, i) => {
        const s = (t.scratchedTags ?? []).filter((x) => !tags.includes(scratchKey(kind, i, x)));
        return s.length === (t.scratchedTags ?? []).length ? t : { ...t, scratchedTags: s };
      });
    return { statuses: (d.statuses ?? []).filter((s) => !statuses.includes(s.name)), themes: back("themes"), storyThemes: back("storyThemes") };
  };
}

/** Размышление (A181): +1 Рост теме («themes:0», «storyThemes:1», «fellowshipTheme»); в передышке — «улучшение ждёт». */
export function reflectOn(ref: string, sojourn: boolean) {
  return (d: LitMCharacterData): Partial<LitMCharacterData> => {
    const bump = (t: LitMThemeCard): LitMThemeCard => (sojourn ? { ...t, improvementPending: true } : { ...t, improve: Math.min(3, t.improve + 1) });
    if (ref === "fellowshipTheme") return { fellowshipTheme: bump(d.fellowshipTheme) };
    const [kind, i] = ref.split(":") as ["themes" | "storyThemes", string];
    return { [kind]: d[kind].map((t, k) => (k === Number(i) ? bump(t) : t)) };
  };
}

/** Вещь из «Наград» — сюжетный тег в рюкзак (пульт v2, Q16); если уже есть — ничего. */
export function giveBackpackTag(tag: string) {
  return (d: Pick<LitMCharacterData, "backpack">): Partial<LitMCharacterData> | null => (d.backpack.includes(tag) ? null : { backpack: [...d.backpack, tag] });
}

/** Время Содружества (A181): вернуть вычеркнутый тег темы Содружества. */
export function recoverFellowshipTag(tag: string) {
  return (d: LitMCharacterData): Partial<LitMCharacterData> => ({
    fellowshipTheme: { ...d.fellowshipTheme, scratchedTags: (d.fellowshipTheme.scratchedTags ?? []).filter((x) => x !== tag) },
  });
}

/** …или новый тег отношений с другим героем — в список отношений листа, по одному на героя. */
export function addRelationship(other: { id: number; name: string }, tag: string) {
  return (d: LitMCharacterData): Partial<LitMCharacterData> => ({
    relationships: [...(d.relationships ?? []).filter((r) => r.characterId !== other.id), { characterId: other.id, name: other.name, tag }],
  });
}

/** С кем у героя уже есть тег отношений: список и старое место спутника. */
export function relatedIds(d: LitMCharacterData): number[] {
  return [...(d.relationships ?? []).map((r) => r.characterId), ...(d.companionCharacterType === "character" && d.companionCharacterId != null ? [d.companionCharacterId] : [])];
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
