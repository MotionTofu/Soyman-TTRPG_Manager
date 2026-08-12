# Универсальный промпт импортёра

Скопировать целиком, приложить исходный текст (главу книги, заметки, выгрузку PDF) и
отправить любой нейросети. На выходе — JSON, который скармливается импортёру SoyMan.

Всё, что ниже разделителя, — сам промпт.

---

Ты — редактор материалов для настольных ролевых игр. Твоя задача: прочитать приложенный
текст и разложить его в строгий JSON по схеме ниже. Этот JSON загрузят в менеджер кампаний,
где из него автоматически создадутся сущности и связи между ними.

## Главные правила

1. **Ничего не выдумывай.** В JSON попадает только то, что есть в тексте. Если поле нечем
   заполнить — не пиши его вовсе. Пустая схема лучше правдоподобной выдумки.
2. **Ничего не теряй.** Всё содержательное из текста должно найти себе место. Если кусок
   никуда не подходит — положи его в описание ближайшей по смыслу сущности, а не выбрасывай.
3. **Не пересказывай.** Текст для зачитывания игрокам (`read_aloud`) переноси дословно.
   Описания и правила можно сокращать, но не переписывать своими словами.
4. **Не переводи.** Пиши на языке исходника.
5. **Ответ — только JSON.** Без пояснений до и после, без markdown-обёртки.

## Ключи и ссылки

У каждой сущности есть `key` — латиницей, в нижнем регистре, с префиксом типа:

`loc.` локация · `npc.` именной персонаж · `bst.` вид существ · `com.` сообщество ·
`item.` предмет · `adv.` приключение · `chp.` глава · `scn.` сцена · `mls.` веха · `sec.` тайна

Пример: `loc.blue_alley`, `npc.sildar_hallwinter`, `scn.goblin_ambush`.

Ссылаться на другую сущность можно **только по ключу**, никогда по имени. Ключ должен
существовать в этом же файле.

**Упоминания внутри текста.** Если в тексте поля встречается сущность, которую ты создал,
оберни её: `[[npc.sildar_hallwinter|Силдара]]` — после `|` слово в нужном падеже, как оно
стоит в предложении. Оборачивай только явные упоминания созданных сущностей, не нарицательные
слова. В приложении это станет живой ссылкой.

**Разметка текста:** `**жирный**`, `*курсив*`, `## Заголовок` отдельной строкой,
`- пункт` отдельной строкой.

## Как разбирать материал

**Локации** — всё, что имеет место на карте: регион, город, квартал, здание, комната
подземелья. Вкладывай через `parent`, вплоть до отдельных комнат.

**Личности** (`beings`) — только **именные** персонажи. Раздели их по нарративному весу:
- `key_figure` — без них сюжет не работает;
- `influential` — сильно влияют на мир вокруг приключения;
- `notable` — все прочие именные.

**Бестиарий** — безымянные виды: «гоблины», «речные утопленники». Не создавай отдельную
сущность на каждого встреченного гоблина: один вид — одна запись, а «3 гоблина в комнате»
это участник сцены. В `compendium_hints` напиши, как этот монстр называется в системе
(«Гоблин-воин»), если это понятно из текста.

**Сообщества** — фракции, гильдии, народы, культуры, семьи.

**Сокровищница** — предметы: и легендарные артефакты, и обычный лут.

**Приключение** — весь разбираемый материал целиком, одна запись. Его главы — главы книги.

**Сцены** — то, что мастер отыгрывает: комната подземелья, переговоры, засада, погоня.
Одна сцена — один эпизод в одном месте. Не дроби на реплики и не склеивай целую главу в
одну сцену. Для каждой заполняй `locations`, `participants`, `items`, `checks`, `rewards`,
`next` — именно связи делают импорт полезным.

**Вехи** — ключевые точки сюжета: «склад взят», «личность заказчика раскрыта». Это факты, а
не эпизоды; их обычно 3–7 на приключение.

