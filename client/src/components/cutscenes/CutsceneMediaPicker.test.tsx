// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("../../data/hooks", () => ({ useResource: (path: string | null) => ({ data: path ? [{ id: 1, name: "Тема Береза", file_path: "a.mp3", file_url: "/files/a.mp3?sig=x" }] : undefined, loading: false, error: null, reload: vi.fn() }) }));
vi.mock("../../sound/duration", () => ({ useDurations: () => new Map([[1, 168]]), formatDuration: (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` }));
vi.mock("../mentions/MentionPickerModal", () => ({ MentionPickerModal: () => null }));
import { CutsceneMediaPicker } from "./CutsceneMediaPicker";

afterEach(cleanup);

describe("поиск материала", () => {
  it("различает пустой источник и поиск без совпадений, сброс возвращает список", () => {
    render(<CutsceneMediaPicker id={1} kind="audio" title="Музыка шага" onPick={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск материала" }), { target: { value: "барабаны" } });
    expect(screen.getByText(/Ничего не найдено по «барабаны»/)).toBeTruthy();
    expect(screen.queryByText("Нет доступных локальных файлов.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить поиск" }));
    expect(screen.getByText("Тема Береза")).toBeTruthy();
  });
  it("строка трека показывает длительность и даёт прослушать одним нажатием", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    render(<CutsceneMediaPicker id={1} kind="audio" title="Музыка шага" onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("2:48")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Прослушать «Тема Береза»" }));
    await screen.findByRole("button", { name: "Остановить «Тема Береза»" });
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Остановить «Тема Береза»" }));
    expect(pause).toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Прослушать «Тема Береза»" })).toBeTruthy();
    play.mockRestore(); pause.mockRestore();
  });
});
