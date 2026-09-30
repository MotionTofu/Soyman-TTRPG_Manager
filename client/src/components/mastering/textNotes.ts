export type TextAnchor = { start: number; end: number };
export type TextNoteDraft = { quote: string; anchor: TextAnchor | null; context_before: string; context_after: string };
export type TextNote = TextNoteDraft & { id: string; book_id: number; body: string; needs_reattach: boolean; created_at: string; updated_at: string };
export const EMPTY_TEXT_ANCHOR: TextNoteDraft = { quote: "", anchor: null, context_before: "", context_after: "" };

export function captureTextSelection(root: HTMLElement): TextNoteDraft | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const raw = range.toString(), quote = raw.trim();
  if (!quote || quote.length > 10_000) return null;
  const prefix = range.cloneRange(); prefix.selectNodeContents(root); prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length + raw.indexOf(quote), end = start + quote.length;
  const text = root.textContent ?? "";
  return { quote, anchor: { start, end }, context_before: text.slice(Math.max(0, start - 100), start), context_after: text.slice(end, end + 100) };
}

/** После правки текста ищем цитату с контекстом; неоднозначную привязку не угадываем. */
export function resolveTextAnchor(text: string, note: TextNoteDraft & { needs_reattach?: boolean }): TextAnchor | null {
  if (!note.anchor || !note.quote) return null;
  const { start, end } = note.anchor;
  const contextMatches = (at: number) => (!note.context_before || text.slice(Math.max(0, at - note.context_before.length), at) === note.context_before)
    && (!note.context_after || text.slice(at + note.quote.length, at + note.quote.length + note.context_after.length) === note.context_after);
  if (text.slice(start, end) === note.quote && (!note.needs_reattach || contextMatches(start))) return { start, end };
  const matches: number[] = [];
  for (let at = text.indexOf(note.quote); at >= 0; at = text.indexOf(note.quote, at + 1)) { matches.push(at); if (matches.length > 2000) return null; }
  const precise = matches.filter(contextMatches);
  const at = precise.length === 1 ? precise[0] : matches.length === 1 ? matches[0] : null;
  return at == null ? null : { start: at, end: at + note.quote.length };
}

export function textAnchorRange(root: HTMLElement, anchor: TextAnchor): Range | null {
  if (anchor.start < 0 || anchor.end <= anchor.start) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0, started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && anchor.start <= offset + length) { range.setStart(node, anchor.start - offset); started = true; }
    if (started && anchor.end <= offset + length) { range.setEnd(node, anchor.end - offset); return range; }
    offset += length;
  }
  return null;
}
