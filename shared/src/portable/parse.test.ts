import { describe, it, expect } from "vitest";
import { parsePortableHtml, validatePortablePayload } from "./parse";

/**
 * Регрессия единого portable-контракта (фаза B2.1): один и тот же парсер
 * читает старый v1 и v2 для обоих продуктов. Глубокие проверки листа и
 * каталога — на вызывающей стороне; здесь только извлечение и структура.
 */

const doc = (json: string) =>
  `<!doctype html><html><body><div id="root"></div><script id="oneshot-payload" type="application/json">${json}</script><script>var app=1;</script></body></html>`;

const catalog = {
  system: { id: 1, name: "D&D 5.5" },
  sections: [{ id: 1, kind: "spell", name: "Заклинания" }],
  entries: [{ id: 7, section_id: 1, kind: "spell", level: 2, name: "Призыв", data: {} }],
};

const content = {
  characterName: "Мордекай",
  classes: [],
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  hitPointsCurrent: "21",
};

describe("shared portable parser", () => {
  it("v1 читается без identity", () => {
    const parsed = parsePortableHtml(
      doc(JSON.stringify({ format: "soyman-1shot-portable", version: 1, exportedAt: "2026-09-21T00:00:00.000Z", character: { name: "Мордекай", content, portrait: null }, catalog }))
    );
    expect(parsed.characterUid).toBeNull();
    expect(parsed.name).toBe("Мордекай");
    expect(parsed.content).toEqual(content);
    expect(parsed.portrait).toBeNull();
  });

  it("v2 несёт тот же лист плюс stable UID", () => {
    const parsed = parsePortableHtml(
      doc(JSON.stringify({ format: "soyman-1shot-portable", version: 2, exportedAt: "2026-09-21T00:00:00.000Z", identity: { characterUid: "uid-abc" }, character: { name: "Мордекай", content, portrait: "data:image/png;base64,iVBORw0KGgo=" }, catalog }))
    );
    expect(parsed.characterUid).toBe("uid-abc");
    expect(parsed.name).toBe("Мордекай");
    expect(parsed.content).toEqual(content);
    expect(parsed.portrait).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("чужой HTML и битый payload отвергаются кодами", () => {
    expect(() => parsePortableHtml("<html><body>hello</body></html>")).toThrowError(expect.objectContaining({ code: "unsupported-file" }));
    expect(() => parsePortableHtml(doc('{"format":"soyman-1shot-portable","version":1,'))).toThrowError(
      expect.objectContaining({ code: "damaged-payload" })
    );
    expect(() => validatePortablePayload({ format: "soyman-1shot-portable", version: 99 })).toThrowError(
      expect.objectContaining({ code: "unsupported-version" })
    );
    expect(() => validatePortablePayload({ format: "soyman-1shot-portable", version: 2 })).toThrowError(
      expect.objectContaining({ code: "damaged-payload" })
    );
  });
});
