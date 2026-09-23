# SoyMan_1shot — технический аудит текущего состояния

Дата: 2026-09-21. Все пути — относительно корня репозитория (`E:\Claude\01_Blender`).
Метод: чтение кода → вывод. Проверено прогоном: `npm test` — 15/15 pass,
`tsc -p tsconfig.json` — exit 0, `GET http://127.0.0.1:4318/` после `npm start` — 200.

Легенда пометок: **Факт** — прямо видно в коде; **Вывод** — следует из кода;
**Предположение** — прямо помечено, используется только при невозможности установить иначе.

---

## 1. Executive summary

1. **Факт.** `SoyMan_1shot` — бессерверный сайт (визард + лист D&D 5.5), переиспользующий
   настоящие компоненты большого SoyMan из `client/src/components/dnd/`
   (`DndCharacterWizard`, `DndLevelUpWizard`, `DndCharacterView`), общие типы/расчёты
   из `shared/src/dnd/`, React/Query/Router/CSS из `client/`.
2. **Факт.** Собственный код 1shot — тонкий слой: `app/main.tsx` (169 строк, главная + шелл),
   `app/repository.ts` (65 строк, IndexedDB), `app/transport.ts` (56 строк, эмуляция API),
   `app/catalog.mjs` (валидация справочника), `app/export-audit.mjs` + `app/portable.mjs`
   (срез экспорта + автономный HTML), `app/standalone.tsx` + `app/standalone-transport.ts`
   (рантайм внутри HTML), скрипты `prepare-catalog.mjs` / `build-standalone.mjs` / `package-server.mjs`.
3. **Факт.** Своих `dependencies` у 1shot нет (`package.json`: только scripts);
   всё собирается из `../client/node_modules`. Отдельная установка не нужна и невозможна.
4. **Факт.** Бэкенда нет. Персистентность — IndexedDB `soyman-1shot-characters` v1,
   три стора без индексов и миграций: `characters`, `catalogs`, `settings`.
5. **Факт.** Модель персонажа — `DndCharacterData` (`shared/src/dnd/types.ts:97-272`).
   Schema version нет; барьер совместимости — `normalizeDndCharacter` (`shared/src/dnd/normalize.ts`).
6. **Факт.** Запись персонажа 1shot: `{id, name, content: DndCharacterData|null, portrait, catalogKey, revision}`.
   `content==null` = черновик (визард не завершён). `catalogKey` = pin версии справочника.
7. **Факт.** Визард — 12 фиксированных шагов (`DndCharacterWizard.tsx:71-84`), пишет результат
   одним `POST /statblocks`; черновик — `localStorage` (`dnd-wizard-draft:ownerType:ownerId`),
   прерываемый/продолжаемый. Level-up — отдельный компонент с динамическими шагами,
   состояние только в `useState`, коммит одним `onApply(patch)`, черновика нет.
8. **Факт.** Лист — один `DndCharacterView` на mobile и desktop (ветвление `useIsMobile()`,
   8 вкладок `DND_VIEW_TABS`). Игровые действия идут через `onQuickUpdate(patch)` наружу;
   в 1shot патч складывается в IndexedDB через очередь с read-check-write по `revision`.
9. **Факт.** Расчёты (`shared/src/dnd/derive.ts: deriveSheet`, `armorClass.ts`, `abilities.ts`,
   `equipment.ts`, ...) — чистые функции `DndCharacterData → Sheet{value, parts[]}`.
   Хранимые `proficiencyBonus/armorClass/initiative` — legacy, расчётами не читаются.
10. **Факт.** Транспорт подменяет `client/src/api/client.ts` через Vite `resolveId`
    (dev: `app/transport.ts`, HTML-сборка: `app/standalone-transport.ts`).
    Поддержаны только чтения каталога + `POST /statblocks` (создание листа) +
    `POST /characters/:id/avatar`. Любой `PUT`, `DELETE`, инбокс, кампании — throw.
11. **Факт.** Справочник в поставку не входит (`private/` в `.gitignore`); пользователь
    подключает его сам (JSON-импорт / `/__local/catalog` в dev / `/catalog.json` на сервере).
    Локальный `private/catalog.json` на машине аудита — **~130 МБ** (base64-аватарки).
12. **Факт.** Экспортов два: JSON-бэкап `soyman-1shot-backup v1` (персонаж + **весь** справочник,
    обратно импортируется) и автономный HTML `soyman-1shot-portable v1` (персонаж + **срез**
    записей, self-contained, CSP `connect-src 'none'`, ~4.1 МБ шаблон). Импорта HTML обратно нет.
13. **Факт.** PWA/офлайн у основного сайта отсутствуют: нет SW, нет manifest-ссылки,
    нет кэширования (DEPLOY.md:5 прямо фиксирует). SW + manifest есть только у лабораторного
    прототипа (`dist/c/:id/`, порт 4317). Автономный HTML офлайн-способен по построению.
14. **Факт.** Мультивкладочность: защита только optimistic concurrency (`revision`,
    compare-and-swap в одной транзакции). Нет BroadcastChannel/storage-событий —
    вторая вкладка не обновляется и узнаёт о конфликте лишь при своей записи.
15. **Факт.** Sync/accounts/identity/sharing/campaign/GM — отсутствуют полностью
    (ни UI, ни заготовок в коде 1shot; `getAuthToken()=null`, `campaignConnected:false`,
    броски отключены `allowDiceRolls:false`). `?character=N` — локальный указатель, не шаринг.
