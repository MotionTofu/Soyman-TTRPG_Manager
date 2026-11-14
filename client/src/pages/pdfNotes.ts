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

/** PDF text runs can overlap on the same line, especially around font changes. */
export function mergePdfLineRects(rects: PdfRect[]): PdfRect[] {
  const merged: PdfRect[] = [];
  for (const rect of [...rects].sort((a, b) => a.x - b.x)) {
    const line = merged.find((item) => {
      const verticalOverlap = Math.min(item.y + item.h, rect.y + rect.h) - Math.max(item.y, rect.y);
      return verticalOverlap >= Math.max(item.h, rect.h) * 0.65 && rect.x <= item.x + item.w + 0.0015;
    });
    if (!line) {
      merged.push({ ...rect });
      continue;
    }
    const top = Math.min(line.y, rect.y);
    line.h = Math.max(line.y + line.h, rect.y + rect.h) - top;
    line.y = top;
    line.w = Math.max(line.x + line.w, rect.x + rect.w) - line.x;
  }
  return merged.sort((a, b) => a.y - b.y || a.x - b.x);
}

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

  const pageBounds = new Map<HTMLElement, DOMRect>();
  const pages = new Map<number, PdfRect[]>();
  const collect = (node: Node) => {
    const page = node.parentElement?.closest<HTMLElement>(".page");
    if (!page || !node.parentElement?.closest(".textLayer")) return;
    const pageNumber = Number(page.dataset.pageNumber);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return;
    const box = pageBounds.get(page) ?? page.getBoundingClientRect();
    pageBounds.set(page, box);
    const textRange = document.createRange();
    textRange.selectNodeContents(node);
    if (node === range.startContainer) textRange.setStart(node, range.startOffset);
    if (node === range.endContainer) textRange.setEnd(node, range.endOffset);
    const rects = pages.get(pageNumber) ?? [];
    for (const rect of textRange.getClientRects()) {
      const left = Math.max(box.left, rect.left);
      const top = Math.max(box.top, rect.top);
      const right = Math.min(box.right, rect.right);
      const bottom = Math.min(box.bottom, rect.bottom);
      if (right - left < 1 || bottom - top < 1) continue;
      rects.push({
        x: (left - box.left) / box.width,
        y: (top - box.top) / box.height,
        w: (right - left) / box.width,
        h: (bottom - top) / box.height,
      });
    }
    if (rects.length) pages.set(pageNumber, rects);
  };
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) collect(root);
  else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (range.intersectsNode(walker.currentNode)) collect(walker.currentNode);
    }
  }
  const anchors = [...pages].map(([page, rects]) => ({ page, rects: mergePdfLineRects(rects) }));
  if (!anchors.length || anchors.length > 20 || anchors.some(({ rects }) => rects.length > 100)) return null;
  return {
    quote,
    anchors,
    context_before: (range.startContainer.textContent ?? "").slice(Math.max(0, range.startOffset - 100), range.startOffset),
    context_after: (range.endContainer.textContent ?? "").slice(range.endOffset, range.endOffset + 100),
  };
}
