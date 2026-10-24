import { campaignEntityStateLabel, type CampaignEntityKind, type CampaignEntityState } from "@shared/campaignWorld";
import { useAction, useAfterWrite, write } from "./data/hooks";
import { campaignPaths } from "./data/campaigns";
import { labelled } from "./data/notices";
import { recordAffects } from "./entityRecords";
import { useUndoDelete } from "./hooks/useUndoDelete";

export type WorldType = CampaignEntityKind;

export interface WorldEntity {
  entity_type: WorldType;
  entity_id: number;
  name: string;
  category: string | null;
  manual: boolean;
  can_remove: boolean;
  records: number;
  drafts: number;
  rumors: number;
  state: CampaignEntityState;
  image: string | null;
  summary: { text: string; from_setting: boolean };
  aspects: { key: string; text: string | null }[];
  changed_at: string;
  last_session: { id: number; title: string | null; date: string } | null;
}

export interface CampaignWorld {
  setting_id: number | null;
  entities: WorldEntity[];
  rumors: number;
  drafts: number;
}

export const WORLD_GROUPS: { type: WorldType; label: string; kind: string; path: string }[] = [
  { type: "location", label: "Места", kind: "место", path: "/locations" },
  { type: "being", label: "Существа", kind: "существо", path: "/beings" },
  { type: "community", label: "Сообщества", kind: "сообщество", path: "/communities" },
  { type: "artifact", label: "Артефакты", kind: "артефакт", path: "/artifacts" },
];
export const WORLD_TYPES = WORLD_GROUPS.map((g) => g.type);

interface StateChange {
  state: CampaignEntityState;
  previous: CampaignEntityState;
  record_id: number | null;
}

/** Тот же тост отмены, что у персонажа; сервер возвращает id служебной записи. */
export function useSetCampaignEntityState(campaignId: number) {
  const run = useAction();
  const touched = useAfterWrite();
  const { offerUndo } = useUndoDelete();
  return async (entity: WorldEntity, state: CampaignEntityState) => {
    if (entity.state === state) return;
    const affects = recordAffects(campaignId, entity.entity_type, entity.entity_id);
    const path = `${campaignPaths.world(campaignId)}/${entity.entity_type}/${entity.entity_id}/state`;
    const result = await run(labelled("Состояние в кампании", () => write.put<StateChange>(path, { state })), { affects, retry: false });
    if (!result || result.record_id == null) return;
    offerUndo({
      entityName: entity.name,
      message: `${entity.name}: ${campaignEntityStateLabel(entity.entity_type, state)}`,
      restoreFn: async () => {
        await write.put<StateChange>(path, { state: result.previous, undo_record_id: result.record_id });
        touched(affects);
      },
    });
  };
}