16. **Факт.** Delete/archive/duplicate в UI 1shot отсутствуют (нет ни кнопок, ни кода).
17. **Вывод.** Главный архитектурный риск — нетипизированная, недокументированная зависимость
    от внутренностей `client/`: сигнатуры компонентов, shape `DndRuntimeContext`, набор
    endpoint'ов, формат statblock, `dndCompendium`-шейпы. Изменение client ломает 1shot молча.
18. **Вывод.** Второй риск — `main.tsx` (монолит шелла: загрузка, очередь сохранений, бэкап,
    восстановление, экспорт, аудит, каталог) напрямую знает IndexedDB; слой use-case отсутствует.
19. **Вывод.** Каталог и персонаж связаны через `catalogKey`-pinning без миграций и без очистки
    старых каталогов; персонаж, чей каталог потерян, деградирует до «сырого» листа.
20. **Расхождение с README (Факт).** README описывает lab-прототип и основной сайт как
    взаимозаменяемые, но SW/manifest/installability есть только у lab; README сам это
    признаёт, однако смешивает результаты проверок обеих поставок.

---

## 2. Карта архитектуры

```text
                    ┌─────────────────────────────────────────┐
                    │  ../client (большой SoyMan, reuse as-is) │
                    │  components/dnd/DndCharacterWizard      │
                    │  components/dnd/DndLevelUpWizard        │
                    │  components/dnd/DndCharacterForm        │
                    │   (DndCharacterView, WizardMiniSheet…)  │
                    │  + queryClient, themes, dndPrefs, CSS   │
                    └───────┬──────────────────┬──────────────┘
                            │                  │
                │ импорты               │ API-вызовы
                │ (напрямую)            │ (через шим)
                ▼                       ▼
        ┌───────────────┐   ┌────────────────────────┐
        │ shared/src/dnd│   │ vite resolveId:        │
        │ types         │   │ client/src/api/client  │
        │ normalize     │   │  → transport.ts (dev)  │
        │ derive/calc   │   │  → standalone-         │
        └───────┬───────┘   │     transport.ts (html)│
                │           └───────────┬────────────┘
                ▼                       ▼
        ┌───────────────────────────────────────────┐
        │ SoyMan_1shot/app (тонкий собственный слой) │
        │ main.tsx (шелл) ↔ repository.ts (IDB)      │
        │ catalog.mjs (валидация)                    │
        │ export-audit.mjs → portable.mjs (срез+HTML)│
        │ standalone.tsx (рантайм внутри HTML)       │
        └───────┬───────────────────────┬───────────┘
                ▼                       ▼
     IndexedDB (персонажи,        файлы наружу:
     каталоги, настройки)         backup.json,
                                  OneShot-*.html
```

Граница client↔1shot (§12 детально): пропсы трёх компонентов, shape
`DndRuntimeContext`, ~10 endpoint'ов транспорта, формат statblock `dnd_character`,
шейпы `dndCompendium`, ключ черновика `dnd-wizard-draft:*`, версии React из
`client/node_modules`. Контракт нигде не зафиксирован.

---

## 3. Структура файлов

Карта архитектурно значимых единиц (`→ ответственность → зависит → используют`):

```text
app/main.tsx
→ entry, шелл: главная, очередь сохранений, бэкап/восстановление, экспорт HTML,
  аудит экспорта, подключение каталога (3 способа), статус сохранения
→ repository.ts, transport.ts(selectCharacter), catalog.mjs, export-audit.mjs,
  portable.mjs, client-компоненты/хуки/темы/CSS, @shared
→ index.html (точка входа Vite)

app/repository.ts
→ IndexedDB-обёртка: characters/catalogs/settings, revision-CAS, repairSpellLevels
→ @shared/dnd/{types,normalize}, browser IndexedDB
→ main.tsx, transport.ts

app/transport.ts
→ dev-эмуляция server API поверх IndexedDB-каталога + создание листа/аватара
→ repository.ts
→ подставляется вместо client/src/api/client.ts через vite resolveId;
  потребители — все client-компоненты (визард, лист, хуки данных)

app/standalone-transport.ts
→ read-only транспорт поверх JSON-снапшота внутри HTML (post/put/del = throw)
→ #oneshot-payload в DOM
→ подставляется вместо client api при сборке standalone-шаблона

app/standalone.tsx
→ рантайм автономного HTML: лист в памяти + «скачать обновлённую копию»
→ standalone-transport.ts(snapshot), DndCharacterView, normalize

app/catalog.mjs
→ parseCatalog (валидация импорта), repairSpellLevels (DEV-починка кругов)
→ ничего (чистый)
→ prepare-catalog.mjs, main.tsx, package-server.mjs

app/export-audit.mjs
→ инвентаризация ссылок персонажа на каталог (проблемы, внешние ассеты, срез)
→ ничего (чистый)
→ main.tsx (кнопка «Проверить состав»), portable.mjs

app/portable.mjs
→ portablePayload (строгий срез) + renderPortable (подстановка в шаблон)
→ export-audit.mjs
→ main.tsx (exportHtml)

app/index.html → Vite root entry (`/main.tsx`), тема/мета
app/shell.css → собственные стили шелла поверх 6 CSS из client/
app/*.d.mts → типы для .mjs-модулей (см. tsconfig include: ["app"])

prepare-catalog.mjs
→ app.db (read-only) → private/catalog.json (система, секции, записи, preview аватарок)
→ server/config/storages.json, server/node_modules/{better-sqlite3,sharp}, catalog.mjs
→ dev-кнопка через /__local/catalog; вход для --catalog-пакетов

build-standalone.mjs → IIFE-бандл standalone.tsx → generated/standalone-template.html
  (buildStandalone(); инлайн CSS/шрифтов в base64; CSP без сети)
→ vite.config.mjs, app/standalone-transport.ts, client/public (ассеты)
→ run-app.mjs (dev и --build), pretest

package-server.mjs → app-dist + deploy/ + catalog.json + server-config.json → releases/*.tar.gz
run-app.mjs → dev (buildStandalone + createServer :4318) / --build (app-dist)
server.mjs + build.mjs + public/ → LAB-прототип :4317/dist (не основной сайт!)
vite.config.mjs → root app/, publicDir client/public, алиасы @shared/react/*,
  шим client api → transport.ts, dev :4318; build → app-dist/
tsconfig.json → extends client/tsconfig.app.json, paths @shared + типы из client
tests/*.test.mjs → catalog, export-audit, portable, state, export (§17)
deploy/{Caddyfile,compose.yaml,.env.example} + DEPLOY.md → серверная поставка
private/catalog.json → gitignored, ~130 МБ, никогда не копируется в app-dist
```

