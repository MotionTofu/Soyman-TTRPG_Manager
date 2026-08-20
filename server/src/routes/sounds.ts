import { Router } from "express";
import { randomUUID } from "crypto";
import path from "path";
import { db } from "../db/db";
import { toFileUrl } from "../services/filesystem";
import { fileSrc, isMissing, rememberFileSize } from "../services/fileHealth";
import { removeOrArchive } from "../services/vaultDedup";

export const soundsRouter = Router();
export const soundSetsRouter = Router();

export type AudioRole = "background" | "ambient" | "weather" | "stinger";
const ROLES: AudioRole[] = ["background", "ambient", "weather", "stinger"];

interface SoundRow {
  id: number;
  name: string;
  audio_role: AudioRole | null;
  audio_icon: string | null;
  audio_icon_image_path: string | null;
  audio_pinned: number;
  file_path: string | null;
  tags: string | null;
}

function toButton(row: SoundRow) {
  return {
    resource_id: row.id,
    name: row.name,
    role: row.audio_role,
    icon: row.audio_icon,
    icon_url: row.audio_icon_image_path ? toFileUrl(row.audio_icon_image_path) : null,
    pinned: row.audio_pinned === 1,
    src: fileSrc(row.id, row.file_path),
    missing: isMissing(row.file_path),
  };
}

const SOUND_COLUMNS =
  "id, name, audio_role, audio_icon, audio_icon_image_path, audio_pinned, file_path, tags";

// --- библиотека звуков (вкладка «Звук» в Ресурсах) ---

soundsRouter.get("/", (req, res) => {
  const { role } = req.query as { role?: string };
  const rows = (
    role
      ? db
          .prepare(
            `SELECT ${SOUND_COLUMNS} FROM resources
             WHERE category = 'audio' AND audio_role = ? AND archived_at IS NULL
             ORDER BY name COLLATE NOCASE`
          )
          .all(role)
      : db
          .prepare(
            `SELECT ${SOUND_COLUMNS} FROM resources
             WHERE category = 'audio' AND archived_at IS NULL
             ORDER BY audio_role, name COLLATE NOCASE`
          )
          .all()
  ) as SoundRow[];
  res.json(rows.map(toButton));
});

// Роль, иконка и «постоянный стингер» правятся здесь же: роль одна на файл и
// меняется в любой момент, поэтому отдельного мастера перекладывания нет.
soundsRouter.put("/:id", (req, res) => {
  const { name, audio_role, audio_icon, audio_pinned } = req.body as {
    name?: string;
    audio_role?: string;
    audio_icon?: string | null;
    audio_pinned?: boolean;
  };
  if (audio_role !== undefined && !ROLES.includes(audio_role as AudioRole)) {
    return res.status(400).json({ error: "неизвестная роль звука" });
  }
  const current = db
    .prepare(`SELECT ${SOUND_COLUMNS} FROM resources WHERE id = ?`)
    .get(req.params.id) as SoundRow | undefined;
  if (!current) return res.status(404).json({ error: "звук не найден" });

  // Переименование меняет имя только в приложении. Файл на диске не трогаем:
  // на него могут быть жёсткие ссылки из других записей (см. vaultDedup), и
  // платить риском потерять привязку за косметику незачем.
  db.prepare(
    "UPDATE resources SET name = ?, audio_role = ?, audio_icon = ?, audio_pinned = ? WHERE id = ?"
  ).run(
    name !== undefined && name.trim() ? name.trim() : current.name,
    audio_role !== undefined ? audio_role : current.audio_role,
    audio_icon !== undefined ? audio_icon : current.audio_icon,
    audio_pinned !== undefined ? (audio_pinned ? 1 : 0) : current.audio_pinned,
    req.params.id
  );
  if (current.file_path) rememberFileSize(current.id, current.file_path);

  res.json(
    toButton(db.prepare(`SELECT ${SOUND_COLUMNS} FROM resources WHERE id = ?`).get(req.params.id) as SoundRow)
  );
});

// Где звук используется. Спрашивается перед удалением: «удалить» без ответа
// на «а откуда он пропадёт» — это выбор вслепую.
soundsRouter.get("/:id/usage", (req, res) => {
  const sets = db
    .prepare(
      `SELECT s.id, s.name FROM sound_set_items i JOIN sound_sets s ON s.id = i.set_id
       WHERE i.resource_id = ? GROUP BY s.id ORDER BY s.name COLLATE NOCASE`
    )
    .all(req.params.id) as { id: number; name: string }[];
  const playlists = db
    .prepare(
      `SELECT p.id, p.name FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id
       WHERE pi.resource_id = ? GROUP BY p.id ORDER BY p.name COLLATE NOCASE`
    )
    .all(req.params.id) as { id: number; name: string }[];
  res.json({ sets, playlists });
});

