// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CompendiumEntry, System } from "../types";
import { VehicleDetailPage } from "./VehicleDetailPage";

vi.mock("../data/hooks", () => ({ useEntity: () => ({ data: null }), useSaveEntity: () => ({ save: vi.fn() }), useAction: () => vi.fn(), write: {}, useResource: (path: string) => ({ data: path?.endsWith("/sections") ? [{ id: 2, name: "Транспорт" }] : [] }) }));
vi.mock("../components/VehiclePlan", () => ({ VehiclePlan: () => <p>Прежний чертёж</p>, VehiclePlanPreview: ({ onOpen }: { onOpen: () => void }) => <button type="button" onClick={onOpen}>Чертёж судна</button> }));
vi.mock("../components/StatblockList", () => ({ StatblockList: () => <p>Прежние статблоки</p> }));
vi.mock("../components/EntryImagesTab", () => ({ EntryImagesTab: () => <p>Прежняя галерея</p> }));
vi.mock("../components/MentionsTab", () => ({ MentionsTab: () => <p>Прежние упоминания</p> }));
vi.mock("../components/mentions/MentionText", () => ({ MentionText: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock("../components/EntityPreviewModal", () => ({ EntityPreviewModal: () => null }));
vi.mock("../components/EntityFieldsCard", () => ({ EntityFieldsCard: () => <p>Прежняя правка полей</p>, EntityFieldInputs: () => null, toFieldValues: () => ({}) }));
afterEach(cleanup);
const entry = { id: 5, system_id: 1, section_id: 2, kind: "vehicle", name: "Воздушный корабль", description: "Описание судна", parent_id: null, level: null, position: 0, aliases: [], name_original: "Airship", short_name: null, created_at: "2026-11-06", data: { size: "Большой", category: "Воздушный", ac: "13", hp: "300", crew: "10", passengers: "20", cargo: "1 тонна", speed: "8 миль/ч" } } as CompendiumEntry;
function show(value = entry) { return render(<MemoryRouter><VehicleDetailPage entry={value} system={{ id: 1, name: "D&D 5.5" } as System} /></MemoryRouter>); }
it("судно использует профиль, реальные факты и прежние вкладки", () => {
  const { container } = show();
  expect(container.querySelector(".entity-page--profile")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Воздушный корабль", level: 1 })).toBeTruthy();
  expect(screen.getByText("300")).toBeTruthy();
  expect(screen.getByText("Постов экипажа пока нет.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Чертёж судна" }));
  expect(screen.getByText("Прежний чертёж")).toBeTruthy();
  for (const [tab, text] of [["Статблоки", "Прежние статблоки"], ["Галерея", "Прежняя галерея"], ["Упоминания", "Прежние упоминания"]]) {
    fireEvent.click(screen.getByRole("tab", { name: tab })); expect(screen.getByText(text)).toBeTruthy();
  }
});
it("пост сохраняет собственные вкладки без чертежа и списка экипажа", () => {
  show({ ...entry, kind: "vehicle_post", name: "Защитный пост" });
  expect(screen.queryByRole("tab", { name: "Чертёж" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Посты экипажа" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Пост", level: 2 })).toBeTruthy();
});
