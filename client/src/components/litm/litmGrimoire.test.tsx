// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { CompendiumEntry } from "../../types";
import { LitmRich, type GrimLinks } from "./LitmBook";
import { litmCatalogOf } from "./litmBookText";
import { articleEffects, articleOutcome, grimMark, grimoireOf, resolveBookRef, resolveRef, searchGrimoire } from "./litmGrimoire";

const entry = (id: number, kind: string, name: string, parent: number | null, position: number, data: Record<string, unknown>) =>
  ({ id, kind, name, name_original: name, parent_id: parent, position, data, description: "" }) as unknown as CompendiumEntry;

const book = grimoireOf([
  entry(2, "mechanic_group", "Бой", null, 1, { page: 15, intro: { title: "Частые боевые статусы", limits: ["Ранить"], sections: [] } }),
  entry(1, "mechanic_group", "Общее", null, 0, { page: 4 }),
  entry(12, "mechanic_item", "Атаки издалека", 2, 1, { page: 18, sub: "Прямые атаки", success: [{ effects: ["ATTACK"], text: "" }] }),
  entry(11, "mechanic_item", "Рукопашные атаки", 2, 0, { page: 18, sub: "Прямые атаки", index: ["Ударить мечом"], success: [{ effects: ["QUICK"], text: "" }, { effects: ["ATTACK"], text: "" }] }),
  entry(13, "mechanic_item", "Перемещаться по полю боя", 2, 2, { page: 30, sub: "Перемещение", examples: ["Отступить за щит"] }),
]);
const articles = book.flatMap((c) => c.articles);

describe("Гримуар действий LitM", () => {
  it("keeps book order and reads article fields", () => {
    expect(book.map((c) => c.entry.name)).toEqual(["Общее", "Бой"]);
    expect(book[1].articles.map((a) => a.entry.name)).toEqual(["Рукопашные атаки", "Атаки издалека", "Перемещаться по полю боя"]);
    expect(book[1].intro?.limits).toEqual(["Ранить"]);
    expect(articleEffects(articles[0])).toEqual(["QUICK", "ATTACK"]);
    expect(articleOutcome(articles[0])).toBe("Быстрый · Развёрнутый");
    expect(articleOutcome(articles[2])).toBeNull();
  });

  it("resolves «Name» (p. N) by page and name stem, in any case form", () => {
    expect(resolveRef(articles, "Перемещаться по полю боя", 30)?.entry.id).toBe(13);
    expect(resolveRef(articles, "Атаках издалека", 18)?.entry.id).toBe(12);
    expect(resolveRef(articles, "Рукопашные атаки", 19)?.entry.id).toBe(11); // статья начинается страницей раньше
    expect(resolveRef(articles, "Прямых атак", 18)?.entry.id).toBe(11); // подраздел → его первая статья
    expect(resolveRef(articles, "Магия", 54)).toBeNull();
    expect(resolveBookRef(book, "Бой", 15)).toBe(2); // ссылка на главу
    expect(resolveBookRef(book, "Атаки издалека", 18)).toBe(12);
  });

  it("searches names, examples and index lines", () => {
    expect(searchGrimoire(articles, "мечом").map((h) => [h.article.entry.id, h.phrase])).toEqual([[11, "Ударить мечом"]]);
    expect(searchGrimoire(articles, "атаки").map((h) => h.article.entry.id)).toEqual([12, 11]);
    expect(searchGrimoire(articles, "щит")[0].phrase).toBe("Отступить за щит");
    expect(searchGrimoire(articles, " ")).toEqual([]);
  });

  it("tells statuses from tags and shows hyphenated statuses with spaces", () => {
    expect(grimMark("застигнут-врасплох", "Вас застали ")).toEqual({ kind: "status", name: "застигнут врасплох" });
    expect(grimMark("острый слух", "")).toEqual({ kind: "tag", name: "острый слух" });
    expect(grimMark("метла", "вещь тегом ")).toEqual({ kind: "tag", name: "метла" });
    expect(grimMark("ранен-3", "")).toEqual({ kind: "status", name: "ранен", tier: "3" });
  });

  it("links articles and corebook rules in text", () => {
    const grim: GrimLinks = { article: (n, p) => (resolveRef(articles, n, p) ? "/a" : null), rule: (n) => (n === "Полярные статусы" ? "/r" : null) };
    const html = renderToStaticMarkup(<MemoryRouter><LitmRich grim={grim} text="см. «Атаки издалека» (с. 18) и «Нет такой» (с. 99); (**Полярные статусы**, кн. I, с. 170), *отвлечён* (**Заблокировано**)" /></MemoryRouter>);
    expect(html).toContain('<a class="lb-link" href="/a" data-discover="true">Атаки издалека, с. 18</a>');
    expect(html).toContain("«Нет такой» (с. 99)");
    expect(html).toContain('<a class="lb-ref lb-link" href="/r" data-discover="true">Полярные статусы</a>');
    expect(html).toContain('<span class="lb-st">отвлечён</span>');
    expect(html).toContain('<span class="lb-cq">Заблокировано</span>');
    expect(litmCatalogOf("litm", { id: 1, system_id: 1, position: 0, name: "Гримуар действий", kind: "mechanics", created_at: "" })).toBe("grimoire");
  });
});
