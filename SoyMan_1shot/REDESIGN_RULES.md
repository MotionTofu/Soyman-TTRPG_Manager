# SoyMan / OneShot — правила редизайна

## Область действия и приоритет источников

Эти правила — источник визуальных решений для всего `SoyMan_1shot`: Library,
Wizard, Character Sheet, модальных окон и автономного HTML. Общая система
`DESIGN.md` / `docs/design-system-punk-zine.md` остаётся основой для общих
механизмов, доступности и читаемости. Если её тема, палитра или оформление
компонента расходятся с этим документом, внутри OneShot действует этот
документ. Вне OneShot общая система не меняется. Общий компонент получает
OneShot-оформление только через явный scope или opt-in variant; глобальные
селекторы, меняющие остальные экраны SoyMan, не являются целевым решением.

Приоритет при проектировании: реальные функции, данные и ограничения кода →
этот документ → `Redesign_Concepts/Design_Codex_V1.md` как стилистический
ориентир → изображения-концепты. `assets/fantasy-punk/Concept_001.png` —
главный композиционный ориентир desktop Character Sheet. `PC.png` и
`Mobile.png` — вторичные референсы стиля; они не создавались на основе
существующего интерфейса и не задают его структуру или набор функций.
Перевёрстка Library и Wizard разрешена в пределах правил ниже; Sheet
сохраняет текущую информационную архитектуру.

## 1. Общая цель

Новый интерфейс должен ощущаться как сочетание:

**функционального игрового UI + панк-зина + фэнтезийной карточной игры.**

Ключевой принцип:

> Хаос располагается вокруг информации, а не поверх неё.

Интерфейс может быть грубым, печатным, асимметричным и визуально насыщенным, но игровые данные должны считываться мгновенно.

---

# 2. Визуальный язык

Основная палитра:

- тёплая бумага;
- ink / почти чёрный `#171717`;
- acid yellow `#F3FF3A`;
- punk magenta `#FF3E91`.

Дополнительные semantic colors:

- danger — грязный crimson/red;
- success — зелёный;
- info/sync — cyan, использовать экономно.

Не превращать интерфейс в RGB-карнавал.

Обычно в одной локальной композиции:

**ink + один основной кислотный цвет + небольшой вторичный accent.**

---

# 3. Материалы

Основные визуальные материалы:

- бумага;
- печатная краска;
- маркер;
- шариковая ручка;
- грубая типографская печать;
- halftone;
- потёртости;
- небольшие хроматические смещения.

Datamosh — редкий специальный эффект, а не базовая стилистика.

---

# 4. Геометрия

Предпочитать:

- прямоугольные формы;
- срезанные углы;
- неровные рамки;
- hard shadows;
- offset outlines;
- radius примерно `0–4px`.

Не использовать без необходимости:

- большие скругления;
- glassmorphism;
- blur shadows;
- glow;
- SaaS-style pills;
- стерильные карточки.

---

# 5. Порядок проектирования

Редизайн всегда вести **от большого к малому**.

Правильный порядок:

1. layout и крупные визуальные массы;
2. иерархия экрана;
3. повторяемые UI-компоненты;
4. фирменные элементы;
5. микро-декор;
6. animation / hover / polish.

Не строить экран от случайных декоративных ассетов.

Мелкие элементы могут быть придуманы заранее как стилистические ориентиры, но массово внедряются только после формирования крупных поверхностей и системы компонентов.

---

# 6. Крупные поверхности

Сначала определить:

- background страницы;
- основные панели;
- карточки;
- ink-surfaces;
- paper-surfaces;
- hero / feature areas.

Большие поверхности могут использовать крупные текстуры.

Маленькие controls не должны наследовать такой же уровень визуального шума.

Принцип:

> крупная поверхность = материал / texture  
> мелкий control = чистая геометрия + один акцент

---

# 7. Noise budget

Количество декоративного шума зависит от типа контента.

## Почти без шума

- цифры;
- HP;
- AC;
- DC;
- modifiers;
- названия действий;
- названия заклинаний;
- описания;
- поля ввода;
- длинные списки.

## Малый шум

- buttons;
- inputs;
- toggles;
- counters;
- chips.

## Средний шум

- navigation;
- tabs;
- section headings;
- dividers;
- selected states.

## Высокий шум

- portrait framing;
- empty states;
- feature surfaces;
- крупные декоративные области.

Halftone, scribbles и chromatic aberration не накрывают критически важную информацию.

---

# 8. Generated assets

Сгенерированная графика является **skin/decorative layer**, а не основой layout.

Использовать generated assets как:

