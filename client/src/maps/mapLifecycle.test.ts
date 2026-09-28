import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "./core/fixtures";
import { buildSoyMapV2, checkSoyMapV2ImportTarget, parseSoyMapV2 } from "./core/exchangeV2";
import { projectMapDocumentForPlayer } from "./core/playerProjection";
import { serializeMapDocument } from "./core/serialize";
import { compareLegacySemantics } from "./core/semanticEquivalence";
import { validateMapDocument } from "./core/validate";
import { loadStoredEditorDocument } from "./editor/loadDocument";

describe("existing map lifecycle", () => {
  it.each([
    ["v1 terrain", FIXTURES.terrainV1, "square"],
    ["v2 labels", FIXTURES.labelsV2, "square"],
    ["v3 dungeon", FIXTURES.dungeonV3, "square"],
    ["v4 full square", FIXTURES.fullV4Square, "square"],
    ["v4 full hex", FIXTURES.fullV4Hex, "hex"],
  ] as const)("loads, saves, exports, reimports and projects %s", (_name, cells, grid) => {
    const target = { grid, width: 8, height: 8 };
    const loaded = loadStoredEditorDocument({ cells, ...target });
    expect(loaded.corrupt).toBe(false);
    expect(loaded.compatibility.compatible).toBe(true);
    expect(compareLegacySemantics({ ...target, cells: parseFixture(cells) }, loaded.document)).toEqual([]);

    const saved = serializeMapDocument(loaded.document);
    const reopened = loadStoredEditorDocument({ cells: saved, ...target });
    expect(reopened.sourceFormat).toBe("v5");
    expect(reopened.corrupt).toBe(false);
    expect(serializeMapDocument(reopened.document)).toBe(saved);

    const envelope = buildSoyMapV2(
      { name: "Карта", scale: "locality", cellLore: "5 м" },
      reopened.document,
      { seed: 42, sea: 55, mountains: 12, forest: 30 },
    );
    const imported = parseSoyMapV2(JSON.parse(JSON.stringify(envelope)));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(checkSoyMapV2ImportTarget(imported.value.document, target)).toBeNull();
    expect(serializeMapDocument(imported.value.document)).toBe(saved);

    const player = projectMapDocumentForPlayer(imported.value.document);
    expect(validateMapDocument(player)).toEqual([]);
    expect(serializeMapDocument(imported.value.document)).toBe(saved);
  });
});
