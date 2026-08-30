# Done — отчёты о выполненных задачах

Журнал закрытых пунктов `ToDo.md`. Каждая запись — что было, как искали, что поправили, как проверили. При закрытии нового пункта — добавить секцию сюда и пометить `ToDo.md` как `✅ ВЫПОЛНЕНО`.

Шаблон:
```
## ПX.Y — Название — YYYY-MM-DD
- **Проблема:** ...
- **Расследование:** файлы:line, запросы, бэкапы
- **Фикс:** что изменено
- **Проверка:** как убеждаемся, что не вернётся
- **ToDo.md:** строка помечена
```

---

## П0.4 — Счётчик `systems` ушёл в тысячи — 2026-08-30

- **Проблема:** `sqlite_sequence` для `systems` 6924 при `max(id)=6064` и 4 живых системах (drift 860). История по бэкапам: 4252 (14.08) → 4865 → 5257 → 5374 → 5815 → 5895 → 5999 → 6308 → 6448 → 6456 → 6784 → 6924 (28.08). Систему создают 3 места, одно должно было крутиться.

- **Расследование:**
  - `server/data/app.db` — `SELECT seq, max(id), count(*), archived` → `6068/6064/4/0` после ручного сброса 29.08; до сброса `6924` (`app.db.seqreset-20260829-013724.bak`).
  - `rg INSERT INTO systems` → 3 точки: `server/src/db/db.ts:901` сид, `server/src/routes/systems.ts:645` `POST /`, `server/src/routes/systems.ts:850` `importSystemExport`, `server/src/import/systemApply.ts:897`.
  - `server/src/db/schema.sql:18` — `name TEXT NOT NULL UNIQUE`, `AUTOINCREMENT`.
  - `server/src/db/db.ts:900` — флаг `default_systems_seeded` (`app_settings`) замыкает сид, выставлен `2026-08-28 22:33:43`, после него рост остановился (все бэкапы после 29.08 — `6068`).
  - `E:\RPG-Vault\Systems` — 27 пустых папок-сирот `City of Mist-2..8`, `D&D 5.5-2..7`, `Daggerheart-2..8`, `Legend in the Mist-2..8` — по 7 на систему, `Get-ChildItem | Where Name -match '-\d+$'` → 27× 0 файлов.
  - Вывод: `INSERT OR IGNORE` с `AUTOINCREMENT` двигает `sqlite_sequence` даже при игноре дубликата — 4× каждый старт. `systemFolder()` (`server/src/services/filesystem.ts:97` → `freshDir`) звался ДО `INSERT`, поэтому даже игнорируемый `INSERT` оставлял папку `-2`.

- **Фикс:**
  - `server/src/db/db.ts:900` — замена `INSERT OR IGNORE` на `SELECT id WHERE name=?` → `INSERT` только если нет; сид не трогает `seq`.
  - `server/src/routes/systems.ts:640` `POST /` — `INSERT` с `folder_path=""`, затем `systemFolder(name)` + `UPDATE folder_path` — папка только после успеха.
  - `server/src/routes/systems.ts:852` `importSystemExport` — тот же переставленный порядок.
  - Комментарии `П0.4` в коде.

- **Проверка:**
  - `C:\Users\ingva\AppData\Local\Temp\opencode\check_systems.py` → `seq 6064, max 6064, drift 0`.
  - `fix_seq.py` — `UPDATE sqlite_sequence SET seq=max(id)` → `6068→6064`.
  - `Get-ChildItem Systems` — 4 папки осталось (`City of Mist`, `D&D 5.5`, `Daggerheart`, `Legend in the Mist`), 27 удалены `Remove-Item -Recurse`.
  - `npx tsc --noEmit --project server/tsconfig.json` — чисто.
  - `check_seq_backup.py` — после 29.08 все бэкапы `6068`, сейчас `6064`, следующий `INSERT` даст `6065`.

- **ToDo.md:** `ToDo.md:119` помечено `✅ ВЫПОЛНЕНО 2026-08-30` с разбором причины, фикса и уборки.

---

## П0.5 — Каталог модулей отдаёт битые выгрузки — 2026-08-30