- textures;
- corners;
- dividers;
- marker strokes;
- halftone overlays;
- decorative frames;
- stickers;
- masks;
- accent elements.

Не использовать изображения как:

- готовую кнопку с текстом;
- фиксированную UI-панель;
- замену HTML-form controls;
- элемент, определяющий размеры layout.

Предпочитать:

- `background-image`;
- `mask-image`;
- `::before`;
- `::after`;
- отдельный decorative layer.

Generated asset не должен влиять на flow документа.

---

# 9. Texture policy

Фоновая бумага должна быть truly seamless.

Для повторяемого page background:

- отдельный seamless tile;
- `background-repeat: repeat`;
- никаких виньеток;
- никаких крупных пятен;
- никаких halftone-углов внутри tile.

Заметные потёртости, halftone и пятна добавляются отдельными overlay-assets.

Не пытаться превращать неподходящий bitmap в seamless texture сложными CSS-масками.

---

# 10. Typography

Использовать несколько ролей.

## Display

Для:

- имени персонажа;
- крупных hero headings;
- важных названий.

## Condensed / interface display

Для:

- tabs;
- section headings;
- labels;
- navigation.

## Читаемый UI font

Для:

- игровой механики;
- описаний;
- таблиц;
- форм;
- чисел.

Handwritten / marker / pen typography использовать только декоративно.

Критически важные данные не должны зависеть от декоративного шрифта.

---

# 11. Tabs и selected states

Selected/active элементы обозначать через:

- marker stroke;
- underline;
- ink inversion;
- небольшую acid surface;
- локальный magenta accent.

Не использовать:

- blue glow;
- generic browser highlight;
- большие rounded pills.

Активное состояние должно быть заметно, но не тяжелее самого контента.

---

# 12. Lists

Actions, Spells, Skills, Inventory и другие плотные списки сохраняют высокую информационную плотность.

Не превращать каждую строку в отдельную карточку.

Допустимы:

- thin ink separators;
- очень мягкий hover;
- selected marker;
- icon cell;
- subtle alternate surface.

Недопустимы:

- shadow card на каждой строке;
- отдельная texture для каждой строки;
- крупные декоративные рамки вокруг каждого элемента.

---

# 13. Inputs

Inputs должны выглядеть как часть Fantasy Punk UI, но оставаться формами.

Базовый язык:

- warm paper;
- ink border;
- минимальный radius;
- ясный focus-state.

Focus:

- acid marker;
- underline;
- небольшой offset.

Не использовать стандартный blue browser focus как финальный дизайн, но accessibility focus должен оставаться очевидным.

---

# 14. Buttons

Основные типы:

## Default
paper + ink border.

## Primary
ink fill + paper text + небольшой acid accent.

## Danger
dirty crimson / dark red.

Danger не должен выглядеть как magenta decorative accent.

## Disabled
приглушённый ink, но текст остаётся читаемым.

Без glass, glow и больших rounded corners.

---

# 15. Halftone

Halftone — структурный декоративный эффект.

Хорошие места:

- края панелей;
- пустые углы;
- границы ink/paper;
- framing;
- selected section.

Плохие места:

- body text;
- значения;
- inputs;
- таблицы;
- длинные списки.

---

# 16. Scribbles, marker, arrows

Использовать экономно.

Scribbles и marker strokes нужны для:

- подчёркивания;
- selected states;
- редких акцентов;
- визуальных связей.

Стрелка используется только если действительно на что-то указывает.

Не заполнять пустое пространство декоративными знаками без функции.

---

# 17. Chromatic aberration

Допустима только на:

- display typography;
- декоративных edges;
- portrait framing;
- special selected elements.

Не использовать на:

- основном тексте;
- цифрах;
- формах;
- механике.

---

# 18. Никаких случайных надписей

Не добавлять:

- случайные цитаты;
- афоризмы;
- lorem-style graffiti;
- псевдо-lore;
- декоративные фразы без продуктовой функции.

Если текст присутствует в интерфейсе, он должен иметь смысл.

Исключение — намеренная функциональная область вроде «Записки от мастера».

---

# 19. Разные экраны имеют разную свободу

## Character Sheet

Структура считается удачной.

Сохранять:

- большую Character Card слева;
- Work Area справа;
- существующую информационную архитектуру;
- высокую плотность данных;
- dice-like elements как фирменный мотив.

Здесь преимущественно **эволюционный redesign**.

Не перестраивать layout без отдельного решения.

## Home / Library

Структура пока не считается финальной.

Можно существенно менять:

