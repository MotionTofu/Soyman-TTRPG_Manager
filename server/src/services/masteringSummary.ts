/** Сведения для обложки. Полный текст остаётся в GET /mastering/:id. */
export function validMasteringCover(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && (value === "" || (value.length <= 2048 && /^(https?:\/\/[^\s]+|\/files\/[^\s]+|soyman:resource\/[0-9a-f-]{36})$/i.test(value))));
}

export function masteringSummary<T extends { content: string; cover_image?: unknown }>(note: T) {
  const { content, ...fields } = note;
  const prose = content.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, "");
  const image = /!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^\n]*?["'])?\s*\)/.exec(prose)?.[1];
  // В обложку не переносим Base64 и локальные пути из загруженного Markdown.
  const custom = note.cover_image;
  const cover = custom != null && validMasteringCover(custom) ? custom || null
    : image && validMasteringCover(image) ? image : null;
  const words = content.replace(/!\[[^\]]*\]\([^)]*\)/g, "").match(/\S+/g)?.length ?? 0;
  return { ...fields, reading_minutes: words ? Math.max(1, Math.ceil(words / 200)) : 0, cover_image: cover };
}
