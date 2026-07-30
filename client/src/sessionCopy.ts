import { api } from "./api/client";

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
export async function copySessionPrep(sourceSessionId: number, targetSessionId: number): Promise<void> {
  const source = await api.get<{ idea_notes: string | null }>(`/sessions/${sourceSessionId}`);
  if (source.idea_notes) {
    await api.put(`/sessions/${targetSessionId}`, { idea_notes: source.idea_notes });
  }
  const links = await api.get<GenericLink[]>(`/links?type=session&id=${sourceSessionId}`);
  const relevant = links.filter((l) => l.section && PREP_SECTIONS.includes(l.section));
  for (const l of relevant) {
    const other =
      l.from_type === "session" && l.from_id === sourceSessionId
        ? { type: l.to_type, id: l.to_id }
        : { type: l.from_type, id: l.from_id };
    await api.post("/links", {
      from_type: "session",
      from_id: targetSessionId,
      to_type: other.type,
      to_id: other.id,
      section: l.section,
    });
  }
}
