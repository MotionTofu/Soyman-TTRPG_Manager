import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { DETAIL_ROUTES } from "../../entityTypes";

// Inline markup recognized inside any text field, alongside the existing
// [[type:id|Label]] mention token: **bold**, *italic*, [label](url) external
// links, and {span color="…" size="…" font="…"}…{/span} styled runs. A line
// starting with #/##/### is a heading, a line starting with "- " is a
// bullet-list item (consecutive "- " lines are grouped into one <ul>).
const TOKEN_RE =
  /\[\[(\w+):(\d+)\|([^\]]+)\]\]|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\{span([^}]*)\}|\{quote\}|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/;

function parseSpanAttrs(attrs: string): CSSProperties {
  const style: CSSProperties = {};
  const attrRe = /(\w+)="([^"]*)"/g;
  for (const m of attrs.matchAll(attrRe)) {
    const [, key, val] = m;
    if (key === "color") style.color = val;
    else if (key === "size") style.fontSize = `${val}px`;
    else if (key === "font") style.fontFamily = val;
  }
  return style;
}

// Finds the index of the "{/span}" matching the "{span …}" that just ended
// at `from`, accounting for nested spans of the same kind.
function findSpanClose(text: string, from: number): number {
  const re = /\{span\b[^}]*\}|\{\/span\}/g;
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].startsWith("{span")) depth++;
    else {
      depth--;
      if (depth === 0) return m.index;
    }
  }
  return -1;
}

function parseInline(text: string, keyPrefix: string, mentionsAsBold: boolean): ReactNode[] {
  const nodes: ReactNode[] = [];
  let pos = 0;
  let key = 0;
  while (pos < text.length) {
    const rest = text.slice(pos);
    const m = TOKEN_RE.exec(rest);
    if (!m) {
      nodes.push(<span key={`${keyPrefix}-${key++}`}>{rest}</span>);
      break;
    }
    const idx = m.index;
    if (idx > 0) nodes.push(<span key={`${keyPrefix}-${key++}`}>{rest.slice(0, idx)}</span>);
    const [full, mType, mId, mLabel, linkLabel, linkUrl, spanAttrs, boldText, italicText] = m;

    if (mType) {
      const id = Number(mId);
      nodes.push(
        mentionsAsBold ? (
          <strong key={`${keyPrefix}-${key++}`}>{mLabel}</strong>
        ) : DETAIL_ROUTES[mType] ? (
          <Link key={`${keyPrefix}-${key++}`} className="mention-link" to={`${DETAIL_ROUTES[mType]}/${id}`}>
            {mLabel}
          </Link>
        ) : (
          <span key={`${keyPrefix}-${key++}`} className="mention-link">
            {mLabel}
          </span>
        )
      );
      pos += idx + full.length;
    } else if (linkUrl) {
      nodes.push(
        <a key={`${keyPrefix}-${key++}`} className="ext-link" href={linkUrl} target="_blank" rel="noreferrer">
          {linkLabel}
        </a>
      );
      pos += idx + full.length;
    } else if (spanAttrs !== undefined) {
      const openEnd = pos + idx + full.length;
      const closeIdx = findSpanClose(text, openEnd);
      if (closeIdx === -1) {
        nodes.push(<span key={`${keyPrefix}-${key++}`}>{full}</span>);
        pos = openEnd;
      } else {
        const inner = text.slice(openEnd, closeIdx);
        nodes.push(
          <span key={`${keyPrefix}-${key}`} style={parseSpanAttrs(spanAttrs)}>
            {parseInline(inner, `${keyPrefix}-${key}`, mentionsAsBold)}
          </span>
        );
        pos = closeIdx + "{/span}".length;
      }
      key++;
    } else if (full === "{quote}") {
      const openEnd = pos + idx + full.length;
      const closeIdx = text.indexOf("{/quote}", openEnd);
      if (closeIdx === -1) {
        nodes.push(<span key={`${keyPrefix}-${key++}`}>{full}</span>);
        pos = openEnd;
      } else {
        const inner = text.slice(openEnd, closeIdx);
        nodes.push(
          <span key={`${keyPrefix}-${key}`} className="rt-quote">
            {parseInline(inner, `${keyPrefix}-${key}`, mentionsAsBold)}
          </span>
        );
        pos = closeIdx + "{/quote}".length;
      }
      key++;
    } else if (boldText != null) {
      nodes.push(<strong key={`${keyPrefix}-${key++}`}>{boldText}</strong>);
      pos += idx + full.length;
    } else if (italicText != null) {
      nodes.push(<em key={`${keyPrefix}-${key++}`}>{italicText}</em>);
      pos += idx + full.length;
    }
  }
  return nodes;
}

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const BULLET_RE = /^-\s+(.*)$/;
// A table row is any line wrapped in pipes: "| a | b |". The row right after
// the header — cells made only of dashes/colons ("---", ":--:") — is the
// separator and isn't rendered as a row, matching plain markdown tables.
const TABLE_ROW_RE = /^\|(.+)\|\s*$/;
const TABLE_SEP_CELL_RE = /^:?-+:?$/;

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

