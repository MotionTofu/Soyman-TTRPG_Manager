import { api } from "../api/client";
import { getCachedUser } from "../api/currentUser";
import type { CreatureCardPayload } from "../components/CreatureCard";
import { dataKeys } from "./entities";
import { queryClient } from "./queryClient";

// Чтение карточки существа (components/CreatureCard.tsx). В слое, а не в
// компоненте: у игрока то же чтение идёт запасным путём по игроцкому адресу.

function creatureCardPath(type: string, id: number, statblockId?: number): string {
  return `/creature-card/${type}/${id}${statblockId ? `?statblock_id=${statblockId}` : ""}`;
}

async function loadCreatureCard(
  type: string,
  id: number,
  statblockId: number | undefined,
  signal?: AbortSignal
): Promise<CreatureCardPayload> {
  try {
    return await api.get<CreatureCardPayload>(creatureCardPath(type, id, statblockId), { signal });
  } catch (e) {
    // Жетон спутника открывает ту же карточку и у игрока, а мастерский
    // /creature-card ему закрыт. Существа сеттинга (being) игроку не отдаём
    // и здесь: игроцкий роут существует только для записей бестиария.
    if (type === "compendium_entry" && getCachedUser()?.role === "player") {
      const q = statblockId ? `?statblock_id=${statblockId}` : "";
      return api.get<CreatureCardPayload>(`/player/creature-card/compendium_entry/${id}${q}`, { signal });
    }
    throw e;
  }
}

/**
 * Карточка существа под ключом слоя `/creature-card/…` — тем же, что читает
 * редактор карточки: правка ролей задевает его и доходит до трекера и
 * всплывающих карточек без своего кэша.
 */
export function creatureCardQuery(type: string, id: number, statblockId?: number) {
  return {
    queryKey: dataKeys.resource(creatureCardPath(type, id, statblockId)),
    queryFn: ({ signal }: { signal: AbortSignal }) => loadCreatureCard(type, id, statblockId, signal),
  };
}

export function fetchCreatureCard(type: string, id: number, statblockId?: number): Promise<CreatureCardPayload> {
  return queryClient.fetchQuery(creatureCardQuery(type, id, statblockId));
}
