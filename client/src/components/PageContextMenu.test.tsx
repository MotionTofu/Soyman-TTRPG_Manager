// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageContextMenu } from "./PageContextMenu";
import { entityMark } from "../pageMenu";

vi.mock("../data/hooks", () => ({ useAfterWrite: () => vi.fn() }));
vi.mock("../api/currentUser", () => ({ getCachedUser: () => ({ role: "gm" }) }));
vi.mock("../mentions", () => ({ buildMentionToken: vi.fn(async () => null) }));
Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(), readText: vi.fn(), write: vi.fn() }, configurable: true });
afterEach(cleanup);

function setup(children: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/settings/3?tab=Население"]}>
      <h1>Вотердип</h1>
      {children}
      <PageContextMenu />
    </MemoryRouter>
  );
}
const labels = () => Array.from(document.querySelectorAll(".context-menu button")).map((b) => b.querySelector(".context-menu-label")?.textContent);

describe("ПКМ страниц — общая точка", () => {
  it("объект по метке: шапка с именем, общий блок, архив последним", () => {
    setup(<button {...entityMark("being", 7, "Флоон Бластар")}>Флоон</button>);
    fireEvent.contextMenu(screen.getByText("Флоон"));
    expect(document.querySelector(".context-menu-title")?.textContent).toBe("Флоон Бластар");
    expect(labels()).toEqual(["Открыть", "Открыть вторым окном", "В мешок", "Закрепить", "Копировать упоминание", "В архив"]);
  });

  it("фон страницы — меню страницы с подсказкой про Shift", () => {
    setup(<p>Просто текст</p>);
    fireEvent.contextMenu(screen.getByText("Просто текст"));
    expect(labels()).toEqual(["Открыть вторым окном", "Закрепить страницу", "Копировать ссылку"]);
    expect(document.querySelector(".context-menu-foot")?.textContent).toMatch(/Shift/);
  });

  it("поле — правка, а не меню страницы", () => {
    setup(<input defaultValue="Вотердипп" />);
    fireEvent.contextMenu(screen.getByRole("textbox"));
    expect(labels()).toContain("Вставить");
    expect(labels()).not.toContain("Закрепить страницу");
  });

  it("своё меню страницы и Shift+ПКМ не перехватываются", () => {
    setup(<div onContextMenu={(e) => e.preventDefault()}>Своё</div>);
    fireEvent.contextMenu(screen.getByText("Своё"));
    fireEvent.contextMenu(document.body, { shiftKey: true });
    expect(document.querySelector(".context-menu")).toBeNull();
  });
});
