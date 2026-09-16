import { describe, expect, it, vi } from "vitest";
import { dataKeys, matchesAffect } from "./entities";
import {
  boardLayoutAffects,
  boardObjectAffects,
  createLayoutWriter,
  mergeLayoutWrite,
  subtractLayoutWrite,
  type LayoutWrite,
} from "./canvas";

const board = (url: string) => dataKeys.resource(url);

describe("холст: что задевает правка", () => {
  it("сдвиг задевает свою доску и её же через вход кампании — и не трогает соседние", () => {
    const [affect] = boardLayoutAffects("/canvas/board?arc_id=27");
    expect(matchesAffect(board("/canvas/board?arc_id=27"), affect)).toBe(true);
    expect(matchesAffect(board("/canvas/board?arc_id=27&campaign_id=5"), affect)).toBe(true);
    expect(matchesAffect(board("/canvas/board?arc_id=270"), affect)).toBe(false);
    expect(matchesAffect(board("/canvas/index"), affect)).toBe(false);
  });

  it("объект доски задевает и экран выбора", () => {
    const affects = boardObjectAffects("/canvas/board?free_id=4");
    expect(affects.some((a) => matchesAffect(board("/canvas/index"), a))).toBe(true);
  });

  it("правка сцены или существа на своей странице задевает открытые доски", () => {
    expect(matchesAffect(board("/canvas/board?arc_id=27"), { kind: "scene", id: 114 })).toBe(true);
    expect(matchesAffect(board("/canvas/board?setting_id=3"), { kind: "being", id: 40 })).toBe(true);
    expect(matchesAffect(board("/canvas/index"), { kind: "adventure", id: 27 })).toBe(true);
    // Правка ресурса на доске не видна — доска её и не задевает.
    expect(matchesAffect(board("/canvas/board?arc_id=27"), { kind: "resource", id: 1 })).toBe(false);
    expect(matchesAffect(board("/canvas/index"), { kind: "being", id: 40 })).toBe(false);
  });
});

const nodes = (path: string, list: Record<string, unknown>[]): LayoutWrite => ({
  path,
  body: { board_id: 9, nodes: list },
});

describe("раскладка: неотправленное", () => {
  it("новая запись ложится поверх старой поле к полю, нода к ноде", () => {
    const merged = mergeLayoutWrite(
      nodes("/canvas/board/nodes", [
        { node_type: "scene", node_id: 1, x: 0, y: 0, parent_key: "frame:3" },
        { node_type: "sticker", node_id: 2, x: 5, y: 5 },
      ]),
      nodes("/canvas/board/nodes", [{ node_type: "scene", node_id: 1, x: 40, y: 40 }])
    );
    expect(merged.body.nodes).toEqual([
      { node_type: "scene", node_id: 1, x: 40, y: 40, parent_key: "frame:3" },
      { node_type: "sticker", node_id: 2, x: 5, y: 5 },
    ]);
    expect(mergeLayoutWrite({ path: "/canvas/frames/3", body: { x: 1, y: 2 } }, { path: "/canvas/frames/3", body: { w: 9 } }).body)
      .toEqual({ x: 1, y: 2, w: 9 });
  });

  it("удачная запись вычитает только то, что покрыла", () => {
    expect(subtractLayoutWrite({ path: "/canvas/frames/3", body: { x: 1, y: 2, w: 9 } }, { path: "/canvas/frames/3", body: { w: 10 } }))
      .toEqual({ path: "/canvas/frames/3", body: { x: 1, y: 2 } });
    const left = subtractLayoutWrite(
      nodes("/canvas/board/nodes", [
        { node_type: "scene", node_id: 1, x: 0, y: 0, parent_key: "frame:3" },
        { node_type: "sticker", node_id: 2, x: 5, y: 5 },
      ]),
      nodes("/canvas/board/nodes", [
        { node_type: "scene", node_id: 1, x: 40, y: 40, z_index: 0 },
        { node_type: "sticker", node_id: 2, x: 6, y: 6 },
      ])
    );
    expect(left?.body.nodes).toEqual([{ node_type: "scene", node_id: 1, parent_key: "frame:3" }]);
  });
});

describe("раскладка: одна плашка на все отказы", () => {
  function setup() {
    let down = true;
    const sent: LayoutWrite[] = [];
    let retry: (() => Promise<void>) | null = null;
    const deps = {
      send: vi.fn(async (w: LayoutWrite) => {
        if (down) throw new Error("502 Bad Gateway");
        sent.push(w);
        return { board_id: 9 };
      }),
      notify: vi.fn(),
      showError: vi.fn((_m: string, r: () => Promise<void>) => {
        retry = r;
        return 1;
      }),
      dismiss: vi.fn(),
    };
    const writer = createLayoutWriter(deps);
    return { writer, deps, sent, up: () => (down = false), retry: () => retry!() };
  }

  it("отказы копятся, плашка одна, «Повторить» досылает последнее состояние", async () => {
    const t = setup();
    await t.writer.put(nodes("/canvas/board/nodes", [{ node_type: "scene", node_id: 1, x: 10, y: 10 }]));
    await t.writer.put(nodes("/canvas/board/nodes", [{ node_type: "scene", node_id: 1, x: 80, y: 80 }]));
    await t.writer.put({ path: "/canvas/pins/4", body: { x: 1, y: 1 } });
    expect(t.writer.hasPending()).toBe(true);
    expect(t.deps.notify).not.toHaveBeenCalled();

    t.up();
    await t.retry();
    expect(t.sent).toEqual([
      nodes("/canvas/board/nodes", [{ node_type: "scene", node_id: 1, x: 80, y: 80 }]),
      { path: "/canvas/pins/4", body: { x: 1, y: 1 } },
    ]);
    expect(t.writer.hasPending()).toBe(false);
    expect(t.deps.notify).toHaveBeenCalled();
  });

  it("удачный следующий сдвиг покрывает несохранённое — плашка уходит сама", async () => {
    const t = setup();
    await t.writer.put(nodes("/canvas/board/nodes", [{ node_type: "scene", node_id: 1, x: 10, y: 10 }]));
    t.up();
    const result = await t.writer.put(nodes("/canvas/board/nodes", [{ node_type: "scene", node_id: 1, x: 20, y: 20 }]));
    expect(result).toEqual({ board_id: 9 });
    expect(t.writer.hasPending()).toBe(false);
    expect(t.deps.dismiss).toHaveBeenCalledWith(1);
  });
});
