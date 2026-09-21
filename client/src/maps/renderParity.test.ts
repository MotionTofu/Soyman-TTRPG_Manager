// Visual parity (§32–33 ТЗ): legacy model vs migrated V5 model дают
// одинаковую последовательность значимых draw calls на mocked context.
// Без brittle pixel-снапшотов: сравнивается именно то, что renderer просит
// у canvas. Камера — полный обзор (без маргинального culling).

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { migrateLegacyMap } from "./core/migrateLegacy";
import type { MapCells } from "./render";
import { renderMap, type MapChrome, type RenderOptions } from "./render";
import {
  createLegacyRenderModel,
  createV5RenderModel,
  type MapRenderModel,
} from "./renderModel";

const CHROME: MapChrome = { paper: "#fff", line: "#000", muted: "#666", ink: "#111" };

function makeRecordingCtx(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const fmt = (v: unknown): string => {
    if (typeof v === "number") {
      if (Object.is(v, -0)) return "0";
      return Number.isInteger(v) ? String(v) : v.toPrecision(12);
    }
    return JSON.stringify(v);
  };
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "canvas") return null;
        return (...args: unknown[]) => {
          calls.push(`${String(prop)}(${args.map(fmt).join(",")})`);
        };
      },
      set(_t, prop, value) {
        calls.push(`set:${String(prop)}=${fmt(value)}`);
        return true;
      },
      has() {
        return false;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const FULL: MapCells = {
  terrain: new Map([
    ["1,1", "forest"],
    ["2,1", "wall"],
    ["3,3", "lava"],
  ]),
  roads: new Set(["0,2", "1,2", "4,0"]),
  rivers: new Set(["4,0", "4,1", "5,1"]),
  labels: [{ x: 1, y: 1, text: "Лес" }],
  rooms: [{ x: 2, y: 0, w: 2, h: 2, type: "treasury", name: "Кладовая" }],
  doors: [
    { x: 2, y: 0, edge: "n", kind: "door", secret: false, pair: null },
    { x: 0, y: 0, edge: "s", kind: "secret", secret: true, pair: null },
    { x: 1, y: 3, edge: "e", kind: "trapped", secret: false, pair: null },
    { x: 3, y: 3, edge: "w", kind: "locked", secret: false, pair: null },
  ],
  traps: [{ x: 3, y: 1, kind: "pit" }],
  markers: [
    { x: 5, y: 5, kind: "chest" },
    { x: 6, y: 1, kind: "city" },
  ],
  start: { x: 0, y: 5 },
  finish: { x: 5, y: 0 },
};

function baseOpts(
  grid: "square" | "hex",
  model: MapRenderModel,
  patch: Partial<RenderOptions> = {},
): RenderOptions {
  return {
    grid,
    width: 8,
    height: 8,
    model,
    scale: 24,
    ox: 10,
    oy: 10,
    showGrid: true,
    showCoords: true,
    hover: null,
    chrome: CHROME,
    playerView: false,
    selectedId: null,
    ...patch,
  };
}

function renderCalls(opts: RenderOptions): string[] {
  const { ctx, calls } = makeRecordingCtx();
  renderMap(ctx, 400, 400, opts);
  return calls;
}

/**
 * Каноническая форма draw-потока (документированные benign-расхождения):
 * - V5 хранит клетки отсортированными, legacy Set/Map — в порядке вставки:
 *   сегменты в ключе группы отсортированы; бегущий fill/stroke-style
 *   запекается в ключ (а не прилипает к первой ячейке цвета).
 * - Ячейки одного цвета/стиля не пересекаются (заливки непрозрачные,
 *   мотивы confined to own cell) — перестановка групп на растр не влияет.
 * Строго позиционно: rects, текст, state (alpha/lineWidth/save/restore),
 * фазы рек/дорог (lineWidth-барьеры), порядок сущностей. Пропуски, лишние
 * сущности, неверные координаты/стили/тексты и перестановки фаз ловятся.
 */
function normalize(calls: string[]): string[] {
  const isFillStyle = (c: string) => c.startsWith("set:fillStyle=");
  const isStrokeStyle = (c: string) => c.startsWith("set:strokeStyle=");
  const isPath = (c: string) =>
    c === "beginPath()" ||
    c.startsWith("moveTo(") ||
    c.startsWith("lineTo(") ||
    c === "closePath()" ||
    c.startsWith("arc(");
  const isPaint = (c: string) => c === "fill()" || c === "stroke()";
  const val = (c: string) => c.slice(c.indexOf("=") + 1);

  const ordered: string[] = [];
  const styles: string[] = [];
  const groups: string[] = [];
  let runFill = "";
  let runStroke = "";
  let cur: string[] = [];
  const flushCurAsGroup = () => {
    if (cur.length === 0) return;
    const segs = cur.filter(isPath).sort();
    const paints = cur.filter(isPaint);
    groups.push(JSON.stringify([runFill, runStroke, ...segs, ...paints]));
    cur = [];
  };

  for (const c of calls) {
    if (isFillStyle(c)) {
      runFill = val(c);
      styles.push(`f=${runFill}`);
      continue;
    }
    if (isStrokeStyle(c)) {
      runStroke = val(c);
      styles.push(`s=${runStroke}`);
      continue;
    }
    if (isPath(c)) {
      cur.push(c);
      continue;
    }
    if (isPaint(c)) {
      cur.push(c);
      flushCurAsGroup();
      continue;
    }
    // Барьер: сырой хвост пути (без покраски — в renderer не встречается)
    // и сам барьер — строго позиционно.
    if (cur.length > 0) {
      ordered.push(...cur);
      cur = [];
    }
    ordered.push(c);
  }
  if (cur.length > 0) ordered.push(...cur);
  styles.sort();
  groups.sort();
  return [...ordered, "##STYLES", ...styles, "##GROUPS", ...groups];
}

/** Экспорт канонизации для временного smoke реальных карт. */
export { normalize as normalizeRenderCallsForSmoke };

describe("visual parity: legacy model vs migrated V5 model", () => {
  function parity(
    grid: "square" | "hex",
    cells: MapCells,
    patch: Partial<RenderOptions> = {},
  ): void {
    const legacy = createLegacyRenderModel(grid, 8, 8, cells);
    const { model: v5model, diagnostics } = createV5RenderModel(
      migrateLegacyMap({ grid, width: 8, height: 8, cells }).document,
    );
    expect(diagnostics).toEqual([]);
    const a = normalize(renderCalls(baseOpts(grid, legacy, patch)));
    const b = normalize(renderCalls(baseOpts(grid, v5model, patch)));
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(100);
  }

  it("square GM: полный набор сущностей", () => {
    parity("square", FULL);
  });

  it("square player preview (secret скрыт, trapped обычная)", () => {
    parity("square", FULL, { playerView: true });
  });

  it("square с selectedId door/trap (stable IDs обеих моделей)", () => {
    parity("square", FULL, { selectedId: "legacy-door-0" });
    parity("square", FULL, { selectedId: "legacy-trap-0" });
    parity("square", FULL, { selectedId: "legacy-start" });
  });

  it("square крупный zoom (мотивы террейна, глифы)", () => {
    parity("square", FULL, { scale: 40, ox: -40, oy: -40 });
  });

  it("hex GM", () => {
    const hexCells: MapCells = {
      ...FULL,
      // Дверей на гексах renderer не рисует (break) — обе модели одинаково.
      doors: [],
    };
    parity("hex", hexCells);
  });

  it("hex player preview", () => {
    parity("hex", { ...FULL, doors: [] }, { playerView: true });
  });

  it("нормализация не тавтология: пропуски/сдвиги ловятся", () => {
    const legacy = createLegacyRenderModel("square", 8, 8, FULL);
    const v5doc = migrateLegacyMap({ grid: "square", width: 8, height: 8, cells: FULL }).document;
    const broken = structuredClone(v5doc);
    const gameplay = broken.layers.find((l) => l.id === "lyr-gameplay");
    if (!gameplay || gameplay.kind !== "gameplay") throw new Error("bad fixture");
    // Удаляем ловушку и сдвигаем подпись.
    gameplay.items = gameplay.items.filter((e) => e.kind !== "trap");
    const labels = broken.layers.find((l) => l.id === "lyr-labels");
    if (!labels || labels.kind !== "label") throw new Error("bad fixture");
    labels.items[0].position.x += 1;
    const { model: brokenModel } = createV5RenderModel(broken);
    const a = normalize(renderCalls(baseOpts("square", legacy)));
    const b = normalize(renderCalls(baseOpts("square", brokenModel)));
    expect(b).not.toEqual(a);
  });
});
