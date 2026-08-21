-- Accounts for the remote/hosted deployment (player desktop app + mobile
-- apps). Irrelevant to the plain local desktop GM app, which runs with
-- AUTH_ENABLED unset and never touches this table. role='gm' accounts see
-- everything; role='player' accounts are scoped to player_id's own
-- characters and campaigns (see routes/player.ts).
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player', -- gm | player
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  is_admin INTEGER NOT NULL DEFAULT 0, -- marks the seeded admin account, see services/auth.ts
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS systems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  folder_path TEXT,
  thumbnail_image_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT,
  imported_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  background_image_path TEXT,
  thumbnail_image_path TEXT,
  folder_path TEXT,
  calendar_era TEXT DEFAULT '',
  pinned_calendar_year INTEGER,
  pinned_calendar_month INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT,
  imported_at TEXT
);

-- In-world calendar definition for a setting: an ordered list of months
-- (each with its own day count) and an ordered list of weekday names.
CREATE TABLE IF NOT EXISTS setting_calendar_months (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  days INTEGER NOT NULL DEFAULT 30
);

CREATE TABLE IF NOT EXISTS setting_calendar_weekdays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'gm', -- gm | player
  system_id INTEGER REFERENCES systems(id),
  setting_id INTEGER REFERENCES settings(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  type TEXT NOT NULL DEFAULT 'campaign', -- campaign | oneshot
  payment_type TEXT NOT NULL DEFAULT 'free', -- free | paid | negotiable
  payment_frequency TEXT NOT NULL DEFAULT 'per_session', -- per_session | per_month
  rate_split TEXT NOT NULL DEFAULT 'per_person', -- per_person | per_table
  session_rate REAL DEFAULT 0,
  currency TEXT DEFAULT 'RUB',
  background_image_path TEXT,
  thumbnail_image_path TEXT,
  group_theme_litm TEXT, -- JSON LitMThemeCard, shared theme auto-copied into new character statblocks
  pinned_calendar_year INTEGER, -- year the campaign's in-world calendar opens to by default
  pinned_calendar_month INTEGER, -- month the campaign's in-world calendar opens to by default
  folder_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  notes TEXT DEFAULT '',
  folder_path TEXT,
  avatar_image_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE, -- NULL = standalone, not tied to any campaign
  system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL, -- only meaningful when campaign_id IS NULL; campaign implies system otherwise
  character_name TEXT NOT NULL,
  backstory TEXT DEFAULT '',
  statblock TEXT DEFAULT '',
  current_situation TEXT DEFAULT '',
  personal_arc TEXT DEFAULT '',
  future_thoughts TEXT DEFAULT '',
  connections_notes TEXT DEFAULT '',
  avatar_image_path TEXT,
  thumbnail_image_path TEXT,
  folder_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS campaign_roster (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active', -- active | left
  PRIMARY KEY (campaign_id, player_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'planned', -- planned | held | cancelled | rescheduled
  rescheduled_to_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  rescheduled_from_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  payment_override TEXT, -- NULL (inherit from campaign) | free | paid | negotiable
  stake_override REAL,
  idea_notes TEXT DEFAULT '',
  main_events TEXT DEFAULT '',
  main_events_visible INTEGER NOT NULL DEFAULT 0, -- shown to players via the sync API when true
  inworld_year INTEGER,
  inworld_month INTEGER, -- 1-based position into setting_calendar_months
  inworld_day INTEGER,
  inworld_year_end INTEGER,
  inworld_month_end INTEGER,
  inworld_day_end INTEGER,
  start_time TEXT, -- "HH:MM", optional real-world start time shown on the calendar
  folder_path TEXT,
  combat_active INTEGER NOT NULL DEFAULT 0,
  combat_turn_entry_id INTEGER REFERENCES initiative_entries(id) ON DELETE SET NULL,
  battle_playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
  cheatsheet_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS session_attendance (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  attended INTEGER NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, player_id)
);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'note',
  scope TEXT NOT NULL DEFAULT 'global', -- global | campaign | session | setting | system
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  setting_id INTEGER REFERENCES settings(id) ON DELETE CASCADE,
  system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL, -- for type = statblock_template
  template_kind TEXT, -- short | full, for type = statblock_template
  template_format TEXT NOT NULL DEFAULT 'text', -- text | litm_character | litm_challenge | dnd_character | dnd_creature, for type = statblock_template
  file_path TEXT,
  link_url TEXT, -- for type = link (external URL/folder button)
  category TEXT, -- folder | pdf | image | audio | link | other, sub-grouping within type = link
  tags TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

-- Named, manually-ordered collections of audio resources. A session can
-- either own playlists directly or attach a setting's playlist via
-- generic_links (section='attached_playlist') to reuse it without copying.
-- Плейлист остался ровно под одну роль — боевую тему пульта: она одна на всю
-- кампанию и переиспользуется, поэтому её имеет смысл держать отдельно от
-- наборов. Плейлистов сеттинга и сессии больше нет, их работу делает набор.
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scope TEXT NOT NULL, -- battle (session | setting — только в старых базах, чистятся миграцией)
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  setting_id INTEGER REFERENCES settings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  custom_name TEXT, -- overrides the resource's own name, just within this playlist
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Размер файла на момент последней удачной привязки. Нужен ровно одному
-- механизму: когда файлы переехали и путь указывают заново, совпадение
-- размера отличает «это тот самый файл» от «просто одноимённый файл из
-- чужой библиотеки». Хранится отдельной таблицей, а не колонкой на
-- resources: это кэш файловой системы, а не свойство ресурса.
CREATE TABLE IF NOT EXISTS resource_file_sizes (
  resource_id INTEGER PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  size_bytes INTEGER NOT NULL
);

-- Пульт звука. Набор — это то, из чего собран пульт для одного места: какие
-- кнопки лежат в каналах Бэкграунда, Эмбиента, Погоды и Стингеров. Треки
-- Бэкграунда лежат в самом наборе (sound_set_items с role = 'background'), а
-- не отдельным плейлистом: заготавливать список заранее, чтобы потом
-- подцепить его к набору, — лишний шаг там, где список нужен ровно один раз.
-- Исключение — боевая тема: она переиспользуется по всей кампании, поэтому
-- осталась плейлистом. Набор глобальный; setting_id/campaign_id — только
-- ярлык, по которому список поднимает подходящее наверх, а не владение.
CREATE TABLE IF NOT EXISTS sound_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT,
  name TEXT NOT NULL,
  setting_id INTEGER REFERENCES settings(id) ON DELETE SET NULL,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  battle_playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Кнопка канала внутри набора. Роль дублирует resources.audio_role
-- намеренно: набор может показать звук в своём канале и тогда, когда роль у
-- ресурса потом поменяли, — иначе набор молча терял бы кнопку.
CREATE TABLE IF NOT EXISTS sound_set_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER NOT NULL REFERENCES sound_sets(id) ON DELETE CASCADE,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- ambient | weather | stinger
  position INTEGER NOT NULL DEFAULT 0,
  -- Запускается при включении набора. Только у ambient: Бэкграунд стартует
  -- плейлистом набора, а Погода и Стингеры при включении не трогаются.
  is_start INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sound_set_items_set ON sound_set_items(set_id, role, position);

CREATE TABLE IF NOT EXISTS statblocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL, -- character | being
  owner_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'full', -- short | full
  format TEXT NOT NULL DEFAULT 'text', -- text | litm_character | litm_challenge | dnd_character | dnd_creature
  content TEXT DEFAULT '', -- plain text, or JSON when format != 'text'
  note TEXT DEFAULT '',
  theme TEXT, -- statblock visual theme (see statblock themes), NULL = default "Гравюра" (theme-color)
  density TEXT, -- 'comfortable' | 'compact', NULL = comfortable
  avatar_image_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS character_chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  section TEXT NOT NULL, -- backstory | personal_arc | current_situation | future_thoughts | inventory
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  image_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS location_chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id INTEGER NOT NULL REFERENCES setting_locations(id) ON DELETE CASCADE,
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  visible_to_players INTEGER NOT NULL DEFAULT 0, -- explicit GM reveal, shown via the player sync API
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaign_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  category TEXT NOT NULL, -- notes | quotes | tasks (secrets переехали в story_secrets)
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'none', -- none | done | failed (tasks); none | done (secrets: unrevealed | revealed)
  priority INTEGER NOT NULL DEFAULT 0, -- tasks only
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS setting_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  category TEXT NOT NULL, -- notes | internet_ideas
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS being_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  being_a_id INTEGER NOT NULL REFERENCES setting_beings(id) ON DELETE CASCADE,
  being_b_id INTEGER NOT NULL REFERENCES setting_beings(id) ON DELETE CASCADE,
  relation_type TEXT DEFAULT '',
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Superseded being_relations: directional (from feels `tone` about to, not
-- necessarily reciprocated) and polymorphic (being/character/community in
-- either slot, not just being<->being), so a player character or a faction
-- can carry a described opinion of anyone else too. No FK on from_id/to_id
-- since the referenced table depends on from_type/to_type (same tradeoff as
-- generic_links).
CREATE TABLE IF NOT EXISTS entity_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_type TEXT NOT NULL, -- being | character | community
  from_id INTEGER NOT NULL,
  to_type TEXT NOT NULL,
  to_id INTEGER NOT NULL,
  tone TEXT NOT NULL DEFAULT 'neutral', -- positive | negative | neutral | mixed
  label TEXT NOT NULL DEFAULT '', -- short user-written name, e.g. "любит", "ненавидит"
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entity_relations_from ON entity_relations(from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_entity_relations_to ON entity_relations(to_type, to_id);

CREATE TABLE IF NOT EXISTS mastering_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL, -- prep | live | knowledge
  system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS preproduction (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
  adventure_challenge TEXT DEFAULT '',
  gameplay_styles TEXT DEFAULT '',
  background TEXT DEFAULT '',
  adventure_stakes_hooks TEXT DEFAULT '',
  threads_clues_lore TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS setting_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES setting_locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Синонимы имени (JSON-массив) и имя в оригинале: разные переводы одной
  -- книги зовут сущность по-разному, сходится это по оригиналу.
  aliases TEXT NOT NULL DEFAULT '[]',
  name_original TEXT NOT NULL DEFAULT '',
  kind TEXT DEFAULT '',
  description TEXT DEFAULT '',
  folder_path TEXT,
  avatar_image_path TEXT,
  thumbnail_image_path TEXT,
  map_image_path TEXT,
  map_max_zoom REAL,
  map_start_zoom REAL,
  map_goto_zoom REAL,
  map_labels_always INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

-- Pins placed on a location's map image, linking to any entity (usually a
-- child location, but any type from the search panel can be dropped here).
CREATE TABLE IF NOT EXISTS location_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id INTEGER NOT NULL REFERENCES setting_locations(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  x REAL NOT NULL, -- percentage 0-100, left offset
  y REAL NOT NULL, -- percentage 0-100, top offset
  color TEXT, -- NULL = default accent color
  size REAL, -- pin dot diameter in px, NULL = default
  border_color TEXT, -- NULL = default border
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS setting_beings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Синонимы имени (JSON-массив) и имя в оригинале: разные переводы одной
  -- книги зовут сущность по-разному, сходится это по оригиналу.
  aliases TEXT NOT NULL DEFAULT '[]',
  name_original TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'bestiary', -- bestiary | key_figure | influential | notable
  location_id INTEGER REFERENCES setting_locations(id) ON DELETE SET NULL,
  base_monster_id INTEGER REFERENCES compendium_entries(id) ON DELETE SET NULL, -- template this personality was cloned from, if any
  statblock_short TEXT DEFAULT '',
  statblock_full TEXT DEFAULT '',
  history TEXT DEFAULT '',
  behavior TEXT DEFAULT '',
  avatar_image_path TEXT,
  thumbnail_image_path TEXT, -- wide crop shown in the Население list, independent of the square avatar
  folder_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS setting_communities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES setting_communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Синонимы имени (JSON-массив) и имя в оригинале: разные переводы одной
  -- книги зовут сущность по-разному, сходится это по оригиналу.
  aliases TEXT NOT NULL DEFAULT '[]',
  name_original TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  history TEXT DEFAULT '',
  current_situation TEXT DEFAULT '',
  features TEXT DEFAULT '',
  goals TEXT DEFAULT '',
  folder_path TEXT,
  avatar_image_path TEXT,
  thumbnail_image_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

-- Multi-article notes for a community (history/situation/features/goals),
-- mirroring character_chapters / location_chapters.
CREATE TABLE IF NOT EXISTS community_chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  community_id INTEGER NOT NULL REFERENCES setting_communities(id) ON DELETE CASCADE,
  section TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS being_communities (
  being_id INTEGER NOT NULL REFERENCES setting_beings(id) ON DELETE CASCADE,
  community_id INTEGER NOT NULL REFERENCES setting_communities(id) ON DELETE CASCADE,
  PRIMARY KEY (being_id, community_id)
);

CREATE TABLE IF NOT EXISTS being_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  being_id INTEGER NOT NULL REFERENCES setting_beings(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Multi-article notes for a being's История/Поведение/Текущая ситуация,
-- mirroring community_chapters. Текущая ситуация additionally uses
-- campaign_id/important; the other two sections leave them at their defaults.
CREATE TABLE IF NOT EXISTS being_chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  being_id INTEGER NOT NULL REFERENCES setting_beings(id) ON DELETE CASCADE,
  section TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  important INTEGER NOT NULL DEFAULT 0,
  visible_to_players INTEGER NOT NULL DEFAULT 0, -- explicit GM reveal, shown via the player sync API
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Синонимы имени (JSON-массив) и имя в оригинале: разные переводы одной
  -- книги зовут сущность по-разному, сходится это по оригиналу.
  aliases TEXT NOT NULL DEFAULT '[]',
  name_original TEXT NOT NULL DEFAULT '',
  short_name TEXT,
  description TEXT DEFAULT '',
  owner TEXT DEFAULT '',
  power TEXT DEFAULT '',
  history TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  item_class TEXT, -- magic_item | equipment
  item_type TEXT,
  rarity TEXT,
  requires_attunement INTEGER NOT NULL DEFAULT 0,
  -- Где лежит и у кого на руках: ссылками на сущности. Текстовый owner выше
  -- остаётся для записей, которым не соответствует ни одна сущность.
  location_id INTEGER REFERENCES setting_locations(id) ON DELETE SET NULL,
  owner_type TEXT, -- being | community
  owner_id INTEGER,
  avatar_image_path TEXT,
  file_path TEXT,
  folder_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

-- "Приключения": prepared story content owned by a setting. An arc is one
-- adventure / storyline / chapter of an imported book (nested via parent_id,
-- so "Синий Переулок → Глава 2" works), holding an ordered list of scenes.
CREATE TABLE IF NOT EXISTS story_arcs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE,
  -- Copy-on-write campaign layer, exactly as story_scenes has it below: a row
  -- with campaign_id set and source_arc_id pointing at the setting's original
  -- is that campaign's own version of the adventure's (or chapter's) texts.
  -- Cloning an arc never clones its children: a chapter gets its own copy only
  -- when that chapter is edited.
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  source_arc_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'adventure', -- adventure | chapter
  description TEXT NOT NULL DEFAULT '',   -- синопсис
  hook TEXT NOT NULL DEFAULT '',          -- завязка: как партия сюда попадает
  recommended_level TEXT NOT NULL DEFAULT '',
  player_count TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',        -- книга/автор/страницы, заполняет импортёр
  tags TEXT NOT NULL DEFAULT '',
  thumbnail_image_path TEXT,
  -- Each setting gets exactly one auto-created "Сцены вне приключений"
  -- bucket, so a scene never has to live outside an adventure. It can't be
  -- renamed or archived.
  is_default INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_story_arcs_setting ON story_arcs(setting_id);

-- Какие приключения сеттинга входят в эту кампанию. Без этой связи кампания
-- видела все приключения сеттинга сразу, и сеттинг с тремя импортированными
-- книгами превращал разделы кампании в свалку из чужих глав. Автоматическое
-- «Сцены вне приключений» сюда не попадает: оно есть у кампании всегда.
CREATE TABLE IF NOT EXISTS campaign_adventures (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  arc_id INTEGER NOT NULL REFERENCES story_arcs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (campaign_id, arc_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_adventures_arc ON campaign_adventures(arc_id);

-- A scene is the unit the GM actually runs. Two rows can describe the same
-- scene: the setting's original (campaign_id IS NULL, source_scene_id IS
-- NULL) and a campaign's copy-on-write override (campaign_id set,
-- source_scene_id pointing at the original). A campaign's list is built by
-- taking the setting's scenes and swapping in any override that exists; the
-- copy is only created on the first edit made inside that campaign, and
-- deleting it restores the original. A row with campaign_id set and
-- source_scene_id NULL is a scene invented inside that campaign, which never
-- appears in the setting.
--
-- Полка заготовок («Заготовки») живёт этими же строками, двумя колонками:
--
--   in_library = 1        — сцена лежит на полке и предлагается к вставке.
--                           Ставится галочкой на ЛЮБОЙ сцене, в том числе
--                           стоящей внутри приключения: переиспользуемость
--                           обнаруживается задним числом.
--   library_scene_id      — эта строка есть ВСТАВКА такой заготовки. У неё
--                           своё место в приключении и свой порядок, но нет
--                           своих текстов: пока не тронули, показывается
--                           содержимое заготовки. Первая правка копирует
--                           содержимое внутрь и обнуляет колонку.
--
-- Почему это НЕ source_scene_id, хотя механика «отвязки при первой правке»
-- та же: связи разного направления. Переопределение кампании — копия вперёд
-- (у копии есть свои тексты, оригинал цел, показ подменяет одно другим).
-- Вставка — чтение назад (у строки текстов нет, она смотрит в заготовку).
-- Одна колонка на две разные связи означала бы, что копия кампании,
-- сделанная поверх вставки, неотличима от самой вставки.
--
-- setting_id необязателен НАМЕРЕННО: у заготовки сеттинг — это метка «где
-- написана», а не владелец (тот же уговор, что у sound_sets). Удаление
-- сеттинга уносит его обычные сцены каскадом, а заготовки остаются с пустой
-- меткой — иначе удаление старого сеттинга снесло бы каскадом ещё и вставки
-- в ЧУЖИХ приключениях. Обнуление делает маршрут удаления сеттинга; у
-- обычных сцен каскад работает как работал.
CREATE TABLE IF NOT EXISTS story_scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id INTEGER REFERENCES settings(id) ON DELETE CASCADE,
  arc_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  source_scene_id INTEGER REFERENCES story_scenes(id) ON DELETE CASCADE,
  -- Каскад здесь — подстраховка, а не поведение: удаление заготовки сначала
  -- материализует свои вставки (маршрут DELETE /story/scenes/:id), и до
  -- каскада доходить не должно.
  library_scene_id INTEGER REFERENCES story_scenes(id) ON DELETE CASCADE,
  in_library INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'scene', -- scene | encounter | branch | ending
  summary TEXT NOT NULL DEFAULT '',        -- краткое описание для мастера
  read_aloud TEXT NOT NULL DEFAULT '',     -- текст для зачитывания игрокам
  whats_happening TEXT NOT NULL DEFAULT '',
  entry_condition TEXT NOT NULL DEFAULT '',
  outcomes TEXT NOT NULL DEFAULT '',
  hidden_from_players INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_story_scenes_arc ON story_scenes(arc_id);
CREATE INDEX IF NOT EXISTS idx_story_scenes_campaign ON story_scenes(campaign_id, source_scene_id);
-- Индекса по library_scene_id здесь НЕТ намеренно, хотя он нужен: «покажи все
-- вставки этой заготовки» — запрос удаления и отвязки, а ведущая колонка
-- индекса выше campaign_id. Этот файл выполняется ДО миграций, и на базе,
-- заведённой раньше колонки, CREATE INDEX по ней падает — CREATE TABLE IF NOT
-- EXISTS старую таблицу не трогает. Индекс создаётся в db.ts, рядом с
-- пересборкой таблицы, где колонка уже точно есть.

-- Ability/skill checks a scene calls for. `difficulty` is deliberately free
-- text ("DC 14", "Сложность 2", a PbtA move name) so non-d20 systems fit
-- without a schema change.
CREATE TABLE IF NOT EXISTS story_scene_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_id INTEGER NOT NULL REFERENCES story_scenes(id) ON DELETE CASCADE,
  what TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT '',
  on_success TEXT NOT NULL DEFAULT '',
  on_failure TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_story_scene_checks_scene ON story_scene_checks(scene_id);

-- Loot/rewards available in a scene. artifact_id optionally ties a line to a
-- real entry in the setting's Сокровищница; plain text works without one.
-- Exactly one of scene_id / arc_id is set: loot found in a scene, or a
-- reward granted for the adventure as a whole.
CREATE TABLE IF NOT EXISTS story_scene_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_id INTEGER REFERENCES story_scenes(id) ON DELETE CASCADE,
  arc_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE,
  what TEXT NOT NULL DEFAULT '',
  where_found TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  artifact_id INTEGER REFERENCES artifacts(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_story_scene_rewards_scene ON story_scene_rewards(scene_id);
CREATE INDEX IF NOT EXISTS idx_story_scene_rewards_arc ON story_scene_rewards(arc_id);

-- "Вехи" — ordered story checkpoints of an adventure, optionally tied to the
-- scene that delivers them. Defined once in the setting; whether a campaign
-- has reached one lives in campaign_milestone_state, same split as scenes and
-- their progress.
-- arc_id и campaign_id оба необязательные: веха приключения принадлежит
-- сеттингу (arc_id, campaign_id NULL), а собственная веха кампании несёт
-- campaign_id и может быть либо свободной, либо доложенной в чужое
-- импортированное приключение — тогда у неё заполнены оба.
CREATE TABLE IF NOT EXISTS story_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arc_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  scene_id INTEGER REFERENCES story_scenes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_story_milestones_arc ON story_milestones(arc_id);

CREATE TABLE IF NOT EXISTS campaign_milestone_state (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  milestone_id INTEGER NOT NULL REFERENCES story_milestones(id) ON DELETE CASCADE,
  achieved INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (campaign_id, milestone_id)
);

-- "Тайны и зацепки" of an adventure — the threads/clues/secrets block books
-- usually carry. Reveal state is per campaign, like milestones above.
-- arc_id/campaign_id — как у вех выше. Собственные тайны кампании раньше
-- жили в campaign_entries категории secrets, отдельной моделью без вида и без
-- привязки к приключению; db.ts переносит их сюда разово.
CREATE TABLE IF NOT EXISTS story_secrets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arc_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'secret', -- secret | clue | thread
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_story_secrets_arc ON story_secrets(arc_id);

CREATE TABLE IF NOT EXISTS campaign_secret_state (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  secret_id INTEGER NOT NULL REFERENCES story_secrets(id) ON DELETE CASCADE,
  revealed INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  -- В какой сессии раскрыли. Вычислять по updated_at нельзя: Мастер отмечает
  -- тайны и на следующий день, разбирая записи, и после двух сессий за
  -- выходные — время правки уведёт их не в тот вечер. У раскрытых до
  -- появления колонки она пустая, так и показываем: «раскрыто раньше».
  revealed_session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (campaign_id, secret_id)
);

-- Directed "what can follow what" edges, with the condition as the label
-- ("если убедили стражника"). Drawn as arrows by the future node editor and
-- listed as "Дальше:" in the current UI.
CREATE TABLE IF NOT EXISTS story_scene_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_scene_id INTEGER NOT NULL REFERENCES story_scenes(id) ON DELETE CASCADE,
  to_scene_id INTEGER NOT NULL REFERENCES story_scenes(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE(from_scene_id, to_scene_id, label)
);
CREATE INDEX IF NOT EXISTS idx_story_scene_transitions_from ON story_scene_transitions(from_scene_id);

-- Заготовка вечера: какие сцены Мастер набрал на эту сессию.
--
-- Хранятся именно СЦЕНЫ, а не отметки приключений и глав. Галочка главы в
-- подготовке — просто способ добавить её сцены разом. Разница видна на одном
-- сценарии: отметили главу, потом в приключение добавилась новая сцена — при
-- хранении отметок она молча приедет в подготовленную сессию, которую Мастер
-- не готовил и в глаза не видел.
--
-- Порядка у заготовки нет: это набор, показываемый деревом в порядке самого
-- приключения. Вручную собранная очередь отвергнута — она ломается на первой
-- развилке, а «куда дальше» пульт берёт из переходов.
--
-- На следующую сессию переезжают заготовленные, но НЕ сыгранные: что играли,
-- знает session_scenes.
CREATE TABLE IF NOT EXISTS session_planned_scenes (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  scene_id INTEGER NOT NULL REFERENCES story_scenes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, scene_id)
);
CREATE INDEX IF NOT EXISTS idx_session_planned_scene ON session_planned_scenes(scene_id);

-- Журнал запусков сцен: лента вечера, а не список посещённого. Последняя
-- строка — это «где мы сейчас» (переживает перезагрузку страницы), весь
-- журнал — «что прошли», из чего Мастер одной кнопкой набирает «Основные
-- события сессии».
--
-- Возврат в пройденную сцену пишется НОВОЙ строкой: «таверна → подземелье →
-- таверна» рассказывает про сессию больше, чем «таверна, подземелье».
--
-- Отдельно от campaign_scene_state: та отвечает «пройдено ли это в кампании
-- вообще», эта — «что было в этот вечер и в каком порядке».
CREATE TABLE IF NOT EXISTS session_scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  scene_id INTEGER NOT NULL REFERENCES story_scenes(id) ON DELETE CASCADE,
  launched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_session_scenes_session ON session_scenes(session_id, id);

-- Per-campaign playthrough progress. Kept out of story_scenes on purpose:
-- marking a scene "пройдена" must not spawn a copy-on-write override, which
-- is what writing to the scene row itself would mean.
CREATE TABLE IF NOT EXISTS campaign_scene_state (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  scene_id INTEGER NOT NULL REFERENCES story_scenes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | done | skipped
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (campaign_id, scene_id)
);

-- A бестиарий entry (setting_beings with category='bestiary') can reference
-- monster templates in the compendiums of several systems at once — the same
-- creature kind run under D&D and under another system. Distinct from
-- setting_beings.base_monster_id, which marks "this named personality was
-- cloned from that one template".
CREATE TABLE IF NOT EXISTS being_compendium_links (
  being_id INTEGER NOT NULL REFERENCES setting_beings(id) ON DELETE CASCADE,
  compendium_entry_id INTEGER NOT NULL REFERENCES compendium_entries(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (being_id, compendium_entry_id)
);

CREATE TABLE IF NOT EXISTS artifact_chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS generic_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_type TEXT NOT NULL,
  from_id INTEGER NOT NULL,
  to_type TEXT NOT NULL,
  to_id INTEGER NOT NULL,
  section TEXT, -- optional namespace so the same owner can have several distinct drop-zone lists
  origin TEXT NOT NULL DEFAULT 'planned', -- 'planned' | 'live' (dropped in during the session pult)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_type, from_id, to_type, to_id, section)
);

CREATE TABLE IF NOT EXISTS link_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES generic_links(id) ON DELETE CASCADE,
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Campaign-specific in-world calendar events, created from the campaign's
-- custom calendar tab (right-click on a day) or from the "События" list.
CREATE TABLE IF NOT EXISTS campaign_calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  -- Краткое описание для строки хроники; развёрнутый текст и последствия
  -- живут в профиле события (участники и локации — в общем графе связей).
  description TEXT DEFAULT '',
  full_description TEXT DEFAULT '',
  consequences TEXT DEFAULT '',
  inworld_year INTEGER NOT NULL,
  inworld_month INTEGER NOT NULL,
  inworld_day INTEGER NOT NULL,
  -- Точность даты: century | decade | year | month | day.
  --
  -- Не выбирается из списка — её задаёт масштаб, на котором событие поставили
  -- или перетащили на оси. Бросили на полосу десятилетия — «десятилетие»;
  -- зазумились до дней и подвинули — стало точным до дня. Уточнение и сдвиг —
  -- один жест на разных зумах.
  --
  -- Запись «1492-06-15, точность month» читается как «июнь 1492»; 15-е —
  -- место при сортировке. Отдельного поля «примерно» рядом с точной датой нет:
  -- два поля даты у одной записи дают вопрос «какое из них правда» при каждом
  -- чтении.
  date_precision TEXT NOT NULL DEFAULT 'day',
  -- Конец периода: «осада длилась три месяца». Пусто — событие точечное.
  -- Период и неточность — разные вещи и рисуются по-разному: период сплошной
  -- полосой с засечками, неточность размытой. Неточное событие ждёт
  -- уточнения, а период уже точен и уточнять в нём нечего.
  inworld_year_end INTEGER,
  inworld_month_end INTEGER,
  inworld_day_end INTEGER,
  -- upcoming | happened | cancelled.
  --
  -- «Отменено» нужно и хронике мира: в неё пишут и будущее — пророчество,
  -- затмение, коронацию. Без этого статуса Мастер, помешавший событию, обязан
  -- его удалить и потеряет память о том, что это планировалось и почему не
  -- вышло, — а через месяц вспомнить захочется именно это.
  status TEXT NOT NULL DEFAULT 'happened',
  -- Чем ОТМЕНИЛОСЬ: что игроки сделали, чтобы этого не произошло. Чем
  -- отменяется (в отличие от «чем отменилось») отдельным полем не пишется:
  -- это связь, и стрелка от сцены к событию на полотне скажет то же самое, но
  -- переживёт переименование.
  cancel_note TEXT NOT NULL DEFAULT '',
  important INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A being/community can inhabit several locations (and a location can host
-- several beings/communities) — many-to-many, replacing the old single
-- setting_beings.location_id as the source of truth for the UI.
CREATE TABLE IF NOT EXISTS being_locations (
  being_id INTEGER NOT NULL REFERENCES setting_beings(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES setting_locations(id) ON DELETE CASCADE,
  PRIMARY KEY (being_id, location_id)
);

CREATE TABLE IF NOT EXISTS community_locations (
  community_id INTEGER NOT NULL REFERENCES setting_communities(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES setting_locations(id) ON DELETE CASCADE,
  PRIMARY KEY (community_id, location_id)
);

-- Recurring or one-off in-world dates tied to a being or community
-- ("Важные даты") — surfaced on the setting's own calendar preview and on
-- the calendars of every campaign using that setting.
CREATE TABLE IF NOT EXISTS important_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL, -- being | community | location | character
  owner_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'once', -- once | annual | monthly
  year INTEGER,  -- used when recurrence = once
  month INTEGER, -- used when recurrence = once | annual
  day INTEGER NOT NULL,
  source_event_id INTEGER REFERENCES setting_calendar_events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One-off in-world calendar events owned by a setting ("Хроника мира"),
-- created from the setting's own calendar tab. On creation, a copy is
-- inserted into campaign_calendar_events for every campaign currently using
-- this setting, so campaigns can freely edit/delete their own copy without
-- touching this source row (deliberately not linked back — see settings.ts).
CREATE TABLE IF NOT EXISTS setting_calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  -- Краткое описание для строки хроники; развёрнутый текст и последствия
  -- показывает профиль события (участники и локации — в общем графе связей).
  description TEXT DEFAULT '',
  full_description TEXT DEFAULT '',
  consequences TEXT DEFAULT '',
  inworld_year INTEGER NOT NULL,
  inworld_month INTEGER NOT NULL,
  inworld_day INTEGER NOT NULL,
  -- Точность даты: century | decade | year | month | day.
  --
  -- Не выбирается из списка — её задаёт масштаб, на котором событие поставили
  -- или перетащили на оси. Бросили на полосу десятилетия — «десятилетие»;
  -- зазумились до дней и подвинули — стало точным до дня. Уточнение и сдвиг —
  -- один жест на разных зумах.
  --
  -- Запись «1492-06-15, точность month» читается как «июнь 1492»; 15-е —
  -- место при сортировке. Отдельного поля «примерно» рядом с точной датой нет:
  -- два поля даты у одной записи дают вопрос «какое из них правда» при каждом
  -- чтении.
  date_precision TEXT NOT NULL DEFAULT 'day',
  -- Конец периода: «осада длилась три месяца». Пусто — событие точечное.
  -- Период и неточность — разные вещи и рисуются по-разному: период сплошной
  -- полосой с засечками, неточность размытой. Неточное событие ждёт
  -- уточнения, а период уже точен и уточнять в нём нечего.
  inworld_year_end INTEGER,
  inworld_month_end INTEGER,
  inworld_day_end INTEGER,
  -- upcoming | happened | cancelled.
  --
  -- «Отменено» нужно и хронике мира: в неё пишут и будущее — пророчество,
  -- затмение, коронацию. Без этого статуса Мастер, помешавший событию, обязан
  -- его удалить и потеряет память о том, что это планировалось и почему не
  -- вышло, — а через месяц вспомнить захочется именно это.
  status TEXT NOT NULL DEFAULT 'happened',
  -- Чем ОТМЕНИЛОСЬ: что игроки сделали, чтобы этого не произошло. Чем
  -- отменяется (в отличие от «чем отменилось») отдельным полем не пишется:
  -- это связь, и стрелка от сцены к событию на полотне скажет то же самое, но
  -- переживёт переименование.
  cancel_note TEXT NOT NULL DEFAULT '',
  important INTEGER NOT NULL DEFAULT 0,
  visible_to_players INTEGER NOT NULL DEFAULT 0, -- explicit GM reveal, shown via the player sync API
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Large named year ranges ("Эпоха") a GM can define to group the Хроника
-- мира event list by Эпоха > Столетие > Десятилетие > Года > События instead
-- of a flat chronological list. An era spans from its own start_year up to
-- (but not including) the next era's start_year, ordered by start_year — no
-- explicit end_year column, so eras can't overlap or leave gaps by accident.

-- Цикл сеттинга: «каждые N дней, начиная с такой-то даты».
--
-- Обобщённый, а не «луна с фазами». Нынешние повторения
-- (important_dates.recurrence = once | annual | monthly) не покрывают луну с
-- периодом 28 дней в году из 360, а отдельная сущность «луна» стоила бы
-- столько же и покрыла бы только луны. Цикл берёт заодно приливы, ярмарку раз
-- в десять дней, смену стражи и мир с двумя лунами разного периода.
-- Приложению не нужно знать, что такое луна: ему нужно считать «каждые N
-- дней» и подписывать точки.
CREATE TABLE IF NOT EXISTS setting_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  period_days INTEGER NOT NULL,
  -- Дата отсчёта: с неё цикл начинает первый оборот.
  anchor_year INTEGER NOT NULL,
  anchor_month INTEGER NOT NULL,
  anchor_day INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_setting_cycles_setting ON setting_cycles(setting_id);

-- Именованная точка внутри оборота: «полнолуние» на 14-м дне, «новолуние» на
-- 28-м. Необязательна — цикл без точек это просто «каждые N дней».
CREATE TABLE IF NOT EXISTS setting_cycle_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id INTEGER NOT NULL REFERENCES setting_cycles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Смещение в днях от начала оборота, 0 — сам день отсчёта.
  day_offset INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_setting_cycle_points_cycle ON setting_cycle_points(cycle_id);

CREATE TABLE IF NOT EXISTS setting_calendar_eras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_year INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Simple app-wide key/value store (e.g. the "Главная" page background image).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Toggleable "modules": a system or setting that can be imported and later
-- enabled/disabled without losing data (disable = archive the materialized
-- system/setting, enable = restore it or, on first enable, import source_json).
CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL, -- 'system' | 'setting'
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'local', -- 'local' (wraps a pre-existing row) | 'imported' (has source_json)
  source_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL,
  setting_id INTEGER REFERENCES settings(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  remote_id TEXT, -- GitHub catalog manifest.json entry id, if installed from there
  remote_version TEXT -- last installed catalog version, for update-available checks
);

-- Per-system compendium: each system owns an ordered list of sections (tabs),
-- and each section holds compendium_entries. Entries self-reference via
-- parent_id to form hierarchy (Class → subclasses/features). `kind` drives the
-- structured field schema on the frontend; `data` holds type-specific fields
-- as JSON; `level` is promoted to a column because it's a common sort/filter.
CREATE TABLE IF NOT EXISTS system_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'wiki', -- wiki | class | spell | item | species | feat | background | monster
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS compendium_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES system_sections(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES compendium_entries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'wiki',
  name TEXT NOT NULL DEFAULT '',
  level INTEGER,
  data TEXT DEFAULT '{}',
  description TEXT DEFAULT '',
  -- Имена записи, как у сущностей сеттинга: синонимы и оригинальное
  -- (обычно английское) название ищутся наравне с name, короткое имя
  -- подписывает пин на карте локации — записи компендиума на карту
  -- перетаскиваются так же, как существа сеттинга.
  aliases TEXT NOT NULL DEFAULT '[]',
  name_original TEXT NOT NULL DEFAULT '',
  short_name TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- История и Поведение существа бестиария, зеркало being_chapters. Ни
-- campaign_id, ни visible_to_players: шаблон системы к кампании не привязан
-- и игроку не синхронизируется, показывают игрокам существо сеттинга.
CREATE TABLE IF NOT EXISTS compendium_entry_chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES compendium_entries(id) ON DELETE CASCADE,
  section TEXT NOT NULL DEFAULT '', -- history | behavior
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_compendium_entry_chapters_entry
  ON compendium_entry_chapters(entry_id);

-- Polymorphic multi-image gallery for characters, setting_beings, locations,
-- communities, and campaign player-sections (see gallery_images: no FK since
-- owner_type is polymorphic, same pattern as statblocks/important_dates).
CREATE TABLE IF NOT EXISTS gallery_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL, -- 'character' | 'being' | 'location' | 'community' | 'campaign_player_section'
  owner_id INTEGER NOT NULL,
  image_path TEXT NOT NULL,
  caption TEXT DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Custom GM-defined subsections under a campaign's "Для игроков" tab. Each
-- is either a gallery (content = gallery_images rows owned by this section)
-- or an articles list (content = campaign_player_articles rows below).
-- Visibility is granted per-player via player_visibility_grants — creating
-- a section here does not reveal it to anyone.
CREATE TABLE IF NOT EXISTS campaign_player_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'articles', -- gallery | articles
  folder_path TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaign_player_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES campaign_player_sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-player, per-campaign reveal grants backing the "Для игроков" tabs on
-- both campaign and setting profiles. A row means "this player, in this
-- campaign, can see this target". target_type covers both campaign-owned
-- content (campaign_player_section — whole-subsection grant implicitly
-- reveals every article/image under it unless a narrower
-- campaign_player_article grant model is needed later; campaign_player_article
-- for a single-article override) and setting-owned content reused as-is
-- (setting_location, setting_being, setting_community, setting_calendar_event
-- for "История"/Хроника мира). Setting content is granted per campaign since
-- the same setting can be shared by multiple campaigns with different players.
CREATE TABLE IF NOT EXISTS player_visibility_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL, -- campaign_player_section | campaign_player_article | setting_location | setting_being | setting_community | setting_calendar_event
  target_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(campaign_id, player_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_player_visibility_grants_target ON player_visibility_grants(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_player_visibility_grants_campaign_player ON player_visibility_grants(campaign_id, player_id);

-- Player-authored "Исследование мира" journal — simple существо/локация/
-- предмет/событие entries a player creates about what their party has
-- learned in-world. Shared across the whole campaign party (not private per
-- player) — player_id just records who wrote the entry, it's not an access
-- filter. extra_field holds the one kind-specific value: место обитания for
-- being, обитатели for location; unused (empty) for item/event.
CREATE TABLE IF NOT EXISTS world_exploration_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- being | location | item | event
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  extra_field TEXT NOT NULL DEFAULT '',
  avatar_image_path TEXT,
  folder_path TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_world_exploration_entries_campaign ON world_exploration_entries(campaign_id, kind);

-- GM-authored reminder/message shown on a player's Главная in player-app.
-- target_type='player': visible only to that one player. target_type=
-- 'campaign': broadcast to every player in that campaign. Lifecycle is
-- entirely GM-controlled (no per-player dismiss/ack) — deleting the row
-- here removes it for everyone, which is the only way it goes away.
CREATE TABLE IF NOT EXISTS gm_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL, -- player | campaign
  target_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gm_reminders_target ON gm_reminders(target_type, target_id);

-- Initiative tracker rows for the "Пульт сессии" cockpit (replaces the
-- global "Мешок" widget in the search panel while on a session's live
-- page). `id` doubles as the insertion-order tiebreak when sorting.
CREATE TABLE IF NOT EXISTS initiative_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  entity_type TEXT,
  entity_id INTEGER,
  name TEXT NOT NULL,
  dex_modifier INTEGER NOT NULL DEFAULT 0,
  initiative INTEGER,
  max_hp INTEGER,
  current_hp INTEGER,
  temp_hp INTEGER,
  dead INTEGER NOT NULL DEFAULT 0,
  conditions TEXT NOT NULL DEFAULT '[]',
  -- Что это за строка. creature — боец (в том числе вбитый руками, без
  -- entity_type); lair — действие логова, environment — действие окружения,
  -- custom — своё событие Мастера. У трёх последних нет хитов и нечему
  -- умирать, поэтому и колонка своя: пустой entity_type уже занят другим
  -- смыслом — «существо, вбитое руками», а это обычный боец.
  kind TEXT NOT NULL DEFAULT 'creature',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_initiative_entries_session ON initiative_entries(session_id);

-- "Also present in this setting" tags for the global Ресурсы library —
-- separate from a resource's/playlist's single "home" scope, which stays
-- untouched. Not folded into generic_links: that table's NODE_TABLES
-- (links.ts) backs the graph/label-resolution system and doesn't know
-- "playlist" as a node type.
CREATE TABLE IF NOT EXISTS resource_setting_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL, -- 'resource' | 'playlist'
  owner_id INTEGER NOT NULL,
  setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(owner_type, owner_id, setting_id)
);
CREATE INDEX IF NOT EXISTS idx_resource_setting_links_owner ON resource_setting_links(owner_type, owner_id);

-- Content-hash registry backing upload dedup (see services/vaultDedup.ts):
-- every upload that goes through storeDeduped() is hashed, and if the same
-- bytes were already uploaded somewhere else, the new path becomes an NTFS
-- hard link to that existing file instead of a second physical copy — same
-- directory structure/paths as before (nothing else in the app changes),
-- zero extra disk usage, and deleting one entity's copy never breaks
-- another's (the OS keeps the data alive as long as any link remains).
-- `path` is just the most-recently-seen still-existing link for a hash, used
-- as the hardlink source for the next duplicate upload — not a "the" owner.
CREATE TABLE IF NOT EXISTS vault_files (
  hash TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Files moved here (instead of deleted) when a user removes the *last*
-- remaining link to some content (see services/vaultDedup.ts's
-- deleteWithArchiveChoice) and chooses "archive" over "delete forever" —
-- reviewable/restorable from the Archive page's "Файлы" tab.
CREATE TABLE IF NOT EXISTS archived_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_owner_type TEXT NOT NULL,
  original_owner_id INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  archive_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Импорт книги приключений (docs/adventure-import/format.md). Батч — один
-- залитый файл; key_map_json хранит соответствие «ключ модели → тип:id», чтобы
-- второй файл той же книги видел ключи первого, а откат знал, что удалять.
CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ru',
  setting_key TEXT NOT NULL DEFAULT '',
  source_title TEXT NOT NULL DEFAULT '',
  source_part TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  counts_json TEXT NOT NULL DEFAULT '{}',
  key_map_json TEXT NOT NULL DEFAULT '{}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_setting INTEGER NOT NULL DEFAULT 0, -- сеттинг создан этим импортом: откат удалит и его
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Поимённый список созданных строк. Дочерние строки уходят каскадом по FK, но
-- полиморфные generic_links / entity_relations / important_dates каскада не
-- имеют — без этого списка откат был бы гаданием.
CREATE TABLE IF NOT EXISTS import_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  -- Прежнее значение изменённого поля: откат склейки синонимов.
  payload TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_import_records_batch ON import_records(batch_id);

-- ---------------------------------------------------------------- полотно
--
-- Раскладка узлового редактора («Полотно»). Позиция ноды принадлежит холсту,
-- а не сущности, и это не мелочь оформления, а два конкретных требования.
--
-- Первое: одна и та же сцена (или существо, когда полотно поедет дальше
-- приключений) должна лежать сразу на нескольких холстах, каждый раз в своём
-- месте. Колонка на строке сущности даёт ровно одну позицию на всё.
--
-- Второе, и оно серьёзнее: у сцен есть copy-on-write слой кампании
-- (campaign_id + source_scene_id — см. story_scenes выше). Запись координат в
-- саму строку сцены означала бы, что сдвиг ноды мышкой внутри кампании
-- порождает копию сцены: Мастер подвинул квадратик, чтобы не мешал, и молча
-- отвязал сцену от оригинала. Поэтому раскладка живёт на слое сеттинга и
-- copy-on-write не запускает.
--
-- Отсюда же мёртвый задел story_scenes.canvas_x/canvas_y: он рассчитывал на
-- первый вариант и не используется. Убрать его отдельной миграцией, когда
-- полотно поедет в работу.
CREATE TABLE IF NOT EXISTS canvas_boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Пока единственный вид: 'arc' — холст одного приключения. Полиморфно с
  -- прицелом на холсты лора и сессии, поэтому FK нет (как у generic_links).
  scope_type TEXT NOT NULL,
  scope_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(scope_type, scope_id)
);

-- Нода на холсте — это ссылка на реальную запись плюс её место.
--
-- У строки два разных смысла, и это намеренно.
--
-- Ноды СЦЕН выводятся из приключения: холст показывает все его сцены, а
-- строка здесь нужна только чтобы запомнить, куда ноду подвинули. У
-- неподвинутой позиция вычисляется раскладкой по умолчанию, и холст свежего
-- приключения не требует ни одной записи.
--
-- Ноды СУЩНОСТЕЙ и НАБОРОВ выводить не из чего: в приключении на двадцать
-- сцен подцеплено под сотню существ и локаций, и показывать их все значит
-- заставить Мастера расчищать схему вместо того, чтобы её рисовать. Поэтому
-- такая нода существует ровно потому, что её сюда положили, и строка здесь —
-- и есть факт её существования на этом холсте.
--
-- Отсюда же разный смысл удаления: убрать ноду сущности — убрать строку
-- отсюда, и связь «участник сцены» при этом остаётся жить. Связь снимается
-- отсоединением стрелки, а не уборкой квадратика.
CREATE TABLE IF NOT EXISTS canvas_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES canvas_boards(id) ON DELETE CASCADE,
  -- scene | being | location | artifact | community | compendium_entry | bundle
  node_type TEXT NOT NULL,
  node_id INTEGER NOT NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(board_id, node_type, node_id)
);
CREATE INDEX IF NOT EXISTS idx_canvas_nodes_board ON canvas_nodes(board_id);

-- Рамка главы на холсте приключения: своя нода-группа, а не обводка по
-- содержимому. Обводка обошлась бы без хранения, но переставить главу местами
-- значило бы выделить и не промахнувшись перетащить четырнадцать нод — а
-- переставлять их хочется сразу после переезда.
--
-- Хранится один прямоугольник на главу. Сцены внутри держат СВОИ координаты в
-- системе холста, а не относительно рамки: иначе перетаскивание сцены из
-- главы в главу пересчитывало бы её место, и она бы прыгала.
CREATE TABLE IF NOT EXISTS canvas_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES canvas_boards(id) ON DELETE CASCADE,
  arc_id INTEGER NOT NULL REFERENCES story_arcs(id) ON DELETE CASCADE,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  w REAL NOT NULL DEFAULT 320,
  h REAL NOT NULL DEFAULT 240,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(board_id, arc_id)
);

-- Набор — универсальный объединитель узлового редактора: своё имя, внутри
-- перечисление сущностей с количеством, один выход. Отряд гоблинов, связка
-- ключей, три двери подземелья.
--
-- Типизируется содержимым: что положили первым, того набор и есть. Набор
-- существ втыкается только во вход «участники», набор предметов — только в
-- «предметы». Без этого правила универсальный объединитель ломает то, ради
-- чего у сцены три отдельных входа.
--
-- Своей записью, а не при полотне: поэтому переносится между полотнами и
-- уезжает с экспортом приключения на тех же условиях, что сцена — едет
-- структура, привязки едут ссылками.
--
-- Переиспользуется по правилу заготовки, той же парой колонок, что у сцены:
-- in_library — лежит на полке; library_bundle_id — эта строка есть вставка
-- такого набора и следует за ним, пока её не тронули. Правило одно на весь
-- редактор: две несовместимые механики переиспользования гарантируют вопрос
-- «почему тут правка разошлась, а тут разъехалась».
-- uid у набора нет намеренно, хотя экспорт его потребует: список UID_TABLES в
-- db.ts обязан совпадать с MENTIONABLE, а набор не упоминается в текстах.
-- Заводить колонку впрок — это ровно тот мёртвый задел, каким оказались
-- story_scenes.canvas_x/canvas_y; добавится, когда наборы поедут в экспорт.
CREATE TABLE IF NOT EXISTS canvas_bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  -- being | artifact | location | compendium_entry — вид содержимого.
  -- Пусто у пустого набора: он ещё ничем не стал.
  content_type TEXT,
  library_bundle_id INTEGER REFERENCES canvas_bundles(id) ON DELETE CASCADE,
  in_library INTEGER NOT NULL DEFAULT 0,
  -- Метка «где заведён», а не владение — как у заготовки и у наборов пульта
  -- звука. Удаление сеттинга набор переживает.
  setting_id INTEGER REFERENCES settings(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_canvas_bundles_library ON canvas_bundles(library_bundle_id);

-- Сколько именно: «4», «1к6», «2к4+1».
--
-- Свойство СВЯЗИ, а не существа: в одной сцене гоблинов четверо, в другой
-- 1к6, а гоблин один и тот же. Спутник, а не колонка в generic_links: та
-- держит на себе всё приложение, и колонка, осмысленная в одной секции из
-- двадцати, через полгода никем не удаляется.
--
-- Один ключ — строка generic_links, поэтому таблица обслуживает разом состав
-- сцены (scene_participants) и состав набора (from_type = 'bundle').
CREATE TABLE IF NOT EXISTS link_cast (
  link_id INTEGER PRIMARY KEY REFERENCES generic_links(id) ON DELETE CASCADE,
  -- Свободная строка на входе, разбирается как бросок при показе: что не
  -- разобралось, показывается текстом и в инициативу не размножается.
  qty TEXT NOT NULL DEFAULT ''
);

-- Исходы проверки. Раньше это были два текстовых поля story_scene_checks
-- .on_success/.on_failure, и ветвление подземелья было спрятано внутри
-- строки: «провалил — попадает в яму» читается человеком, но не рисуется
-- схемой и не переживает переименования ямы.
--
-- Число исходов задаёт система, а не программа: в D&D их два, в Legends in
-- the Mist три, в Daggerheart четыре. Поэтому список свободный — по два
-- («Успех», «Провал») при создании проверки, дальше Мастер добавляет и
-- переименовывает. Прибитые четыре означали бы две вечно пустые дырки в
-- каждой d20-проверке, а Мастер начал бы их чем-то заполнять просто потому,
-- что они есть. Тот же довод, по которому difficulty оставлен свободным
-- текстом.
--
-- Полей два, а не одно. Подпись (`label`) — имя разъёма, короткое, его видно
-- на схеме. Последствие (`consequence`) — что при этом происходит, словами.
-- Слить их в одно значило бы либо потерять существующие тексты при переносе,
-- либо подписывать разъём абзацем.
--
-- target_type/target_id — необязательная связь: куда ведёт этот исход. Пока
-- это сцена (тогда исход рисуется ребром на холсте приключения); поле
-- полиморфное с прицелом на награду, артефакт и событие. FK нет по той же
-- причине, что у generic_links.
--
-- Входов у проверки нет намеренно: если у ноды стрелки сходятся с обеих
-- сторон, схема читается медленнее текста, ради которого её и рисовали.
-- Общее последствие на несколько проверок выражается тем, что несколько
-- исходов ведут в одну ноду.
CREATE TABLE IF NOT EXISTS story_check_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id INTEGER NOT NULL REFERENCES story_scene_checks(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  consequence TEXT NOT NULL DEFAULT '',
  target_type TEXT,
  target_id INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_story_check_outcomes_check ON story_check_outcomes(check_id);