**Факт.** `public/` 1shot (app.js, sheet.html, state.js, style.css, sw.js 792 байта) —
только lab-прототип. Основной сайт своих public-ассетов не имеет:
`publicDir → ../client/public`.

## 4. Character data model

**Факт.** Источник типов: `shared/src/dnd/types.ts:97-272` (переехал из `client/src/types.ts`
2026-09-10; там остался реэкспорт). Обёртка 1shot — `Character` (`app/repository.ts:5`).

```text
Character (repository.ts:5, persistent, IndexedDB store "characters")
├─ id: number (autoIncrement keyPath)
├─ name: string (имя черновика; после визарда ≈ content.characterName)
├─ content: DndCharacterData | null  ← null = черновик без листа
├─ portrait: string | null (data-URL png/jpeg/webp)
├─ catalogKey: string | null (UUID ключа в store "catalogs"; pin версии правил)
└─ revision: number (optimistic concurrency, +1 на каждую запись)

DndCharacterData (types.ts:97-272; десятки полей, ниже — архитектурно значимые)
├─ systemId: number | null — id системы компендиума (НЕ версия схемы!)
├─ characterName, playerName, classes: DndClassEntry[] (мультикласс = элементы;
│   {classId, className, subclassId, subclassName, level, skillChoiceOptions[],
│   skillChoiceCount, spellcastingAbility}; суммарный уровень = Σ level)
├─ raceId/raceName/raceTypeName, backgroundId/backgroundName/backgroundSkillNames[],
│   alignment, experiencePoints
├─ abilities, savingThrowProfs: Record<Ability,bool>, skillProfs: Record<string,0|1|2>
├─ HP: hitPointMax/hitPointsCurrent/hitPointsTemp/hitPointMaxTemp (string),
│   hitDice ("NкM"), hitDiceUsed, hpLump/hpRolls/hpMiscPerLevel (lump-модель),
│   deathSaveSuccesses/Failures, exhaustion 0–6, concentration
├─ armorClass: string (legacy), initiative: number|null (бросок!), initiativeMisc,
│   speed: string + speeds: DndCreatureSpeed, sensesList, resistances/immunities/...
├─ attacks: DndManualAttack[], equipmentSections[] (снаряжение!), coins {cp..pp},
│   attunementCount/attunementExtra
├─ speciesFeatures/classFeatures/feats/specialAbilities: DndFeature[] (entryId-ссылки),
│   masteredWeapons, proficiencies, cantrips, spellsByLevel[9], spellSlotLevels,
│   spellSlotPips[9], spellSlotsUsed[9], pactSlotsUsed?, spellcasting, spellDcMisc/...
├─ spell state: spellsByLevel (как DndSpellEntry{prepared:0|1|2}), prepared-слоты —
│   часть документа; отдельного runtime-стора нет
├─ resources: resourceUsed/resourceBonus: Record<key,number>; слоты/кости/предметы —
│   тоже поля документа (см. выше)
├─ conditions[] + conditionImmunities[], inspiration, notes (personality/ideals/bonds/flaws)
├─ companions[] (featureEntryId/spellEntryId → чертёж ИЛИ entryId/statblockId → статблок),
│   elixirs?, replicaSchemes/Items?, pinnedActions?(≤3), portraitFocus?
└─ НЕТ: schema version, timestamps (created/updated), metadata, владельца/прав,
   wizard-прогресса, levelup-прогресса (всё это — вне документа)
```

**Факт.** Отдельных wizard/sheet/runtime/levelup-состояний как моделей нет:
визард пишет черновик в `localStorage`, лист и level-up мутируют тот же `DndCharacterData`
через патчи. Разделение «документ vs представление» — только через derived-слой (§8).

**Persistent vs UI state (Факт).** Persistent: `Character` целиком + каталоги + `settings.catalog`
(IDB) + визард-черновик + `dndPrefs.cardBack` (localStorage). UI-only: шаги визарда/level-up,
вкладка листа (`?card=` в URL), очередь/статус сохранения, модалки, `includeLargeCards`,
результат `auditExport`.

