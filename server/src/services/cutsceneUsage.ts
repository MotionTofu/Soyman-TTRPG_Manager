import type { CutsceneLaunchContext, CutsceneUsage, CutsceneUsagePlace } from "@soyman/shared";
import { db } from "../db/db";
import { hasCutscenePreview } from "../db/cutscenePreviews";
import { readCutscene } from "./cutscenes";
import { readPlayerDisplay } from "./playerDisplay";

function contextPlace(context: CutsceneLaunchContext | null): { label: string; href: string | null } {
  if (!context || context.kind === "library") return { label: "общая мастерская", href: "/mastering/cutscenes" };
  if (context.kind === "campaign") {
    const row = db.prepare("SELECT name FROM campaigns WHERE id = ?").get(context.campaignId) as { name: string } | undefined;
    return { label: row?.name ?? `Кампания #${context.campaignId}`, href: `/campaigns/${context.campaignId}` };
  }
  const row = db.prepare(`SELECT s.title, s.date, c.name FROM sessions s LEFT JOIN campaigns c ON c.id = s.campaign_id WHERE s.id = ?`)
    .get(context.sessionId) as { title: string | null; date: string; name: string | null } | undefined;
  return { label: row ? [row.name, row.date, row.title].filter(Boolean).join(" · ") : `Сессия #${context.sessionId}`, href: `/sessions/${context.sessionId}` };
}

/** All consumers, including DELETE, read the same persisted sources. No window/heartbeat expiry. */
export function readCutsceneUsage(id: number): CutsceneUsage {
  const original = readCutscene(id), places: CutsceneUsagePlace[] = [];
  if (hasCutscenePreview(db.prepare("SELECT 1").database) && db.prepare("SELECT 1 FROM cutscene_preview_state WHERE cutscene_id=?").get(id)) {
    places.push({ key: "preview", kind: "snapshot", label: "Предпросмотр или ожидающий возврат", href: `/mastering/cutscenes/${id}` });
  }
  for (const row of db.prepare(`SELECT c.id, c.name FROM campaign_cutscenes b JOIN campaigns c ON c.id = b.campaign_id WHERE b.cutscene_id = ? ORDER BY c.id`)
    .all(id) as { id: number; name: string }[]) {
    places.push({ key: `campaign:${row.id}`, kind: "campaign", label: `Подборка кампании «${row.name}»`, href: `/campaigns/${row.id}` });
  }
  for (const row of db.prepare(`SELECT s.id, s.title, s.date, c.name FROM session_cutscenes b JOIN sessions s ON s.id = b.session_id
    LEFT JOIN campaigns c ON c.id = s.campaign_id WHERE b.cutscene_id = ? ORDER BY s.id`).all(id) as
    { id: number; title: string | null; date: string; name: string | null }[]) {
    places.push({ key: `session:${row.id}`, kind: "session", label: `План сессии «${[row.name, row.date, row.title].filter(Boolean).join(" · ")}»`, href: `/sessions/${row.id}` });
  }
  const runs = db.prepare(`SELECT r.run_id, r.mode, r.launch_context, r.version FROM cutscene_runs r
    JOIN cutscene_run_uses u ON u.run_id = r.run_id WHERE u.cutscene_id = ? AND r.ended_at IS NULL ORDER BY r.created_at`)
    .all(id) as { run_id: string; mode: "live" | "rehearsal"; launch_context: string; version: string }[];
  for (const run of runs) {
    const context = contextPlace(JSON.parse(run.launch_context)), version = JSON.parse(run.version);
    places.push({ key: `run:${run.run_id}`, kind: run.mode,
      label: `${run.mode === "live" ? "Активный показ" : "Репетиция"} «${version.document.name}» · ${context.label} (включая снимок возврата)`, href: context.href });
  }
  const display = readPlayerDisplay().snapshot;
  if (display?.source.kind === "cutscene" && display.source.cutsceneId === id) {
    const context = contextPlace(display.context);
    places.push({ key: "frame", kind: "frame", label: `Оставленный кадр · ${context.label}`, href: context.href });
  }
  if (db.prepare("SELECT 1 FROM cutscene_music_uses WHERE cutscene_id = ?").get(id)) {
    const row = db.prepare(`SELECT r.launch_context FROM cutscene_music_state m LEFT JOIN cutscene_runs r ON r.run_id = m.run_id WHERE m.id = 1`)
      .get() as { launch_context: string | null } | undefined;
    const context = contextPlace(row?.launch_context ? JSON.parse(row.launch_context) : null);
    places.push({ key: "music", kind: "music", label: `Продолжающаяся музыка · ${context.label}`, href: context.href });
  }
  // The ledger also protects old versions and in-flight duplication, independently of the latest document.
  const holds = db.prepare(`SELECT DISTINCT h.holder_kind, h.holder_key FROM cutscene_media_holds h
    JOIN cutscene_media m ON m.id = h.media_id WHERE m.cutscene_id = ?`).all(id) as { holder_kind: string; holder_key: string }[];
  for (const hold of holds) {
    if ((hold.holder_kind === "original" || hold.holder_kind === "staging") && hold.holder_key === String(id)) continue;
    if (hold.holder_kind === "snapshot" && runs.some(run => run.run_id === hold.holder_key)) continue;
    if (hold.holder_kind === "frame" && places.some(place => place.kind === "frame")) continue;
    if (hold.holder_kind === "music" && places.some(place => place.kind === "music")) continue;
    const preparing = hold.holder_key.startsWith("duplicate:");
    places.push({ key: `hold:${hold.holder_kind}:${hold.holder_key}`, kind: preparing ? "preparation" : "snapshot",
      label: preparing ? "Подготовка независимого дубликата" : "Сохранённый материал показа или снимка возврата", href: null });
  }
  if (db.prepare("SELECT 1 FROM cutscene_media WHERE cutscene_id = ? AND state = 'pending'").get(id)) {
    places.push({ key: "upload", kind: "preparation", label: "Подготовка медиафайла", href: null });
  }
  return { cutsceneId: id, places, canDelete: original.archivedAt !== null && places.length === 0 };
}
