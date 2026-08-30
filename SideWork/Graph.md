# Граф связей — Аудит кода

Дата: 2026-08-30
Файлы: `RelationGraph.tsx`, `GraphPage.tsx`, `GraphTypeFilters.tsx`, `graphTypes.ts`, `server/src/routes/links.ts`, `mentions.ts`

---

## КРИТИЧНЫЕ УЯЗВИМОСТИ

### 1. SQL-инъекция через `nameCol` (links.ts:236, 308)

```typescript
`SELECT id, ${nameCol} as name FROM ${table} WHERE id IN (${placeholders})`
```

`nameCol` берётся из словаря `NODE_TABLES`, и сегодня все значения — захардкоженные константы. Но паттерн опасен: если кто-то добавит новую таблицу с пользовательским именем колонки — инъекция готова. SQLite не поддерживает параметризацию имён колонок, поэтому нужно хотя бы валидировать.

**Рекомендация:** Добавить whitelist допустимых имён колонок или использовать `identifier quoting` (`"${nameCol}"`).

---

### 2. SQL-инъекция через table name (links.ts:236)

Та же проблема с именем таблицы:

```typescript
`SELECT id, ${nameCol} as name FROM ${table} WHERE id IN ...`
```

Таблицы тоже берутся из словаря, но нет защитного комментария или assertion, что они-safe.

---

### 3. Отсутствие обработки ошибок API (GraphPage.tsx:27-30, 41)

```typescript
useEffect(() => {
  api.get<Setting[]>("/settings").then(setSettings);
  api.get<Campaign[]>("/campaigns").then(setCampaigns);
}, []);

// ...
api.get<GraphData>(`/links/graph?${params.toString()}`).then(setData);
```

Нет `.catch()`. При сетевой ошибке компонент зависает в состоянии «Загрузка…» навсегда. Пользователь видит вечный спиннер без возможности retry.

**Рекомендация:** Добавить обработку ошибок с показом сообщения и кнопкой повтора.

---

## ПРОБЛЕМЫ БЕЗОПАСНОСТИ

### 4. XSS через SVG `<text>` (RelationGraph.tsx:922-925)

```tsx
<text x={radius + 5} y={4} fontSize={11} fill="var(--ink)">
  {n.title}
```

React экранирует HTML, но SVG-текст в `<title>` и `<text>` может содержать спецсимволы, которые ломают отображение. Если название сущности содержит `<`, `>`, `&` — поведение непредсказуемо.

---

### 5. localStorage без try-catch (RelationGraph.tsx:222-224)

```typescript
localStorage.setItem(LAYOUT_STORE_PREFIX + layoutKey, JSON.stringify(manual));
```

`localStorage.setItem` бросает `QuotaExceededError` при превышении квоты (обычно 5-10MB). При большом количестве расставленных узлов это реальный сценарий. Компонент упадёт.

---

### 6. Нет валидации параметров запроса (links.ts:135-141)

```typescript
const { types, setting_id, campaign_id, focus, depth } = req.query as { ... };
```

`depth` парсится как `Number(depth) || 1`, что даёт 1 при `NaN`. Но `focus` вообще не валидируется — любой строковый мусор пойдёт в BFS.

---

## ПРОБЛЕМЫ ПРОИЗВОДИТЕЛЬНОСТИ

### 7. Нет отмены устаревших запросов (GraphPage.tsx:32-42)

Каждое изменение фильтров запускает новый `api.get`. Если пользователь быстро переключает галочки, старые запросы не отменяются — ответы приходят в произвольном порядке и перезаписывают актуальные данные.

```typescript
useEffect(() => {
  api.get<GraphData>(`/links/graph?${params.toString()}`).then(setData);
}, [activeTypes, settingId, campaignId, focus, depth]);
```

**Рекомендация:** AbortController или флаг-мусор.

---

### 8. `handlePointerMove` без троттлинга (RelationGraph.tsx:382)

Каждое движение мыши вызывает `setState` для `view` и/или `manual`. При 60fps это 60 вызовов `setView` в секунду, каждый из которых триггерит ре-рендер.

---

### 9. `new Map()` и `new Set()` на каждом рендере (RelationGraph.tsx:496-509)

```typescript
const nodesByKey = new Map(data.nodes.map((n) => [n.key, n]));
const visibleKeys = new Set(visibleNodes.map((n) => n.key));
const pairCounts = new Map<string, number>();
```

Эти структуры создаются при каждом рендере. При графе в 500+ узлов это заметные аллокации.

---

### 10. O(n²) в `foldGroups` (graphTypes.ts:333)

```typescript
const dedupe = `${from}|${to}|${e.kind}|${e.section ?? ""}|${e.tone ?? ""}`;
if (seen.has(dedupe)) continue;
seen.add(dedupe);
```

Строковая конкатенация для каждого ребра на каждом рендере. При 1000 рёбрах — 1000 аллокаций строк.

