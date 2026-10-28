// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CutsceneUsage } from "@shared/cutscenes/usage";
vi.mock("../components/ListPage", () => ({ ListPage: ({ children, toolbarExtra, actions }: { children: ReactNode; toolbarExtra: ReactNode; actions: ReactNode }) => <main>{actions}{toolbarExtra}{children}</main> }));
vi.mock("../mentions", () => ({ refreshMentionIndex: vi.fn() }));
vi.mock("../data/hooks", () => ({ useResource: (path: string) => ({ data: path === "/archive" ? [{ type: "cutscene", id: 15, title: "Архивный пролог", archived_at: "2026-10-26T00:00:00Z" }] : [], loading: false, error: null, reload: vi.fn() }), useAfterWrite: () => vi.fn(), write: { del: vi.fn(), put: vi.fn(), post: vi.fn() } }));
vi.mock("../data/imperative", () => ({ readOnce: vi.fn() }));
import { write } from "../data/hooks";
import { readOnce } from "../data/imperative";
import { ArchivePage } from "./ArchivePage";
const impact = (usage: CutsceneUsage) => ({ detachedCampaigns: [], compendiumLinks: 0, baseMonsters: 0, resources: 0, characters: 0, masteringNotes: 0, modules: 0, cutsceneUsage: usage });
const free = () => impact({ cutsceneId: 15, places: [], canDelete: true });
const show = () => render(<MemoryRouter><ArchivePage /></MemoryRouter>);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readOnce).mockResolvedValue(free()); vi.mocked(write.del).mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("защищённое удаление катсцены в общем архиве", () => {
  it("перечисляет именованные места и блокирует кнопку", async () => {
    vi.mocked(readOnce).mockResolvedValue(impact({ cutsceneId: 15, canDelete: false, places: [{ key: "session:8", kind: "session", label: "План сессии «Город · Финал»", href: "/sessions/8" }] }));
    show(); fireEvent.click(screen.getByRole("button", { name: "Удалить навсегда" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "План сессии «Город · Финал»" })).toBeTruthy());
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Да, удалить навсегда" }).hasAttribute("disabled")).toBe(true); expect(write.del).not.toHaveBeenCalled();
  });
  it("до получения расчёта не разрешает удаление", () => {
    vi.mocked(readOnce).mockReturnValue(new Promise(() => {})); show(); fireEvent.click(screen.getByRole("button", { name: "Удалить навсегда" }));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Да, удалить навсегда" }).hasAttribute("disabled")).toBe(true);
  });
  it("при ошибке расчёта остаётся закрытым для удаления", async () => {
    vi.mocked(readOnce).mockRejectedValue(Error("offline")); show(); fireEvent.click(screen.getByRole("button", { name: "Удалить навсегда" }));
    await screen.findByRole("alert"); expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Да, удалить навсегда" }).hasAttribute("disabled")).toBe(true);
  });
  it("свободный архивный оригинал удаляет через защищённый серверный маршрут", async () => {
    show(); fireEvent.click(screen.getByRole("button", { name: "Удалить навсегда" }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Да, удалить навсегда" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Да, удалить навсегда" })); await waitFor(() => expect(write.del).toHaveBeenCalledWith("/archive/cutscene/15"));
  });
  it("новое использование между расчётом и DELETE сохраняет диалог и показывает отказ сервера", async () => {
    vi.mocked(write.del).mockRejectedValue(Error("Катсцена используется: Продолжающаяся музыка · Город")); show(); fireEvent.click(screen.getByRole("button", { name: "Удалить навсегда" }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Да, удалить навсегда" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Да, удалить навсегда" })); await waitFor(() => expect(screen.getByText(/Не удалось удалить: Катсцена используется/)).toBeTruthy()); expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it("восстанавливает через маршрут оригинала", async () => {
    show(); fireEvent.click(screen.getByRole("button", { name: "Восстановить" })); await waitFor(() => expect(write.put).toHaveBeenCalledWith("/cutscenes/15/restore", undefined, undefined));
  });
});
