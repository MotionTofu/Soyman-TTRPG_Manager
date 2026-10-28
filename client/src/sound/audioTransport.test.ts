// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fadeAndPause, positionAfterMetadata } from "./audioTransport";
describe("возврат позиции аудио", () => {
  it("ставит позицию после metadata и отменяется при новой команде", () => {
    const audio = document.createElement("audio"); audio.src = "/first.wav";
    const cancel = positionAfterMetadata(audio, 17); cancel(); audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(0);
    positionAfterMetadata(audio, 23); audio.dispatchEvent(new Event("loadedmetadata")); expect(audio.currentTime).toBe(23);
  });
  it("событие старого источника не перематывает новый", () => {
    const audio = document.createElement("audio"); audio.src = "/old.wav";
    positionAfterMetadata(audio, 17); audio.src = "/new.wav"; audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(0);
  });
  it("уже приостановленные слои не задерживают последовательный вход на время затухания", async () => {
    const audio = document.createElement("audio");
    const pause = vi.spyOn(audio, "pause").mockImplementation(() => {});
    await fadeAndPause([audio], 60000, () => true);
    expect(pause).toHaveBeenCalledTimes(1);
  });
});