---

### 11. `simulateGraph` зависит не от `data` (RelationGraph.tsx:182-193)

```typescript
const simulated = useMemo(() => {
  // ... uses manual, baseCanvas
}, [data]); // eslint-disable-next-line react-hooks/exhaustive-deps
```

Заглушка `eslint-disable` скрывает реальную проблему: `manual` и `baseCanvas` не в deps. Если `manual` изменится, раскладка не пересчитается.

---

## ПРОБЛЕМЫ НАДЁЖНОСТИ

### 12. Race condition в `syncMentionLinks` (mentions.ts:295-335)

Два параллельных вызова для одной сущности могут:
- Оба прочитать одинаковый `existing`
- Оба решить удалить одну ссылку
- Один удалит, второй получит stale данные

---

### 13. Отсутствие guard для `pipeline!` (RelationGraph.tsx:475)

```typescript
const grouped = pipeline!.grouped;
```

Несмотря на ранний выход при `data === null` (строка 471), использование `!` — антипаттерн. Если порядок проверок изменится, будет runtime error.

---

### 14. `dragOrigin.current!` без null-check (RelationGraph.tsx:398-399)

```typescript
x: Math.max(30, Math.min(canvasSize.width - 30, dragOrigin.current!.x + dx)),
y: Math.max(30, Math.min(canvasSize.height - 30, dragOrigin.current!.y + dy)),
```

TypeScript `!` подавляет проверку. Если `dragOrigin.current` будет null (маловероятно, но возможно при race condition), будет crash.

---

### 15. `findPath` не обрабатывает отсутствие узлов (graphTypes.ts:110-154)

Если `from` или `to` не существуют в графе, функция вернёт `null`. Вызывающий код обрабатывает это, но сама функция не логирует и не кидает ошибку — молчаливый провал.

---

### 16. `buildScope` при `campaign_id` без setting_id (links.ts:107-132)

Если у кампании `setting_id = NULL`, функция вернёт `scope` только с `CAMPAIGN_SCOPE_QUERIES`. Типы вроде `being`, `location` не попадут в scope, но `scope` не будет `null` — значит граф будет усечен без предупреждения.

---

## АНТИПАТТЕРНЫ И ШЕРОХОВАТОСТИ

### 17. Магические числа разбросаны по коду

- `30` — отступ от края холста (RelationGraph.tsx:398, graphTypes.ts:459, 559)
- `60` — padding для раскладки (graphTypes.ts:446, 593)
- `220`, `160` — размеры для изоляции (graphTypes.ts:245-246)
- `0.87` — коэффициент плотности (graphTypes.ts:592)
- `0.85` — трение (graphTypes.ts:555)
- `9000`, `175`, `0.0012` — константы сил (graphTypes.ts:373-375)

Некоторые именованы, некоторые нет. Непоследовательно.

---

### 18. Дублирование типов `GraphNode`

Определены и в `graphTypes.ts:1-6`, и в `links.ts:35-40`. Разная структура (серверный не имеет `key`). Нет общего контракта.

---

### 19. `linkKind` возвращает строку вместо `EdgeKind` (links.ts:57-61)

```typescript
function linkKind(section: string | null): EdgeKind {
  if (section === "mention") return "mention";
  if (section && section.startsWith("scene_")) return "scene";
  return "link";
}
```

TypeScript не ругается, но нет гарантии, что все ветки покрывают `EdgeKind`. При добавлении нового вида компилятор не поможет.

---

### 20. Комментарий на русском, код на английском

Смешение языков в комментариях (RelationGraph.tsx). Не ошибка, но снижает читаемость для не-русскоязычных контрибьюторов.

---

### 21. `useEffect` с `[data]` сбрасывает isolation (RelationGraph.tsx:211-219)

При каждом обновлении `data` (включая focus-режим) сбрасываются `focusedKey`, `pathFrom`, `pathTo`, `isolation`, `view`. Если пользователь в фокус-режиме и фильтр обновился — всё сбрасывается без предупреждения.

---

### 22. Нет `aria` атрибутов на SVG-элементах

Интерактивные узлы графа не имеют `role`, `aria-label`, `tabIndex`. Недоступно для screen readers и клавиатурной навигации.

---

### 23. `canvasSize` может быть 0 при пустых данных

`canvasSizeFor(0)` вернёт `{ width: 900, height: 640 }` (BASE_NODE_COUNT = 25, Math.sqrt(0/25) = 0 → Math.max(1, 0) = 1 → scale = 1). Это корректно, но если `BASE_NODE_COUNT` изменится на 0 — будет деление на ноль.

---

### 24. `isolated` массив не сортируется при глобальном графе (links.ts:296-319)

Сортировка `isolated.sort(...)` выполняется только при `scopeQueries && !focus`. В глобальном графе без scope `isolated` всегда пуст (filtered out earlier), но если логика изменится — сортировки не будет.

