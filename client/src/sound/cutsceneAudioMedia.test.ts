// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../data/imperative", () => ({ readOnce: mock.read }));
import { loadCutsceneAudioBlob, prepareCutsceneAudioAsset } from "./cutsceneAudioMedia";
const ref = { kind: "audio" as const, id: "file-06" };
const oldUrl = "/files/stream.mp3?sig=old&exp=1";
const freshUrl = "/files/stream.mp3?sig=fresh&exp=9999999999";
let fetchFile: ReturnType<typeof vi.fn>, createUrl: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mock.read.mockReset(); mock.read.mockResolvedValue({ ref, url: freshUrl, expiresAt: "2286-11-20T17:46:39.000Z" });
  fetchFile = vi.fn(async () => new Response(new Blob(["silent fixture bytes"]), { status: 200 }));
  createUrl = vi.fn();
  vi.stubGlobal("fetch", fetchFile); vi.stubGlobal("URL", { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function(this: HTMLMediaElement) {
    Object.defineProperty(this, "duration", { value: 12, configurable: true });
    Object.defineProperty(this, "readyState", { value: 4, configurable: true });
    this.dispatchEvent(new Event("loadedmetadata")); this.dispatchEvent(new Event("canplay"));
  });
});
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("потоковый запуск музыки", () => {
  it("готовит два HTTP-голоса без полного fetch/Blob и без начала воспроизведения", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const prepared = await prepareCutsceneAudioAsset(6, ref, 2, new AbortController().signal);
    expect(fetchFile).not.toHaveBeenCalled(); expect(createUrl).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled(); expect(prepared.voices.map(audio => audio.currentTime)).toEqual([2, 2]);
    expect(prepared.voices.every(audio => audio.src.endsWith(freshUrl) && audio.dataset.audioChannel === "background")).toBe(true);
    prepared.dispose(); expect(document.querySelectorAll("audio")).toHaveLength(0);
  });
  it("обновляет доступ, истёкший до первой подготовки", async () => {
    mock.read.mockResolvedValueOnce({ ref, url: oldUrl, expiresAt: "1970-01-01T00:00:01.000Z" });
    vi.mocked(HTMLMediaElement.prototype.load).mockImplementationOnce(function(this: HTMLMediaElement) { this.dispatchEvent(new Event("error")); });
    const prepared = await prepareCutsceneAudioAsset(6, ref, 2, new AbortController().signal);
    expect(mock.read).toHaveBeenCalledTimes(2); expect(prepared.voices[0].src).toContain("sig=fresh"); prepared.dispose();
  });
  it("поздняя перемотка обновляет только устаревший голос и сохраняет позицию", async () => {
    mock.read.mockResolvedValueOnce({ ref, url: oldUrl, expiresAt: "1970-01-01T00:00:01.000Z" });
    const prepared = await prepareCutsceneAudioAsset(6, ref, 2, new AbortController().signal);
    expect(await prepared.refresh!(prepared.voices[0], 7, new AbortController().signal)).toBe(true);
    expect(prepared.voices[0].src).toContain("sig=fresh"); expect(prepared.voices[0].currentTime).toBe(7);
    expect(prepared.voices[1].src).toContain("sig=old");
    expect(await prepared.refresh!(prepared.voices[0], 7, new AbortController().signal)).toBe(false);
    expect(mock.read).toHaveBeenCalledTimes(2); prepared.dispose();
  });
  it("ошибка свежей ссылки не вызывает бесконечные попытки", async () => {
    vi.mocked(HTMLMediaElement.prototype.load).mockImplementation(function(this: HTMLMediaElement) { if (this.hasAttribute("src")) this.dispatchEvent(new Event("error")); });
    await expect(prepareCutsceneAudioAsset(6, ref, 0, new AbortController().signal)).rejects.toThrow("подготовить");
    expect(mock.read).toHaveBeenCalledTimes(2); expect(document.querySelectorAll("audio")).toHaveLength(0);
  });
  it("ошибка границ освобождает оба audio-элемента", async () => {
    await expect(prepareCutsceneAudioAsset(6, ref, 12, new AbortController().signal)).rejects.toThrow("границы");
    expect(mock.read).toHaveBeenCalledTimes(1); expect(document.querySelectorAll("audio")).toHaveLength(0);
  });
  it("отмена запроса доступа не оставляет поздние аудио-элементы", async () => {
    const abort = new AbortController();
    mock.read.mockImplementationOnce(async () => { abort.abort(); return { ref, url: freshUrl, expiresAt: "2286-11-20T17:46:39.000Z" }; });
    await expect(prepareCutsceneAudioAsset(6, ref, 0, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(document.querySelectorAll("audio")).toHaveLength(0);
  });
  it("отсутствующий материал не маскируется повтором", async () => {
    mock.read.mockRejectedValueOnce(new Error("404: материал недоступен"));
    await expect(prepareCutsceneAudioAsset(6, ref, 0, new AbortController().signal)).rejects.toThrow("404");
    expect(mock.read).toHaveBeenCalledTimes(1); expect(fetchFile).not.toHaveBeenCalled();
  });
  it("полный Blob остаётся доступен анализу волны с обновлением истёкшего доступа", async () => {
    fetchFile.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const blob = await loadCutsceneAudioBlob(6, ref, new AbortController().signal);
    expect(blob.size).toBeGreaterThan(0); expect(mock.read).toHaveBeenCalledTimes(2);
  });
});
