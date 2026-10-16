// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SessionRecordsReview } from "./SessionRecordsReview";
import type { EntityRecord } from "../../entityRecords";

const fx = vi.hoisted(() => ({
  records: [] as unknown[],
  put: vi.fn(async () => ({})),
  run: vi.fn(async (action: () => Promise<unknown>) => action()),
}));
vi.mock("../../data/hooks", () => ({
  useResource: (path: string | null) => ({ data: path?.includes("/records?") ? { records: fx.records } : path?.includes("/world") ? { setting_id: 1, entities: [] } : [] }),
  useAction: () => fx.run,
  write: { put: fx.put, post: vi.fn() },
}));
vi.mock("../mentions/MentionText", () => ({ MentionText: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock("../mentions/MentionPickerModal", () => ({ MentionPickerModal: () => null }));
afterEach(() => {
  cleanup();
  fx.put.mockClear();
});

function rec(over: Partial<EntityRecord>): EntityRecord {
  return {
    id: 1, campaign_id: 5, owner_type: "being", owner_id: 9, owner_name: "Мия", aspect: "note", text: "Текст",
    status: "established", certainty: "known", known_to: "gm", known_note: "", basis: "", session_id: 3,
    replaces_id: null, replaced_by: null, source: "manual", source_note_id: null, created_at: "", updated_at: "", ...over,
  };
}

function mount() {
  render(
    <MemoryRouter>
      <SessionRecordsReview campaignId={5} sessionId={3} settingId={1} />
    </MemoryRouter>
  );
}

describe("разбор встречи", () => {
  it("черновики — в очереди, не в «Записях встречи»", () => {
    fx.records = [rec({ id: 2, status: "draft", text: "Черновик" }), rec({ id: 1, text: "Факт" })];
    mount();
    const held = screen.getByRole("heading", { name: /Записи встречи/ }).closest("section")!;
    expect(within(held).getByText("Факт")).toBeTruthy();
    expect(within(held).queryByText("Черновик")).toBeNull();
    expect(screen.getByRole("heading", { name: /Черновики — разобрать/ })).toBeTruthy();
  });

  it("черновик без адреса нельзя подтвердить, пока не выбран владелец", () => {
    fx.records = [rec({ id: 2, status: "draft", owner_type: "campaign", owner_id: 5, aspect: "unsorted", source: "quick" })];
    mount();
    expect((screen.getByRole("button", { name: "Подтвердить" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/быстрая запись/)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "На ком" }), { target: { value: "campaign:5:resources" } });
    expect(fx.put).toHaveBeenCalledWith("/records/2", { owner_type: "campaign", owner_id: 5, aspect: "resources" });
  });

  it("«Подтвердить» и «Отбросить» меняют статус", async () => {
    fx.records = [rec({ id: 2, status: "draft" })];
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    await vi.waitFor(() => expect(fx.put).toHaveBeenCalledWith("/records/2", { status: "established" }));
    fireEvent.click(screen.getByRole("button", { name: "Отбросить" }));
    await vi.waitFor(() => expect(fx.put).toHaveBeenCalledWith("/records/2", { status: "discarded" }));
  });
});