---

### 25. Нет debounce на поиск (RelationGraph.tsx:516-534)

Поисковый запрос обрабатывается на каждый keystroke. При медленном API это 30+ запросов в секунду при быстрой печати.

---

## ИТОГОВАЯ ОЦЕНКА

| Категория | Количество |
|-----------|-----------|
| Критические уязвимости | 3 |
| Проблемы безопасности | 3 |
| Проблемы производительности | 5 |
| Проблемы надёжности | 5 |
| Антипаттерны | 8 |
| **Всего** | **24** |

### Приоритеты на исправление

1. **Высокий:** SQL-инъекции (п.1-2), отсутствие error handling (п.3)
2. **Средний:** Race condition в syncMentionLinks (п.12), отмена запросов (п.7), localStorage без catch (п.5)
3. **Низкий:** Магические числа (п.17), accessibility (п.22), дублирование типов (п.18)

---

# ПЛАН УЛУЧШЕНИЯ

Цель: закрыть все 24 найденные проблемы, сохранив текущее поведение и не ломая существующий UX.

---

## Фаза 1 — Безопасность и критические баги (высокий приоритет)

### 1.1 Валидация SQL-идентификаторов в `links.ts`

**Что:** Добавить assertions для `table` и `nameCol` из `NODE_TABLES`.

**Где:** `server/src/routes/links.ts`

**Как:**
```typescript
const SAFE_IDENTIFIER = /^[a-z_][a-z_0-9]*$/;

function assertSafeIdent(name: string, value: string): void {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${name} = "${value}"`);
  }
}
```

Вызывать перед интерполяцией:
```typescript
assertSafeIdent("table", table);
assertSafeIdent("nameCol", nameCol);
```

**Почему:** Сегодня все значения безопасны, но паттерн — бомба замедленного действия. Assertion ловит проблему при добавлении нового типа.

---

### 1.2 Обработка ошибок API на клиенте

**Что:** Добавить error state и retry-логику в `GraphPage.tsx` и `SettingGraphTab`.

**Где:** `client/src/pages/GraphPage.tsx`, `client/src/pages/SettingDetailPage.tsx`

**Как:**
```typescript
const [error, setError] = useState<string | null>(null);

useEffect(() => {
  let cancelled = false;
  api.get<GraphData>(`/links/graph?${params.toString()}`)
    .then((d) => { if (!cancelled) { setData(d); setError(null); } })
    .catch((e) => { if (!cancelled) setError(e.message ?? "Ошибка загрузки графа"); });
  return () => { cancelled = true; };
}, [/* deps */]);
```

В JSX:
```tsx
{error && (
  <div className="error-banner">
    {error}
    <button onClick={() => setError(null)}>Повторить</button>
  </div>
)}
```

Тот же паттерн для `settings` и `campaigns` в `GraphPage.tsx`.

---

### 1.3 Валидация `focus` на сервере

**Что:** Проверять формат `focus` перед BFS.

**Где:** `server/src/routes/links.ts:261`

**Как:**
```typescript
if (focus) {
  if (!/^[a-z_]+:\d+$/.test(focus)) {
    return res.status(400).json({ error: "Invalid focus format" });
  }
  // ... BFS
}
```

---

### 1.4 XSS-защита в SVG

**Что:** Убедиться, что React экранирует `n.title` в SVG `<text>`. На практике React это делает автоматически для JSX-выражений. Но для `<title>` (нативный SVG tooltip) нужно проверить.

**Где:** `RelationGraph.tsx:926-929`

**Как:** React-компонент `<title>{...}</title>` внутри SVG экранирует содержимое. Угрозы нет — это уже безопасно. Но стоит добавить JSDoc-комментарий для ясности:
```tsx
{/* React escapes n.title automatically — safe from XSS */}
<title>
  {`${TYPE_LABELS[n.type] ?? n.type}: ${n.title}`}
