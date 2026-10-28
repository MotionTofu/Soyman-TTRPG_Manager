// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createCutsceneDocument, createCutsceneStep } from "@shared/cutscenes/defaults";
import { CutsceneReading } from "./CutsceneReading";
afterEach(() => cleanup());
describe("просмотр текстов катсцены", () => {
  it("продолженный текст читается, а заметки берутся из выбранного шага", () => {
    const document = { ...createCutsceneDocument("Чтение"), steps: [
      { ...createCutsceneStep("a"), text: { action: "replace" as const, text: "**У ворот**" }, notes: "Первые заметки" },
      { ...createCutsceneStep("b"), notes: "Другие заметки" },
    ] };
    render(<CutsceneReading document={document} />); fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
    expect(screen.getByText("У ворот").closest("strong")).toBeTruthy(); expect(screen.getByText("Другие заметки")).toBeTruthy(); expect(screen.queryByText("Первые заметки")).toBeNull();
  });
  it("пустой черновик не обещает доступных команд показа", () => {
    render(<CutsceneReading document={createCutsceneDocument("Пустая")} />); expect(screen.getByText("В катсцене пока нет шагов.")).toBeTruthy(); expect(screen.queryByRole("button")).toBeNull();
  });
});
