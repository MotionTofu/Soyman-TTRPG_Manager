import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  LITM_CHALLENGE_KIND,
  LITM_SCENE_KIND,
  challengeStateFromProfile,
  journeyArrived,
  vignetteState,
  type LitmJourneyState,
  type LitmVignette,
  emptySceneState,
  parseChallengeState,
  parseSceneState,
  type LitmChallengeState,
  type LitmSceneState,
} from "@shared/litm/conflict";
import { dataKeys } from "../../../data/entities";
import { useAction, useEntity, useResource, write } from "../../../data/hooks";
import { readResource } from "../../../data/imperative";
import { labelled } from "../../../data/notices";
import { initiativePath, patchRow } from "../../../combat/useCombat";
import { recordNote } from "../../../combat/battleLog";
import { logLitm, rowChange } from "./litmLog";
import type { CampaignDetail, InitiativeEntry, SessionDetail, Statblock } from "../../../types";
import { challengeProfile } from "../litmChallenge";

const NO_ENTRIES: InitiativeEntry[] = [];

/** Строки расклада LitM — не бой D&D: бой их пропускает (useCombat). */
export function isLitmRow(e: Pick<InitiativeEntry, "kind">): boolean {
  return e.kind === LITM_CHALLENGE_KIND || e.kind === LITM_SCENE_KIND;
}

/** Цель выгрузки ленты: «На ленту» в строках панелей и «Мешок». */
export const LITM_RIBBON_TARGET = "Лента вызовов";

/**
 * Код системы кампании сессии: `undefined` — ещё читается. По нему пульт
 * выбирает «Бой» D&D или «Вызовы» LitM (Q1), а трекер инициативы прячется.
 */
export function useSessionSystemCode(sessionId: number): string | null | undefined {
  const session = useEntity<SessionDetail>("session", sessionId).data;
  const campaign = useEntity<CampaignDetail>("campaign", session?.campaign_id).data;
  const systemId = campaign?.system_id ?? null;
  const system = useResource<{ code: string | null }>(systemId ? `/systems/${systemId}` : null).data;
  if (!campaign) return undefined;
  if (!systemId) return null;
  return system ? (system.code ?? null) : undefined;
}

/** Откуда вызов встаёт на ленту (Q16): запись книги, существо сеттинга или
 *  «Быстрый» — без профиля, имя и один предел. */
export type LitmSource =
  | { type: "compendium_entry" | "being"; id: number; name: string }
  | { type: "quick"; name: string; limit?: { name: string; max: number } };

/** Пределы и теги профиля для новой строки; профиля нет — пустая строка. */
async function sourceState(src: LitmSource): Promise<LitmChallengeState> {
  if (src.type === "quick") {
    return challengeStateFromProfile({ limitList: src.limit ? [{ name: src.limit.name, max: String(src.limit.max) }] : [] });
  }
  const rows = await readResource<Statblock[]>(`/statblocks?owner_type=${src.type}&owner_id=${src.id}`);
  const sb = rows.find((s) => s.format === "litm_challenge");
  if (!sb) return challengeStateFromProfile({});
  const p = challengeProfile({ name: src.name, name_original: "", description: "", data: {} }, sb);
  return challengeStateFromProfile({ limitList: p.limitList, tagList: p.tagList });
}

/** «Разбойник», «Разбойник 2», «Разбойник 3» — копии нумеруются (Q16). */
function numbered(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  let k = 2;
  while (taken.includes(`${base} ${k}`)) k += 1;
  return `${base} ${k}`;
}

/**
 * Расклад режима «Вызовы» (Backlog Д33, Q1–Q22): вызовы на ленте и полоса
 * «Сцена» — строками `initiative_entries` сессии своих видов. Правки — сразу
 * на экране, отказ возвращает прежнее (как useCombat.change).
 */
