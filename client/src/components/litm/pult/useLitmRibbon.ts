import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  LITM_CHALLENGE_KIND,
  LITM_SCENE_KIND,
  challengeStateFromProfile,
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

  function setChallenge(row: InitiativeEntry, label: string, state: LitmChallengeState) {
    return change(label, () => write.put(`/initiative-entries/${row.id}`, { state }), patchRow(row.id, { state: JSON.stringify(state) }));
  }

  /** Полоса «Сцена» — одна строка на сессию, заводится первой правкой. */
  function setScene(label: string, state: LitmSceneState) {
    if (sceneRow) {
      return change(label, () => write.put(`/initiative-entries/${sceneRow.id}`, { state }), patchRow(sceneRow.id, { state: JSON.stringify(state) }));
    }
    return change(label, () => write.post("/initiative-entries", { session_id: sessionId, name: "Сцена", kind: LITM_SCENE_KIND, state }));
  }

  async function add(src: LitmSource, count = 1) {
    const names = challenges.map((e) => e.name);
    for (let k = 0; k < count; k += 1) {
      const state = await sourceState(src);
      const name = numbered(src.name, names);
      names.push(name);
      await change(`«${name}» не встал на ленту`, () =>
        write.post("/initiative-entries", {
          session_id: sessionId,
          name,
          kind: LITM_CHALLENGE_KIND,
          entity_type: src.type === "quick" ? null : src.type,
          entity_id: src.type === "quick" ? null : src.id,
          state,
        })
      );
    }
  }

  function remove(row: InitiativeEntry) {
    return change(`«${row.name}» не убран с ленты`, () => write.del(`/initiative-entries/${row.id}`), (rows) => rows.filter((e) => e.id !== row.id));
  }

  return { challenges, scene, sceneRow, setChallenge, setScene, add, remove, stateOf: (row: InitiativeEntry) => parseChallengeState(row.state) };
}

export type LitmRibbon = ReturnType<typeof useLitmRibbon>;