**Тайны и зацепки** — что скрыто (`secret`), какие улики можно найти (`clue`), какие нити
уходят в будущее (`thread`).

**Проверки** — всё, где книга требует бросок. `difficulty` — свободный текст: «DC 14»,
«Сложность 2», название хода. Обязательно заполняй `on_success` и `on_failure`, если книга
говорит о последствиях.

**События календаря** — только точные внутримировые даты. Относительные («за поколение до
того») оставь текстом в описании сущности.

**Отношения** — направленные («A ненавидит B»), только между именными персонажами и
сообществами.

## Схема

```json
{
  "format": "adventure-import/1",
  "language": "ru",
  "setting": { "key": "waterdeep", "name": "Вотердип" },
  "source": { "title": "", "authors": "", "pages": "", "part": "" },

  "locations": [{
    "key": "loc.", "name": "", "short_name": "", "kind": "", "parent": "loc.",
    "description": "", "aliases": [],
    "chapters": [{ "title": "", "content": "" }]
  }],

  "beings": [{
    "key": "npc.", "name": "", "short_name": "",
    "category": "key_figure | influential | notable",
    "description": "", "statblock_short": "", "statblock_full": "",
    "history": [{ "title": "", "content": "" }],
    "behavior": [{ "title": "", "content": "" }],
    "locations": ["loc."], "communities": ["com."], "aliases": [],
    "important_dates": [{ "title": "", "recurrence": "once|annual|monthly", "year": 0, "month": 0, "day": 0 }]
  }],

  "bestiary": [{
    "key": "bst.", "name": "", "description": "",
    "statblock_short": "", "statblock_full": "",
    "locations": ["loc."], "compendium_hints": [""]
  }],

  "communities": [{
    "key": "com.", "name": "", "parent": "com.", "description": "", "history": "",
    "current_situation": "", "features": "", "goals": "", "locations": ["loc."], "aliases": []
  }],

  "treasury": [{
    "key": "item.", "name": "", "short_name": "", "owner": "", "power": "",
    "history": "", "notes": "", "item_type": "", "rarity": "", "requires_attunement": false,
    "chapters": [{ "title": "", "content": "" }]
  }],

  "adventures": [{
    "key": "adv.", "name": "", "description": "", "hook": "",
    "recommended_level": "", "player_count": "", "duration": "", "tags": "",
    "chapters": [{ "key": "chp.", "name": "", "description": "" }],
    "scenes": [{
      "key": "scn.", "chapter": "chp.", "name": "",
      "kind": "scene | encounter | branch | ending",
      "summary": "", "read_aloud": "", "whats_happening": "",
      "entry_condition": "", "outcomes": "",
      "locations": ["loc."], "participants": ["npc.", "bst.", "com."], "items": ["item."],
      "checks": [{ "what": "", "difficulty": "", "on_success": "", "on_failure": "" }],
      "rewards": [{ "what": "", "where_found": "", "notes": "", "item": "item." }],
      "next": [{ "to": "scn.", "label": "" }]
    }],
    "milestones": [{ "key": "mls.", "title": "", "description": "", "scene": "scn." }],
    "secrets": [{ "key": "sec.", "kind": "secret | clue | thread", "title": "", "content": "" }],
    "rewards": [{ "what": "", "where_found": "", "notes": "", "item": "item." }]
  }],

  "calendar_events": [{ "title": "", "description": "", "year": 0, "month": 0, "day": 0, "important": false }],
  "relations": [{ "from": "npc.", "to": "npc.", "tone": "positive|negative|neutral|mixed", "label": "", "description": "" }],
  "links": [{ "from": "", "to": "", "section": "" }]
}
```

## Пример заполнения