- **Проблема:** `soyman-modules` `dnd55.json`/`Set_Phandelver.json` выгружены версией, терявшей главы/связи.
- **Решение владельца:** модули удалены, каталог пуст, новых выгрузок не планируется.
- **ToDo.md:** `ToDo.md:129` помечено `✅ ЗАКРЫТО 2026-08-30 — отложено`, переоткрыть одним прогоном `buildSystemExportData` (`server/src/routes/systems.ts:690`).

---

## П1.1 — Раздел «Здоровье» — 2026-08-30

- **Проблема:** Экран ревизии рядом с настройками отсутствует — половина проверок (`later.md` «приоритетнее прочего») некуда вывести: битые `*_path`, сироты `П0.2`, дрифт `seq` `П0.4`, «каких модулей не хватает».
- **Расследование:** `client/src/pages/StoragesSettingsPage.tsx:11` — единственный экран настроек, `App.tsx:173` маршруты, `AppShell.tsx:51` `GM_NAV_BOTTOM_ITEMS` — место рядом с «Настройки»/«Внешний вид». Сервер: `orphans.ts:81` `sweepOrphans()` (транзакция), `fileHealth.ts:43` `findMissingFiles()`, `filesystem.ts:16` `vaultAbs/Rel`, `PATH_TABLES` 20 таблиц/34 колонки `*_path`, `sqlite_sequence` дрифт, `links.ts:470` `scanBroken` (образец карточки `LinkMaintenanceCard`).
- **Фикс:**
  - `server/src/routes/health.ts` — `GET /api/health/scan` (brokenPaths по `PATH_TABLES` + `findMissingFiles` + dry-run `countOrphans()` + `seqDrift` по `sqlite_sequence`), `POST /health/orphans/clean` → `sweepOrphans()`, `POST /health/seq/reset` → `UPDATE sqlite_sequence SET seq=max(id)`.
  - `server/src/index.ts:62,270` — `healthRouter` на `/api/health` (не конфликтует с `GET /api/health` liveness: `172` точный путь vs `/scan`).
  - `client/src/pages/HealthPage.tsx` — `GET /health/scan` по кнопке, секции: сироты (кнопка убрать), счётчики (кнопка сбросить), битые пути (до 200), пропавшие файлы ресурсов.
  - `client/src/App.tsx:60,177` — `lazy HealthPage`, `Route /health`; `client/src/layout/AppShell.tsx:53` — пункт «Здоровье» в `GM_NAV_BOTTOM_ITEMS` рядом с Настройками.
- **Проверка:** `npx tsc --noEmit` server+client — чисто; `GET /health/scan` возвращает `brokenPathsCount/orphansTotal/seqWorst`, `POST /orphans/clean` и `POST /seq/reset` отрабатывают на живой `app.db` (`seq 6064`).
- **ToDo.md:** `ToDo.md:160` помечено `✅ ВЫПОЛНЕНО 2026-08-30 (MVP + починка)`; дальше — перенести сюда `GET /links/broken`/`dangling` и отчёт «каких модулей не хватает».

---

## П1.2 — Мультивыделение на Полотне — 2026-08-30

- **Проблема:** `Ctrl`+клик заменял выделение вместо добавления — писал `focus` в адрес, эффект `focusParam` сводил к одной ноде.
- **Расследование:** `client/src/pages/CanvasPage.tsx:2426` `appliedFocusRef` + `4962` `onNodeClick` — при `ctrlKey/metaKey` не вызывался `selectOnly` и не писался `focus`.
- **Фикс:** `CanvasPage.tsx:4968` `if(ctrl||meta) return` — React Flow сам переключает `selected` через `onNodesChange`; `2446` `if(appliedFocusRef!==focusParam)` — навязывание выделения только при реальном изменении `focus` (Ш1). Рамкой — уже работало.
- **ToDo.md:** `ToDo.md:171` помечено `✅ ВЫПОЛНЕНО (код)` — в ToDo оставалось открытым по недосмотру.

---

## П1.3 — Свойства существа общая таблица — 2026-08-30

