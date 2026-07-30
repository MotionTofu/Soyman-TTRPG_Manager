import { Router } from "express";
import multer from "multer";
import fs from "fs";
import os from "os";
import path from "path";
import { db } from "../db/db";
import { ensureSubfolder, toFileUrl, VAULT_ROOT, writeReplacingOldFile } from "../services/filesystem";

export const appSettingsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

function getValue(key: string): string | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setValue(key: string, value: string | null): void {
  if (value === null) {
    db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
  } else {
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(key, value);
  }
}

appSettingsRouter.get("/", (_req, res) => {
  const homeBackgroundPath = getValue("home_background_path");
  const fadeDurationMs = Number(getValue("fade_duration_ms"));
  res.json({
    home_background_path: homeBackgroundPath,
    home_background_url: homeBackgroundPath ? toFileUrl(homeBackgroundPath) : null,
    fade_duration_ms: Number.isFinite(fadeDurationMs) && fadeDurationMs >= 0 ? fadeDurationMs : 0,
  });
});

appSettingsRouter.put("/fade-duration", (req, res) => {
  const { fade_duration_ms } = req.body as { fade_duration_ms?: number };
  const ms = Math.max(0, Math.round(Number(fade_duration_ms) || 0));
  setValue("fade_duration_ms", String(ms));
  res.json({ fade_duration_ms: ms });
});

appSettingsRouter.post("/home-background", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });
  const folder = ensureSubfolder(VAULT_ROOT, "App");
  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(folder, `home-background${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, getValue("home_background_path"), "background");
  setValue("home_background_path", target);
  res.json({ home_background_path: target, home_background_url: toFileUrl(target) });
});

appSettingsRouter.delete("/home-background", (_req, res) => {
  setValue("home_background_path", null);
  res.json({ ok: true });
});

// Powers "Приглашения" — lets the GM show a copyable server address for
// players to paste into мобил-игрок/игрок-клиент's "Адрес сервера" field,
// without needing a real deep-link (see feature discussion: manual copy was
// chosen over a custom url scheme). Lists every non-internal IPv4 the OS
// reports so the GM can pick whichever interface their players are actually
// reachable on (Wi-Fi vs Ethernet vs VPN).
appSettingsRouter.get("/network-addresses", (_req, res) => {
  const nets = os.networkInterfaces();
  const addresses: string[] = [];
  for (const iface of Object.values(nets)) {
    for (const net of iface ?? []) {
      if (net.family === "IPv4" && !net.internal) addresses.push(net.address);
    }
  }
  res.json({ addresses, port: process.env.PORT || 3001 });
});