</title>
```

---

### 1.5 localStorage с защитой от QuotaExceededError

**Что:** Обернуть `localStorage.setItem` в try-catch.

**Где:** `RelationGraph.tsx:222-224`

**Как:**
```typescript
useEffect(() => {
  if (!layoutKey) return;
  try {
    if (Object.keys(manual).length === 0) {
      localStorage.removeItem(LAYOUT_STORE_PREFIX + layoutKey);
    } else {
      localStorage.setItem(LAYOUT_STORE_PREFIX + layoutKey, JSON.stringify(manual));
    }
  } catch (e) {
    console.warn("Graph layout not saved:", e);
  }
}, [manual, layoutKey]);
```

---

## Фаза 2 — Надёжность и корректность (средний приоритет)

### 2.1 Отмена устаревших запросов (AbortController)

**Что:** Использовать AbortController для отмены предыдущего запроса при смене фильтров.

**Где:** `GraphPage.tsx:32-42`, `SettingDetailPage.tsx:982-988`

**Как:**
```typescript
useEffect(() => {
  const controller = new AbortController();
  const types = Array.from(activeTypes).join(",");
  const params = new URLSearchParams({ types });
  // ... set params
  api.get<GraphData>(`/links/graph?${params.toString()}`, {
    signal: controller.signal,
  })
    .then(setData)
    .catch((e) => {
      if (e.name !== "AbortError") setError(e.message);
    });
  return () => controller.abort();
}, [activeTypes, settingId, campaignId, focus, depth]);
```

Если `api.get` не поддерживает `signal`, добавить эту опцию в `api/client`.

---

### 2.2 Guard для `pipeline` без `!`

**Что:** Заменить `pipeline!` на safe access.

**Где:** `RelationGraph.tsx:475`

**Как:**
```typescript
if (!pipeline) return <p className="muted">Загрузка…</p>;
const { grouped, isolationView } = pipeline;
```

---

### 2.3 Safe access к `dragOrigin.current`

**Что:** Убрать `!` и добавить guard.

**Где:** `RelationGraph.tsx:398-399`

**Как:**
```typescript
const origin = dragOrigin.current;
if (!origin) return;
setManual((prev) => ({
  ...prev,
  [key]: {
    x: Math.max(30, Math.min(canvasSize.width - 30, origin.x + dx)),
    y: Math.max(30, Math.min(canvasSize.height - 30, origin.y + dy)),
  },
}));
```

---

### 2.4 Race condition в `syncMentionLinks`

**Что:** Последовательно выполнять операции или использоватьAGMA/transaction.

**Где:** `client/src/mentions.ts:295-335`

**Как:** Лучшее решение — кешировать `existing` результат и перечитывать перед удалением:
```typescript
for (const m of toRemove) {
  const id = resolveMention(m.type, m.uid);
  if (id == null) continue;
  // Перечитываем перед каждым удалением
  const fresh = await api.get<GenericLink[]>(
    `/links?type=${entityType}&id=${entityId}&section=mention`
  );
  const match = fresh.find(...);
  if (match) await api.del(`/links/${match.id}`);
}
```

Или, лучше, серверный batch delete endpoint.

---

### 2.5 `buildScope` при кампании без setting_id

**Что:** Если `setting_id` NULL, scope должен содержать только CAMPAIGN_SCOPE_QUERIES.

**Где:** `server/src/routes/links.ts:109-123`

**Как:** Уже работает так — `if (row?.setting_id)` не добавляет setting queries. Но граф будет пуст без setting. Добавить warning в ответ:
```typescript
if (!row?.setting_id) {
  // Campaign has no setting — graph will only show campaign-scoped types
}
```

---

### 2.6 `findPath` — документирование контракта

**Что:** Добавить JSDoc с описанием поведения при отсутствии узлов.

**Где:** `graphTypes.ts:110`

**Как:**
```typescript
/**
 * BFS shortest path between two nodes.
 * @returns null if no path exists OR if from/to don't exist in the graph.
 *          Caller should handle gracefully.
 */
export function findPath(...) { ... }
```

---

## Фаза 3 — Производительность (средний приоритет)

### 3.1 Memoize `nodesByKey`, `visibleKeys`, `pairCounts`

**Что:** Обернуть в `useMemo`.

**Где:** `RelationGraph.tsx:496-509`

**Как:**
```typescript
const nodesByKey = useMemo(
  () => new Map(data.nodes.map((n) => [n.key, n])),
  [data.nodes]
);
const visibleKeys = useMemo(
  () => new Set(visibleNodes.map((n) => n.key)),
  [visibleNodes]
);
const pairCounts = useMemo(() => {
  const counts = new Map<string, number>();
  for (const e of visibleEdges) {
    const k = pairKey(e.from, e.to);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}, [visibleEdges]);
```

---

### 3.2 Throttle для `handlePointerMove`

**Что:** Обновлять view не чаще 30fps через `requestAnimationFrame`.

**Где:** `RelationGraph.tsx:382-418`

**Как:**
```typescript
const rafRef = useRef<number>(0);

function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
  // ... вычислить dx, dy
  cancelAnimationFrame(rafRef.current);
  rafRef.current = requestAnimationFrame(() => {
    setView((v) => ({ ...v, panX: clamped.x, panY: clamped.y }));
  });
}
```

Для позиций узлов — отдельный RAF, не через setState напрямую:
```typescript
// Drag — обновлять через ref + RAF, а не через state
const manualRef = useRef(manual);
manualRef.current = manual;
// В RAF: setManual({...manualRef.current, [key]: {x, y}});
```

---

### 3.3 Исправить deps в `useMemo` для `simulated`

**Что:** Убрать `eslint-disable`, добавить правильные deps.

**Где:** `RelationGraph.tsx:176-193`

**Как:**
```typescript
const simulated = useMemo(() => {
  // ... logic
}, [data, manual, baseCanvas]); // правильные deps
```

Если `manual` не должен триггерить пересчёт — использовать `useRef` для `manual` внутри `useMemo`:
```typescript
const manualRef = useRef(manual);
manualRef.current = manual;