## 5. Wizard

**Факт.** `client/src/components/dnd/DndCharacterWizard.tsx` (3275 строк).
Пропсы: `ownerType:"character"|"being", ownerId, ownerName?, ownerPlayerName?, onDone, onCancel,
initialSystemId?`. 1shot вызывает с `ownerType="character", ownerId=<id>, initialSystemId = catalogKey?1:null`
(`main.tsx:163`); `onDone/onCancel` — перезагрузка/назад.

Шаги, порядок фиксирован (`STEPS`, :71-84):
`Личность → Портрет → Класс → Вид → Предыстория → Черта → Характеристики → Навыки →
Заклинания → Досье → Снаряжение → Обзор`.
Навигация: вперёд/назад, клик по пройденным шагам (:2218-2226), счётчик «Шаг N из 12».
Порядок обосцован комментариями (:65-70: навыки после черты/вида, снаряжение предпоследним).

Путь данных до хранилища (Факт):
```text
шаг → локальный state визарда (+ черновик localStorage на каждое изменение, :528)
→ finish() (:1797): emptyDndCharacter()+выборы → recomputeGrantedSpells
→ write.post("/statblocks",{owner_type:"character",owner_id:<id>,
   format:"dnd_character",kind:"full",content:JSON})   ← транспорт 1shot:
   проверка владельца (transport.ts:36-41), parseCharacterContent, saveCharacter(IDB)
→ портрет отдельным POST /characters/:id/avatar (FormData, ≤15МБ) (:1818-1826)
→ clearWizardDraft() → onDone() → location.reload() → лист
```
**Факт.** Character создаётся в IDB заранее (`createCharacter`, content=null, `main.tsx:127`),
визард лишь дописывает первый лист; повторный POST запрещён («Лист уже создан»).
Закрытие (`cancelWizard`, :2135) — confirm, черновик НЕ стирается → «Продолжить создание»
открывает визард снова (`open()`: `setWizard(!c.content)`, `main.tsx:91`).
Полноценного листа во время создания нет; есть `WizardMiniSheet`-превью (:2096) + шаг «Обзор».
Зависимости между выборами есть (порядок шагов, `recomputeGrantedSpells`, пулы навыков);
явный механизм invalidation при смене раннего выбора из кода 1shot не виден —
логика внутри визарда, отдельный аудит не проводился (**не удалось установить** детали).

## 6. Level-up

**Факт.** Отдельный компонент `client/src/components/dnd/DndLevelUpWizard.tsx` (905 строк),
не режим визарда. Пропсы: `value: DndCharacterData, onApply:(patch:Partial<DndCharacterData>)=>void,
onClose`. Вход — цифра уровня в картуше листа (`DndCharacterForm.tsx:11051`),
рендер под `showLevelUp` (:12451); в 1shot `onApply → update() → IDB` (`main.tsx`+`:12451`).

Шаги динамические (:339-346): `Хиты, Новое, [Подкласс?] , [Черта?] , Заклинания, Обзор`;
N→N+1, кап 20; мультикласс — селект `clsIdx` (качается одна строка).
Состояние — только `useState` (класс, hpMode roll/average/manual, ASI, feat, subclass, шаги);
**черновика и localStorage нет** — прерывание = потеря прогресса level-up
(документ при этом untouched — защита по построению).
Коммит — только `finish()` (:386): nextClasses/nextAbilities(+ASI cap 20)/addedFeatures/
hpPatch(legacy vs lump)/feats/cantrips/spellsByLevel/slots → `recomputeGrantedSpells` →
единственный `onApply({...})` → `onClose()`. Истории/предыдущей версии нет.
Resumable level-up: ⚪ отсутствует.

## 7. Sheet

**Факт.** `DndCharacterView` (`client/src/components/dnd/DndCharacterForm.tsx:9434`,
сам файл — 12 000+ строк). Mobile и desktop — **не отдельные реализации**: один компонент,
ветвление `useIsMobile()` → `showDesktopFace` (:9552), проп `compact` (`DndCharacterViewMini`, :7208),
адаптация через `client/src/dnd-sheet.css`. Desktop = расширение mobile, компоненты общие.

Вкладки (`DND_VIEW_TABS`, :5619): `Карта, Действия, Магия, Снаряжение, Навыки, Особенности,
Досье, Ресурсы`; `syncTabToUrl` держит вкладку в `?card=` (:9484). Пропсы:
`value, portraitUrl?, compact?, onQuickUpdate?, syncTabToUrl?, campaignId?, ownerCharacterId?,
onSheetBack?, onPortraitRefresh?` (:9434-9477).

**Факт.** Лист читает `value: DndCharacterData` напрямую + добирает живые записи каталога
(`sheetEntryIds → useCompendiumEntries → GET /systems/entries/:id и /batch`, кэш
`entryCache.ts`, мёртвые ссылки `deadLinks.ts`). Отдельных selectors/adapters/view models нет;
ближайший аналог — `Sheet/Derived/Part` из `derive.ts` (§8).

Игровые действия → `onQuickUpdate(patch)` (внутри компонента сетевых записей нет):
`HpEditModal` (урон/лечение/временные/отдых → `hitPointsCurrent/hitPointsTemp/hitPointMax`),
пипсы слотов (`spellSlotsUsed[]`, `pactSlotsUsed`), возврат отдыхом, пипсы ресурсов
(`resourceUsed`), спасброски смерти, концентрация, инициатива, `manualAcBonus`,
снаряжение/реплики. В 1shot каждый патч — `update()` → очередь → `saveCharacter` (IDB);
в большой аппке — `quickSaveDnd` → debounce → `PUT /statblocks/:id`
(который транспорт 1shot **не поддерживает** — но 1shot этот путь и не использует).

