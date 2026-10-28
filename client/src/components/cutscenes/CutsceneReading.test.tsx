// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createCutsceneDocument, createCutsceneStep } from "@shared/cutscenes/defaults";
import { CutsceneReading } from "./CutsceneReading";
afterEach(() => cleanup());
describe("просмотр текстов катсцены", () => {
  it("весь сценарий подряд: свой текст, продолжение без повтора, скрытый текст и заметки каждого шага", () => {
    const document = { ...createCutsceneDocument("Чтение"), steps: [
      { ...createCutsceneStep("a"), text: { action: "replace" as const, text: "**У ворот**" }, notes: "Первые заметки" },
      { ...createCutsceneStep("b"), name: "Двор", notes: "Другие заметки" },
      { ...createCutsceneStep("c"), text: { action: "clear" as const } },
    ] };
    render(<CutsceneReading document={document} />);
    expect(screen.getByText("1 · У ворот", { selector: "h3" })).toBeTruthy();
    expect(screen.getByText("У ворот").closest("strong")).toBeTruthy();
    expect(screen.getByText("Текст продолжается с шага «1 · У ворот».")).toBeTruthy(); expect(screen.getByText("Текст скрыт.")).toBeTruthy();
    expect(screen.getByText("Первые заметки")).toBeTruthy(); expect(screen.getByText("Другие заметки")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("пустой черновик не обещает доступных команд показа", () => {
    render(<CutsceneReading document={createCutsceneDocument("Пустая")} />); expect(screen.getByText("В катсцене пока нет шагов.")).toBeTruthy(); expect(screen.queryByRole("button")).toBeNull();
  });
});
