/**
 * Первая фраза описания для карточки сущности на доске (Q12): без разметки и
 * ссылок, не длиннее 120 знаков. Нет описания — пустая строка, и карточка
 * ниже.
 */
export function cardBlurb(text: string | null | undefined): string {
  const plain = (text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Упоминание [[being@uid|Мир|Подпись]] показывается последней частью.
    .replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => { const parts = inner.split("|"); return parts.length > 1 ? parts[parts.length - 1] : ""; })
    .replace(/[*`#>]+/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .find(Boolean) ?? "";
  const sentence = /^.+?[.!?…](?=\s|$)/.exec(plain)?.[0] ?? plain;
  return sentence.length > 120 ? `${sentence.slice(0, 119).trimEnd()}…` : sentence;
}

