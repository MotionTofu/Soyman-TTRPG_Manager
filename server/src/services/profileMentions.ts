import { db } from "../db/db";
import { ENTITY_KINDS } from "../db/entityKinds";
import { mentionTextColumns, normUid, scanMentions } from "./mentions";

export function profileMentions(type: string, id: number) {
  const targetKind = ENTITY_KINDS.find((k) => k.kind === type);
  if (!targetKind?.mentionable) return [];
  const target = db.prepare(`SELECT uid FROM ${targetKind.table} WHERE id = ?`).get(id) as { uid: string } | undefined;
  if (!target) return [];
  const refs = db.prepare("SELECT DISTINCT from_type AS type, from_id AS id FROM generic_links WHERE to_type = ? AND to_id = ? AND section = 'mention'").all(type,id) as { type: string; id: number }[];
  const columns = mentionTextColumns();
  const chapterOwners: Record<string,{ table: string; key: string }> = { being:{table:"being_chapters",key:"being_id"}, location:{table:"location_chapters",key:"location_id"}, community:{table:"community_chapters",key:"community_id"}, artifact:{table:"artifact_chapters",key:"artifact_id"} };
  return refs.flatMap((ref) => {
    const kind = ENTITY_KINDS.find((k) => k.kind === ref.type);
    if (!kind || !kind.nameCol) return [];
    const row = db.prepare(`SELECT * FROM ${kind.table} WHERE id = ?${kind.hasArchivedAt ? " AND archived_at IS NULL" : ""}`).get(ref.id) as Record<string,unknown> | undefined;
    if (!row) return [];
    const texts = columns.filter((c) => c.table === kind.table).map((c) => row[c.column]).filter((t): t is string => typeof t === "string");
    const ch = chapterOwners[ref.type];
    if (ch && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(ch.table)) {
      const chapters = db.prepare(`SELECT content FROM ${ch.table} WHERE ${ch.key} = ?`).all(ref.id) as { content: string }[];
      texts.push(...chapters.map((c) => c.content));
    }
    let excerpt = "";
    for (const text of texts) {
      const hit = scanMentions(text).find((m) => m.type === type && (m.kind === "legacy" ? m.id === id : normUid(target.uid).startsWith(normUid(m.uid))));
      if (hit) { excerpt = text.slice(Math.max(0,hit.start-70),Math.min(text.length,hit.end+140)); break; }
    }
    return [{ ...ref, name:String(row[kind.nameCol] ?? ""), excerpt }];
  });
}
