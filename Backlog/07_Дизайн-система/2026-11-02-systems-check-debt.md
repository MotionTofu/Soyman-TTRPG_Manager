# Прежние барьеры общего lint и тестов при доводке систем

Дата: 2026-11-02. Статус: `needs-triage`. База `6590a269`.

Ниже ошибки вне изменённых файлов задачи систем. Их исходники не правились:
часть этих областей параллельно меняется в основной рабочей копии. Общие
проверки из-за них остаются красными; требуется отдельное исправление.

| Проверка / место | Что исправить |
|---|---|
| `npm run lint`, `client/src/index.css:7625` | `.entity-dots` задаёт 18px вне шкалы |
| `check-spacing`, `d-system.css:525`, `index.css:7539` | Отступы -3px и 7px вне шкалы |
| `check-entity-page`, `pages/MapPacksPage.tsx:581` | Собственный h1 в обход каркаса |
| `check-inline-styles` | Превышение в CampaignsListPage (3/2), MapPacksPage (69/0), MapSheetDialog (24/0), MapsListPage (18/10), MapWorkspacePage (1/0), MarkdownResourcePage (2/0), PdfNotesPanel (2/0), PdfReaderPage (1/0) |
| `check-page-frame` | Нет каркаса у MapPacksPage, MarkdownResourcePage, PdfMarkdownPage |
| `pages/MasteringPage.test.tsx` | Mock `../mentions` не экспортирует `MENTION_RE`; импорт SheetEditor через WorkbookFieldInput прекращает сбор тестов (`SheetEditor.tsx:29`) |
| `data/noDirectApi.test.ts:32` | Прямой импорт транспорта api в components/PageContextMenu.tsx, components/dnd/DndCards.tsx, pages/PdfEntityPanel.tsx, pages/PdfReaderPage.tsx, pages/ResourceLinkPage.tsx |

Команды запускались без пайпа, коды завершения сохранены: общий lint — 1,
spacing/entity-page/inline-styles/page-frame — 1; list и raster — 0;
`npx oxlint src` — 0, до и после 228 предупреждений и ни одной ошибки.
Журналы: `.scratch/systems-finish/lint-verified.log`, `check-*.log`,
`tests-complete.log` в рабочей копии `codex-systems-finish`.
Нестабильность MapEditorPage записана в теме карт отдельным файлом.
