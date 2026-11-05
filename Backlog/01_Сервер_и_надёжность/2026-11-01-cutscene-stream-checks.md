# Общие проверки при исправлении потокового запуска катсцен

Status: needs-triage

Проверено 2026-11-01. Исправление касается только клиентского воспроизведения
и принадлежности ошибок кадров; нижеперечисленные места не менялись.

`client: npm test`: 227 прошедших / 4 упавших файла, 1860 прошедших /
6 упавших тестов, один suite не загрузился.

- Прежний `pages/MasteringPage.test.tsx`: мок `../mentions` не экспортирует
  MENTION_RE, импорт SheetEditor падает до тестов (С52 / Т25).
- Прежний `data/noDirectApi.test.ts:32`: прямые импорты транспорта в
  PageContextMenu, DndCards, PdfEntityPanel, PdfReaderPage, ResourceLinkPage
  (С52 / Т26).
- `pages/MapEditorPage.test.tsx:74,96,179`: таймауты по 5000 мс.
- `components/campaign/CampaignEntityStateBadge.test.tsx:45`, случай being:
  таймаут 5000 мс.
- `pages/MapEditorPage.test.tsx:200`: aria-pressed свободной кисти false
  вместо true; аналогичная нестабильность уже описана в сверке Хроники.

Повторная команда с одним worker:
`npx vitest run --maxWorkers=1 src/pages/MapEditorPage.test.tsx src/components/campaign/CampaignEntityStateBadge.test.tsx src/sound/cutsceneAudioMedia.test.ts`
прошла: 3 файла, 27 тестов. Четыре таймаута и ошибка кисти не повторились;
причина нестабильности в этом задании не исследовалась.

`client: npm run lint` по-прежнему останавливается на Ди23:
`index.css:7625`, `.entity-dots` использует font-size 18px вне шкалы.
Oxlint до/после — 0 ошибок, 228 предупреждений.

Не исправлено: моки библиотеки, слой данных PDF/D&D, редактор карт,
состояния сущностей и дизайн-долг находятся вне согласованного исправления
музыки и ошибок старого кадра. Подробный отчёт —
`.scratch/cutscene-stream-fix/report.md`.