## 8. Derived calculations

**Факт.** Центр — `shared/src/dnd/derive.ts`: `deriveSheet(c): Sheet` (:346-447) возвращает
`{level, proficiencyBonus, abilityModifiers, saves, skills, armorClass, initiative(бонус),
maxHitPoints, passivePerception/Insight/Investigation, exhaustionPenalty, walkSpeed,
carryCapacity, spellcasting:{ability,saveDc,attackBonus}|null}`.
Каждое число — `{value, parts: Part[]}` + флаг `stale`. Опоры:
`abilities.ts` (мод `floor((s-10)/2)`, `totalCharacterLevel`, proficiency, закл. характеристика),
`armorClass.ts` (`computeArmorClass`: 10+Лов / лучший доспех+cap+щит+бонусы; `unarmoredDefenseBonus`
Монах/Варвар), `equipment.ts` (carry `str×15×2^n`, `equipmentMetaFromEntry` — снимок для расчётов
без сети), `skillCatalog.ts` (18 навыков, resolve рус→англ ключей), `effects.ts` (строки урона/СЛ),
`creature.ts` (скорость), `normalize.ts` (совместимость старых форм).

```text
raw Character (DndCharacterData)
→ deriveSheet() + computeArmorClass() + abilityModifier() + ...   (чистые, синхронные)
→ Sheet{value, parts[], stale?} → DndCharacterView
```

**Факт.** Хранимые `proficiencyBonus/armorClass/initiative` — legacy/stale-фолбэки,
расчётами **не читаются** (исторически молча устаревали). Сейвы/скиллы: мод+владение/экспертиза−истощение;
СЛ заклинаний `8+мод+БМ+spellDcMisc`; скорость `walk−5×истощение`.
**Вывод.** Character Document от представления отделён хорошо: документ — сырые поля + entryId-ссылки,
всё отображаемое считается; `stale` честно маркирует деградацию. 1shot напрямую импортирует
из расчётов ничего (только типы + normalize); всё идёт транзитивно через `DndCharacterView`/визард.

## 9. Persistence

**Факт.** `app/repository.ts` (65 строк). БД `soyman-1shot-characters`, version 1, апгрейд создаёт
3 стора; **миграций нет** (нечего мигрировать — версия единственная).
Ключи/индексы: `characters` — `keyPath:id, autoIncrement`; `catalogs` — произвольный ключ
(фактически UUID); `settings` — строковые ключи. Индексов нет. Транзакции: одиночные
`operation()` + одна ручная read-modify-write транзакция в `saveCharacter`.

- `characters`: `Character` (§4). Revision — per character, +1 на запись, CAS в одной
  транзакции: несовпадение → abort + «Персонаж изменён в другом окне...».
  Autosave: очередь промисов в `main.tsx:115-122` (без debounce — каждый патч в очередь),
  индикатор статуса, `beforeunload`-гард при `pending/failed`. Recovery: ручное —
  «Скачайте резервную копию» при `failed`; авторетраев нет. Синхронизации вкладок нет
  (нет BroadcastChannel/storage-событий — проверено поиском по `app/`).
- `catalogs`: `{system, sections[], entries[]}`, ключ UUID (`saveCatalog`), **очистки старых нет** —
  каждый импорт/восстановление = +1 запись ~МБ–сотни МБ. Versioning — только pinning через
  `catalogKey` персонажа; версий схемы каталога нет.
- `settings`: только `catalog` → текущий ключ (через `currentCatalog()`).
- Прочее: `localStorage` — черновики визарда + `dndPrefs` (рубашка карт);
  Cache Storage — нет; cookies — нет.

## 10. Transport

**Факт.** Механизм: `vite.config.mjs:11-14` — плагин `oneshot-local-transport` (`enforce:pre`,
`resolveId`): любой относительный импорт, резолвящийся в
`../client/src/api/client.ts`, заменяется на `app/transport.ts`. Единое состояние
выбранного персонажа/каталога — через `globalThis.__oneShotTransportState`
(комментарий :2-4: две копии модуля в dev/prod-сборках). Сборка HTML использует
`app/standalone-transport.ts` (подмена в `build-standalone.mjs:11-15`).

Эмулируемые endpoint'ы (dev-транспорт; в скобках — кто зовёт → источник → ответ):

```text
GET /systems → визард/лист (системы) → catalog.system или [] → [{id:1,name,code:'dnd55'}]
GET /systems/:id → то же → catalog.system
GET /systems/:id/sections → визард/лист → catalog.sections → [...]
GET /systems/:id/entries[?section_id][?parent_id] → списки выбора → фильтр entries → [...]
GET /systems/entries/batch?ids= → useCompendiumEntries → фильтр по ids → [...]
GET /systems/entries/:id → карточки/лист → поиск по id → entry+avatar(full) или throw
GET /statblocks → визард (проверка «лист уже создан») → character.content → [statblock]
GET /search → [] ; GET /player/characters/:id/inbox → [] (заглушки)
POST /statblocks → finish() визарда → строгая проверка владельца + saveCharacter(IDB)
POST /characters/:id/avatar → загрузка портрета → PNG/JPEG/WebP ≤15МБ → data-URL в IDB
PUT * / DELETE * / остальное → throw «пока недоступно»
```