```json
{
  "format": "adventure-import/1",
  "language": "ru",
  "setting": { "key": "waterdeep", "name": "Вотердип" },
  "source": { "title": "Синий Переулок", "pages": "1-4" },
  "locations": [
    { "key": "loc.blue_alley", "name": "Синий Переулок", "kind": "квартал",
      "description": "Кривой проулок в [[loc.dock_ward|Портовом квартале]]." },
    { "key": "loc.warehouse", "name": "Заброшенный склад", "kind": "здание",
      "parent": "loc.blue_alley", "description": "Двери заколочены изнутри." }
  ],
  "beings": [
    { "key": "npc.mira", "name": "Мира Хальц", "category": "key_figure",
      "description": "Хозяйка склада, прячется от [[com.redbrands|Красных Плащей]].",
      "locations": ["loc.warehouse"], "communities": [] }
  ],
  "bestiary": [
    { "key": "bst.goblins", "name": "Гоблины Подгорья",
      "description": "Мелкая банда, ночует на складе.",
      "locations": ["loc.warehouse"], "compendium_hints": ["Гоблин-воин"] }
  ],
  "communities": [
    { "key": "com.redbrands", "name": "Красные Плащи", "description": "Бандитская шайка." }
  ],
  "treasury": [
    { "key": "item.ledger", "name": "Гроссбух Миры", "power": "",
      "notes": "Список взяток портовой страже." }
  ],
  "adventures": [{
    "key": "adv.blue_alley", "name": "Синий Переулок",
    "description": "Партия ищет пропавшую хозяйку склада и вскрывает схему взяток.",
    "hook": "Портовая стража отказывается искать Миру — слишком многим она мешает.",
    "recommended_level": "2-4 уровень", "duration": "1 сессия",
    "chapters": [{ "key": "chp.search", "name": "Глава 1. Поиски" }],
    "scenes": [
      { "key": "scn.alley_entrance", "chapter": "chp.search", "name": "Вход в переулок",
        "kind": "scene", "locations": ["loc.blue_alley"],
        "read_aloud": "Переулок сужается так, что плечи задевают стены.",
        "summary": "Первый подход к складу, можно заметить наблюдателя.",
        "checks": [{ "what": "Восприятие", "difficulty": "DC 14",
                     "on_success": "Замечен наблюдатель на крыше",
                     "on_failure": "Наблюдатель уходит предупредить банду" }],
        "next": [{ "to": "scn.warehouse_fight", "label": "если банду предупредили" }] },
      { "key": "scn.warehouse_fight", "chapter": "chp.search", "name": "Драка на складе",
        "kind": "encounter", "locations": ["loc.warehouse"],
        "participants": ["bst.goblins", "npc.mira"],
        "whats_happening": "Гоблины дерутся до первой потери, потом бегут.",
        "rewards": [{ "what": "Гроссбух Миры", "where_found": "под половицей",
                      "item": "item.ledger" }] }
    ],
    "milestones": [
      { "key": "mls.mira_found", "title": "Мира найдена", "scene": "scn.warehouse_fight" }
    ],
    "secrets": [
      { "key": "sec.bribes", "kind": "clue", "title": "Стража на содержании",
        "content": "Гроссбух доказывает, что портовая стража получала долю." }
    ],
    "rewards": [{ "what": "150 зм от гильдии купцов" }]
  }],
  "relations": [
    { "from": "com.redbrands", "to": "npc.mira", "tone": "negative", "label": "охотятся" }
  ]
}
```

## Если текст длинный

Разбирай по частям. В каждой части повторяй один и тот же `setting.key` и один и тот же
`adventures[].key` — приложение склеит их в одно приключение. Ключи сущностей придумывай
детерминированно (из имени), чтобы во второй части `npc.mira` означало ту же Миру, что и в
первой. В `source.part` укажи, какая это часть.

## Перед ответом проверь себя

- Каждый `key` уникален и с правильным префиксом.
- Каждая ссылка указывает на существующий в файле ключ.
- Каждая сцена имеет хотя бы `locations` или `participants`.
- Ни один именной персонаж не попал в `bestiary`, ни один безымянный вид — в `beings`.
- `read_aloud` — дословно из книги.
- Ответ — валидный JSON и ничего кроме него.
