import { describe, expect, it, vi } from "vitest";
import { readCutscenePreview } from "./preview";
import type { CutsceneComposition } from "@shared/cutscenes/types";
vi.mock("../data/imperative", () => ({ readOnce: vi.fn(async (path: string) => ({
  ref: { kind: "image", id: decodeURIComponent(path.split("/").at(-2)!) }, url: `/signed${path}`, expiresAt: null,
})) }));
import { readOnce } from "../data/imperative";
describe("приватное превью репетиции", () => {
  it("использует существующую композицию, не запрашивает скрытые слои и не публикует кадр", async () => {
    const composition: CutsceneComposition = { background: { kind: "image", id: "bg" }, title: "Титр", title_secs: 0, fade_ms: 0, layers: [
      { id: "a", name: "Private name", image: { kind: "image", id: "bg" }, visible: true, position: 0, x_pct: 20, y_pct: 30, w_pct: 40, h_pct: 50 },
      { id: "b", name: "Hidden", image: { kind: "image", id: "hidden" }, visible: false, position: 1, x_pct: 0, y_pct: 0, w_pct: 10, h_pct: 10 },
    ] };
    const abort = new AbortController(), data = await readCutscenePreview(10, composition, abort.signal);
    expect(readOnce).toHaveBeenCalledTimes(1); expect(readOnce).toHaveBeenCalledWith("/cutscenes/10/media/bg/access", { signal: abort.signal });
    expect(data.layers).toHaveLength(1); expect(data.layers[0]).toMatchObject({ name: "", x_pct: 20, y_pct: 30, w_pct: 40, h_pct: 50 });
    expect(data.background_url).toBe(data.layers[0].image_url); expect(data.title).toBe("Титр");
  });
});