// A mention token's own "|" (between type:id and Label) is indistinguishable
// from a table-cell separator once a line has been recognized as a table
// row — mask each token out to a pipe-free placeholder before row-splitting,
// then restore it into whichever cell it landed in.
const MENTION_TOKEN_RE = /\[\[\w+:\d+\|[^\]]+\]\]/g;

function maskMentions(line: string): { masked: string; tokens: string[] } {
  const tokens: string[] = [];
  const masked = line.replace(MENTION_TOKEN_RE, (m) => {
    tokens.push(m);
    return `\u0000${tokens.length - 1}\u0000`;
  });
  return { masked, tokens };
}

function unmaskMentions(text: string, tokens: string[]): string {
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)] ?? "");
}

export function MentionText({ text, mentionsAsBold = false }: { text: string; mentionsAsBold?: boolean }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let key = 0;
  let i = 0;
  while (i < lines.length) {
    const firstMasked = maskMentions(lines[i]);
    if (TABLE_ROW_RE.test(firstMasked.masked)) {
      const rows: string[][] = [];
      while (i < lines.length) {
        const { masked, tokens } = maskMentions(lines[i]);
        if (!TABLE_ROW_RE.test(masked)) break;
        rows.push(splitTableRow(masked).map((c) => unmaskMentions(c, tokens)));
        i++;
      }
      let header: string[] | null = null;
      let body = rows;
      if (rows.length > 1 && rows[1].every((c) => TABLE_SEP_CELL_RE.test(c))) {
        header = rows[0];
        body = rows.slice(2);
      }
      const tkey = key++;
      blocks.push(
        <div key={`b${tkey}`} className="rt-table-wrap">
          <table className="rt-table">
            {header && (
              <thead>
                <tr>
                  {header.map((c, ci) => (
                    <th key={ci}>{parseInline(c, `th${tkey}-${ci}`, mentionsAsBold)}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => (
                    <td key={ci}>{parseInline(c, `td${tkey}-${ri}-${ci}`, mentionsAsBold)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const bulletMatch = BULLET_RE.exec(lines[i]);
    if (bulletMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = BULLET_RE.exec(lines[i]);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      blocks.push(
        <ul key={`b${key++}`} className="rt-ul">
          {items.map((item, ii) => (
            <li key={ii}>{parseInline(item, `bi${key}-${ii}`, mentionsAsBold)}</li>
          ))}
        </ul>
      );
      continue;
    }

    const heading = HEADING_RE.exec(lines[i]);
    if (heading) {
      blocks.push(
        <span key={`b${key++}`} className={`rt-h rt-h${heading[1].length}`}>
          {parseInline(heading[2], `h${key}`, mentionsAsBold)}
        </span>
      );
      i++;
      continue;
    }

    blocks.push(<span key={`b${key++}`}>{parseInline(lines[i], `l${key}`, mentionsAsBold)}</span>);
    i++;
    if (i < lines.length && !BULLET_RE.test(lines[i]) && !HEADING_RE.test(lines[i])) {
      blocks.push("\n");
    }
  }
  return <>{blocks}</>;
}
