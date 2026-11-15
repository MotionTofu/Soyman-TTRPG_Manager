import { normalizeSearchText, searchExcerpt, searchTextPattern } from "@shared/searchText";

const HIGHLIGHT_NAME = "soyman-search-match";
const TEXT_BLOCKS = ".rt-md-paragraph, .rt-h, .rt-md-code, .rt-table th, .rt-table td";

export function searchJump(search: string) {
  const params = new URLSearchParams(search);
  const query = normalizeSearchText(params.get("find") ?? "");
  const occurrence = Number(params.get("occurrence"));
  if (!query || !Number.isSafeInteger(occurrence) || occurrence < 0) return null;
  return { query, occurrence, before: params.get("before"), after: params.get("after") };
}

function indexedBlock(block: HTMLElement) {
  const nodes: { node: Text; start: number; end: number }[] = [];
  let raw = "";
  const tree = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: node => node.nodeType === Node.TEXT_NODE || (node as Element).tagName === "BR"
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
  });
  for (let node = tree.nextNode(); node; node = tree.nextNode()) {
    if (node instanceof Text && node.length) {
      nodes.push({ node, start: raw.length, end: raw.length + node.length });
      raw += node.data;
    } else if (node instanceof HTMLBRElement) raw += "\n";
  }
  // Keep the original offsets through whitespace folding and PDF ligatures
  // so a DOM Range can span glyph runs and Markdown inline elements.
  const starts: number[] = [];
  const ends: number[] = [];
  let text = "";
  for (const part of raw.matchAll(/\s+|\P{M}\p{M}*|\p{M}+/gu)) {
    const normalized = /^\s/.test(part[0]) ? (text ? " " : "") : part[0].normalize("NFKC");
    for (let i = 0; i < normalized.length; i++) {
      starts.push(part.index);
      ends.push(part.index + part[0].length);
    }
    text += normalized;
  }
  return { block, nodes, text: text.trimEnd(), starts, ends };
}

export function findSearchRange(root: HTMLElement, jump: NonNullable<ReturnType<typeof searchJump>>, markdown: boolean) {
  const rendered = markdown ? Array.from(root.querySelectorAll<HTMLElement>(TEXT_BLOCKS))
    .filter(node => !node.querySelector(TEXT_BLOCKS)) : [];
  const pattern = searchTextPattern(jump.query);
  let occurrence = 0;
  let ordinal: Range | null = null;
  let contextual: Range | null = null;
  let contextDistance = Infinity;
  for (const block of rendered.length ? rendered : [root]) {
    const { nodes, text, starts, ends } = indexedBlock(block);
    for (const hit of text.matchAll(pattern)) {
      const index = occurrence++;
      const excerpt = searchExcerpt(text, hit.index, hit[0]);
      const sameContext = excerpt.before === jump.before && excerpt.after === jump.after;
      if (index !== jump.occurrence && !sameContext) continue;
      const start = starts[hit.index];
      const end = ends[hit.index + hit[0].length - 1];
      const first = nodes.find(node => node.start <= start && start < node.end);
      const last = nodes.find(node => node.start < end && end <= node.end);
      if (!first || !last) continue;
      const range = document.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      if (sameContext && index === jump.occurrence) return range;
      if (index === jump.occurrence) ordinal = range;
      if (sameContext && Math.abs(index - jump.occurrence) < contextDistance) {
        contextDistance = Math.abs(index - jump.occurrence);
        contextual = range;
      }
    }
  }
  return contextual ?? ordinal;
}

export function showSearchRange(range: Range, { scroll = true, container }: { scroll?: boolean; container?: HTMLElement } = {}) {
  const registry = globalThis.CSS?.highlights;
  const highlight = typeof Highlight !== "undefined" ? new Highlight(range) : null;
  if (highlight) registry?.set(HIGHLIGHT_NAME, highlight);
  if (scroll) {
    const parent = range.startContainer.parentElement;
    let scroller = container;
    for (let node = parent; node && !scroller; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) scroller = node;
    }
    if (scroller) {
      const match = range.getBoundingClientRect();
      const bounds = scroller.getBoundingClientRect();
      if (container || match.top < bounds.top || match.bottom > Math.min(bounds.bottom, window.innerHeight)) {
        scroller.scrollTop += match.top - bounds.top - scroller.clientHeight * 0.35;
      }
    } else {
      const block = parent?.closest<HTMLElement>(TEXT_BLOCKS) ?? parent;
      block?.scrollIntoView({ block: "center" });
    }
  }
  return () => {
    if (registry?.get(HIGHLIGHT_NAME) === highlight) registry?.delete(HIGHLIGHT_NAME);
  };
}