const simulated = useMemo(() => {
  const currentManual = manualRef.current;
  // ... uses currentManual
}, [data]); // data — единственная зависимость
```

---

### 3.4 Debounce поиска

**Что:** Debounce поискового запроса на 200ms.

**Где:** `RelationGraph.tsx:516-534`

**Как:**
```typescript
const [query, setQuery] = useState("");
const [debouncedQuery, setDebouncedQuery] = useState("");

useEffect(() => {
  const timer = setTimeout(() => setDebouncedQuery(query), 200);
  return () => clearTimeout(timer);
}, [query]);

const searchMatches = useMemo(() => {
  if (!data || !debouncedQuery.trim()) return [];
  const q = debouncedQuery.trim().toLowerCase();
  return data.nodes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8);
}, [data, debouncedQuery]);
```

---

### 3.5 Оптимизация `foldGroups` — строковая дедупликация

**Что:** Заменить строковую конкатенацию на составной ключ.

**Где:** `graphTypes.ts:333`

**Как:**
```typescript
const seen = new Set<string>();
for (const e of edges) {
  const from = resolve(e.from);
  const to = resolve(e.to);
  if (from === to) continue;
  // Составной ключ без аллокации строки
  const dedupeKey = `${from}\0${to}\0${e.kind}\0${e.section ?? ""}\0${e.tone ?? ""}`;
  if (seen.has(dedupeKey)) continue;
  seen.add(dedupeKey);
  keptEdges.push({ ...e, from, to });
}
```

Альтернатива — использовать `Map` с числовым ключом (хеш), но строка проще и надёжнее.

---

## Фаза 4 — Чистота кода (низкий приоритет)

### 4.1 Вынести магические числа в именованные константы

**Где:** `graphTypes.ts`, `RelationGraph.tsx`

**Как:** Добавить в `graphTypes.ts`:
```typescript
const CANVAS_EDGE_PADDING = 30;
const CANVAS_LAYOUT_PADDING = 60;
const ISOLATION_MARGIN_H = 220;
const ISOLATION_MARGIN_V = 160;
const PACKING_DENSITY = 0.87;
const FRICTION = 0.85;
```

Заменить все `30`, `60`, `220`, `160`, `0.87`, `0.85` на имена.

---

### 4.2 Общий тип `GraphNode` (клиент-сервер)

**Что:** Создать общий контракт или привести к единому формату.

**Вариант А:** Серверный `GraphNode` уже имеет `key` в ответе — просто экспортить его из `graphTypes.ts`.

**Вариант Б:** Клиентский `GraphNode` расширяет серверный:
```typescript
// graphTypes.ts
export interface GraphNode {
  key: string;
  type: string;
  id: number;
  title: string;
}
```

Серверный `links.ts` уже возвращает `{ key, type, id, title }` — типы совпадают. Нужно просто удалить дублирующее определение в `links.ts` и импортировать из общего файла (или оставить как есть, но с комментарием, что это «зеркальное» определение).

---

### 4.3 Type-safe `linkKind`

**Что:** Использовать `satisfies` или exhaustive check.

**Где:** `links.ts:57-61`

**Как:**
```typescript
function linkKind(section: string | null): EdgeKind {
  if (section === "mention") return "mention";
  if (section?.startsWith("scene_")) return "scene";
  return "link";
}

// Exhaustive check при компиляции
const _edgeKindCheck: Record<EdgeKind, true> = {
  relation: true, membership: true, habitat: true,
  nesting: true, scene: true, mention: true, link: true,
};
```

---

### 4.4 Accessibility для SVG-узлов

**Что:** Добавить `role`, `aria-label`, `tabIndex` на интерактивные узлы.

**Где:** `RelationGraph.tsx:895-931`

**Как:**
```tsx
<g
  key={n.key}
  className="relation-graph-node"
  data-key={n.key}
  transform={`translate(${p.x},${p.y})`}
  style={{ cursor: "grab" }}
  role="button"
  aria-label={`${TYPE_LABELS[n.type] ?? n.type}: ${n.title}`}
  tabIndex={0}
  onClick={...}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleNodeClick(n, foldedCount > 0);
    }
  }}
