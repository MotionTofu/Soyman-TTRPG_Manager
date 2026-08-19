import { api } from "./api/client";

export interface MentionToken {
  type: string;
  id: number;
  label: string;
}

const MENTION_RE = /\[\[(\w+):(\d+)\|([^\]]+)\]\]/g;

// Подвешенная ссылка: цель на этом устройстве не установлена, поэтому вместо
// локального id стоит глобальный uid и имя модуля-источника (подробности —
// server/src/services/mentions.ts). В граф связей такая не попадает: связывать
// не с чем, строки в базе нет.
export const DEAD_MENTION_RE = /\[\[(\w+)@([0-9a-fA-F][0-9a-fA-F-]{7,})\|([^|\]]*)\|([^\]]*)\]\]/g;

export interface DeadMentionToken {
  type: string;
  uid: string;
  /** Имя модуля, который надо поставить, чтобы ссылка ожила. */
  source: string;
  label: string;
}

export function parseDeadMentions(text: string): DeadMentionToken[] {
  const out: DeadMentionToken[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(DEAD_MENTION_RE)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ type: m[1], uid: m[2], source: m[3], label: m[4] });
  }
  return out;
}

export function formatMentionToken(type: string, id: number, label: string): string {
  return `[[${type}:${id}|${label}]]`;
}

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

interface GenericLink {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
  section: string | null;
}

// Diffs the mentions in oldText vs newText and creates/removes the
// corresponding generic_links (tagged section="mention") so @-mentions show
// up in the link graph without duplicating links a user made by drag-drop.
export async function syncMentionLinks(
  entityType: string,
  entityId: number,
  oldText: string,
  newText: string
): Promise<void> {
  const oldMentions = parseMentions(oldText);
  const newMentions = parseMentions(newText);
  const oldKeys = new Set(oldMentions.map((m) => `${m.type}:${m.id}`));
  const newKeys = new Set(newMentions.map((m) => `${m.type}:${m.id}`));

  const toAdd = newMentions.filter((m) => !oldKeys.has(`${m.type}:${m.id}`));
  const toRemoveKeys = [...oldKeys].filter((k) => !newKeys.has(k));

  for (const m of toAdd) {
    await api.post("/links", {
      from_type: entityType,
      from_id: entityId,
      to_type: m.type,
      to_id: m.id,
      section: "mention",
    });
  }

  if (toRemoveKeys.length > 0) {
    const existing = await api.get<GenericLink[]>(
      `/links?type=${entityType}&id=${entityId}&section=mention`
    );
    for (const key of toRemoveKeys) {
      const [type, idStr] = key.split(":");
      const id = Number(idStr);
      const match = existing.find(
        (l) =>
          (l.to_type === type && l.to_id === id) || (l.from_type === type && l.from_id === id)
      );
      if (match) await api.del(`/links/${match.id}`);
    }
  }
}
