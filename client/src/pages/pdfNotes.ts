export type PdfRect = { x: number; y: number; w: number; h: number };
export type PdfAnchor = { page: number; rects: PdfRect[] };

export type PdfNote = {
  id: string;
  resource_id: number;
  page_number: number | null;
  quote: string;
  body: string;
  anchors: PdfAnchor[];
  context_before: string;
  context_after: string;
  file_sha256: string | null;
  needs_reattach: boolean;
  created_at: string;
  updated_at: string;
};

export type PdfNoteDraft = Pick<PdfNote, "quote" | "anchors" | "context_before" | "context_after">;
export type PdfReaderPreferences = {
  note_mode: "margins" | "list";
  notes_collapsed: boolean;
  show_highlights: boolean;
};

export const DEFAULT_PDF_PREFERENCES: PdfReaderPreferences = {
  note_mode: "margins",
  notes_collapsed: false,
  show_highlights: true,
};

/** Capture text-layer rectangles as page-relative fractions, independent of zoom. */
export function capturePdfSelection(viewer: HTMLElement): PdfNoteDraft | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const quote = selection.toString().replace(/\s+/g, " ").trim();
  if (!quote || quote.length > 10_000) return null;
  const range = selection.getRangeAt(0);
  const start = range.startContainer.parentElement;
  const end = range.endContainer.parentElement;
  if (!start || !end || !viewer.contains(start) || !viewer.contains(end)) return null;
  if (!start.closest(".textLayer") || !end.closest(".textLayer")) return null;

  const pages = new Map<number, PdfRect[]>();
  const pageElements = [...viewer.querySelectorAll<HTMLElement>(".page")];
  for (const rect of range.getClientRects()) {
    if (rect.width < 1 || rect.height < 1) continue;
    const page = pageElements.find((candidate) => {
      const box = candidate.getBoundingClientRect();
      return rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
    });
    if (!page) continue;
    const box = page.getBoundingClientRect();
    const left = Math.max(box.left, rect.left);
    const top = Math.max(box.top, rect.top);
    const right = Math.min(box.right, rect.right);
    const bottom = Math.min(box.bottom, rect.bottom);
    if (right <= left || bottom <= top) continue;
    const pageNumber = Number(page.dataset.pageNumber);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) continue;
    const list = pages.get(pageNumber) ?? [];
    list.push({
      x: (left - box.left) / box.width,
      y: (top - box.top) / box.height,
      w: (right - left) / box.width,
      h: (bottom - top) / box.height,
    });
    pages.set(pageNumber, list);
  }
  if (!pages.size || pages.size > 20 || [...pages.values()].some((rects) => rects.length > 100)) return null;
  return {
    quote,
    anchors: [...pages].map(([page, rects]) => ({ page, rects })),
    context_before: (range.startContainer.textContent ?? "").slice(Math.max(0, range.startOffset - 100), range.startOffset),
    context_after: (range.endContainer.textContent ?? "").slice(range.endOffset, range.endOffset + 100),
  };
}
