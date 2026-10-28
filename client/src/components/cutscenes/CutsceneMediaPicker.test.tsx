// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("../../data/hooks", () => ({ useResource: (path: string | null) => ({ data: path ? [{ id: 1, name: "Тема Береза", file_path: "a.mp3", file_url: null }] : undefined, loading: false, error: null, reload: vi.fn() }) }));
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
});
