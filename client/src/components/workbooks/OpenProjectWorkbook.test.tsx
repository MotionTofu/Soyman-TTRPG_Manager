// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { OpenProjectWorkbook } from "./OpenProjectWorkbook";

const mocks = vi.hoisted(() => ({ post: vi.fn(), run: vi.fn() }));
vi.mock("../../data/hooks", () => ({ useAction: () => mocks.run, write: { post: mocks.post } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function Page() {
  const location = useLocation();
  return <><OpenProjectWorkbook type="adventure" id={156} /><output>{location.pathname}</output></>;
}
it("opens the ensured notebook without creating a second one on repeated clicks", async () => {
  let resolve!: (value: { id: number }) => void;
  mocks.post.mockReturnValue(new Promise<{ id: number }>((done) => { resolve = done; }));
  mocks.run.mockImplementation((action: () => Promise<unknown>) => action());
  render(<MemoryRouter initialEntries={["/settings/1"]}><Page /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Открыть тетрадь" }));
  const opening = screen.getByRole("button", { name: "Открываем тетрадь…" });
  expect((opening as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(opening);
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(mocks.post).toHaveBeenCalledWith("/workbooks/projects/adventure/156/notebook", {});
  await act(async () => { resolve({ id: 4 }); });
  expect(screen.getByText("/workbooks/4")).toBeTruthy();
});
it("stays on the profile and allows retry when opening fails", async () => {
  mocks.run.mockResolvedValue(null);
  render(<MemoryRouter initialEntries={["/settings/1"]}><Page /></MemoryRouter>);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Открыть тетрадь" })); });
  expect(screen.getByText("/settings/1")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Открыть тетрадь" }) as HTMLButtonElement).disabled).toBe(false);
});
