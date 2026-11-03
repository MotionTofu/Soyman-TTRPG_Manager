// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlayerProfilePanel } from "./PlayerProfilePanel";

const mocks = vi.hoisted(() => ({ post: vi.fn(), del: vi.fn().mockResolvedValue({}), empty: [] }));
vi.mock("../../data/hooks", () => ({
  useAction: () => async (fn: () => Promise<unknown>) => { try { return await fn(); } catch { return undefined; } },
  useAfterWrite: () => vi.fn(),
  useEntity: () => ({ data: { id: 7, name: "Белый", notes: "Заметка", interest: "Тайны", characters: [] } }),
  useResource: (path: string) => ({ data: path === "/campaigns" ? [{ id: 32, name: "Эстария" }] : mocks.empty, loading: false }),
  write: { post: mocks.post, del: mocks.del },
}));
vi.mock("../../api/currentUser", () => ({ useCurrentUser: () => ({ user: { role: "gm" } }) }));
vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => true }));
vi.mock("../../hooks/useImageCrop", () => ({ useImageCrop: () => ({ onSelect: vi.fn(), modal: null }) }));
vi.mock("./PlayerPortrait", () => ({ PlayerPortrait: () => <span>Портрет</span> }));
vi.mock("./PlayerCharacterCards", () => ({ PlayerCharacterCards: () => <p>Нет персонажей</p> }));
vi.mock("../EditableTextCard", () => ({ EditableTextCard: () => <p>Интересы</p> }));
vi.mock("../RemindersWidget", () => ({ RemindersWidget: () => null }));
vi.mock("../mentions/MentionText", () => ({ MentionText: ({ text }: { text: string }) => <>{text}</> }));
vi.mock("../mentions/MentionTextarea", () => ({ MentionTextarea: () => <textarea /> }));
afterEach(() => { cleanup(); mocks.post.mockReset(); mocks.del.mockClear(); });
function setup() {
  render(<MemoryRouter><Routes>
    <Route path="/" element={<PlayerProfilePanel playerId={7} />} />
    <Route path="/players" element={<p>Список игроков</p>} />
  </Routes></MemoryRouter>);
}

describe("действия профиля игрока", () => {
  it("обещает архивировать только игрока; отмена не пишет, согласие вызывает один endpoint", async () => {
    setup();
    const openArchive = () => {
      fireEvent.click(screen.getByRole("button", { name: "Ещё действия" }));
      fireEvent.click(screen.getByRole("button", { name: "Архивировать" }));
    };
    openArchive();
    expect(screen.getByRole("dialog").textContent).toContain("Его персонажи и доступ к приложению сохранятся");
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(mocks.del).not.toHaveBeenCalled();
    openArchive();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Архивировать" }));
    expect(await screen.findByText("Список игроков")).toBeTruthy();
    expect(mocks.del.mock.calls).toEqual([["/players/7"]]);
  });

  it("оставляет имя и кампанию при отказе создания персонажа", async () => {
    mocks.post.mockRejectedValue(new Error("Нет связи"));
    setup();
    const passport = document.querySelector<HTMLDetailsElement>(".player-profile__passport")!;
    expect(passport.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "+ Персонаж" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Кампания" }), { target: { value: "32" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Имя персонажа" }), { target: { value: "Ларри" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать персонажа" }));
    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    expect((screen.getByRole("textbox", { name: "Имя персонажа" }) as HTMLInputElement).value).toBe("Ларри");
    expect((screen.getByRole("combobox", { name: "Кампания" }) as HTMLSelectElement).value).toBe("32");
    expect(screen.queryByRole("button", { name: "+ Персонаж" })).toBeNull();
  });
});