- composition;
- card layout;
- Create flow presentation;
- archive/import placement;
- utility blocks;
- информационную колонку.

Здесь допустим полноценный UX/layout redesign.

## Wizard

Структура также может существенно изменяться.

Можно менять:

- progress presentation;
- navigation;
- preview position;
- step layout;
- desktop/mobile composition.

Сохранять:

- существующую логику;
- данные;
- validation;
- resume behavior;
- возможность переходить между доступными шагами.

Не изображать будущие шаги disabled, если приложение позволяет переходить к ним свободно.

---

# 20. Character Sheet intensity

Ориентировочная визуальная интенсивность:

- Home / Library: `7/10`;
- Character Sheet desktop: `5–6/10`;
- Character Sheet mobile during play: `4/10`;
- content artwork / hero illustration: `8/10`.

Чем чаще пользователь взаимодействует с экраном во время игры, тем спокойнее должен быть декор.

---

# 21. Модалки

Modal должна наследовать дизайн-систему экрана:

- paper или ink surface;
- характерная рамка;
- near-zero radius;
- общие buttons;
- общие inputs;
- правильные danger states.

Если modal рендерится через portal, использовать безопасный scope.

Не делать глобальные CSS-overrides, которые случайно меняют другие части клиента.

---

# 22. Signature elements

Фирменные элементы SoyMan могут быть выразительнее обычного UI.

К ним относятся:

- dice-like characteristic blocks;
- Character Card;
- «Веер Карт»;
- character portrait framing;
- «Записка от мастера»;
- selected marker system.

Их дизайн может быть более художественным, но функциональность и читаемость сохраняются.

---

# 23. «Веер Карт»

«Веер Карт» — отдельная продуктовая функция, не generic grid view.

Его иконография должна ассоциироваться с:

- веером карт;
- колодой;
- раскладкой карточек.

Modal / view «Веер Карт» можно оформлять как отдельный card overview mode.

Не сводить его визуальный язык к стандартной иконке grid.

---

# 24. Asset naming

Все production assets получают семантические имена.

Хорошо:

- `paper-tile.webp`
- `ink-surface.webp`
- `marker-underline-long.png`
- `divider-star-thin.png`
- `corner-sun-large.png`

Плохо:

- `imagegen4.png`
- `final2.png`
- `new_asset.png`

Если generated sheet содержит несколько элементов, перед production-use его необходимо нарезать на отдельные assets.

---

# 25. Performance

Production textures оптимизировать.

Предпочитать:

- WebP для крупных raster textures;
- SVG для простой геометрии;
- PNG только когда нужна подходящая прозрачность/качество.

Не использовать многомегабайтный bitmap там, где достаточно небольшого repeat tile или CSS.

---

# 26. Accessibility и usability

Стиль не должен ухудшать:

- контраст;
- focus visibility;
- размер hit-area;
- hover/active feedback;
- mobile usability;
- keyboard navigation.

Decorative asset никогда не является единственным способом передать состояние.

---

# 27. Рабочий процесс редизайна

Не работать по модели:

> один asset → одно внедрение → одна проверка → следующий asset

Предпочитать крупные логические блоки.

Рекомендуемый цикл:

1. определить дизайн блока/экрана;
2. сгенерировать нужный asset-pack;
3. внедрить весь блок;
4. посмотреть реальные screenshots;
5. сделать один correction pass;
6. перейти дальше.

---

# 28. Разделение ролей

## ChatGPT / генерация изображений

Используется для:

- visual concepts;
- textures;
- decorative UI assets;
- icon concepts;
- cards;
- overlays;
- frames;
- special illustrations.

## Кодовая нейросеть

Используется для:

- HTML/CSS/React implementation;
- layout;
- states;
- component styling;
- responsive behavior;
- integration существующих assets.

Не поручать кодовой нейросети «нарисовать» raster asset, если нужное изображение должно быть сгенерировано отдельно.

---

# 29. Test policy во время редизайна

Не запускать полный test suite после каждой визуальной правки.

Во время серии visual iterations:

- screenshots / visual check;
- targeted functional check только если менялась логика.

Полный verification запускать после завершения логичного блока.

Обычно один раз:

- tests;
- `tsc`;
- build.

Чистые CSS/asset-правки не требуют полного regression suite после каждой итерации.

---

# 30. Критерий успеха

Хороший redesign должен работать даже если убрать половину декоративных assets.

Если без halftone, scribbles и stickers UI разваливается визуально, значит проблема находится в:

- layout;
- hierarchy;
- typography;
- surfaces;
- component system.

Декор усиливает дизайн.

Он не заменяет дизайн.
