// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSoundPreview } from "./useSoundPreview";
import type { SoundButton } from "./types";

const reads = vi.hoisted(() => ({ readResource: vi.fn() }));
vi.mock("../data/imperative", () => reads);

const track = (id: number): SoundButton => ({
  resource_id: id, name: `Трек ${id}`, role: "background", icon: null,
  icon_url: null, src: `/preview-${id}.wav`, missing: false, pinned: false,
});
let paused: WeakMap<HTMLMediaElement, boolean>;
let media: HTMLAudioElement;

beforeEach(() => {
  localStorage.clear();
  reads.readResource.mockReset();
  paused = new WeakMap();
  media = document.createElement("audio");
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function (this: HTMLMediaElement) {
    return paused.get(this) ?? true;
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, false);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, true);
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function preview() {
  const hook = renderHook(() => useSoundPreview());
  act(() => hook.result.current.audioRef(media));
  return hook;
}

describe("предпрослушивание аудиотеки", () => {
  it("устанавливает 30% до первого play и повторным нажатием останавливает звук", () => {
    const { result } = preview();
    expect(result.current.volume).toBe(0.3);
    expect(media.volume).toBe(0.3);
    act(() => result.current.toggle(track(1)));
    expect(media.getAttribute("src")).toBe("/preview-1.wav");
    expect(result.current.playingId).toBe(1);
    expect(media.paused).toBe(false);
    act(() => result.current.toggle(track(1)));
    expect(result.current.playingId).toBeNull();
    expect(media.paused).toBe(true);
    expect(media.currentTime).toBe(0);
  });

  it("новый трек использует тот же аудиоэлемент, останавливая предыдущий", () => {
    const { result } = preview();
    act(() => result.current.toggle(track(1)));
    media.currentTime = 12;
    act(() => result.current.toggle(track(2)));
    expect(result.current.playingId).toBe(2);
    expect(media.getAttribute("src")).toBe("/preview-2.wav");
    expect(media.currentTime).toBe(0);
    expect(media.play).toHaveBeenCalledTimes(2);
    expect(media.pause).toHaveBeenCalledTimes(2);
  });

  it("меняет громкость играющего превью сразу и запоминает нулевую громкость", () => {
    const hook = preview();
    act(() => hook.result.current.toggle(track(1)));
    act(() => hook.result.current.setVolume(0.62));
    expect(media.volume).toBe(0.62);
    act(() => hook.result.current.setVolume(0));
    expect(media.volume).toBe(0);
    hook.unmount();
    const reopened = preview();
    expect(reopened.result.current.volume).toBe(0);
    expect(media.volume).toBe(0);
  });

  it("применяет ту же громкость к элементу редактора и синхронизирует его регулятор", () => {
    const { result } = preview();
    act(() => result.current.setVolume(0.18));
    const editor = document.createElement("audio");
    act(() => result.current.audioRef(editor));
    expect(editor.volume).toBe(0.18);
    act(() => result.current.onPlay(track(3)));
    expect(result.current.playingId).toBe(3);
    act(() => { editor.volume = 0.42; result.current.onVolumeChange(); });
    expect(result.current.volume).toBe(0.42);
    expect(media.paused).toBe(true);
  });

  it("сохраняет src редактора при повторном подключении ref в StrictMode", () => {
    const { result } = preview();
    const editor = document.createElement("audio");
    editor.src = "/editor-preview.wav";
    act(() => {
      result.current.audioRef(editor);
      result.current.audioRef(null);
      result.current.audioRef(editor);
    });
    expect(editor.getAttribute("src")).toBe("/editor-preview.wav");
    expect(editor.volume).toBe(0.3);
  });

  it("окончание и уход со страницы останавливают предпрослушивание", () => {
    const { result, unmount } = preview();
    act(() => result.current.toggle(track(1)));
    act(() => result.current.onEnded());
    expect(result.current.playingId).toBeNull();
    act(() => result.current.toggle(track(2)));
    unmount();
    expect(media.paused).toBe(true);
    expect(media.hasAttribute("src")).toBe(false);
  });

  it("отказ старого play не останавливает уже выбранный другой трек", async () => {
    let rejectOld: (reason: Error) => void = () => {};
    vi.mocked(media.play).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; }));
    const { result } = preview();
    act(() => result.current.toggle(track(1)));
    act(() => result.current.toggle(track(2)));
    await act(async () => rejectOld(new Error("aborted")));
    expect(result.current.playingId).toBe(2);
    expect(result.current.error).toBeNull();
  });

  it("при отказе воспроизведения возвращает Play и показывает ошибку", async () => {
    vi.mocked(media.play).mockRejectedValueOnce(new Error("blocked"));
    const { result } = preview();
    await act(async () => result.current.toggle(track(1)));
    expect(result.current.playingId).toBeNull();
    expect(result.current.error).toContain("Трек 1");
    expect(media.paused).toBe(true);
  });

  it("обновляет истёкшую подпись перед play без перезагрузки страницы", async () => {
    const old = { ...track(1), src: "/files/preview.wav?sig=old&exp=1" };
    reads.readResource.mockResolvedValue([{ ...old, src: "/files/preview.wav?sig=fresh&exp=9999999999" }]);
    const { result } = preview();
    await act(async () => result.current.toggle(old));
    expect(reads.readResource).toHaveBeenCalledWith("/sounds", { fresh: true });
    expect(media.getAttribute("src")).toContain("sig=fresh");
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(result.current.playingId).toBe(1);
  });

  it("не запускает запоздалый ответ обновления подписи после Стоп", async () => {
    let finish: (value: SoundButton[]) => void = () => {};
    reads.readResource.mockImplementation(() => new Promise<SoundButton[]>((resolve) => { finish = resolve; }));
    const { result } = preview();
    act(() => result.current.toggle({ ...track(1), src: "/files/preview.wav?sig=old&exp=1" }));
    act(() => result.current.stop());
    await act(async () => finish([{ ...track(1), src: "/files/preview.wav?sig=fresh&exp=9999999999" }]));
    expect(media.play).not.toHaveBeenCalled();
    expect(result.current.playingId).toBeNull();
  });

  it("восстанавливает прослушку редактора при истечении подписи", async () => {
    const old = { ...track(1), src: "/files/preview.wav?sig=old&exp=1" };
    reads.readResource.mockResolvedValue([{ ...old, src: "/files/preview.wav?sig=fresh&exp=9999999999" }]);
    const { result } = preview();
    act(() => result.current.onPlay(old));
    await act(async () => result.current.onError());
    expect(media.getAttribute("src")).toContain("sig=fresh");
    expect(result.current.error).toBeNull();
  });

  it.each(["bad json", "null", "true", "1.2", "-0.1", '"0.7"'])("повреждённое сохранённое значение %s заменяет на 30%%", (value) => {
    localStorage.setItem("soyman.audio-library.preview-volume", value);
    expect(preview().result.current.volume).toBe(0.3);
  });
});
