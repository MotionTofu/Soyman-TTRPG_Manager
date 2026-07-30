// Port of client/src/mentions.ts's parseMentions — no server dependency,
// just the [[type:id|Label]] token regex. gm-app doesn't need
// syncMentionLinks (that's an edit-time concern; this app is read-only).
export interface MentionToken {
  type: string;
  id: number;
  label: string;
}

const MENTION_RE = /\[\[(\w+):(\d+)\|([^\]]+)\]\]/g;

export function parseMentions(text: string): MentionToken[] {
  const seen = new Set<string>();
  const tokens: MentionToken[] = [];
  for (const match of text.matchAll(MENTION_RE)) {
    const key = `${match[1]}:${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push({ type: match[1], id: Number(match[2]), label: match[3] });
  }
  return tokens;
}