// Удаление насовсем — и записи, и файла. `mode` нужен только тогда, когда это
// последняя ссылка на эти байты в хранилище: тем же механизмом и с тем же
// вопросом «навсегда / в архив», что у картинок галереи (см. vaultDedup).
soundsRouter.delete("/:id", (req, res) => {
  const { mode } = req.query as { mode?: "forever" | "archive" };
  const row = db
    .prepare("SELECT id, name, file_path FROM resources WHERE id = ?")
    .get(req.params.id) as { id: number; name: string; file_path: string | null } | undefined;
  if (!row) return res.status(404).json({ error: "звук не найден" });

  if (row.file_path) {
    const result = removeOrArchive(
      row.file_path,
      mode,
      "resource",
      row.id,
      row.name || path.basename(row.file_path)
    );
    if ("needsChoice" in result) return res.status(409).json({ needsChoice: true });
  }

  // Из наборов и плейлистов звук уходит каскадом по внешним ключам, но
  // стартовый эмбиент — это флажок на строке, и удалённая строка забирает его
  // с собой: набор остался бы без старта молча. Поэтому проверяем и чиним.
  const affected = db
    .prepare("SELECT DISTINCT set_id FROM sound_set_items WHERE resource_id = ? AND is_start = 1")
    .all(row.id) as { set_id: number }[];
  const drop = db.transaction(() => {
    db.prepare("DELETE FROM resources WHERE id = ?").run(row.id);
    for (const a of affected) {
      const next = db
        .prepare(
          "SELECT id FROM sound_set_items WHERE set_id = ? AND role = 'ambient' ORDER BY position LIMIT 1"
        )
        .get(a.set_id) as { id: number } | undefined;
      if (next) db.prepare("UPDATE sound_set_items SET is_start = 1 WHERE id = ?").run(next.id);
    }
  });
  drop();
  res.json({ ok: true });
});

// --- наборы ---

interface SetRow {
  id: number;
  uid: string | null;
  name: string;
  setting_id: number | null;
  campaign_id: number | null;
  battle_playlist_id: number | null;
  created_at: string;
}

function setItems(setId: number, role: AudioRole) {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.audio_role, r.audio_icon, r.audio_icon_image_path,
              r.audio_pinned, r.file_path, r.tags, i.is_start
       FROM sound_set_items i
       JOIN resources r ON r.id = i.resource_id
       WHERE i.set_id = ? AND i.role = ?
       ORDER BY i.position, i.id`
    )
    .all(setId, role) as (SoundRow & { is_start: number })[];
  return rows.map((row) => ({ ...toButton(row), is_start: row.is_start === 1 }));
}

function setSummary(row: SetRow) {
  const counts = db
    .prepare("SELECT role, COUNT(*) as c FROM sound_set_items WHERE set_id = ? GROUP BY role")
    .all(row.id) as { role: AudioRole; c: number }[];
  const by = (role: AudioRole) => counts.find((c) => c.role === role)?.c ?? 0;
  return {
    ...row,
    track_count: by("background"),
    ambient_count: by("ambient"),
    weather_count: by("weather"),
    stinger_count: by("stinger"),
  };
}

soundSetsRouter.get("/", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM sound_sets ORDER BY name COLLATE NOCASE")
    .all() as SetRow[];
  res.json(rows.map(setSummary));
});

soundSetsRouter.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM sound_sets WHERE id = ?").get(req.params.id) as
    | SetRow
    | undefined;
  if (!row) return res.status(404).json({ error: "набор не найден" });
  const battle = row.battle_playlist_id
    ? (db.prepare("SELECT id, name FROM playlists WHERE id = ?").get(row.battle_playlist_id) as
        | { id: number; name: string }
        | undefined)
    : undefined;
  res.json({
    ...setSummary(row),
    battle_playlist: battle ?? null,
    tracks: setItems(row.id, "background"),
    ambient: setItems(row.id, "ambient"),
    weather: setItems(row.id, "weather"),
    stingers: setItems(row.id, "stinger"),
  });
});

soundSetsRouter.post("/", (req, res) => {
  const { name, setting_id, campaign_id, battle_playlist_id } = req.body as {
    name?: string;
    setting_id?: number | null;
    campaign_id?: number | null;
    battle_playlist_id?: number | null;
  };
  if (!name?.trim()) return res.status(400).json({ error: "нужно имя набора" });
  // uid проставляется прямо здесь, а не ленивой засыпкой при следующем
  // запуске: набор может уехать на обмен (см. later.md) раньше, чем
  // приложение перезапустят, и уехать он должен уже с ключом.
  const info = db
    .prepare(
      `INSERT INTO sound_sets (uid, name, setting_id, campaign_id, battle_playlist_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(randomUUID(), name.trim(), setting_id ?? null, campaign_id ?? null, battle_playlist_id ?? null);
  const row = db.prepare("SELECT * FROM sound_sets WHERE id = ?").get(info.lastInsertRowid) as SetRow;
  res.status(201).json(setSummary(row));
});

