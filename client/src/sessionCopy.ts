import { write } from "./data/hooks";
import { afterWriteAnywhere, readEntity, readResource } from "./data/imperative";
import { linkAffects } from "./data/sessions";

interface GenericLink {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
  section: string | null;
}

// Sections that make up a session's "prep" — the stuff a oneshot GM re-runs
// for a new group rather than rebuilding from scratch. Deliberately excludes
// финансовые/roster fields (those are per-run) and attached files/resources
// (kept scoped to the original run to avoid silently duplicating uploads).
const PREP_SECTIONS = ["plot_characters", "locations", "loot", "enemies"];

// Copies a oneshot's prep (Задумка text + Сюжетные персонажи/Локации/
// Потенциальный лут/Препятствия links) from an existing session into a
// freshly created one, for GMs re-running the same oneshot with a new group.
// Пишет через слой и сам объявляет задетое: задумку и связи новой сессии.
export async function copySessionPrep(sourceSessionId: number, targetSessionId: number): Promise<void> {
  const source = await readEntity<{ idea_notes: string | null }>("session", sourceSessionId);
  if (source.idea_notes) {
    await write.put(`/sessions/${targetSessionId}`, { idea_notes: source.idea_notes });
  }
  const links = await readResource<GenericLink[]>(`/links?type=session&id=${sourceSessionId}`, { fresh: true });
  const relevant = links.filter((l) => l.section && PREP_SECTIONS.includes(l.section));
  for (const l of relevant) {
    const other =
      l.from_type === "session" && l.from_id === sourceSessionId
        ? { type: l.to_type, id: l.to_id }
        : { type: l.from_type, id: l.from_id };
    await write.post("/links", {
      from_type: "session",
      from_id: targetSessionId,
      to_type: other.type,
      to_id: other.id,
      section: l.section,
    });
  }
  afterWriteAnywhere([{ kind: "session", id: targetSessionId }, ...linkAffects("session", targetSessionId)]);
}
