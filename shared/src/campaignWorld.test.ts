import { describe, expect, it } from "vitest";
import { CAMPAIGN_ENTITY_STATES, campaignEntityState, campaignEntityStateLabel, campaignEntityStateTone, isCampaignEntityKind, isCampaignEntityState } from "./campaignWorld";

describe("состояния сущностей в кампании", () => {
  it("держит закрытые словари и разные подписи одинакового ключа", () => {
    expect(isCampaignEntityKind("artifact")).toBe(true);
    expect(isCampaignEntityKind("character")).toBe(false);
    expect(isCampaignEntityKind("toString")).toBe(false);
    expect(isCampaignEntityState("being", "with_party")).toBe(false);
    expect(isCampaignEntityState("artifact", "with_party")).toBe(true);
    expect(campaignEntityStateLabel("location", "destroyed")).toBe("разрушено");
    expect(campaignEntityStateLabel("artifact", "destroyed")).toBe("уничтожен");
  });

  it("первое значение — умолчание без плашки, остальные окрашены по смыслу", () => {
    for (const kind of ["being", "location", "community", "artifact"] as const) {
      const initial = CAMPAIGN_ENTITY_STATES[kind][0].key;
      expect(campaignEntityState(kind, undefined)).toBe(initial);
      expect(campaignEntityState(kind, "неизвестно")).toBe(initial);
      expect(campaignEntityStateTone(kind, initial)).toBeNull();
    }
    expect(campaignEntityStateTone("being", "dead")).toBe("red");
    expect(campaignEntityStateTone("community", "dissolved")).toBe("red");
    expect(campaignEntityStateTone("artifact", "lost")).toBe("red");
    expect(campaignEntityStateTone("artifact", "with_party")).toBe("green");
    expect(campaignEntityStateTone("location", "damaged")).toBe("yellow");
  });
});
