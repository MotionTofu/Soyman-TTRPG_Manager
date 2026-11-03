# Исходные сбои проверок, обнаруженные при приёмке игроков

Дата: 2026-11-03. База `5f344dff`. Перечисленные файлы не изменялись
реализацией игроков; `git diff --exit-code HEAD -- <пути>` подтвердил это.
Исправление отложено: оно затрагивает общие редакторы, карты, PDF и
Мастерение и не нужно для принятой модели/макетов игроков.

## Тесты клиента

1. `client/src/pages/MasteringPage.test.tsx`: mock `../mentions` не
   возвращает `MENTION_RE`, необходимый `components/sheet/SheetEditor.tsx:29`.
   Сюита падает при импорте, до запуска её тестов. Следует дополнить mock
   или использовать частичный mock с оригинальными константами.
2. `client/src/data/noDirectApi.test.ts:32`: существующие прямые импорты
   `api` в `components/PageContextMenu.tsx`, `components/dnd/DndCards.tsx`,
   `pages/PdfEntityPanel.tsx`, `pages/PdfReaderPage.tsx`,
   `pages/ResourceLinkPage.tsx` не входят в разрешённый список. Нужен
   отдельный перенос операций в слой данных с проверкой инвалидирования.

## Дизайн-барьеры

- `client/src/index.css:7625`, `.entity-dots`: font-size 18px вне шкалы.
- `client/src/d-system.css:525`: margin-top -3px;
  `client/src/index.css:7539`: padding 7px у заголовка контекстного меню.
- `client/src/pages/MapPacksPage.tsx:581`: собственный h1 и отсутствие
  каркаса. Каркас также отсутствует у `MarkdownResourcePage.tsx` и
  `PdfMarkdownPage.tsx`.
- Превышен существующий бюджет inline-стилей в `CampaignsListPage.tsx`
  (3/2), `MapPacksPage.tsx` (69/0), `MapSheetDialog.tsx` (24/0),
  `MapsListPage.tsx` (18/10), `MapWorkspacePage.tsx` (1/0),
  `MarkdownResourcePage.tsx` (2/0), `PdfNotesPanel.tsx` (2/0),
  `PdfReaderPage.tsx` (1/0).

## Окружение проверки

IAB периодически не подключает вкладку: `Timed out waiting for the Browser
webview to attach for this browser-use page`. Это воспроизвелось при
создании скрытой и видимой вкладки, при HTTP 200 от стенда. Существующая
вкладка старой галереи содержит ERR_CONNECTION_REFUSED на остановленном
порту 5297; она не является доказательством ошибки текущего порта 5298.
Управление браузером не лечилось изменениями приложения или отключением
его защит. После ручного открытия вкладки владельцем управление
восстановилось, все дополнительные проверки окон завершены. Причина
сбоя создания вкладок в приложении Codex здесь не установлена.