**Факт.** Fake-auth: `getAuthToken()=null`, сеттеры — no-op. Standalone-транспорт —
только `get` по снапшоту каталога (нет `/statblocks`, нет inbox), `post/put/del = unavailable()`.
Граница client↔infrastructure: всё, что выше `api.*`, — настоящий SoyMan; всё ниже —
`transport.ts` + `repository.ts` + IndexedDB (dev) или JSON-снапшот (HTML).
**Вывод.** Любой новый запрос из client-компонентов (PUT-сохранения, метки/сглаз
`POST /player/.../mark`, трансферы, кампании) падает в красный UI-баннер —
это и есть наблюдаемая граница покрытия.

## 11. Catalog

**Формат (Факт).** `Catalog = {system:{id:1,name,code:'dnd55',description}, sections[],
entries[]}` — без metadata, без версий, без подписей. Entry: `{id, system_id:1, section_id,
parent_id, name, name_original, aliases[], kind, level, position, data(произвольный объект),
description, avatar_preview_url, avatar_large_url}`. Лимиты `parseCatalog`
(`app/catalog.mjs:10-30`): только D&D 5.5 (имя/code), ≤50 000 записей, ≤1 000 секций,
целые уникальные id, секции существуют, родители существуют, `data` — объект.
Dev-починка `repairSpellLevels`: только `level` заклинаний, только в DEV, только из
`/__local/catalog`, с обратной записью в IDB.

**prepare-catalog.mjs (Факт).** Читает `server/config/storages.json` → активное хранилище →
`app.db` read-only: `systems` (D&D 5.5: code phb/dnd55), `system_sections`, `compendium_entries`
(все колонки incl. `data/aliases/description/avatar_image_path`). Исключает: персонажей,
кампании, аккаунты — только система. Преобразует: JSON-парсинг `data/aliases`, аватарки →
`avatar_large_url` (оригинал base64) + `avatar_preview_url` (WebP ≤320px, sharp).
Пишет `private/catalog.json` (факт на машине: ~130 МБ). Персонажи/кампании не копируются.

**Способы загрузки (Факт, `main.tsx:156-158,78-88`).** (1) JSON-импорт файлом (validate→save→reload);
(2) dev-кнопка `/__local/catalog` (нужен事先 `prepare-catalog.mjs`); (3) серверный
`/catalog.json` + флаг `/server-config.json` (только non-DEV). Других нет.

**Привязка (Факт).** Персонаж хранит `catalogKey`; несколько каталогов сосуществуют
(каждый импорт — новая запись); текущий — `settings.catalog` — только для **новых**
персонажей; старый персонаж после нового импорта не меняется (pinning).
Миграций персонажа между каталогами нет. Удаления каталога нет ни в UI, ни в коде —
потерянный каталог = персонаж без правил (деградация, не падение).

## 12. Import / export

**Факт.** Формата ровно два (+ restore как подвид backup):

```text
soyman-1shot-backup v1 (main.tsx:132-139,160)
→ {format, version:1, character:{...Character, revision}, catalog: ВЕСЬ каталог}
→ импорт обратно: ДА (validate → parseCharacterContent → новый id + saveCatalog) 
→ сохраняет catalog: ДА (целиком) | runtime: ДА (это и есть документ)
  wizard/levelup-progress: НЕТ (черновики не входят)

soyman-1shot-portable v1 (portable.mjs:2-35, standalone-рантайм standalone.tsx)
→ {format, version:1, exportedAt, character:{name, content, portrait}, catalog:{срез}}
→ импорт обратно в сайт: НЕТ; «импорт» = открыть HTML и играть в нём
→ catalog: СРЕЗ (только связанные+common rules) | runtime: ДА (живой лист в памяти)
→ уровень/HP меняются; сохранение = скачать обновлённую копию (перезапись payload)
→ исходный Character object: ДА (content целиком); Catalog: срез (+common rules)
```

**Факт.** HTML self-contained: инлайн JS (IIFE, 189 модулей) + CSS + шрифты/WebP/SVG
в base64; снаружи — только `data:`/`blob:`; CSP `default-src 'none'; connect-src 'none'`.
Работает через `file://` (тест `export.test.mjs` грузит без сети — 6 c).
Строгость: `portablePayload` падает при проблемах аудита/внешних картинках/шаблонах
спутников без чертежа/статблоках бестиария. Портрет — только data-URL.
PDF — нет. Импорта/экспорта в основной SoyMan — нет (форматы несовместимы со statblock-API:
совместим лишь `content` как `DndCharacterData`; конвертеров/адаптеров нет).

## 13. Offline / PWA

**Факт.** Основной сайт: manifest не подключён (`index.html` — без link),
Service Worker не регистрируется (поиск по `app/` — ноль), кэш-стратегий нет
(запросы с `cache:no-store` для каталога/конфига). `manifest.json` в `app-dist/` —
мертвый артефакт копирования `client/public`. Lab-прототип (`dist/c/:id/`): manifest
+ `sw.js` на персонажа — единственное PWA-существующее. Workbox — нет нигде.

Сценарии (Факт+Вывод, подтверждает DEPLOY.md:5,53):
- **A (сервер умер после открытия):** открытая страница + IDB работают до перезагрузки;
  Standalone-HTML работает всегда. Гарантированный носитель без сети — только скачанный HTML.