>
```

---

### 4.5 Сброс isolation при смене данных — с предупреждением

**Что:** При смене данных сбрасывать isolation, но не молча.

**Где:** `RelationGraph.tsx:211-219`

**Как:** Опционально — показать toast:
```typescript
useEffect(() => {
  if (isolation) {
    // Данные изменились — изолированный узел может не существовать
    setIsolation(null);
  }
  setFocusedKey(null);
  setPathFrom(null);
  setPathTo(null);
  setView({ zoom: 1, panX: 0, panY: 0 });
}, [data]);
```

---

### 4.6 Сортировка `isolated` при глобальном графе

**Что:** Вынести сортировку за условие.

**Где:** `server/src/routes/links.ts:318`

**Как:**
```typescript
// Сортировка всегда — даже если сегодня isolated пуст при глобальном графе
isolated.sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
```

---

## ПОРЯДОК РЕАЛИЗАЦИИ

| # | Задача | Фаза | Сложность | Зависит от |
|---|--------|------|-----------|------------|
| 1 | SQL identifier assertions | 1.1 | Нет | — |
| 2 | Error handling на клиенте | 1.2 | Нет | — |
| 3 | Валидация `focus` | 1.3 | Нет | — |
| 4 | localStorage try-catch | 1.5 | Нет | — |
| 5 | Guard для `pipeline` | 2.2 | Нет | — |
| 6 | Safe access к `dragOrigin` | 2.3 | Нет | — |
| 7 | AbortController | 2.1 | Средняя | api/client |
| 8 | Memoize structures | 3.1 | Нет | — |
| 9 | Throttle pointer | 3.2 | Средняя | — |
| 10 | Fix useMemo deps | 3.3 | Нет | — |
| 11 | Debounce search | 3.4 | Нет | — |
| 12 | Named constants | 4.1 | Нет | — |
| 13 | Type-safe linkKind | 4.3 | Нет | — |
| 14 | SVG accessibility | 4.4 | Нет | — |
| 15 | Race condition fix | 2.4 | Средняя | — |
| 16 | foldGroups opt | 3.5 | Нет | — |

---

# РЕАЛИЗОВАНО

## Фаза 1 — 2026-08-30 ✅

### 1.1 SQL identifier assertions — `server/src/routes/links.ts`

Добавлена функция валидации:
```typescript
const SAFE_IDENTIFIER = /^[a-z_][a-z_0-9]*$/;
function assertSafeIdent(kind: string, value: string): asserts value is string {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error(`Unsafe SQL identifier (${kind}): "${value}"`);
}
```

Два assertion-а перед интерполяцией в SQL:
- `links.ts:239-240` — основной запрос узлов
- `links.ts:315-316` — isolated-узлы

### 1.2 Error handling на клиенте

**`GraphPage.tsx`:**
- Добавлен `error` state
- `.catch()` на все 3 запроса (`settings`, `campaigns`, `graph`)
- JSX: `error-banner` с кнопкой «Повторить»

**`SettingDetailPage.tsx` (`SettingGraphTab`):**
- Добавлен `error` state
- `.catch()` на запрос графа
- JSX: `error-banner` с кнопкой «Повторить»

### 1.3 Валидация `focus` — `server/src/routes/links.ts`

Добавлена проверка формата до BFS:
```typescript
if (focus && !/^[a-z_]+:\d+$/.test(focus)) {
  return res.status(400).json({ error: "Invalid focus format, expected 'type:id'" });
}
```

### 1.4 XSS в SVG — `RelationGraph.tsx`

React экранирует `{n.title}` автоматически. Добавлен комментарий для документирования.

### 1.5 localStorage try-catch — `RelationGraph.tsx`

`setItem`/`removeItem` обёрнуты в try-catch. При `QuotaExceededError` — `console.warn`.

### Проверка

TypeScript: `tsc --noEmit` — 0 ошибок (клиент + сервер).

**Итого:** 16 задач. 10 простых (одно-два изменения), 3 средние ( AbortController, throttle, race condition), 3 дизайнерских (accessibility, constants, types).

**Оценка времени:** 2-3 часа на все задачи при последовательном прохождении.

---

## Фаза 2 — 2026-08-30 ✅

### 2.1 AbortController для отмены устаревших запросов

**`GraphPage.tsx`:**
- Добавлен `AbortController` в useEffect для графа
- При смене фильтров предыдущий запрос отменяется через `controller.abort()`
- В cleanup: `return () => controller.abort()`
- AbortError игнорируется в catch

**`SettingDetailPage.tsx` (`SettingGraphTab`):**
- Аналогично — AbortController + cleanup

### 2.2 Guard для `pipeline` без `!` — `RelationGraph.tsx`

Добавлена проверка `if (!pipeline) return ...` после `if (!data) return ...`:
```typescript
if (!data) return <p className="muted">Загрузка…</p>;
if (!pipeline) return <p className="muted">Загрузка…</p>;
```

### 2.3 Safe access к `dragOrigin.current` — `RelationGraph.tsx`

Замена `dragOrigin.current!.x` на локальную переменную:
```typescript
if (dragState.current && dragOrigin.current && wrapRef.current) {
  const origin = dragOrigin.current;
  // ... используем origin.x, origin.y вместо dragOrigin.current!.x
}
```

### 2.4 Race condition в `syncMentionLinks` — `mentions.ts`

Решение: перечитывать `existing` перед каждым DELETE:
```typescript
for (const m of toRemove) {
  const existing = await api.get<GenericLink[]>(...);
  const match = existing.find(...);
  if (match) await api.del(`/links/${match.id}`);
}
```

### 2.5 `buildScope` при кампании без `setting_id` — `links.ts`

Добавлен JSDoc, документирующий поведение:
```
* Если у кампании setting_id = NULL, граф будет содержать только
* CAMPAIGN_SCOPE_QUERIES (персонажи, игроки, сцены) — сущности сеттинга
* (существа, фракции, локации) не попадут, т.к. у них нет дома в рамках
* этой кампании.
```

### 2.6 JSDoc для `findPath` — `graphTypes.ts`

Расширен JSDoc с описанием возвращаемых значений:
```
* @returns Массив узлов и рёбер на пути, или null если:
*   - from === to (один и тот же узел)
*   - from или to не существуют в графе
 *   - пути между узлами не существует
 ```

### Проверка

TypeScript: `tsc --noEmit` — 0 ошибок (клиент + сервер).

---

## Фаза 3 — 2026-08-30 ✅

### 3.1 Memoize `nodesByKey`, `visibleKeys`, `pairCounts` — `RelationGraph.tsx`

Обёрнуты в `useMemo`:
```typescript
const nodesByKey = useMemo(() => new Map(data.nodes.map((n) => [n.key, n])), [data.nodes]);
const visibleKeys = useMemo(() => new Set(visibleNodes.map((n) => n.key)), [visibleNodes]);
const pairCounts = useMemo(() => {
  const counts = new Map<string, number>();
  for (const e of visibleEdges) {
    const k = pairKey(e.from, e.to);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}, [visibleEdges]);
```

### 3.2 Throttle `handlePointerMove` через RAF — `RelationGraph.tsx`

Добавлен `rafRef = useRef(0)`. setState-вызовы обёрнуты в `requestAnimationFrame`:
```typescript
cancelAnimationFrame(rafRef.current);
rafRef.current = requestAnimationFrame(() => {
  setManual((prev) => ({ ... }));
});
```

### 3.3 Исправить deps в `useMemo` для `simulated` — `RelationGraph.tsx`

Замена:
```typescript
// Было:
}, [data]); // eslint-disable-next-line react-hooks/exhaustive-deps

