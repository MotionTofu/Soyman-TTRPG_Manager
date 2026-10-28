// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../data/imperative", () => ({ readOnce: mock.read }));
import { prepareCutsceneAudioAsset } from "./cutsceneAudioMedia";
const ref = { kind: "audio" as const, id: "file-06" };
let fetchFile: ReturnType<typeof vi.fn>, createUrl: ReturnType<typeof vi.fn>, revokeUrl: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mock.read.mockReset(); mock.read.mockResolvedValue({ ref, url: "/files/fresh?sig=new&exp=100", expiresAt: null });
  fetchFile = vi.fn(async () => new Response(new Blob(["silent fixture bytes"]), { status: 200 }));
  createUrl = vi.fn(() => "blob:prepared-06"); revokeUrl = vi.fn();
  vi.stubGlobal("fetch", fetchFile); vi.stubGlobal("URL", { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function(this: HTMLMediaElement) {
    Object.defineProperty(this, "duration", { value: 12, configurable: true });
    Object.defineProperty(this, "readyState", { value: 4, configurable: true });
    this.dispatchEvent(new Event("loadedmetadata")); this.dispatchEvent(new Event("canplay"));
  });
});
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("подготовка файла с короткоживущим доступом", () => {
  it("обновляет истёкший доступ и готовит два голоса без начала воспроизведения", async () => {
    mock.read.mockResolvedValueOnce({ ref, url: "/files/old?sig=old&exp=1", expiresAt: null });
    fetchFile.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const prepared = await prepareCutsceneAudioAsset(6, ref, 2, new AbortController().signal);
    expect(mock.read).toHaveBeenCalledTimes(2); expect(fetchFile).toHaveBeenNthCalledWith(2, "/files/fresh?sig=new&exp=100", expect.anything());
    expect(play).not.toHaveBeenCalled(); expect(prepared.voices.map(audio => audio.currentTime)).toEqual([2, 2]);
    expect(prepared.voices.every(audio => audio.src === "blob:prepared-06" && audio.dataset.audioChannel === "background")).toBe(true);
    expect(revokeUrl).not.toHaveBeenCalled(); prepared.dispose(); expect(revokeUrl).toHaveBeenCalledWith("blob:prepared-06");
    expect(document.querySelectorAll("audio")).toHaveLength(0);
  });
  it("возврат готовит свежий доступ, а старый signed URL не является источником голоса", async () => {
    const first = await prepareCutsceneAudioAsset(6, ref, 2, new AbortController().signal); first.dispose();
    const second = await prepareCutsceneAudioAsset(6, ref, 2, new AbortController().signal);
    expect(mock.read).toHaveBeenCalledTimes(2); expect(second.voices[0].src).not.toContain("sig="); second.dispose();
  });
  it("ошибка границ освобождает временный Blob и оба audio-элемента", async () => {
    await expect(prepareCutsceneAudioAsset(6, ref, 12, new AbortController().signal)).rejects.toThrow("границы");
    expect(revokeUrl).toHaveBeenCalledTimes(1); expect(document.querySelectorAll("audio")).toHaveLength(0);
  });
  it("отменённое чтение не создаёт поздний Blob или audio-элемент", async () => {
    const abort = new AbortController();
    fetchFile.mockImplementationOnce(async () => { abort.abort(); return new Response(new Blob(["silent"])); });
    await expect(prepareCutsceneAudioAsset(6, ref, 0, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(createUrl).not.toHaveBeenCalled(); expect(document.querySelectorAll("audio")).toHaveLength(0);
  });
  it("отсутствующий файл не маскируется повторным запросом доступа", async () => {
    fetchFile.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(prepareCutsceneAudioAsset(6, ref, 0, new AbortController().signal)).rejects.toThrow("404");
    expect(mock.read).toHaveBeenCalledTimes(1); expect(createUrl).not.toHaveBeenCalled();
  });
});
