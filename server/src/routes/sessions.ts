import { Router } from "express";
import { db } from "../db/db";
import { ensureSubfolder, openInFileExplorer, sessionFolder, toFileUrl } from "../services/filesystem";
import { sessionEarnings } from "../services/finance";
import {
  carriedSceneIds,
  currentScene,
  exitsFrom,
  launchScene,
  sceneJournal,
  sceneSoundSet,
  plannedSceneIds,
  plannedScenes,
  sessionCastUnion,
  scenePreview,
} from "../story/stage";
import { withLibraryContent } from "../story/library";
import { linkTargetName } from "../story/cast";
import { scenesUnder, searchScenes, storyTree } from "../story/tree";

export const sessionsRouter = Router();

function getCampaignFolder(campaignId: number): string {
  const row = db
    .prepare("SELECT folder_path FROM campaigns WHERE id = ?")
    .get(campaignId) as { folder_path: string } | undefined;
  if (!row) throw new Error("campaign not found");
  return row.folder_path;
}

sessionsRouter.get("/:id", (req, res) => {
  const session = db
    .prepare(
      `SELECT s.*, c.name as campaign_name, c.payment_type as campaign_payment_type,
              c.session_rate as campaign_session_rate, c.currency,
              (SELECT COUNT(*) FROM sessions s2
                 WHERE s2.campaign_id = s.campaign_id AND s2.archived_at IS NULL
                   AND s2.date <= s.date) as session_number
       FROM sessions s
       JOIN campaigns c ON c.id = s.campaign_id
       WHERE s.id = ?`
    )
    .get(req.params.id) as Record<string, unknown> | undefined;
  if (!session) return res.status(404).json({ error: "not found" });

  const attendance = db
    .prepare(
      `SELECT p.id as player_id, p.name,
              COALESCE(sa.attended, 0) as attended,
              COALESCE(sa.amount_paid, 0) as amount_paid
       FROM campaign_roster cr
       JOIN players p ON p.id = cr.player_id
       LEFT JOIN session_attendance sa
         ON sa.session_id = ? AND sa.player_id = p.id
       WHERE cr.campaign_id = (SELECT campaign_id FROM sessions WHERE id = ?)
       ORDER BY p.name`
    )
    .all(req.params.id, req.params.id);

  // archived_at filter matters here: without it, an "archived" (deleted)
  // resource kept showing forever on the session page since this was the
  // only place reading session.resources — the resources.ts router's own
  // GET / already filters archived rows, but this embedded query didn't.
  const resources = (
    db
      .prepare("SELECT * FROM resources WHERE session_id = ? AND archived_at IS NULL ORDER BY name")
      .all(req.params.id) as { file_path: string | null }[]
  ).map((r) => ({ ...r, file_url: r.file_path ? toFileUrl(r.file_path) : null }));

  res.json({
    ...session,
    effective_payment_type:
      (session.payment_override as string) || (session.campaign_payment_type as string),
    attendance,
    resources,
    earned: sessionEarnings(Number(req.params.id)),
  });
});

