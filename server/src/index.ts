import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { createServer } from "http";
import { initRealtime } from "./services/realtime";
import { applyActiveStorageEnv } from "./services/storages";
// Resolve which storage profile is active and point DB_DIR/VAULT_ROOT at it
// before anything below opens a database connection or touches the vault.
applyActiveStorageEnv();
import { db } from "./db/db";
import { initVault, VAULT_ROOT, vaultAbs } from "./services/filesystem";
import { storagesRouter } from "./routes/storages";
import { appSettingsRouter } from "./routes/appSettings";
import { systemsRouter } from "./routes/systems";
import { settingsRouter } from "./routes/settings";
import { playersRouter } from "./routes/players";
import { campaignsRouter } from "./routes/campaigns";
import { sessionsRouter } from "./routes/sessions";
import { resourcesRouter } from "./routes/resources";
import { masteringRouter } from "./routes/mastering";
import { calendarRouter } from "./routes/calendar";
import { searchRouter } from "./routes/search";
import { linksRouter } from "./routes/links";
import { mentionsRouter } from "./routes/mentions";
import { crossLinksRouter } from "./routes/crossLinks";
import { charactersRouter } from "./routes/characters";
import { archiveRouter } from "./routes/archive";
import { randomArticleRouter } from "./routes/randomArticle";
import { archivedFilesRouter } from "./routes/archivedFiles";
import { settingLocationsRouter } from "./routes/settingLocations";
import { settingBeingsRouter } from "./routes/settingBeings";
import { settingCommunitiesRouter } from "./routes/settingCommunities";
import { artifactsRouter } from "./routes/artifacts";
import { financeRouter } from "./routes/finance";
import { statblocksRouter } from "./routes/statblocks";
import { creatureCardRouter } from "./routes/creatureCard";
import { linkNotesRouter } from "./routes/linkNotes";
import { campaignEntriesRouter } from "./routes/campaignEntries";
import { worldExplorationEntriesRouter } from "./routes/worldExplorationEntries";
import { initiativeEntriesRouter } from "./routes/initiativeEntries";
import { settingEntriesRouter } from "./routes/settingEntries";
import { backupRouter } from "./routes/backup";
import { modulesRouter } from "./routes/modules";
import { galleryRouter } from "./routes/gallery";
import { entityRelationsRouter } from "./routes/entityRelations";
import { playlistsRouter } from "./routes/playlists";
import { soundsRouter, soundSetsRouter } from "./routes/sounds";
import { filesRouter } from "./routes/files";
import { authRouter } from "./routes/auth";
import { playerRouter } from "./routes/player";
import { campaignPlayerSectionsRouter } from "./routes/campaignPlayerSections";
import { visibilityGrantsRouter } from "./routes/visibilityGrants";
import { storyRouter } from "./routes/story";
import { canvasRouter } from "./routes/canvas";
import { adventureImportRouter } from "./routes/adventureImport";
import { systemImportRouter } from "./routes/systemImport";
import { sweepOrphans } from "./services/orphans";
import { backfillCompendiumSummaries } from "./services/monsterSummary";
import { attachUser, requireAuth, bootstrapGmAccount, verifyToken, type AuthedRequest } from "./services/auth";
import { apiRoleGate } from "./services/playerAccess";

initVault();
bootstrapGmAccount();

// One-off reconciliation at boot: clear any polymorphic statblock/gallery/date
// rows whose owner was removed before this sweep existed (e.g. by a pre-fix
// permanent delete or FK cascade). Cheap; a no-op once the DB is clean.
{
  const removed = sweepOrphans();
  if (removed > 0) console.log(`Cleaned ${removed} orphaned satellite row(s) at startup.`);
}

