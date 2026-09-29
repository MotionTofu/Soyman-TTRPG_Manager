import path from "path";

export const BUNDLE_RESOURCE_URL = /^soyman:resource\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// ZIP entry names and Markdown destinations use POSIX separators on every OS.
export function safeBundlePath(value: string): string | null {
  if (!value || value.includes("\\") || value.includes("\0") || /[\x00-\x1f]/.test(value)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  if (decoded.includes("\\") || decoded.startsWith("/") || /^[a-z]:/i.test(decoded) || decoded.includes("?") || decoded.includes("#")) return null;
  const parts = decoded.split("/");
  if (parts.some(part => part === ".." || !part || part === "." && parts.length === 1)) return null;
  const normalized = path.posix.normalize(decoded);
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") return null;
  return normalized.replace(/^\.\//, "");
}

export function rewriteMarkdownTargets(source: string, rewrite: (target: string) => string): string {
  let fenced: string | null = null;
  return source.split(/(\r?\n)/).map(part => {
    if (/^\r?\n$/.test(part)) return part;
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(part);
    if (fence) {
      if (!fenced) fenced = fence[1][0];
      else if (fenced === fence[1][0]) fenced = null;
      return part;
    }
    if (fenced || /^(?: {4}|\t)/.test(part)) return part;
    const segments = part.split(/(`+[^`]*`+)/g);
    return segments.map(segment => {
      if (segment.startsWith("`")) return segment;
      let next = segment.replace(/(!?\[[^\]\n]*\]\(\s*)(<[^>]+>|[^)\s]+)([^)]*\))/g,
        (_whole, prefix: string, raw: string, suffix: string) => `${prefix}${raw.startsWith("<") ? `<${rewrite(raw.slice(1, -1))}>` : rewrite(raw)}${suffix}`);
      next = next.replace(/^( {0,3}\[[^\]\n]+\]:\s*)(<[^>]+>|\S+)/,
        (_whole, prefix: string, raw: string) => `${prefix}${raw.startsWith("<") ? `<${rewrite(raw.slice(1, -1))}>` : rewrite(raw)}`);
      return next;
    }).join("");
  }).join("");
}
