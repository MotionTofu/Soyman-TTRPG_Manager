import type { CutsceneOriginal, CutsceneParseResult, CutsceneValidationIssue, CutsceneVersionSnapshot } from "./types";
import { parseCutsceneDocument } from "./validate";

function freezeJSON<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeJSON(child);
    Object.freeze(value);
  }
  return value;
}

/** Detached, deeply frozen content of the LAST SUCCESSFUL save, with no media URLs. */
export function captureCutsceneVersion(
  original: Pick<CutsceneOriginal, "id" | "savedVersion" | "document">,
): CutsceneParseResult<CutsceneVersionSnapshot> {
  const issues: CutsceneValidationIssue[] = [];
  if (!Number.isSafeInteger(original.id) || original.id <= 0) {
    issues.push({ code: "identity.original", path: "id", message: "Некорректный ID катсцены.", stepId: null });
  }
  if (typeof original.savedVersion !== "string" || !original.savedVersion.trim()) {
    issues.push({ code: "identity.saved-version", path: "savedVersion", message: "Не указана сохранённая версия.", stepId: null });
  }
  const parsed = parseCutsceneDocument(original.document);
  if (!parsed.ok) issues.push(...parsed.issues.map((entry) => ({ ...entry, path: `document.${entry.path}` })));
  if (issues.length || !parsed.ok) return { ok: false, issues };
  // Validation above guarantees a finite JSON data document before cloning.
  const document = JSON.parse(JSON.stringify(parsed.value)) as typeof parsed.value;
  return { ok: true, value: freezeJSON({ cutsceneId: original.id, savedVersion: original.savedVersion, document }) };
}
