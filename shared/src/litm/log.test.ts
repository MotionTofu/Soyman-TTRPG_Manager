import { describe, expect, it } from "vitest";
import { diffValues, undoChanges, type LogChange } from "../battleLog";
import { challengeStateFromProfile, emptySceneState, giveToLimit } from "./conflict";
import { describeLitm, litmStats, sheetFromView, sheetView } from "./log";
import { giveStatus } from "./status";

const sheet = (statuses = giveStatus([], "ранен", 2), scratched: string[] = []) => ({
  statuses,
  themes: [{ name: "Меч", scratchedTags: scratched }],
  storyThemes: [],
  fellowshipTheme: {},
});

describe("лог «Вызовов»", () => {
  it("лист героя: разница по статусам и вычеркнутому, отмена возвращает прежнее", () => {
    const before = sheet();
    const after = sheet(giveStatus(before.statuses, "ранен", 2), ["острый"]);
    const changes: LogChange[] = [{ target: { t: "sheet", cid: 15, name: "Воин", party: true }, ops: diffValues(sheetView(before), sheetView(after)) }];
    expect(describeLitm(changes)).toBe("Воин: ранен-2 → ранен-3; Воин: вычеркнут «острый»");
    const res = undoChanges(changes, () => sheetView(after) as unknown as Record<string, unknown>);
    expect(res.conflict).toBeNull();
    const back = sheetFromView(after, res.next.get("sheet:15")!.view as never);
    expect(back.statuses).toEqual(before.statuses);
    expect(back.themes[0].scratchedTags).toEqual([]);
  });

  it("отменяет сюжетные теги Последствия в рюкзаке, сохраняя более поздний тег", () => {
    const before = { ...sheet(), backpack: ["карта"] };
    const after = { ...before, backpack: ["дурная слава"] };
    const changes: LogChange[] = [{ target: { t: "sheet", cid: 15, name: "Воин", party: true }, ops: diffValues(sheetView(before), sheetView(after)) }];
    const latest = { ...after, backpack: [...after.backpack, "ключ"] };
    const result = undoChanges(changes, () => ({ ...sheetView(latest) }));
    expect(result.conflict).toBeNull();
    const restored = sheetFromView(latest, result.next.get("sheet:15")!.view as never);
    expect(restored.backpack.sort()).toEqual(["карта", "ключ"]);
  });

  it("итоги: преодолённый вызов, статусы героев, спотлайт без отменённых строк", () => {
    const st = challengeStateFromProfile({ limitList: [{ name: "Изгнать", max: "2" }, { name: "Задобрить", max: "3", arrow: true }] });
    const beaten = giveToLimit(st, 0, "изгнан", 2);
    const row = { t: "row" as const, id: 138, name: "Домовой", party: false };
    const scene = emptySceneState();
    const lit = { ...scene, spotlight: { current: 15, acted: [15], counts: { 15: 1 } } };
    const next = { ...lit, spotlight: { current: 16, acted: [15, 16], counts: { 15: 1, 16: 1 } } };
    const sceneRow = { t: "row" as const, id: 141, name: "Сцена", party: false };
    const hero = { t: "sheet" as const, cid: 15, name: "Воин", party: true };
    const lines = [
      { undone: false, changes: [{ target: row, ops: diffValues({ state: st }, { state: beaten }) }] },
      { undone: false, changes: [{ target: sceneRow, ops: diffValues({ state: scene }, { state: lit }) }] },
      { undone: true, changes: [{ target: sceneRow, ops: diffValues({ state: lit }, { state: next }) }] },
      { undone: false, changes: [{ target: hero, ops: diffValues(sheetView(sheet([])), sheetView(sheet())) }] },
    ];
    expect(describeLitm(lines[0].changes)).toBe("Домовой: Изгнать 2/2");
    expect(litmStats(lines)).toEqual({
      overcome: [{ name: "Домовой", by: "Изгнать" }],
      statuses: [{ cid: 15, name: "Воин", list: ["ранен-2"] }],
      spotlight: { 15: 1 },
    });
  });
});