// Стартовый проход сводок бестиария: у импортированных систем data записей
// пустая, а её знает статблок — дозаполняем один раз здесь, чтобы список и
// профиль раздела читали готовое, не дописывая при каждом GET. Заполняется
// только пустое; руками заданное не трогается (см. monsterSummary).
{
  const fill = backfillCompendiumSummaries(db);
  if (fill.changed > 0) {
    console.log(
      `Compendium summaries: ${fill.changed}/${fill.checked} monsters filled ` +
        `(size ${fill.filled.size}, type ${fill.filled.creatureType}, ` +
        `alignment ${fill.filled.alignment}, CR ${fill.filled.cr}, ` +
        `${fill.conflicts.length} conflicts, ${fill.unknownTypes.length} unknown types).`
    );
  }
}

const app = express();
// Local desktop usage (Electron serving its own built client, or the dev
// server proxying /api and /files) is always same-origin or has no Origin
// header at all — always allowed below. A hosted deployment additionally
// needs its player desktop app / mobile apps' origins allowed explicitly via
// ALLOWED_ORIGINS (comma-separated), since those aren't "the same machine"
// anymore. Capacitor apps typically send capacitor://localhost or
// http://localhost as their Origin — include those in ALLOWED_ORIGINS too.
const extraAllowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// RFC1918 private ranges + link-local — a phone/tablet on the same WiFi as
// this machine is exactly as trusted as the machine itself for local dev/
// testing (same reasoning as the localhost/127.0.0.1 exception below), so
// LAN testing doesn't require setting ALLOWED_ORIGINS by hand every time.
function isPrivateLanHost(host: string): boolean {
  return (
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin, curl, native app
      try {
        const host = new URL(origin).hostname;
        if (host === "localhost" || host === "127.0.0.1" || isPrivateLanHost(host)) {
          return cb(null, true);
        }
      } catch {
        /* malformed Origin — fall through to the allowlist check below */
      }
      if (extraAllowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
  })
);
// 5mb was fine while every JSON body was plain text/metadata. Setting exports
// with ?include=images now embed avatar/background/resource files as base64
// (opt-in, explicitly warned about in the export modal), so imports of those
// files can legitimately be much larger.
app.use(express.json({ limit: "500mb" }));
app.use(attachUser);

// П2.1: в БД пути хранятся ОТНОСИТЕЛЬНО корня хранилища, но наружу — клиенту —
// они уходят как раньше, абсолютными: клиент показывает folder_path/file_path
// текстом (ArtifactDetailPage и т.п.) и не должен видеть «Campaigns\...»
// вместо «E:\RPG-Vault\Campaigns\...». Конвертация на границе ответа одной
// точкой: рекурсивно по JSON, ключи `*_path` (плюс old_path/new_path из
// relink-кандидатов) → vaultAbs. Голый `path` НЕ трогается (пути валидации
// import'ов и `path` у JSON-pointer'ов — не файлы). Внешние absolute-пути
// (ресурсы вне vault) vaultAbs пропускает как есть.
function absolutizeVaultPaths(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(absolutizeVaultPaths);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      const isPathField =
        k.endsWith("_path") || k === "old_path" || k === "new_path";
      out[k] = isPathField && typeof val === "string" ? vaultAbs(val) : absolutizeVaultPaths(val);
    }
    return out;
  }
  return v;
}
app.use((_req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body) => origJson(body === undefined ? body : absolutizeVaultPaths(body));
  next();
});

app.use("/api/auth", authRouter);
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Player-role routes are already scoped to the caller's own player_id inside
// playerRouter (requireAuth("player")) — mounted before the blanket gm gate
// below so a player token isn't rejected before it even gets there. Every
// other /api/* route returns raw, unfiltered admin data (any campaign,
// anyone's finances, secrets before they're revealed) — those are for
// мастер-клиент / мобил-мастер only, never for a player token, now that a
// real player-role client (игрок-клиент / мобил-игрок) exists to actually
// exercise the distinction.
app.use("/api/player", playerRouter);

// Everything below is role-gated: gm tokens pass everything (the local
// desktop app logs in as the GM account created on first run); player tokens
// get a narrow ownership-checked allowlist — their own characters and the
// read-only compendium — so the desktop character editor works for players
// against the same routes. See services/playerAccess.ts.
app.use("/api", apiRoleGate);

