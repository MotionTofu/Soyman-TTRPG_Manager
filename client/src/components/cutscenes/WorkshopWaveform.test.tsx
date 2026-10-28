// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCutsceneAudioCommand } from "@shared/cutscenes/defaults";
vi.mock("../../cutscenes/waveform", () => ({ readCutsceneWaveform: vi.fn(async () => ({ duration: 60, peaks: [.1, .8, .3, .7] })) }));
vi.mock("../../cutscenes/useWorkshopPreview", () => { const controller = { position: () => null, cancelBoundaryEdit() {}, beginBoundaryEdit() {}, endBoundaryEdit() {} }; return { useWorkshopPreview: () => ({ controller }) }; });
import { WorkshopWaveform } from "./WorkshopWaveform";
afterEach(cleanup);
describe("подбор границ по волнограмме", () => {
  it("перемещает границы с клавиатуры, сохраняет точность и не позволяет пересечь выделение", async () => {
    const command = { ...createCutsceneAudioCommand("music", { kind: "audio" as const, id: "track" }), startSeconds: 3, endSeconds: 12 };
    const change = vi.fn();
    render(<WorkshopWaveform id={1} value={command} onChange={change} onDraft={() => {}} onDuration={() => {}} />);
    const start = await screen.findByRole("button", { name: "Начало выделения" });
    fireEvent.keyDown(start, { code: "ArrowRight", shiftKey: true }); expect(change).toHaveBeenLastCalledWith({ start: 4, end: 12 });
    fireEvent.keyDown(start, { code: "ArrowLeft" }); expect(change).toHaveBeenLastCalledWith({ start: 2.9, end: 12 });
    expect(screen.getByRole("img", { name: /0:03.0 — 0:12.0/ })).toBeTruthy();
  });
});
