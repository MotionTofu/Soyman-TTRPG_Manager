// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { lastHeldSession, recordChains, type EntityRecord } from "../../entityRecords";
import { EntityRecordItem } from "./EntityRecordItem";
import { RecordFormModal } from "./RecordFormModal";
import type { SessionSummary } from "../../types";

const fx = vi.hoisted(() => ({
  sessions: [
    { id: 1, date: "2026-09-01", status: "held", title: "Первая", session_number: 1 },
    { id: 2, date: "2026-09-15", status: "held", title: "Вторая", session_number: 2 },
    { id: 3, date: "2026-10-30", status: "planned", title: "Будущая", session_number: 3 },
  ],
  post: vi.fn(),
  run: vi.fn(async (action: () => Promise<unknown>) => action()),
}));
vi.mock("../../data/hooks", () => ({
  useResource: () => ({ data: fx.sessions, loading: false, error: null, reload: vi.fn() }),
  useAction: () => fx.run,
  write: { post: fx.post, put: vi.fn(), del: vi.fn() },
}));
vi.mock("../mentions/MentionText", () => ({ MentionText: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock("../mentions/MentionTextarea", () => ({
  MentionTextarea: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
afterEach(() => {
  cleanup();
  fx.post.mockReset();
});

function rec(over: Partial<EntityRecord>): EntityRecord {
  return {
    id: 1,
    campaign_id: 5,
    owner_type: "being",
    owner_id: 9,
    owner_name: "Мия",
    aspect: "note",
    text: "Текст",
    status: "established",
    certainty: "known",
    known_to: "gm",
    known_note: "",
    basis: "",
    session_id: null,
    replaces_id: null,
    replaced_by: null,
    source: "manual",
    source_note_id: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("запись", () => {
  it("«установлено» и «известно» меткой не показываются — только отличия", () => {
    const { container } = render(
      <MemoryRouter>
        <EntityRecordItem chain={{ record: rec({}), history: [] }} settingId={1} />
      </MemoryRouter>
    );
    const meta = container.querySelector(".entity-record__meta")!;
    expect(meta.textContent).not.toMatch(/установлено|известно/);
    expect(meta.textContent).toContain("знает: мастер");
    cleanup();
    const { container: c2 } = render(
      <MemoryRouter>
        <EntityRecordItem
          chain={{ record: rec({ status: "assumption", certainty: "rumor", known_to: "some", known_note: "VANTA", session_id: 2 }), history: [] }}
          settingId={1}
        />
      </MemoryRouter>
    );
    const meta2 = c2.querySelector(".entity-record__meta")!.textContent;
    expect(meta2).toContain("предположение");
    expect(meta2).toContain("слух");
    expect(meta2).toContain("знает: VANTA");
    expect(meta2).toContain("Вторая");
  });

  it("заменённая уходит в «Историю замен» заменившей", () => {
    const chains = recordChains([rec({ id: 3, replaces_id: 2, text: "Стало" }), rec({ id: 2, replaces_id: 1, replaced_by: 3, text: "Было-2" }), rec({ id: 1, replaced_by: 2, text: "Было-1" }), rec({ id: 4, text: "Другая" })]);
    expect(chains.map((c) => c.record.id)).toEqual([3, 4]);
    expect(chains[0].history.map((r) => r.id)).toEqual([2, 1]);
    render(
      <MemoryRouter>
        <EntityRecordItem chain={chains[0]} settingId={1} />
      </MemoryRouter>
    );
    expect(screen.queryByText("Было-1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "История замен · 2" }));
    const history = screen.getByRole("list", { name: "История замен" });
    expect(within(history).getByText("Было-2")).toBeTruthy();
    expect(within(history).getByText("Было-1")).toBeTruthy();
  });
});

describe("окно записи", () => {
  it("графы — только словарь вида владельца", () => {
    render(<RecordFormModal campaignId={5} settingId={1} ownerType="location" ownerId={7} onClose={vi.fn()} />);
    const options = within(screen.getByRole("combobox", { name: "Графа" })).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Цена и риск");
    expect(options).not.toContain("Хочет");
  });

  it("встреча по умолчанию — последняя сыгранная, есть «вне встречи»", () => {
    expect(lastHeldSession(fx.sessions as SessionSummary[])?.id).toBe(2);
    render(<RecordFormModal campaignId={5} settingId={1} ownerType="being" ownerId={9} onClose={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: "Встреча" }) as HTMLSelectElement;
    expect(select.value).toBe("2");
    expect(within(select).getByRole("option", { name: "вне встречи" })).toBeTruthy();
  });

  it("«Заменить» шлёт новую запись на /records/:id/replace", async () => {
    const onClose = vi.fn();
    fx.post.mockResolvedValue({ id: 2 });
    render(<RecordFormModal campaignId={5} settingId={1} record={rec({ id: 1, text: "Было" })} replace onClose={onClose} />);
    expect((screen.getByRole("combobox", { name: "Графа" }) as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Утверждение" }), { target: { value: "Стало" } });
    fireEvent.click(screen.getByRole("button", { name: "Заменить" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fx.post).toHaveBeenCalledWith("/records/1/replace", expect.objectContaining({ text: "Стало", session_id: 2 }));
  });
});
