import type { ReactNode } from "react";

// Trimmed-down port of client/src/components/mentions/MentionText.tsx —
// renders [[type:id|Label]] mention tokens plus **bold**/*italic*, which
// covers the vast majority of what shows up in session Задумка/Основные
// события text. Mentions render as a styled (non-navigable) span rather
// than a Link: gm-app has no per-entity-type detail routes to send taps to
// (it's a session-prep companion, not a full mirror of the desktop app),
// so a link with nowhere to go would be worse than a plain highlighted
// label. Tables/headings/bullet lists/colored spans from the full desktop
// renderer are dropped — rare in this text and not worth the complexity here.
const TOKEN_RE = /\[\[(\w+):(\d+)\|([^\]]+)\]\]|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/;

function parseInline(text: string, keyPrefix: string): ReactNode[] {
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
    const [full, , , mLabel, boldText, italicText] = m;

    if (mLabel != null) {
      nodes.push(
        <span key={`${keyPrefix}-${key++}`} className="mention-link">
          {mLabel}
        </span>
      );
    } else if (boldText != null) {
      nodes.push(<strong key={`${keyPrefix}-${key++}`}>{boldText}</strong>);
    } else if (italicText != null) {
      nodes.push(<em key={`${keyPrefix}-${key++}`}>{italicText}</em>);
    }
    pos += idx + full.length;
  }
  return nodes;
}

export function MentionText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {parseInline(line, `l${i}`)}
          {i < lines.length - 1 && "\n"}
        </span>
      ))}
    </>
  );
}