sessionsRouter.post("/", (req, res) => {
  const { campaign_id, date, status, payment_override, stake_override, start_time } =
    req.body as {
      campaign_id: number;
      date: string;
      status?: string;
      payment_override?: string | null;
      stake_override?: number;
      start_time?: string | null;
    };
  if (!campaign_id || !date)
    return res.status(400).json({ error: "campaign_id and date are required" });

  const campaignFolderPath = getCampaignFolder(campaign_id);
  const folder = sessionFolder(campaignFolderPath, date);

  const info = db
    .prepare(
      `INSERT INTO sessions (campaign_id, date, status, payment_override, stake_override, start_time, folder_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      campaign_id,
      date,
      status ?? "planned",
      payment_override || null,
      stake_override ?? null,
      start_time || null,
      folder
    );
  // С прошлой сессии переезжают заготовленные, но НЕ сыгранные сцены:
  // приготовили шесть, сыграли четыре, две ждут следующего вечера — и
  // вспоминать, какие именно, Мастеру не приходится.
  db.prepare(
    `INSERT OR IGNORE INTO session_planned_scenes (session_id, scene_id)
     SELECT ?, p.scene_id FROM session_planned_scenes p
     WHERE p.session_id = (
       SELECT s.id FROM sessions s
       WHERE s.campaign_id = ? AND s.id <> ? AND s.archived_at IS NULL
       ORDER BY s.date DESC, s.id DESC LIMIT 1
     )
     AND p.scene_id NOT IN (
       SELECT j.scene_id FROM session_scenes j WHERE j.session_id = p.session_id
     )`
  ).run(info.lastInsertRowid, campaign_id, info.lastInsertRowid);

  res
    .status(201)
    .json(db.prepare("SELECT * FROM sessions WHERE id = ?").get(info.lastInsertRowid));
});

sessionsRouter.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.id) as
    | {
        title: string | null;
        payment_override: string | null;
        stake_override: number | null;
        inworld_year: number | null;
        inworld_month: number | null;
        inworld_day: number | null;
        inworld_year_end: number | null;
        inworld_month_end: number | null;
        inworld_day_end: number | null;
        start_time: string | null;
        battle_playlist_id: number | null;
      }
    | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });

  const {
    date,
    status,
    title,
    payment_override,
    stake_override,
    idea_notes,
    main_events,
    main_events_visible,
    inworld_year,
    inworld_month,
    inworld_day,
    inworld_year_end,
    inworld_month_end,
    inworld_day_end,
    start_time,
    battle_playlist_id,
    cheatsheet_data,
  } = req.body as {
    date?: string;
    status?: string;
    title?: string | null;
    payment_override?: string | null;
    stake_override?: number | null;
    idea_notes?: string;
    main_events?: string;
    main_events_visible?: boolean;
    inworld_year?: number | null;
    inworld_month?: number | null;
    inworld_day?: number | null;
    inworld_year_end?: number | null;
    inworld_month_end?: number | null;
    inworld_day_end?: number | null;
    start_time?: string | null;
    battle_playlist_id?: number | null;
    cheatsheet_data?: string | null;
  };

  // Дата сессии правится здесь же, обычным патчем. Раньше для этого был
  // «перенос»: он заводил НОВУЮ сессию и помечал старую rescheduled — то есть
  // не переносил, а плодил пустой дубль, теряя название, задумку, состав и
  // всю подготовку. Ни одна сессия в базе им так и не воспользовалась.
  //
  // Папку на диске за датой НЕ двигаем. Она названа датой для удобства, а
  // ссылается на неё folder_path; переименование каталога на внешнем или
  // сетевом диске, да ещё с возможно открытыми файлами, стоит дороже, чем
  // расхождение имени с датой.
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }

  db.prepare(
    `UPDATE sessions SET
       date = COALESCE(?, date),
       status = COALESCE(?, status),
       title = ?,
       payment_override = ?,
       stake_override = ?,
       idea_notes = COALESCE(?, idea_notes),
       main_events = COALESCE(?, main_events),
       main_events_visible = COALESCE(?, main_events_visible),
       inworld_year = ?,
       inworld_month = ?,
       inworld_day = ?,
       inworld_year_end = ?,
       inworld_month_end = ?,
       inworld_day_end = ?,
       start_time = ?,
       battle_playlist_id = ?,
       cheatsheet_data = CASE WHEN ? THEN ? ELSE cheatsheet_data END
     WHERE id = ?`
  ).run(
    date ?? null,
    status ?? null,
    title === undefined ? existing.title : title || null,
    payment_override === undefined ? existing.payment_override : payment_override || null,
    stake_override === undefined ? existing.stake_override : stake_override,
    idea_notes ?? null,
    main_events ?? null,
    main_events_visible === undefined ? null : main_events_visible ? 1 : 0,
    inworld_year === undefined ? existing.inworld_year : inworld_year,
    inworld_month === undefined ? existing.inworld_month : inworld_month,
    inworld_day === undefined ? existing.inworld_day : inworld_day,
    inworld_year_end === undefined ? existing.inworld_year_end : inworld_year_end,
    inworld_month_end === undefined ? existing.inworld_month_end : inworld_month_end,
    inworld_day_end === undefined ? existing.inworld_day_end : inworld_day_end,
    start_time === undefined ? existing.start_time : start_time || null,
    battle_playlist_id === undefined ? existing.battle_playlist_id : battle_playlist_id,
    cheatsheet_data !== undefined ? 1 : 0,
    cheatsheet_data ?? null,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id));
});

// Combat/turn-order state — always fully overwritten (not the optional-field
// COALESCE pattern above), since Старт/Следующий/Предыдущий always know the
// exact target state rather than "leave unspecified fields alone".
sessionsRouter.put("/:id/combat", (req, res) => {
  const { active, turn_entry_id } = req.body as { active: boolean; turn_entry_id: number | null };
  db.prepare("UPDATE sessions SET combat_active = ?, combat_turn_entry_id = ? WHERE id = ?").run(
    active ? 1 : 0,
    turn_entry_id ?? null,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id));
});

sessionsRouter.delete("/:id", (req, res) => {
  db.prepare(
    "UPDATE sessions SET archived_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  res.json({ ok: true });
});

// Reveals the session's whole "resources" folder in the OS file explorer —
// the general-purpose storage the "Ресурсы" section's category subfolders
// (pdf/images/audio/other) live under, see resources.ts's CATEGORY_SUBDIR.
sessionsRouter.post("/:id/reveal-resources", (req, res) => {
  const row = db
    .prepare("SELECT folder_path FROM sessions WHERE id = ?")
    .get(req.params.id) as { folder_path: string | null } | undefined;
  if (!row || !row.folder_path) return res.status(404).json({ error: "not found" });
  const folder = ensureSubfolder(row.folder_path, "resources");
  openInFileExplorer(folder, false);
  res.json({ ok: true });
});

sessionsRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE sessions SET archived_at = NULL WHERE id = ?").run(req.params.id);
  res.json(db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id));
});

sessionsRouter.put("/:id/attendance", (req, res) => {
  const { attendance } = req.body as {
    attendance: { player_id: number; attended: boolean; amount_paid: number }[];
  };
  const upsert = db.prepare(
    `INSERT INTO session_attendance (session_id, player_id, attended, amount_paid)
     VALUES (@session_id, @player_id, @attended, @amount_paid)
     ON CONFLICT(session_id, player_id) DO UPDATE SET attended = @attended, amount_paid = @amount_paid`
  );
  const tx = db.transaction((rows: typeof attendance) => {
    for (const row of rows) {
      upsert.run({
        session_id: Number(req.params.id),
        player_id: row.player_id,
        attended: row.attended ? 1 : 0,
        amount_paid: row.amount_paid || 0,
      });
    }
  });
  tx(attendance || []);
  res.json({ ok: true, earned: sessionEarnings(Number(req.params.id)) });
});


// ------------------------------------------------------------- пульт сессии

/**
 * Всё, что нужно переключателю сцен за один запрос.
 *
 * Одним запросом, а не пятью, потому что это открывается в момент начала игры
 * и должно быть на экране сразу: «сейчас», «дальше» и заготовка — части одной
 * картинки, и показывать их по очереди значит мигать.
 */
sessionsRouter.get("/:id/stage", (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId) as
    | { id: number }
    | undefined;
  if (!session) return res.status(404).json({ error: "not found" });

  const scene = currentScene(sessionId);
  res.json({
    planned: plannedScenes(sessionId),
    current: scene,
    exits: scene ? exitsFrom(scene.id) : [],
    sound: scene ? sceneSoundSet(scene.id) : null,
    journal: sceneJournal(sessionId),
  });
});

/**
 * Заготовка вечера. Читается и подготовкой, и пультом.
 *
 * Вместе со списком едет и то, какие сцены переехали с прошлого вечера
 * несыгранными: считать это на клиенте значило бы тащить туда историю сессий
 * кампании ради двух пометок в дереве.
 */
sessionsRouter.get("/:id/planned", (req, res) => {
  const sessionId = Number(req.params.id);
  res.json({ ids: plannedSceneIds(sessionId), carried: carriedSceneIds(sessionId) });
});

/**
 * Отметить или снять сцену. По одной, а не списком целиком: галочка главы
 * шлёт свои сцены пачкой в этот же маршрут, а перезапись всего списка теряла
 * бы правки, сделанные в другом окне за те же секунды.
 */
sessionsRouter.post("/:id/planned", (req, res) => {
  const sessionId = Number(req.params.id);
  const ids = Array.isArray(req.body?.scene_ids)
    ? (req.body.scene_ids as unknown[]).map(Number).filter(Number.isFinite)
    : [];
  const on = req.body?.on !== false;
  const write = db.transaction(() => {
    const add = db.prepare(
      "INSERT OR IGNORE INTO session_planned_scenes (session_id, scene_id) VALUES (?, ?)"
    );
    const drop = db.prepare(
      "DELETE FROM session_planned_scenes WHERE session_id = ? AND scene_id = ?"
    );
    for (const id of ids) (on ? add : drop).run(sessionId, id);
  });
  write();
  res.json({ ids: plannedSceneIds(sessionId), carried: carriedSceneIds(sessionId) });
});

/**
 * Запуск сцены. Возвращает набор звука, который надо включить, — переключает
 * его клиент: движок звука живёт в главном окне браузера, а не на сервере.
 */
sessionsRouter.post("/:id/launch", (req, res) => {
  const sceneId = Number(req.body?.scene_id);
  if (!Number.isFinite(sceneId)) return res.status(400).json({ error: "нужен scene_id" });
  try {
    res.json(launchScene(Number(req.params.id), sceneId));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "не вышло" });
  }
});

/**
 * Состав всех сцен сессии, объединением — панели пульта показывают его
 * строками без крестика: удалить участника из панели значило бы удалить его из
 * сцены, а это правка приключения, а не пульта.
 */
sessionsRouter.get("/:id/cast-union", (req, res) => {
  const sessionId = Number(req.params.id);
  const rows = sessionCastUnion(sessionId);
  res.json(
    rows.map((r) => ({ ...r, name: linkTargetName(r.to_type, r.to_id) }))
  );
});

/** Лента вечера отдельно от всего пульта: её показывают под «Основными событиями». */
sessionsRouter.get("/:id/journal", (req, res) => {
  res.json(sceneJournal(Number(req.params.id)));
});

/**
 * Предпросмотр сцены: зачитка, состав, проверки, звук и выходы. Звук при этом
 * не трогаем — иначе перебор вариантов «куда дальше» устроил бы за столом
 * дискотеку.
 */
sessionsRouter.get("/:id/preview/:sceneId", (req, res) => {
  const preview = scenePreview(Number(req.params.sceneId));
  if (!preview) return res.status(404).json({ error: "not found" });
  res.json(preview);
});

// ------------------------------------------------- дерево и поиск сцен

/**
 * Дерево «приключение → глава → сцена» для подготовки.
 *
 * По умолчанию ограничено приключениями кампании: в сеттинге владельца их 19 и
 * 50 глав, и всё дерево целиком — это список, в котором ничего не найти.
 * `?scope=setting` снимает ограничение — домашняя заготовка из «Сцен вне
 * приключений» нужна регулярно, а ходить за ней в профиль кампании это работа
 * не на своём месте.
 */
sessionsRouter.get("/:id/story-tree", (req, res) => {
  const session = db
    .prepare(
      `SELECT s.campaign_id, c.setting_id FROM sessions s
       JOIN campaigns c ON c.id = s.campaign_id WHERE s.id = ?`
    )
    .get(req.params.id) as { campaign_id: number; setting_id: number | null } | undefined;
  if (!session?.setting_id) return res.json([]);

  const wide = req.query.scope === "setting";
  const arcIds = wide
    ? []
    : (
        db
          .prepare("SELECT arc_id FROM campaign_adventures WHERE campaign_id = ? ORDER BY position, arc_id")
          .all(session.campaign_id) as { arc_id: number }[]
      ).map((r) => r.arc_id);

  // У кампании не отмечено ни одного приключения — показываем сеттинг целиком,
  // иначе подготовка встретит Мастера пустым деревом.
  res.json(storyTree(session.setting_id, arcIds));
});

/** Сцены, которые принесёт галочка приключения или главы. */
sessionsRouter.get("/story-tree/arcs/:arcId/scenes", (req, res) => {
  res.json(scenesUnder(Number(req.params.arcId)));
});

/** Поиск сцен для пульта: сеттинг плюс полка заготовок. */
sessionsRouter.get("/:id/scene-search", (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json([]);
  const session = db
    .prepare(
      `SELECT c.setting_id FROM sessions s JOIN campaigns c ON c.id = s.campaign_id WHERE s.id = ?`
    )
    .get(req.params.id) as { setting_id: number | null } | undefined;
  if (!session?.setting_id) return res.json([]);
  res.json(searchScenes(session.setting_id, q));
});

// ------------------------------------------------------------- резюме

/**
 * Что вышло из вечера: сколько прошло внутриигровых дней и какие тайны
 * раскрылись именно в этой сессии.
 *
 * Дни считаются по промежутку сессии. Дат нет — строки нет вовсе: приглашать
 * поставить дату задним числом, когда вечер кончился, поздно.
 */
sessionsRouter.get("/:id/summary", (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db
    .prepare(
      `SELECT s.*, c.setting_id FROM sessions s
       JOIN campaigns c ON c.id = s.campaign_id WHERE s.id = ?`
    )
    .get(sessionId) as Record<string, unknown> | undefined;
  if (!session) return res.status(404).json({ error: "not found" });

  const revealed = db
    .prepare(
      `SELECT sec.id, sec.title FROM campaign_secret_state st
       JOIN story_secrets sec ON sec.id = st.secret_id
       WHERE st.revealed_session_id = ? AND st.revealed = 1
       ORDER BY sec.id`
    )
    .all(sessionId) as { id: number; title: string }[];

  const planned = plannedSceneIds(sessionId).length;
  const played = (
    db
      .prepare("SELECT COUNT(DISTINCT scene_id) c FROM session_scenes WHERE session_id = ?")
      .get(sessionId) as { c: number }
  ).c;

  res.json({
    held: session.status === "held",
    planned,
    played,
    revealed,
    // Календарь у клиента: месяцы и эра живут в сеттинге, и считать дни надо
    // тем же способом, что и полоса времени, иначе они разойдутся.
    settingId: session.setting_id ?? null,
    from:
      session.inworld_year == null
        ? null
        : { year: session.inworld_year, month: session.inworld_month, day: session.inworld_day },
    to:
      session.inworld_year_end == null
        ? null
        : {
            year: session.inworld_year_end,
            month: session.inworld_month_end,
            day: session.inworld_day_end,
          },
  });
});
