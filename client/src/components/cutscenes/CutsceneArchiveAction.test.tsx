// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createCutsceneDocument } from "@shared/cutscenes/defaults";
vi.mock("../../data/cutscenes", () => ({ cutscenes: { archive: vi.fn(), restore: vi.fn() } }));
import { cutscenes } from "../../data/cutscenes";
import { queryClient } from "../../data/queryClient";
import { dismissNotice, getSaveNotices } from "../../data/notices";
import { CutsceneArchiveAction } from "./CutsceneArchiveAction";
import { CutsceneUsageList } from "./CutsceneUsageList";
const original = { id: 15, document: createCutsceneDocument("Ворота"), savedVersion: "v1", createdAt: "now", updatedAt: "now", archivedAt: null };
const show = (archived = false) => render(<QueryClientProvider client={queryClient}><MemoryRouter><CutsceneArchiveAction id={15} name="Ворота" archived={archived} /></MemoryRouter></QueryClientProvider>);
beforeEach(() => { vi.resetAllMocks(); queryClient.clear(); vi.mocked(cutscenes.archive).mockResolvedValue(original); vi.mocked(cutscenes.restore).mockResolvedValue(original); });
afterEach(() => { cleanup(); getSaveNotices().forEach(notice => dismissNotice(notice.id)); });
describe("архивирование и причины запрета", () => {
  it("называет оригинал в подтверждении и позволяет отменить без записи", () => {
    show(); fireEvent.click(screen.getByRole("button", { name: "В архив" })); expect(screen.getByRole("heading", { name: "В архив «Ворота»?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" })); expect(cutscenes.archive).not.toHaveBeenCalled();
  });
  it("архивирует общий оригинал без передачи планов или подборок", async () => {
    show(); fireEvent.click(screen.getByRole("button", { name: "В архив" })); fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "В архив" }));
    await waitFor(() => expect(cutscenes.archive).toHaveBeenCalledExactlyOnceWith(15)); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("отказ сохраняет подтверждение и показывает стандартную плашку", async () => {
    vi.mocked(cutscenes.archive).mockRejectedValue(Error("offline")); show(); fireEvent.click(screen.getByRole("button", { name: "В архив" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "В архив" }));
    await waitFor(() => expect(getSaveNotices().some(notice => notice.message.includes("offline"))).toBe(true)); expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it("восстанавливает через стандартное действие", async () => {
    show(true); fireEvent.click(screen.getByRole("button", { name: "Восстановить" })); await waitFor(() => expect(cutscenes.restore).toHaveBeenCalledExactlyOnceWith(15));
  });
  it("причины содержат читаемые контексты и переходы, без кнопки удаления привязок", () => {
    render(<MemoryRouter><CutsceneUsageList usage={{ cutsceneId: 15, canDelete: false, places: [
      { key: "campaign:3", kind: "campaign", label: "Подборка кампании «Город»", href: "/campaigns/3" },
      { key: "music", kind: "music", label: "Продолжающаяся музыка · Город", href: null },
    ] }} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Подборка кампании «Город»" }).getAttribute("href")).toBe("/campaigns/3");
    expect(screen.getByText("Продолжающаяся музыка · Город")).toBeTruthy(); expect(screen.queryByRole("button")).toBeNull();
  });
  it("свободный оригинал показывает отсутствие сохранённых использований", () => {
    render(<CutsceneUsageList usage={{ cutsceneId: 15, canDelete: true, places: [] }} />); expect(screen.getByText("Привязок и сохранённого использования нет.")).toBeTruthy();
  });
});