soundSetsRouter.put("/:id", (req, res) => {
  const current = db.prepare("SELECT * FROM sound_sets WHERE id = ?").get(req.params.id) as
    | SetRow
    | undefined;
  if (!current) return res.status(404).json({ error: "набор не найден" });
  const { name, setting_id, campaign_id, battle_playlist_id } = req.body as {
    name?: string;
    setting_id?: number | null;
    campaign_id?: number | null;
    battle_playlist_id?: number | null;
  };
  db.prepare(
    `UPDATE sound_sets SET name = ?, setting_id = ?, campaign_id = ?, battle_playlist_id = ?
     WHERE id = ?`
  ).run(
    name?.trim() || current.name,
    setting_id !== undefined ? setting_id : current.setting_id,
    campaign_id !== undefined ? campaign_id : current.campaign_id,
    battle_playlist_id !== undefined ? battle_playlist_id : current.battle_playlist_id,
    req.params.id
  );
  res.json(setSummary(db.prepare("SELECT * FROM sound_sets WHERE id = ?").get(req.params.id) as SetRow));
});

soundSetsRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM sound_sets WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Состав набора переписывается целиком, а не по одной кнопке: он и правится
// целиком — и во вкладке, и кнопкой «Сохранить как набор» из пульта, где
// снимок делается со всего пульта разом.
soundSetsRouter.put("/:id/items", (req, res) => {
  const { tracks, ambient, weather, stingers, start_ambient_id } = req.body as {
    tracks?: number[];
    ambient?: number[];
    weather?: number[];
    stingers?: number[];
    start_ambient_id?: number | null;
  };
  const setRow = db.prepare("SELECT id FROM sound_sets WHERE id = ?").get(req.params.id);
  if (!setRow) return res.status(404).json({ error: "набор не найден" });

  const insert = db.prepare(
    "INSERT INTO sound_set_items (set_id, resource_id, role, position, is_start) VALUES (?, ?, ?, ?, ?)"
  );
  const write = db.transaction(() => {
    db.prepare("DELETE FROM sound_set_items WHERE set_id = ?").run(req.params.id);
    // Порядок треков Бэкграунда значим и задаётся перетаскиванием, поэтому
    // position — это индекс в присланном списке, а не порядок добавления.
    (tracks ?? []).forEach((resourceId, i) =>
      insert.run(req.params.id, resourceId, "background", i, 0)
    );
    (ambient ?? []).forEach((resourceId, i) =>
      insert.run(req.params.id, resourceId, "ambient", i, resourceId === start_ambient_id ? 1 : 0)
    );
    (weather ?? []).forEach((resourceId, i) =>
      insert.run(req.params.id, resourceId, "weather", i, 0)
    );
    (stingers ?? []).forEach((resourceId, i) =>
      insert.run(req.params.id, resourceId, "stinger", i, 0)
    );
  });
  write();
  res.json({ ok: true });
});

// --- всё, что нужно пульту, одним запросом ---
//
// Пульт открывается в отдельном окне и не должен собирать своё состояние из
// пяти запросов: чем меньше он ждёт, тем раньше Мастер видит кнопки на их
// постоянных местах.
soundsRouter.get("/console", (req, res) => {
  const setId = req.query.set_id ? Number(req.query.set_id) : null;
  const set = setId
    ? (db.prepare("SELECT * FROM sound_sets WHERE id = ?").get(setId) as SetRow | undefined)
    : undefined;

  // Постоянный состав стингеров плюс дополнения набора: универсальные «Бой» и
  // «Провал» — словарь Мастера, пересобирать их в каждом наборе значит не
  // собрать ни в одном.
  const pinned = db
    .prepare(
      `SELECT ${SOUND_COLUMNS} FROM resources
       WHERE category = 'audio' AND audio_role = 'stinger' AND audio_pinned = 1 AND archived_at IS NULL
       ORDER BY name COLLATE NOCASE`
    )
    .all() as SoundRow[];

  const fromSet = set ? setItems(set.id, "stinger") : [];
  const pinnedIds = new Set(pinned.map((p) => p.id));

  // Бэкграунд набора — его собственный список треков. Плейлист остался только
  // боевой темой, и он приезжает отдельным полем: пульт включает его не при
  // включении набора, а при входе в бой.
  const tracks = set
    ? setItems(set.id, "background").map((t) => ({
        resource_id: t.resource_id,
        name: t.name,
        src: t.src,
        missing: t.missing,
      }))
    : [];

  const battle = set?.battle_playlist_id
    ? (db.prepare("SELECT id, name FROM playlists WHERE id = ?").get(set.battle_playlist_id) as
        | { id: number; name: string }
        | undefined) ?? null
    : null;

  res.json({
    set: set ? setSummary(set) : null,
    tracks,
    battle,
    ambient: set ? setItems(set.id, "ambient") : [],
    weather: set ? setItems(set.id, "weather") : [],
    stingers: [
      ...pinned.map((p) => ({ ...toButton(p), is_start: false, from_set: false })),
      ...fromSet.filter((s) => !pinnedIds.has(s.resource_id)).map((s) => ({ ...s, from_set: true })),
    ],
  });
});
