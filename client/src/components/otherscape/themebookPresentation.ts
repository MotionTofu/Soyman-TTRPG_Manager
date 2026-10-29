// Разбор описания книги тем Otherscape для карточки «Темы персонажа»
// (макет «Д» Roll-OS-Themes). Формат описания один у всех 14 книг:
//   **Affiliation** / **Концепция — Concept** / абзац / Главный вопрос:
//   **…** / *англ.* / … / Источник: [Core Book, с. N](soyman:resource/…#page=N).
// Нет части — её поле пустое, карточка эту строку не рисует.

export interface ThemebookPresentation {
  concept: string;
  question: string;
  questionOriginal: string;
  source: string;
}

export function isOtherscapeThemesSection(code: string | null | undefined, name: string): boolean {
  return code?.trim().toLowerCase() === "otherscape" && ["темы персонажа", "themebooks"].includes(name.trim().toLowerCase());
}

export function parseThemebook(description: string | null | undefined): ThemebookPresentation {
  const text = (description ?? "").replace(/\r\n/g, "\n");
  const concept = /\*\*Концепция[^*]*\*\*\n\n([\s\S]*?)(?:\n\n|$)/.exec(text)?.[1]?.trim() ?? "";
  const q = /Главный вопрос:\s*\*\*(.+?)\*\*(?:\n\n\*(.+?)\*)?/.exec(text);
  const source = /Источник:\s*(\[[^\]]+\]\([^)]+\))/.exec(text)?.[1] ?? "";
  return { concept, question: q?.[1]?.trim() ?? "", questionOriginal: q?.[2]?.trim() ?? "", source };
}

/** Первая фраза вводного абзаца группы («Самость», «Мифос», «Шум») — подпись колонки. */
export function groupLead(description: string | null | undefined): string {
  const paragraphs = (description ?? "").replace(/\r\n/g, "\n").split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const intro = paragraphs.find((p) => !/^\*\*[^*]+\*\*$/.test(p)) ?? "";
  const first = /^[\s\S]*?[.!?](?=\s|$)/.exec(intro)?.[0] ?? intro;
  return first.trim();
}
