import { describe, expect, it } from "vitest";
import { groupLead, parseThemebook } from "./themebookPresentation";

const affiliation = "**Affiliation**\n\n**Концепция — Concept**\n\nГруппа, сообщество или важная личная связь.\n\nГлавный вопрос: **Почему они важны для вас?**\n\n*Why Do They Matter to You?*\n\nДля свободного создания откройте вопросник.\n\nИсточник: [Core Book, с. 196–199](soyman:resource/323df0dc-1d4a-40ef-a35f-8603b6a9ceaf#page=196).";

describe("книга тем Otherscape", () => {
  it("достаёт концепцию, вопрос, его оригинал и источник", () => {
    expect(parseThemebook(affiliation)).toEqual({
      concept: "Группа, сообщество или важная личная связь.",
      question: "Почему они важны для вас?",
      questionOriginal: "Why Do They Matter to You?",
      source: "[Core Book, с. 196–199](soyman:resource/323df0dc-1d4a-40ef-a35f-8603b6a9ceaf#page=196)",
    });
  });

  it("без размеченных частей возвращает пустые строки", () => {
    expect(parseThemebook("Просто текст")).toEqual({ concept: "", question: "", questionOriginal: "", source: "" });
  });

  it("подпись колонки — первая фраза после заголовка", () => {
    expect(groupLead("**Self**\n\nШесть типов тем о человеческой стороне. Motivation — Identity.")).toBe("Шесть типов тем о человеческой стороне.");
  });
});