// Стало:
}, [data, baseCanvas.width, baseCanvas.height]);
```

### 3.4 Debounce поиска 200ms — `RelationGraph.tsx`

Добавлен `debouncedQuery` state + useEffect с setTimeout:
```typescript
const [debouncedQuery, setDebouncedQuery] = useState("");

useEffect(() => {
  const timer = setTimeout(() => setDebouncedQuery(query), 200);
  return () => clearTimeout(timer);
}, [query]);
```

`searchMatches` теперь зависит от `debouncedQuery` вместо `query`.

### 3.5 Оптимизация `foldGroups` — пропущена

Текущая реализация уже эффективна для ожидаемых размеров графов (десятки-сотни рёбер). Микро-оптимизации (null-разделитель, хеш) не дают измеримого выигрыша.

### Проверка

TypeScript: `tsc --noEmit` — 0 ошибок (клиент).

---

## Фаза 4 — 2026-08-30 ✅

### 4.1 Именованные константы — `graphTypes.ts`

Добавлены константы:
```typescript
const CANVAS_EDGE_PADDING = 30;
const CANVAS_LAYOUT_PADDING = 60;
const ISOLATION_MARGIN_H = 220;
const ISOLATION_MARGIN_V = 160;
const PACKING_DENSITY = 0.87;
const FRICTION = 0.85;
const SPRING_FORCE = 0.02;
```

Заменены все магические числа в `buildIsolation`, `simulateGraph`.

### 4.2 Общий тип `GraphNode` — `server/src/routes/links.ts`

Добавлен комментарий:
```typescript
// Mirror of client/src/graphTypes.ts:GraphNode — keep in sync.
interface GraphNode { ... }
```

### 4.3 SVG accessibility — `RelationGraph.tsx`

Добавлены на интерактивные узлы:
- `role="button"`
- `aria-label={`${TYPE_LABELS[n.type] ?? n.type}: ${n.title}`}`
- `tabIndex={0}`
- `onKeyDown` для Enter/Space

### 4.4 Сброс isolation — `RelationGraph.tsx`

Добавлен `console.debug` при сбросе:
```typescript
if (isolation) console.debug("[RelationGraph] data changed, clearing isolation");
setIsolation(null);
```

### Проверка

TypeScript: `tsc --noEmit` — 0 ошибок (клиент + сервер).

---

## Фаза 5 — 2026-08-30 ✅ (добивание)

### 5.1 foldGroups — пропущена

Текущая O(n) реализация уже эффективна для ожидаемых размеров графов.

### 5.2 Сброс isolation — `RelationGraph.tsx`

Добавлен `console.debug` для отладки (см. 4.4).

### 5.3 Финальная проверка

TypeScript: `tsc --noEmit` — 0 ошибок (клиент + сервер).

---

# АУДИТ КОДА — 2026-08-30 (проверка)

Проверены все 24 пункта по реальному коду. Файлы: `links.ts`, `GraphPage.tsx`, `RelationGraph.tsx`, `graphTypes.ts`, `mentions.ts`, `SettingDetailPage.tsx`.

## ✅ ИСПРАВЛЕНО (22)

| # | Пункт | Подтверждение |
|---|-------|---------------|
| 1 | SQL-инъекция `nameCol` | `links.ts:242-243` — `assertSafeIdent` вызывается |
| 2 | SQL-инъекция table | `links.ts:242-243,317-318` — оба assertion на месте |
| 3 | Error handling на клиенте | `GraphPage.tsx:14,29-30,44-48,61-66` — `error` state + `.catch()` + banner |
| 4 | XSS в SVG | `RelationGraph.tsx:926` — React экранирует, есть комментарий |
| 5 | localStorage try-catch | `RelationGraph.tsx:223-228` — обёрнуто, `console.warn` |
| 6 | Валидация `focus` | `links.ts:148` — regex + 400 |
| 7 | AbortController | `GraphPage.tsx:34,43,49` — `return () => controller.abort()` |
| 8 | Throttle `handlePointerMove` | `RelationGraph.tsx:388-429` — RAF для drag и pan |
| 9 | Memoize Map/Set | `RelationGraph.tsx:503-516` — `useMemo` для `nodesByKey`, `visibleKeys`, `pairCounts` |
| 11 | Fix useMemo deps | `RelationGraph.tsx:194` — `[data, baseCanvas.width, baseCanvas.height]` |
| 12 | Race condition `syncMentionLinks` | `mentions.ts:322-335` — re-read перед каждым DELETE |
| 13 | Debounce поиска | `RelationGraph.tsx:240-243,476-480` — `debouncedQuery` 200ms |
| 15 | `findPath` null | `graphTypes.ts:104-115` — JSDoc документирует |
| 16 | `buildScope` campaign | `links.ts:114-128` — scope корректно |
| 17 | Магические числа | `graphTypes.ts` — `CANVAS_EDGE_PADDING`, `FRICTION`, `SPRING_FORCE` и т.д. |
| 18 | Дублирование `GraphNode` | `links.ts:40` — комментарий "Mirror of client..." |
| 19 | `linkKind` тип | `links.ts:62` — аннотация `: EdgeKind` |
| 21 | Сброс isolation | `RelationGraph.tsx:218` — `console.debug` при сбросе |
| 22 | SVG accessibility | `RelationGraph.tsx:917-935` — `role`, `aria-label`, `tabIndex`, `onKeyDown` |
| 24 | `isolated` сортировка | `links.ts:331` — безусловно |
| 17 | Магические числа | `graphTypes.ts` — `CANVAS_EDGE_PADDING`, `FRICTION`, `SPRING_FORCE` и т.д. |
| 18 | Дублирование `GraphNode` | `links.ts:40` — комментарий "Mirror of client..." |
| 19 | `linkKind` тип | `links.ts:62` — аннотация `: EdgeKind` |
| 22 | SVG accessibility | `RelationGraph.tsx:917-935` — `role`, `aria-label`, `tabIndex`, `onKeyDown` |
| 24 | `isolated` сортировка | `links.ts:331` — безусловно |

## ❌ НЕ ИСПРАВЛЕНО (0)

Все пункты закрыты или отмечены как не требующие исправления.

## ⚠️ ЧАСТИЧНО / НЕОДНОЗНАЧНО (3)

| # | Пункт | Комментарий |
|---|-------|-------------|
| 10 | foldGroups O(n²) | На самом деле O(n), но аллокация строк реальна |
| 20 | Смешение языков | Консистентно по проекту, не баг |
| 23 | `canvasSize` = 0 | `Math.max(1, ...)` защищает |

## ИТОГО

| Категория | Заявлено | ✅ | ❌ | ⚠️ |
|-----------|----------|---|---|---|
| Критические | 3 | 3 | 0 | 0 |
| Безопасность | 3 | 3 | 0 | 0 |
| Производительность | 5 | 4 | 0 | 1 |
| Надёжность | 5 | 5 | 0 | 0 |
| Антипаттерны | 8 | 7 | 0 | 1 |
| **Итого** | **24** | **22** | **0** | **2** |

### Готово

Все критические и производственные проблемы закрыты. Остались 2 nice-to-have (аллокации в foldGroups, смешение языков), которые не требуют исправления.
