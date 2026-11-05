// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageContextMenu } from "../PageContextMenu";
import { RegTile } from "../ListRegistry";
import { PlayerCharacterCards } from "./PlayerCharacterCards";
import type { Player, PlayerCharacter } from "../../types";

vi.mock("../../data/hooks", () => ({ useAfterWrite: () => vi.fn() }));
vi.mock("../../api/currentUser", () => ({ getCachedUser: () => ({ role: "gm" }) }));
vi.mock("../../utils/fileUrl", () => ({ useAuthenticatedFileUrl: () => null }));
vi.mock("../mentions/MentionText", () => ({ MentionText: ({ text }: { text: string }) => <>{text}</> }));
Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn() }, configurable: true });
afterEach(cleanup);

const player = { id: 7, name: "Белый", notes: "Расследования" } as Player;
const character = { id: 9, character_name: "Ларри", campaign_id: null, status: "active" } as PlayerCharacter;
const labels = () => Array.from(document.querySelectorAll(".context-menu-label")).map((node) => node.textContent);
function setup(children: React.ReactNode) {
  render(<MemoryRouter>{children}<PageContextMenu /></MemoryRouter>);
}

describe("карточки игроков подключены к общему меню объекта", () => {
  it("ПКМ по карточке и её ⋯ открывают одно меню игрока, а не страницы", () => {
    setup(<RegTile entity={{ type: "player", id: player.id, name: player.name }} to="/players/7"><div className="reg-tile__text">{player.notes}</div></RegTile>);
    fireEvent.contextMenu(screen.getByText("Расследования"));
    expect(document.querySelector(".context-menu-title")?.textContent).toBe("Белый");
    const fromRightClick = labels();
    expect(fromRightClick).toContain("Открыть");
    expect(fromRightClick).not.toContain("Закрепить страницу");
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Действия: Белый" }));
    expect(labels()).toEqual(fromRightClick);
    expect(labels().filter((label) => label === "В архив")).toHaveLength(1);
  });

  it("ПКМ по портрету персонажа относится к персонажу и оставляет один путь к листу", () => {
    setup(<PlayerCharacterCards characters={[character]} />);
    fireEvent.contextMenu(screen.getByLabelText("Портрет не выбран: Ларри"));
    expect(document.querySelector(".context-menu-title")?.textContent).toBe("Ларри");
    expect(labels()).toContain("Открыть");
    expect(labels().at(-1)).toBe("В архив");
    expect(screen.queryByText("Профиль →")).toBeNull();
    expect(screen.getByRole("link", { name: "Завести лист →" }).getAttribute("href")).toBe("/characters/9");
  });

  it("Shift+F10 с имени игрока открывает меню того же игрока", () => {
    setup(<RegTile entity={{ type: "player", id: player.id, name: player.name }} to="/players/7"><div className="reg-tile__text">{player.notes}</div></RegTile>);
    screen.getByRole("link", { name: "Белый" }).focus();
    fireEvent.keyDown(document, { key: "F10", shiftKey: true });
    expect(document.querySelector(".context-menu-title")?.textContent).toBe("Белый");
  });
});
