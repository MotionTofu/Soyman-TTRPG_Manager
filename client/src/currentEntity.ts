import { api } from "./api/client";
import { DETAIL_ROUTES } from "./entityTypes";

// Determines "what entity is the current page about", purely from the
// route — lets the Мешок's empty-slot "+" button work on every detail page
// without each one having to opt in individually.
export function detectCurrentEntity(pathname: string, search: string): { type: string; id: number } | null {
  // Compendium entries have no standalone route of their own — they're
  // viewed at /systems/:id?section=&entry=, and /compendium/:id (used by
  // @-mentions) just redirects there. So this is the only way to detect one.
  const entryId = new URLSearchParams(search).get("entry");
  if (entryId && /^\/systems\/\d+$/.test(pathname)) {
    return { type: "compendium_entry", id: Number(entryId) };
  }
  for (const [type, prefix] of Object.entries(DETAIL_ROUTES)) {
    if (type === "compendium_entry") continue;
    const m = pathname.match(new RegExp(`^${prefix}/(\\d+)$`));
    if (m) return { type, id: Number(m[1]) };
  }
  return null;
}

interface EntityDetails {
  title: string;
  kind?: string;
  system_id?: number;
  section_id?: number;
}

// Compendium entries don't get their own <h1> (the page's h1 is the whole
// system's name), so they're fetched from the API — which also carries
// kind/system_id/section_id, needed by consumers like the DnD feat-drop
// handler (`result.kind === "feat"`) that a title-only payload can't satisfy.
// Every other entity type reuses the on-screen <h1> — same trick
// pinnedPages.ts uses to label a pinned page without a per-type lookup.
export async function resolveCurrentEntityDetails(type: string, id: number): Promise<EntityDetails | null> {
  if (type === "compendium_entry") {
    try {
      const entry = await api.get<{ name: string; kind: string; system_id: number; section_id: number }>(
        `/systems/entries/${id}`
      );
      if (!entry.name) return null;
      return { title: entry.name, kind: entry.kind, system_id: entry.system_id, section_id: entry.section_id };
    } catch {
      return null;
    }
  }
  const title = document.querySelector("h1")?.textContent?.trim();
  return title ? { title } : null;
}
