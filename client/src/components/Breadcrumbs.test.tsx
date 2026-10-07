// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Link, MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { NavigationHistoryProvider } from "../layout/NavigationHistory";
import { Breadcrumbs } from "./Breadcrumbs";

afterEach(cleanup);

function Pages() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <Breadcrumbs items={[{ label: "Сеттинги", to: "/settings" }, { label: "Вотердип", to: "/settings/1" }, { label: "Текущая страница" }]} />
    <output data-testid="path">{location.pathname + location.search}</output>
    <Link to="/workbooks/4">Тетрадь</Link>
    <Link to="/beings/684?tab=Досье">Рухт</Link>
    <Link to="/beings/684?tab=Связи">Связи</Link>
    <button onClick={() => navigate("/beings/684?tab=Хроника", { replace: true })}>Заменить вкладку</button>
    <button onClick={() => navigate(1)}>Вперёд</button>
  </>;
}
const mount = () => render(<MemoryRouter initialEntries={["/settings/1?tab=Приключения&adventure=156"]}>
  <NavigationHistoryProvider><Pages /></NavigationHistoryProvider>
</MemoryRouter>);

describe("возврат из хлебных крошек", () => {
  it("returns to the originating page with its selected adventure", () => {
    mount();
    fireEvent.click(screen.getByRole("link", { name: "Тетрадь" }));
    fireEvent.click(screen.getByRole("button", { name: "← Назад" }));
    expect(screen.getByTestId("path").textContent).toBe("/settings/1?tab=Приключения&adventure=156");
    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    expect(screen.getByTestId("path").textContent).toBe("/workbooks/4");
    fireEvent.click(screen.getByRole("button", { name: "← Назад" }));
    expect(screen.getByTestId("path").textContent).toContain("adventure=156");
  });

  it("skips tab history and handles a replaced entry without creating a back loop", () => {
    mount();
    fireEvent.click(screen.getByRole("link", { name: "Рухт" }));
    fireEvent.click(screen.getByRole("link", { name: "Связи" }));
    fireEvent.click(screen.getByRole("button", { name: "Заменить вкладку" }));
    fireEvent.click(screen.getByRole("button", { name: "← Назад" }));
    expect(screen.getByTestId("path").textContent).toBe("/settings/1?tab=Приключения&adventure=156");
    expect(screen.queryByRole("button", { name: "← Назад" })).toBeNull();
  });

  it("falls back to the nearest parent on direct entry", () => {
    mount();
    expect(screen.getByRole("link", { name: "← Назад" }).getAttribute("href")).toBe("/settings/1");
    expect(screen.getByRole("navigation", { name: "Хлебные крошки" })).toBeTruthy();
    expect(screen.getByText("Текущая страница").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Сеттинги" }).getAttribute("href")).toBe("/settings");
  });
});