- **B (перезагрузка без сети):** обычный сайт не загрузится (нужны HTML/JS с сервера).
- **C (каталог локален, сети нет):** нового персонажа через сайт создать нельзя
  (сайт не откроется); в уже открытом HTML — только игра существующим.
- **D (сайт обновился, каталог старый):** старые персонажи untouched (pinning);
  новый каталог — повторным подключением, только для новых. Миграций нет.

## 14. Concurrency

**Факт** (`repository.ts:48-60`, `main.tsx:68-76,109-123`). Revision — per character,
старт 0, +1 на каждый `saveCharacter`. CAS: `store.get` → сравнение `revision` →
несовпадение → `tx.abort()` + ошибка «Персонаж изменён в другом окне...».
Очередь записей — цепочка промисов (один IDB-транзакшн за раз в рамках вкладки).

При stale-write UI: `failed=true`, статус «Не сохранено», красный баннер, дальнейшие
записи заблокированы до перезагрузки; `beforeunload`-гард просит скачать копию.
Вторая вкладка **не обновляется** (событий нет) и конфликтует только если пишет позже.
Race: окно между `get` и `put` закрыто транзакцией (атомарно); гонка двух вкладок =
один winner, второй — abort с понятной ошибкой (потеря его несохранённых правок —
руками через бэкап). Два устройства/браузера — полностью независимые вселенные.

## 15. Sync / identity / sharing / archive

**Факт (проверено поиском по `app/` — отсутствуют).** Sync-абстракции, remote-репозитория,
auth (кроме `getAuthToken()=null`), anonymous/device ID, share-ссылок, QR, облачных
бэкапов, кампаний, GM-доступа, ownership/permissions — нет ни в UI, ни заготовками.
`?character=N` открывает локального персонажа с id N (DEPLOY.md:5 — не шаринг).
Delete/archive/restore/duplicate/soft-delete — отсутствуют полностью
(единственный `delete` в коде — удаление полей при экспорте).
Клонирование персонажа возможно лишь обходным путём: бэкап → восстановить (= новый id).
`main.tsx:161`: «Аккаунты и синхронизация ещё в работе» — декларация, не код.

## 16. Build / deployment

```text
dev:            npm start → buildStandalone() (шаблон!) + vite :4318 (Факт: run-app.mjs)
                нужен ../client/node_modules; private/ НЕ нужен, пока не нажата dev-кнопка
production:     npm run build → run-app.mjs --build → buildStandalone + vite build → app-dist/
                (Факт: standalone-template.html ~4.1 МБ копируется в app-dist/)
server-пакет:   node package-server.mjs [--catalog private/catalog.json]
                → build → deploy/ + site/ + README + server-config.json (+catalog.json)
                → releases/soyman-server-<ts>/{dir,.tar.gz} (нужен tar)
                На сервере: только Docker/Caddy; Node/исходники/БД не нужны (DEPLOY.md)
lab:            npm run start:lab / build:lab → :4317 / dist/ (отдельная поставка!)
```

**Факт.** Для публикации статического сайта нужны: `app-dist/` целиком
(+ опционально `catalog.json`, `server-config.json` рядом); размещать в корне домена,
без долгого кэша HTML/JSON (DEPLOY.md:59). `?character=` — client-only, роутинга не надо.
`start.bat` (новый, мой) — локальный запуск dev-режима двойным кликом.

## 17. Tests

**Факт.** 5 файлов `tests/*.test.mjs`, node:test, `pretest` = пересборка шаблона.
Покрытие по областям: catalog (validate/лимиты/родители/preview-spell-level+repair),
export-audit (срез, предки, циклы, внешние ассеты, спутники), portable (срез, rejects,
common rules, XSS через `<`), state (round-trip, счётчики, версии), export
(HTML переоткрывает правки; **полный React-HTML бутается без сети**, ~6 c).
Пробелы: repository/IDB (ноль), transport endpoint'ы (ноль), wizard/level-up flow (ноль),
 derive-расчёты (ноль — они в shared без своих тестов в 1shot), PWA/офлайн (ноль),
 concurrency (ноль), фрагмент `repairSpellLevels` покрыт лишь через catalog-тест.
`npm test` 2026-09-21: 15/15 pass. `tsc -p tsconfig.json`: exit 0.

## 18. Lifecycle персонажа

```text
первый вход → main.tsx:94-108: listCharacters + currentCatalog → главная
→ [каталог: импорт/__local//catalog.json] → saveCatalog → settings.catalog
→ «Создать через визард» → createCharacter(name, catalogKey) [IDB, content=null]
  → /?character=id → open() → selectCharacter → wizard (content==null)
  → 12 шагов (черновик localStorage) → finish → POST /statblocks → IDB revision 0→1
  → reload → DndCharacterView (8 вкладок)
→ игра: HpEditModal/пипсы/слоты → onQuickUpdate → очередь → saveCharacter (rev+1)
→ level-up: цифра уровня → DndLevelUpWizard (useState) → finish → onApply → IDB
→ backup: персонаж + ВЕСЬ каталог → oneshot-<id>.json
→ export: audit → portablePayload(срез) → renderPortable → OneShot-<id>.html
→ HTML: игра в памяти → «Скачать обновлённую копию» (перезапись payload)
→ restore: бэкап → новый id + saveCatalog копии → /?character=<new>
→ delete/archive: ОТСУТСТВУЮТ (тупик жизненного цикла)
```

