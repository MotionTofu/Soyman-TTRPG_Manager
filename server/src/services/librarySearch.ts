import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEsm } from "load-esm";
import type { Token, Tokens } from "marked";
import {
  findStoredTableBlocks, normalizeSearchText, searchExcerpt, SEARCH_FRAGMENT_LIMIT,
  type BookFormat, type SearchFragments, type SearchTarget,
} from "@soyman/shared";
import { assertVaultPath } from "./filesystem";
import { isMarkdownFile, MAX_MARKDOWN_BYTES, validMarkdown } from "./markdownFiles";

export interface LibrarySearchFile {
  id: number;
  name: string;
  type: string | null;
  category: string | null;
  file_path: string | null;
  library_section: string | null;
  library_department: string | null;
}

export function libraryFileFormat(file: LibrarySearchFile): BookFormat | undefined {
  if (!file.file_path || file.type === "pdf_notes") return;
  if (file.category === "pdf" || /\.pdf$/i.test(file.file_path)) return "pdf";
  if (isMarkdownFile(file)) return "md";
}

interface TextBlock {
  text: string;
  label: string;
  page?: number;
}

const markdownOptions = { gfm: true, breaks: false };

// Preserve the displayed labels of SoyMan's own inline markup before lexing.
export async function markdownSearchBlocks(source: string): Promise<TextBlock[]> {
  const { Lexer } = await loadEsm<typeof import("marked")>(pathToFileURL(require.resolve("marked")).href);
  const blocks: TextBlock[] = [];
  let heading = "Текст документа";
  const inline = (tokens: Token[]): string => tokens.map((token) => {
    if (token.type === "br") return " ";
    if (token.type === "image") return "";
    if ("tokens" in token && token.tokens) return inline(token.tokens);
    return "text" in token ? String(token.text) : token.raw;
  }).join("");
  const add = (value: string) => {
    const text = normalizeSearchText(value);
    if (text) blocks.push({ label: heading, text });
  };
  const readBlocks = (tokens: Token[]) => {
    for (const token of tokens) {
      switch (token.type) {
        case "space": case "hr": case "checkbox": break;
        case "heading":
          heading = normalizeSearchText(inline(token.tokens ?? [])) || "Текст документа";
          add(heading);
          break;
        case "blockquote": readBlocks(token.tokens ?? []); break;
        case "list":
          for (const item of (token as Tokens.List).items) readBlocks(item.tokens);
          break;
        case "table": {
          const { header, rows } = token as Tokens.Table;
          for (const row of [header, ...rows]) for (const cell of row) add(inline(cell.tokens));
          break;
        }
        case "html": add(token.raw); break;
        default: add(inline([token]));
      }
    }
  };
  function readMarkdown(markdown: string) {
    const text = markdown
      .replace(/\[\[\w+@[0-9a-f-]+\|[^|\]]*\|([^\]]*)\]\]|\[\[\w+:\d+\|([^\]]+)\]\]/gi, (_, label, legacy) => label ?? legacy)
      .replace(/\{\/?(?:span\b[^}]*|quote)\}/g, "");
    readBlocks(Lexer.lex(text, markdownOptions));
  }
  let last = 0;
  for (const block of findStoredTableBlocks(source)) {
    readMarkdown(source.slice(last, block.from));
    const section = heading;
    for (const row of block.table.cells) for (const cell of row) {
      heading = section;
      readMarkdown(cell.text);
    }
    heading = section;
    last = block.to;
  }
  readMarkdown(source.slice(last));
  return blocks;
}

async function pdfSearchBlocks(data: Buffer): Promise<TextBlock[]> {
  const pdfRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const { getDocument } = await loadEsm<typeof import("pdfjs-dist")>(
    pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href,
  );
  const task = getDocument({
    data: new Uint8Array(data),
    cMapUrl: path.join(pdfRoot, "cmaps") + path.sep,
    cMapPacked: true,
    standardFontDataUrl: path.join(pdfRoot, "standard_fonts") + path.sep,
    isEvalSupported: false,
  });
  try {
    const document = await task.promise;
    const blocks: TextBlock[] = [];
    for (let page = 1; page <= document.numPages; page++) {
      const view = await document.getPage(page);
      try {
        const { items } = await view.getTextContent({ disableNormalization: true });
        const text = normalizeSearchText(items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "").join(""));
        if (text) blocks.push({ label: `Страница ${page}`, text, page });
      } finally {
        view.cleanup();
      }
    }
    return blocks;
  } finally {
    await task.destroy();
  }
}

// Extract once per file revision; use filesystem metadata so external edits,
// replacements and vault changes refresh results without database triggers.
const CACHE_BUDGET = 64 * 1024 * 1024;
const cache = new Map<string, { fingerprint: string; blocks: TextBlock[]; size: number }>();
let cacheSize = 0;
let extractionQueue = Promise.resolve();

async function loadBlocks(file: string, format: BookFormat): Promise<TextBlock[]> {
  const metadata = await stat(file);
  if (!metadata.isFile() || (format === "md" && metadata.size > MAX_MARKDOWN_BYTES)) return [];
  const fingerprint = `${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
  const key = `${format}:${file}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cacheSize -= cached.size;
    if (cached.fingerprint === fingerprint) {
      cache.set(key, cached);
      cacheSize += cached.size;
      return cached.blocks;
    }
  }
  const data = await readFile(file);
  const source = format === "md" ? validMarkdown(data) : null;
  const blocks = format === "pdf" ? await pdfSearchBlocks(data) : source == null ? [] : await markdownSearchBlocks(source);
  const size = blocks.reduce((sum, block) => sum + 96 + 2 * (block.text.length + block.label.length), 96);
  if (size <= CACHE_BUDGET) {
    for (const [oldKey, old] of cache) {
      if (cacheSize + size <= CACHE_BUDGET) break;
      cache.delete(oldKey);
      cacheSize -= old.size;
    }
    cache.set(key, { fingerprint, blocks, size });
    cacheSize += size;
  }
  return blocks;
}

export function appendTextMatches(
  result: SearchFragments, text: string, query: RegExp, label: string,
  targetFor: (occurrence: number) => SearchTarget, firstOccurrence = 0,
): void {
  let occurrence = firstOccurrence;
  for (const hit of text.matchAll(query)) {
    if (result.fragments.length < SEARCH_FRAGMENT_LIMIT) {
      result.fragments.push({ label, ...searchExcerpt(text, hit.index, hit[0]), target: targetFor(occurrence) });
    }
    occurrence++;
    result.match_count++;
  }
}

export async function searchLibraryFile(
  file: string, format: BookFormat, query: RegExp, cancelled: () => boolean,
): Promise<SearchFragments> {
  const result: SearchFragments = { fragments: [], match_count: 0 };
  // One PDF at a time, even when the user changes a filter mid-extraction.
  const pending = extractionQueue.then(async () => {
    if (cancelled()) return [];
    try { return await loadBlocks(assertVaultPath(file), format); }
    catch { return []; } // Missing, unreadable or password-protected file.
  });
  extractionQueue = pending.then(() => {});
  for (const { text, label, page } of await pending) {
    if (cancelled()) break;
    if (page === undefined) {
      appendTextMatches(result, text, query, label, (occurrence) => ({ occurrence }), result.match_count);
    } else {
      appendTextMatches(result, text, query, label, (occurrence) => ({ page, occurrence }));
    }
  }
  return result;
}
