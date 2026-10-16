// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCampaign } from "./campaignProfile";
import { ContextSwitch } from "./CampaignProfileParts";
import type { EngagedCampaign } from "../../types";

vi.mock("../../data/hooks", () => ({ useResource: () => ({ data: [] }), useAction: () => vi.fn(), write: {} }));
afterEach(cleanup);

const camp = (id: number, name: string): EngagedCampaign => ({ id, name, records: 0, drafts: 0, rumors: 0, last_session: null });
const engaged = [camp(2, "Фобетор"), camp(5, "Мёртвый канал")];

describe("контекст кампании на профиле", () => {
  it("параметр выбирает кампанию, base — основу", () => {
    expect(resolveCampaign("5", null, engaged)?.name).toBe("Мёртвый канал");
    expect(resolveCampaign("base", 5, engaged)).toBeNull();
    // Кампания, где сущность не задействована, — основа.
    expect(resolveCampaign("9", null, engaged)).toBeNull();
  });

  it("без параметра во время идущей сессии — её кампания, если сущность там задействована", () => {
    expect(resolveCampaign(null, 2, engaged)?.id).toBe(2);
    expect(resolveCampaign(null, 9, engaged)).toBeNull();
    expect(resolveCampaign(null, null, engaged)).toBeNull();
  });

  it("переключатель — только если сущность где-то задействована", () => {
    const { container } = render(<ContextSwitch engaged={[]} campaign={null} onSelect={vi.fn()} />);
    expect(container.textContent).toBe("");
    const onSelect = vi.fn();
    render(<ContextSwitch engaged={engaged} campaign={engaged[1]} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: "Мёртвый канал" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Основа сеттинга" }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
