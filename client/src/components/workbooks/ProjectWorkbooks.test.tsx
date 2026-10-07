// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ProjectWorkbooks } from "./ProjectWorkbooks";

const mocks = vi.hoisted(() => ({ post: vi.fn(), run: vi.fn() }));
vi.mock("../../data/hooks", () => ({
  useResource: () => ({ data: [], error: null }),
  useAction: () => mocks.run,
  write: { post: mocks.post },
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each([true, false])("creates a notebook with inline=%s and keeps the expected page", async (inline) => {
  mocks.post.mockResolvedValue({ id: 4 });
  mocks.run.mockImplementation((action: () => Promise<unknown>) => action());
  function Page() {
    const location = useLocation();
    return <><ProjectWorkbooks type="campaign" id={42} inline={inline}/><output data-testid="address">{location.pathname}{location.search}</output></>;
  }
  render(<MemoryRouter initialEntries={["/campaigns/42?tab=Тетрадь"]}><Page/></MemoryRouter>);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Создать рабочую тетрадь" })); });
  expect(mocks.post).toHaveBeenCalledWith("/workbooks/projects/campaign/42/notebook", {});
  expect(screen.getByTestId("address").textContent).toBe(inline ? "/campaigns/42?tab=Тетрадь" : "/workbooks/4");
});
