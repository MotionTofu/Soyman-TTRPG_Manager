import { describe, expect, it } from "vitest";
import { migrateLegacyMap } from "../migrateLegacy";
import { parseCellsBlob } from "../../render";
import { serializeMapDocument } from "../serialize";
import { validateMapDocument } from "../validate";
import { clearEditableContent, resizeGridDocument } from "./document";
import { paintExplorationCell, setAllExplorationCells, setExplorationEnabled } from "./exploration";

function doc(side = 8) {
  return migrateLegacyMap({ grid: "hex", width: side, height: side,
    cells: parseCellsBlob('{"v":1,"cells":{},"roads":[]}') }).document;
}

describe("exploration mutations", () => {
  it("включение скрывает всё, раскрытие клетки переживает сериализацию и выключение", () => {
    const original = doc();
    const enabled = setExplorationEnabled(original, true);
    expect(enabled.ok && enabled.changed).toBe(true);
    if (!enabled.ok) return;
    expect(enabled.document.exploration).toEqual({ enabled: true, revealedCells: [] });
    const painted = paintExplorationCell(enabled.document, 3, 4, true);
    if (!painted.ok) throw new Error("paint failed");
    expect(painted.document.exploration?.revealedCells).toEqual([{ x: 3, y: 4 }]);
    expect(validateMapDocument(painted.document)).toEqual([]);
    expect(JSON.parse(serializeMapDocument(painted.document)).exploration.revealedCells).toEqual([{ x: 3, y: 4 }]);
    const disabled = setExplorationEnabled(painted.document, false);
    if (!disabled.ok) throw new Error("disable failed");
    expect(disabled.document.exploration).toEqual({ enabled: false, revealedCells: [{ x: 3, y: 4 }] });
    expect(original.exploration).toBeUndefined();
  });

  it("повторный мазок не создаёт шаг, скрытие работает обратно", () => {
    const enabled = setExplorationEnabled(doc(), true);
    if (!enabled.ok) throw new Error("enable failed");
    const painted = paintExplorationCell(enabled.document, 2, 2, true);
    if (!painted.ok) throw new Error("paint failed");
    const again = paintExplorationCell(painted.document, 2, 2, true);
    expect(again.ok && !again.changed && again.document === painted.document).toBe(true);
    const hidden = paintExplorationCell(painted.document, 2, 2, false);
    expect(hidden.ok && hidden.document.exploration?.revealedCells).toEqual([]);
  });

  it("массовые действия, очистка и уменьшение поля сохраняют валидность", () => {
    const enabled = setExplorationEnabled(doc(9), true);
    if (!enabled.ok) throw new Error("enable failed");
    const all = setAllExplorationCells(enabled.document, true);
    if (!all.ok) throw new Error("reveal all failed");
    expect(all.document.exploration?.revealedCells).toHaveLength(81);
    const resized = resizeGridDocument(all.document, 8, 8);
    if (!resized.ok) throw new Error("resize failed");
    expect(resized.document.exploration?.revealedCells).toHaveLength(64);
    expect(validateMapDocument(resized.document)).toEqual([]);
    const clear = clearEditableContent(resized.document);
    if (!clear.ok) throw new Error("clear failed");
    expect(clear.document.exploration).toBeUndefined();
  });
});