// Not a plain express.static(VAULT_ROOT): that would bake in whatever
// VAULT_ROOT is at this line, and switching storages later wouldn't change
// where /files serves from. Building the static handler fresh per request
// picks up the current value instead. Gated behind auth (any role) once
// hosted — uploaded handouts/images shouldn't be guessable-URL public, but
// both gm and player clients legitimately need to load images/audio.
app.use("/files", (req: AuthedRequest, _res, next) => {
  // Plain <img>/<audio src> tags can't attach an Authorization header — the
  // desktop client appends ?token=... to every /files URL it renders (see
  // client/src/api/client.ts's withFileTokens) as a fallback for exactly
  // this route. attachUser already ran (header-only) before this point.
  if (!req.user && typeof req.query.token === "string") {
    const user = verifyToken(req.query.token);
    if (user) req.user = user;
  }
  next();
});
app.use("/files", requireAuth(), (req, res, next) => {
  // Митгация утечки ?token= (H4): файлы не должны кэшироваться публично и не
  // должны уходить в Referer. Полный фикс — грузить через Authorization header
  // (см. client/src/utils/fileUrl.ts), но пока ?token= остаётся fallback для
  // <img>/<audio> — режем кэш и реферер.
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use("/files", requireAuth(), (req, res, next) => {
  express.static(VAULT_ROOT)(req, res, next);
});

app.use("/api/systems", systemsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/players", playersRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/resources", resourcesRouter);
app.use("/api/mastering", masteringRouter);
app.use("/api/calendar", calendarRouter);
app.use("/api/search", searchRouter);
app.use("/api/links", linksRouter);
app.use("/api/mentions", mentionsRouter);
app.use("/api/cross-links", crossLinksRouter);
app.use("/api/characters", charactersRouter);
app.use("/api/archive", archiveRouter);
app.use("/api/random-article", randomArticleRouter);
app.use("/api/archived-files", archivedFilesRouter);
app.use("/api/setting-locations", settingLocationsRouter);
app.use("/api/setting-beings", settingBeingsRouter);
app.use("/api/creature-card", creatureCardRouter);
app.use("/api/setting-communities", settingCommunitiesRouter);
app.use("/api/artifacts", artifactsRouter);
app.use("/api/finance", financeRouter);
app.use("/api/statblocks", statblocksRouter);
app.use("/api/link-notes", linkNotesRouter);
app.use("/api/campaign-entries", campaignEntriesRouter);
app.use("/api/world-exploration-entries", worldExplorationEntriesRouter);
app.use("/api/initiative-entries", initiativeEntriesRouter);
app.use("/api/setting-entries", settingEntriesRouter);
app.use("/api/backup", backupRouter);
app.use("/api/storages", storagesRouter);
app.use("/api/app-settings", appSettingsRouter);
app.use("/api/modules", modulesRouter);
app.use("/api/gallery", galleryRouter);
app.use("/api/entity-relations", entityRelationsRouter);
app.use("/api/playlists", playlistsRouter);
app.use("/api/sounds", soundsRouter);
app.use("/api/sound-sets", soundSetsRouter);
app.use("/api/files", filesRouter);
app.use("/api/campaign-player-sections", campaignPlayerSectionsRouter);
app.use("/api/visibility-grants", visibilityGrantsRouter);
app.use("/api/story", storyRouter);
app.use("/api/canvas", canvasRouter);
app.use("/api/import", adventureImportRouter);
app.use("/api/system-import", systemImportRouter);

// In the packaged app (and when a built client exists next to the server),
// serve the compiled React app and fall back to it for any non-API route
// so client-side routing (react-router) works on page reload.
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/files).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Last-resort error handler: without one, a thrown route error (a SQL
// constraint, a failed fs op) returns Express's default HTML stack-trace page,
// which the client then shows verbatim. Log the full error server-side and
// hand the client a clean JSON message instead.
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(`[${req.method} ${req.path}]`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err?.message ?? "internal server error" });
});

const PORT = process.env.PORT || 3001;
const httpServer = createServer(app);
initRealtime(httpServer);
httpServer.listen(PORT, () => {
  console.log(`RPG manager server listening on http://localhost:${PORT}`);
});