export function useLitmRibbon(sessionId: number) {
  const client = useQueryClient();
  const run = useAction();
  const path = initiativePath(sessionId);
  const all = useResource<InitiativeEntry[]>(path).data ?? NO_ENTRIES;
  const challenges = useMemo(() => all.filter((e) => e.kind === LITM_CHALLENGE_KIND), [all]);
  const sceneRow = useMemo(() => all.find((e) => e.kind === LITM_SCENE_KIND) ?? null, [all]);
  const scene = useMemo<LitmSceneState>(() => (sceneRow ? parseSceneState(sceneRow.state) : emptySceneState()), [sceneRow]);

  async function change(label: string, send: () => Promise<unknown>, patch?: (rows: InitiativeEntry[]) => InitiativeEntry[]) {
    const key = dataKeys.resource(path);
    let previous: InitiativeEntry[] | undefined;
    if (patch) {
      await client.cancelQueries({ queryKey: key });
      previous = client.getQueryData<InitiativeEntry[]>(key);
      if (previous) client.setQueryData(key, patch(previous));
    }
    const done = await run(labelled(label, () => send().then(() => true)), { affects: [{ path }], retry: !patch });
    if (!done && previous) client.setQueryData(key, previous);
    return done === true;
  }

  /** Правка строки — на экран сразу, в лог конфликта (Q15) — когда записалась. */
  async function setRow(row: InitiativeEntry, label: string, state: unknown, turn = false, compare = false) {
    const changes = rowChange(row, state);
    const ok = await change(label, () => write.put(`/initiative-entries/${row.id}`, { state, ...(compare ? { expectedState: row.state } : {}) }), patchRow(row.id, { state: JSON.stringify(state) }));
    if (ok) logLitm(sessionId, label, changes, turn);
    else if (compare) void client.invalidateQueries({ queryKey: dataKeys.resource(path) });
    return ok;
  }

  function setChallenge(row: InitiativeEntry, label: string, state: LitmChallengeState, compare = false) {
    return setRow(row, label, state, false, compare);
  }

  /** Полоса «Сцена» — одна строка на сессию, заводится первой правкой. `turn` — передача спотлайта. */
  async function setScene(label: string, state: LitmSceneState, turn = false) {
    if (sceneRow) return setRow(sceneRow, label, state, turn);
    const made: { row?: InitiativeEntry } = {};
    const ok = await change(label, async () => {
      made.row = await write.post<InitiativeEntry>("/initiative-entries", { session_id: sessionId, name: "Сцена", kind: LITM_SCENE_KIND, state });
    });
    if (ok && made.row) logLitm(sessionId, label, rowChange({ ...made.row, state: "{}" }, state), turn);
    return ok;
  }

  async function add(src: LitmSource, count = 1) {
    const names = challenges.map((e) => e.name);
    let added = true;
    for (let k = 0; k < count; k += 1) {
      const state = await sourceState(src);
      const name = numbered(src.name, names);
      names.push(name);
      const ok = await change(`«${name}» не встал на ленту`, () =>
        write.post("/initiative-entries", {
          session_id: sessionId,
          name,
          kind: LITM_CHALLENGE_KIND,
          entity_type: src.type === "quick" ? null : src.type,
          entity_id: src.type === "quick" ? null : src.id,
          state,
        })
      );
      if (!ok) added = false;
      else recordNote(sessionId, `«${name}» на ленте`);
    }
    return added;
  }

  /**
   * Виньетка «На ленту» (пульт v2, Q5–Q6): строка с копией угрозы и
   * последствий. Первая виньетка путешествия открывает его полосу — число
   * шагов спросит она сама (`steps` 0).
   */
  async function addVignette(v: LitmVignette, journey?: Omit<LitmJourneyState, "steps" | "gap" | "passed">) {
    const name = numbered(v.name, challenges.map((e) => e.name));
    const ok = await change(`«${name}» не встала на ленту`, () =>
      write.post("/initiative-entries", {
        session_id: sessionId,
        name,
        kind: LITM_CHALLENGE_KIND,
        entity_type: v.journeyId != null ? "compendium_entry" : null,
        entity_id: v.journeyId,
        state: vignetteState(v),
      })
    );
    if (!ok) return false;
    recordNote(sessionId, `Виньетка «${name}» на ленте`);
    const running = scene.journey && scene.journey.entryId === journey?.entryId && !journeyArrived(scene.journey);
    if (journey && !running) await setScene(`Путешествие «${journey.name}»`, { ...scene, journey: { ...journey, steps: 0, gap: "часы", passed: [] } });
    return true;
  }

  async function remove(row: InitiativeEntry, note = `«${row.name}» убран с ленты`) {
    const ok = await change(`«${row.name}» не убран с ленты`, () => write.del(`/initiative-entries/${row.id}`), (rows) => rows.filter((e) => e.id !== row.id));
    if (ok) recordNote(sessionId, note);
    return ok;
  }

  return { challenges, scene, sceneRow, setChallenge, setScene, add, addVignette, remove, stateOf: (row: InitiativeEntry) => parseChallengeState(row.state) };
}

export type LitmRibbon = ReturnType<typeof useLitmRibbon>;
