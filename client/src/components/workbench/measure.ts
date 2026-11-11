// Где блок можно разрезать между листами: низ каждой строки текста и низ
// каждой строки таблицы. Строки ищутся по настоящей вёрстке (Range), поэтому
// жирный, ссылки и разные размеры шрифта в одной строке не мешают: все
// прямоугольники одной строки сливаются, и берётся её нижний край.

interface Span { top: number; bottom: number }

function mergeLines(spans: Span[]): number[] {
  spans.sort((a, b) => a.top - b.top);
  const out: number[] = [];
  let cur: Span | null = null;
  for (const s of spans) {
    if (cur && s.top < cur.bottom - 1) { cur.bottom = Math.max(cur.bottom, s.bottom); continue; }
    if (cur) out.push(cur.bottom);
    cur = { ...s };
  }
  if (cur) out.push(cur.bottom);
  return out;
}

export function measureBlock(root: HTMLElement): { height: number; breaks: number[] } {
  const box = root.getBoundingClientRect();
  const spans: Span[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // Внутри таблицы режем только между строками таблицы — иначе разрез
    // прошёл бы посреди соседней, более высокой ячейки.
    if (!node.textContent?.trim() || node.parentElement?.closest("table")) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) if (r.height > 0) spans.push({ top: r.top - box.top, bottom: r.bottom - box.top });
  }
  const breaks = new Set(mergeLines(spans).map(Math.ceil));
  root.querySelectorAll("tr").forEach((tr) => breaks.add(Math.ceil(tr.getBoundingClientRect().bottom - box.top)));
  const height = Math.ceil(box.height);
  breaks.add(height);
  return { height, breaks: [...breaks].filter((b) => b > 0 && b <= height).sort((a, b) => a - b) };
}
