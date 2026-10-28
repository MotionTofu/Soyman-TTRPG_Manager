// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCutsceneDocument, createCutsceneStep } from "@shared/cutscenes/defaults";
import { resolveCutsceneStep } from "@shared/cutscenes/resolve";
import type { CutsceneRunState } from "@shared/cutscenes/runApi";
import { browserCutsceneOutput, listenForCutscenePreparation, prepareImages } from "./display";

vi.mock("../data/imperative", () => ({ readOnce: vi.fn(async () => ({ ref: { kind: "image", id: "image-08" }, url: "/files/image-08.png", expiresAt: null })) }));
const ports = new Set<Channel>(), sent: unknown[] = [];
class Channel {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor() { ports.add(this); }
  postMessage(data: unknown) { sent.push(data); for (const port of ports) if (port !== this) queueMicrotask(() => port.onmessage?.({ data })); }
  close() { ports.delete(this); }
}
class ImageStub {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  decode() { return Promise.resolve(); }
  removeAttribute() {}
}
beforeEach(() => { ports.clear(); sent.length = 0; vi.stubGlobal("BroadcastChannel", Channel); vi.stubGlobal("Image", ImageStub);
  history.replaceState(null, "", "/player-display?windowId=window-08"); });
afterEach(() => { ports.forEach(port => port.close()); vi.unstubAllGlobals(); });
describe("подготовка изображения без публикации", () => {
  it("не принимает небезопасный URL", async () => {
    await expect(prepareImages(["javascript:alert(1)"], new AbortController().signal)).rejects.toThrow();
  });
  it("учитывает отмену ещё до загрузки", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(prepareImages(["/files/image.png"], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("готовит настоящее окно только изображениями, без приватных каналов", async () => {
    const base = createCutsceneDocument("PRIVATE NAME");
    const document = { ...base, steps: [{ ...createCutsceneStep("first"), text: { action: "replace" as const, text: "PRIVATE TEXT" },
      notes: "PRIVATE NOTES", image: { action: "replace" as const, transition: { kind: "cut" as const, durationMs: 0 },
        composition: { background: { kind: "image" as const, id: "image-08" }, layers: [], title: "Public caption", title_secs: 0, fade_ms: 0 } } }] };
    const run = { snapshot: { mode: "live", version: { cutsceneId: 17, document },
      returnState: { window: { windowId: "window-08" } } } } as unknown as CutsceneRunState;
    const detach = listenForCutscenePreparation();
    try {
      const dispose = await browserCutsceneOutput.prepare(run, resolveCutsceneStep(document, "first")!, new AbortController().signal); dispose();
      const packets = JSON.stringify(sent); expect(packets).toContain("/files/image-08.png");
      for (const forbidden of ["PRIVATE", "notes", "narration", "returnState", "audio", "document"]) expect(packets).not.toContain(forbidden);
    } finally { detach(); }
  });
  it("репетиция декодирует изображения локально без межоконных сообщений", async () => {
    const document = { ...createCutsceneDocument("Rehearsal"), steps: [createCutsceneStep("first")] };
    const run = { snapshot: { mode: "rehearsal", version: { cutsceneId: 17, document } } } as unknown as CutsceneRunState;
    const dispose = await browserCutsceneOutput.prepare(run, resolveCutsceneStep(document, "first")!, new AbortController().signal); dispose();
    expect(sent).toEqual([]);
  });
});
