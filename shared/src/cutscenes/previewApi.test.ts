import { describe, expect, it } from "vitest";
import { createCutsceneAudioCommand, createCutsceneDocument, createCutsceneStep } from "./defaults";
import { selectedPreviewDocument } from "./previewApi";
import { parseCutsceneDocument } from "./validate";

describe("рабочая проекция предпросмотра", () => {
  it("сохраняет идентичность наследованной музыкальной команды, текст и заметки выбранного шага", () => {
    const command = createCutsceneAudioCommand("music", { kind: "audio", id: "track" });
    const document = { ...createCutsceneDocument("Тест"), steps: [
      { ...createCutsceneStep("source"), audio: { action: "replace" as const, command }, text: { action: "replace" as const, text: "Читать" } },
      { ...createCutsceneStep("selected"), notes: "Пауза" },
    ] };
    expect(selectedPreviewDocument(document, "selected").steps).toEqual([expect.objectContaining({
      id: "selected", audio: { action: "replace", command }, text: { action: "replace", text: "Читать" }, notes: "Пауза",
    })]);
    expect(document.steps[1].audio.action).toBe("keep");
  });
  it("не включает ошибочный неиспользуемый шаг, но сохраняет ошибку выбранного источника", () => {
    const command = { ...createCutsceneAudioCommand("bad", { kind: "audio" as const, id: "track" }), startSeconds: 12, endSeconds: 2 };
    const document = { ...createCutsceneDocument("Тест"), steps: [
      { ...createCutsceneStep("valid"), text: { action: "replace" as const, text: "Готово" } },
      { ...createCutsceneStep("bad"), audio: { action: "replace" as const, command } },
    ] };
    expect(parseCutsceneDocument(selectedPreviewDocument(document, "valid")).ok).toBe(true);
    expect(parseCutsceneDocument(selectedPreviewDocument(document, "bad")).ok).toBe(false);
  });
});