Каждый переход: UI (главная/лист/визард/HTML) → код выше → меняется `content`/`revision`/
`catalogKey` → сохраняется в IDB (кроме HTML — в файл).

## 19. Feature matrix

| Возможность | Статус | Доказательство |
|---|---|---|
| local-first | ✅ | IDB, сервер не нужен после загрузки |
| immediate draft creation | ✅ | `createCharacter` до визарда, `main.tsx:127` |
| autosave | ✅ | очередь `update()`, `main.tsx:109-123` (без debounce) |
| live preview | ✅ | `WizardMiniSheet`, шаг «Обзор» |
| sheet during creation | ⚪ | только превью, не полный лист |
| completed-step navigation | ✅ | клик по шагам, `DndCharacterWizard.tsx:2218` |
| dependency invalidation | ❓ | порядок шагов есть; явный механизм не установлен |
| catalog pinning | ✅ | `catalogKey`, `transport.ts:8-9` |
| catalog versions/migration | 🟡 | pinning есть; версий схемы и миграций нет |
| offline | 🟡 | только скачанный HTML; сайт — нет |
| PWA | ⚪ | только lab-прототип (`dist/c/:id`) |
| multi-tab revision | 🟡 | CAS есть; синхронизации вкладок нет |
| standalone HTML | ✅ | `portable.mjs`, `build-standalone.mjs` |
| HTML import | ⚪ | только «открыть и играть» |
| JSON backup | ✅ | `soyman-1shot-backup v1`, туда-обратно |
| import в основной SoyMan | ⚪ | конвертеров нет |
| runtime/build separation | ✅ | два транспорта, `define NODE_ENV production` |
| resumable level-up | ⚪ | дроп при закрытии |
| archives | ⚪ | нет |
| sync abstraction | ⚪ | нет даже заготовок |
| device identity | ⚪ | нет |
| sharing | ⚪ | `?character=` локален (DEPLOY.md:5) |

## 20. Архитектурные риски

1. **Незафиксированная зависимость от `client/`.** Доказательства: пропсы 3 компонентов,
   `DndRuntimeContext`, ~10 endpoint'ов, statblock-формат, `dndCompendium`-шейпы,
   ключ `dnd-wizard-draft:*`, версии из `client/node_modules`. Ломается молча.
2. **`main.tsx`-монолит напрямую знает IDB.** 169 строк: загрузка, очередь, бэкап,
   restore, экспорт, аудит, каталог. Слоя use-case нет; тестировать нечего (§17).
3. **Каталоги копятся.** Нет удаления/очистки/GC; каждый импорт — +копия (десятки–сотни МБ).
4. **Потерянный каталог = деградация.** Нет проверки «все персонажи имеют каталог»,
   нет repair/migrate — только DEV-`repairSpellLevels` для одного поля.
5. **Черновик визарда вне транзакций.** `localStorage`-ключ делит неймспейс с большим SoyMan;
   повреждение/переполнение квоты — вне обработки 1shot.
6. **Размер бэкапа.** Бэкап тащит весь каталог (base64-аватары ×2); лимит чтения 256 МБ
   (`main.tsx:140`) при `private/catalog.json` ~130 МБ — запас невелик.
7. **Хрупкость HTML-цепи.** `renderPortable` зависит от маркера `__ONESHOT_PAYLOAD__`
   и DOM-структуры шаблона; `standalone-transport` — от `#oneshot-payload`.
8. **Два «сайта» в одном репо.** Lab (`server.mjs`/`dist`) и основной (`app-dist`)
   делят имя; проверки lab не переносятся (README смешивает).
9. **Нет наблюдаемости.** Ошибка сохранения = красный баннер; логов, диагностики IDB,
   проверки целостности каталога нет.

## 21. Неясности

```text
Не удалось установить:
- Детали invalidation зависимых решений внутри DndCharacterWizard (файл 3275 строк,
  точечно не аудировался).
- TTL/инвалидация entryCache и точный состав useCompendiumEntries (транзитивный слой client).
- Судьба dist/ lab-прототипа: развивать, заморозить или удалить.
- Ожидаемое содержимое server-config.json при dev-запуске (ветка только non-DEV).
- Дедупликация двух копий React при шиме транспорта (комментарий claims globalThis-фикс;
  самостоятельная проверка не проводилась).
Причина: границы задания (только 1shot + точки касания) и объём client-файлов (12k+ строк листа).
```

## 22. Важные файлы для дальнейшего изучения

```text
app/main.tsx, app/repository.ts, app/transport.ts, app/standalone-transport.ts
app/catalog.mjs, app/export-audit.mjs, app/portable.mjs, app/standalone.tsx
vite.config.mjs, build-standalone.mjs, package-server.mjs, prepare-catalog.mjs
../shared/src/dnd/{types,normalize,derive,armorClass,abilities,equipment,skillCatalog,effects}.ts
../client/src/components/dnd/{DndCharacterWizard,DndLevelUpWizard,DndCharacterForm,WizardMiniSheet}.tsx
../client/src/components/dnd/DndRuntime.tsx, ../client/src/data/queryClient.ts
tests/{catalog,export-audit,portable,state,export}.test.mjs, DEPLOY.md, README.md
```

*Конец отчёта. Файлы проекта не изменялись; прогоны: `npm test` 15/15, `tsc` exit 0.*
