# Повтор существующих падений при исправлении HTTP-доступа по LAN

Проверено 2026-11-01. Область работы: генерация клиентских UUID без
`crypto.randomUUID` в HTTP-контексте локальной сети.

- `client: npm test`: 229 файлов прошли, 2 упали; 1851 тест прошёл,
  1 упал, один набор не загрузился.
- `client/src/pages/MasteringPage.test.tsx`: мок `../mentions` не экспортирует
  `MENTION_RE`; импорт `SheetEditor.tsx:29` падает до выполнения тестов.
- `client/src/data/noDirectApi.test.ts:32`: прямой импорт транспорта в
  `components/PageContextMenu.tsx`, `components/dnd/DndCards.tsx`,
  `pages/PdfEntityPanel.tsx`, `pages/PdfReaderPage.tsx`, `pages/ResourceLinkPage.tsx`.
- `client: npm run lint`: остановка на `client/src/index.css:7625`,
  `.entity-dots` использует `font-size: 18px` вне шкалы.

Это уже описанные С52 / Т25 / Т26 и Ди23; новый дефект не заводится.
Не исправлено: моки библиотеки, миграция чтения PDF/D&D на слой данных
и общий размер шрифта находятся вне исправления запуска приложения по LAN.
Проверки самого исправления: 16/16; TypeScript проходит; oxlint — 0 ошибок,
228 предупреждений, число ошибок относительно исходного состояния не выросло.
