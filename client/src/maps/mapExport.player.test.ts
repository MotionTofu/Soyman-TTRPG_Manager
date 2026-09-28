// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAndDownloadPng } from "./mapExport";
import { MAP_ROOM_LABELS, renderMap } from "./render";
import { FIXTURES, parseFixture } from "./core/fixtures";
import { migrateLegacyMap } from "./core/migrateLegacy";

vi.mock("./render", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render")>()),
  renderMap: vi.fn(),
  readChrome: () => ({ paper: "#fff", line: "#000", muted: "#666", ink: "#111" }),
}));

afterEach(() => vi.restoreAllMocks());

describe("PNG for players", () => {
  it("uses the server player projection for the map and its legend", () => {
    const labels: string[] = [];
    const ctx = new Proxy({
      fillText: (value: string) => labels.push(value),
      measureText: () => ({ width: 0 }),
    }, {
      get(target, key) {
        return key in target ? target[key as keyof typeof target] : () => undefined;
      },
    }) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
    const document = migrateLegacyMap({
      grid: "square", width: 8, height: 8, cells: parseFixture(FIXTURES.fullV4Square),
    }).document;

    buildAndDownloadPng({
      grid: "square", width: 8, height: 8, name: "Тест", scale: "locality", cell_lore: "5 м",
      document, pv: true, withLegend: true, withGrid: false, withCoords: false, fileName: "test",
    }, 20);

    const model = vi.mocked(renderMap).mock.calls[0]?.[3]?.model;
    const rooms = model?.layers.flatMap((layer) => layer.kind === "gameplay"
      ? layer.items.filter((item) => item.kind === "room").map((item) => item.room.type)
      : []);
    expect(rooms).toContain("empty");
    expect(rooms).not.toContain("treasury");
    expect(labels).toContain(MAP_ROOM_LABELS.empty);
    expect(labels).not.toContain(MAP_ROOM_LABELS.treasury);
  });
});