- **Проблема:** `KIND_DEFS` `monster {size,cr}` показывался у 9 существ LitM, где их нет — пустое поле врёт о правилах (`ToDo.md:182`).
- **Фикс минимум:** `compendium.ts:295` `isMonsterFieldVisible` (phb только) + `MonsterDetailPage.tsx:96` `isPhb`, `CompendiumSection.tsx:414` `systemCode` + `EntryNode:1330`, `MonsterSection.tsx:21` скрыты фильтры/сортировки `cr/size`, `MonsterTileGrid.tsx:121` `systemCode` — плитка без `КО` для не-phb. `tsc` чисто.
- **ToDo.md:** `ToDo.md:182` помечено `✅ ВЫПОЛНЕНО 2026-08-30 (фильтр)`.

---

## П2.6 — Оригинальное название и синонимы — 2026-08-30

- **Проблема:** `aliases`/`name_original` есть, поиск ищет, импорт бестиария вклеивал `«Нимблрайт [Nimblewright]»` в `name`, синонимов не было.
- **Шаг 0:** `compendium_entries` 3451, `LIKE '%[%'` 1850, `name_original!=''` 557, `aliases!='[]'` 0 → после миграции `name_original` 2404, brackets осталось 1 (`[Deity]’s` префикс).
- **Фикс:** `server/src/services/compendiumNames.ts` `splitBracketName` (регекс `compendium.ts:428`); `db.ts:2382` миграция `LIKE '%[%' → UPDATE name/name_original` (идемпотентна); `systemApply.ts:386` `splitFields` + `systems.ts:840` `importSystemExport`/`buildSystemExportData:696`/`updateSystemFromExport:1056` фолбэк brackets→колонки + `aliases=[]`; `systemFormat.ts:22` уже умел.
- **Проверка:** `tsc` чисто, `SELECT LIKE '%[%'` → 1, `SELECT name,name_original` — `Амуниция → Ammunition` и т.д.
- **ToDo.md:** `ToDo.md:343` помечено `✅ ВЫПОЛНЕНО 2026-08-30`.

---

## Ранее закрытое (сверено 2026-08-30, пометки добавлены в ToDo.md)

- **П0.1** `admin/admin` — `server/src/services/auth.ts:118` `bootstrapGmAccount` только по `ADMIN_USERNAME/PASSWORD` + флаг `needsSetup` — ПОЧИНЕНО 2026-08-28.
- **П0.2** сироты `compendium_entry` — `server/src/routes/systems.ts:511` каскад + `server/src/services/orphans.ts:23` `sweepOrphans` — ВЫПОЛНЕНО 2026-08-29.
- **П0.3** `backfillResizeImages.ts:56` — `unlinkSync` перед `writeFileSync` — ВЫПОЛНЕНО 2026-08-29.
- **П0.6** токен между окнами — `client/src/api/client.ts:20` `storage` listener — ВЫПОЛНЕНО 2026-08-29.
- **П1.5** нуар `PT Mono` → `Archivo` — `client/src/themes.ts:355` / `client/src/index.css:69` — ВЫПОЛНЕНО 2026-08-29.
- **П1.6** карточки `1px/0px` — `client/src/themes.ts:129,191` + `AppearanceSettingsPage.tsx:235` — ВЫПОЛНЕНО 2026-08-29.
- **П1.7** контраст `muted` 3.57→4.53:1 — `themes.ts:147` + `canvas.css:1121,1215` — ВЫПОЛНЕНО 2026-08-29.
- **П1.8** палитра/поиск 260+260 на 360 — `CanvasPage.tsx:1101,3108,3122` + `canvas.css:387` — ВЫПОЛНЕНО 2026-08-29.
- **П2.1** относительные пути — `filesystem.ts:16` `vaultRel/Abs` + `index.ts:152` `absolutizeVaultPaths` — ВЫПОЛНЕНО (ленивая миграция).
- **П2.2/П2.3** `canvas_groups` — `server/src/db/db.ts:2511` `DROP TABLE` — УСТАРЕЛО/закрыто.
- **П2.5** `Статблоки→Statblocks` — `filesystem.ts:175` — ВЫПОЛНЕНО 2026-08-29.
- **П2.9/10/11/13** — ВЫПОЛНЕНО 2026-08-29.
