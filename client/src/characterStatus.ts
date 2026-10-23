import { useAction, useAfterWrite, write } from "./data/hooks";
import { labelled } from "./data/notices";
import { campaignPaths } from "./data/campaigns";
import type { Affect } from "./data/entities";
import { useUndoDelete } from "./hooks/useUndoDelete";
import type { Character, CharacterStatus } from "./types";

// Статус персонажа в истории кампании (гриллинг «Партия» 2026-10-23, Q19–Q21):
// погибший и ушедший не уходят в архив — персонаж остаётся историей.

export const CHARACTER_STATUSES: CharacterStatus[] = ["active", "reserve", "temporary", "dead", "gone"];

export const CHARACTER_STATUS_LABELS: Record<CharacterStatus, string> = {
  active: "Активный",
  reserve: "Запасной",
  temporary: "Временный",
  dead: "Погиб",
  gone: "Ушёл",
};

export const statusOf = (c: Pick<Character, "status">): CharacterStatus => c.status ?? "active";

/** Живой — в деле полным блоком; погибший и ушедший — строкой «Память». */
export const isLiving = (c: Pick<Character, "status">) => !["dead", "gone"].includes(statusOf(c));

/**
 * За столом — активные и временные: из них Пульт собирает партию сам.
 * Запасной добавляется вручную, погибший и ушедший — только в деле (Q26).
 */
export const isAtTable = (c: Pick<Character, "status">) => ["active", "temporary"].includes(statusOf(c));

/** Смена статуса без подтверждения, с «Отменить» в тосте (Q20). */
export function useSetCharacterStatus() {
  const run = useAction();
  const touched = useAfterWrite();
  const { offerUndo } = useUndoDelete();
  return async function setStatus(c: Pick<Character, "id" | "character_name" | "campaign_id">, status: CharacterStatus) {
    const affects: Affect[] = [
      { kind: "character", id: c.id },
      ...(c.campaign_id != null ? [{ path: campaignPaths.characters(c.campaign_id) }] : []),
    ];
    const put = (s: CharacterStatus) => write.put<{ status: CharacterStatus; previous: CharacterStatus }>(`/characters/${c.id}/status`, { status: s });
    const res = await run(labelled("Статус персонажа", () => put(status)), { affects });
    if (!res || res.previous === status) return;
    offerUndo({
      entityName: c.character_name,
      message: `${c.character_name}: ${CHARACTER_STATUS_LABELS[status].toLowerCase()}`,
      restoreFn: async () => {
        await put(res.previous);
        touched(affects);
      },
    });
  };
}
