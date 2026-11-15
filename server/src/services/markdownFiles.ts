export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

export function validMarkdown(buffer: Buffer): string | null {
  if (buffer.length > MAX_MARKDOWN_BYTES) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, ""); }
  catch { return null; }
}

export function isMarkdownFile(resource: { type?: string | null; file_path: string | null }): boolean {
  return !!resource.file_path && resource.type !== "pdf_notes" &&
    (resource.type === "markdown" || /\.md$/i.test(resource.file_path));
}
