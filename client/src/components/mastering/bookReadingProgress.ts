import type { LibraryBook } from "./libraryTypes";

export function bookReadingProgress(book: Pick<LibraryBook, "last_opened" | "position" | "format">) {
  if (!book.last_opened) return null;
  const { page, pageCount, ratio } = book.position;
  if (book.format === "pdf" && typeof page === "number" && typeof pageCount === "number" &&
      Number.isInteger(page) && Number.isInteger(pageCount) && page > 0 && page <= pageCount) {
    return { label: `стр. ${page} из ${pageCount}`, ratio: page / pageCount };
  }
  if (book.format === "markdown" && typeof ratio === "number" && Number.isFinite(ratio)) {
    const progress = Math.min(1, Math.max(0, ratio));
    return { label: `${Math.round(progress * 100)} %`, ratio: progress };
  }
  return null;
}
