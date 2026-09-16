import type { Affect } from "./entities";

/**
 * Холст в слое данных (docs/adr/0001, группа «холст», часть 1 — доска).
 *
 * Доска — один ресурс слоя под своим адресом `GET /canvas/board?…`. Ноды React
 * Flow по-прежнему строятся из неё на странице, но сама доска лежит в кэше, и
 * соседнее окно с той же доской получает правку адресным сигналом: переставляет
 * ноды на месте, а не перезагружается целиком, как раньше на каждый сдвиг.
 */

export const canvasPaths = {
  index: () => "/canvas/index",
  presets: () => "/canvas/presets",
};

/**
 * Сдвиг нод, размер и свёртка рамки, привязка к группе: задета только эта
 * доска. Адрес доски — префикс и для входа с кампанией
 * (`arc_id=27&campaign_id=5`), поэтому окно, открывшее ту же доску через
 * кампанию, тоже её получит.
 */
export function boardLayoutAffects(boardUrl: string): Affect[] {
  return [{ path: boardUrl }];
}

/**
 * Объект доски создан, удалён или переименован: сама доска и экран выбора —
 * на нём у свободной доски написано число объектов.
 */
export function boardObjectAffects(boardUrl: string): Affect[] {
  return [{ path: boardUrl }, { path: canvasPaths.index() }];
}

/**
 * Правка сюжета с холста (часть 2): сцена, проверка, исход, переход, состав,
 * полка, набор. Задевает то же, что правка на странице сцены — сцены,
 * приключения, пульт и сессии (там сцены вечера и шпаргалки), все доски, — и
 * сверх того проверки, полку заготовок и связи (состав сцены лежит связями).
 *
 * Перечитывается из этого только открытое: на холсте это доска и панель.
 */
export function canvasStoryAffects(): Affect[] {
  return [
    { kind: "scene" },
    { kind: "adventure" },
    { path: "/story/checks" },
    { path: "/story/library" },
    { path: "/links" },
    { path: "/sessions" },
    { path: "/canvas" },
  ];
}

/**
 * Правка на экране выбора досок (часть 3): свободная доска создана,
 * переименована, переехала к другому владельцу, ушла в архив. Задет список
 * досок экрана выбора и список свободных досок мастера «Открыть»; архив — на
 * своей странице.
 */
export function boardIndexAffects(): Affect[] {
  return [{ path: canvasPaths.index() }, { path: "/canvas/free-boards" }, { path: "/archive" }];
}

/**
 * Действие с подписью для плашки: плашка сама начинается с «Не сохранилось:»,
 * а без подписи Мастер увидел бы только «502 Bad Gateway» и не понял бы, что
 * именно не вышло. Экран выбора пишет через общий `useAction`, у которого
 * своей подписи нет.
 */
export function labelled<R>(label: string, action: () => Promise<R>): () => Promise<R> {
  return () =>
    action().catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error ?? "");
      throw new Error(reason ? `${label} — ${reason}` : label);
    });
}

// ─── Раскладка ───────────────────────────────────────────────────────────────

/** Одна запись раскладки: путь и тело PUT. */
export interface LayoutWrite {
  path: string;
  body: Record<string, unknown>;
}

type LayoutNode = Record<string, unknown> & { node_type: string; node_id: number };

const NODES_PATH = "/canvas/board/nodes";

function nodeKey(n: LayoutNode): string {
  return `${n.node_type}:${n.node_id}`;
}

function isNodesWrite(write: LayoutWrite): boolean {
  return write.path === NODES_PATH && Array.isArray(write.body.nodes);
}

/**
 * Слить новую запись с прежней неотправленной по тому же пути: новое поверх
 * старого, поле к полю. У раскладки нод — нода к ноде: сдвиг одной ноды не
 * должен стереть несохранённую привязку соседней к группе.
 */
export function mergeLayoutWrite(prev: LayoutWrite | undefined, next: LayoutWrite): LayoutWrite {
  if (!prev) return next;
  if (!isNodesWrite(prev) || !isNodesWrite(next)) return { path: next.path, body: { ...prev.body, ...next.body } };
  const byKey = new Map<string, LayoutNode>();
  for (const n of prev.body.nodes as LayoutNode[]) byKey.set(nodeKey(n), n);
  for (const n of next.body.nodes as LayoutNode[]) byKey.set(nodeKey(n), { ...byKey.get(nodeKey(n)), ...n });
  return { path: next.path, body: { ...prev.body, ...next.body, nodes: [...byKey.values()] } };
}

/**
 * Вычесть из неотправленного то, что сейчас удачно записалось: удавшийся
 * `{w,h}` рамки не отменяет несохранённых `{x,y}`. null — неотправленного
 * больше нет.
 */
export function subtractLayoutWrite(pending: LayoutWrite, done: LayoutWrite): LayoutWrite | null {
  if (pending.path !== done.path) return pending;
  if (isNodesWrite(pending) && isNodesWrite(done)) {
    const doneByKey = new Map((done.body.nodes as LayoutNode[]).map((n) => [nodeKey(n), n]));
    const left: LayoutNode[] = [];
    for (const n of pending.body.nodes as LayoutNode[]) {
      const d = doneByKey.get(nodeKey(n));
      if (!d) {
        left.push(n);
        continue;
      }
      const rest = Object.fromEntries(Object.entries(n).filter(([k]) => !(k in d)));
      if (Object.keys(rest).length) left.push({ ...rest, node_type: n.node_type, node_id: n.node_id } as LayoutNode);
    }
    return left.length ? { path: pending.path, body: { ...pending.body, nodes: left } } : null;
  }
  const rest = Object.fromEntries(Object.entries(pending.body).filter(([k]) => !(k in done.body)));
  return Object.keys(rest).length ? { path: pending.path, body: rest } : null;
}

export interface LayoutWriterDeps {
  send: (write: LayoutWrite) => Promise<unknown>;
  /** Запись удалась — сказать другим окнам. */
  notify: () => void;
  /** Показать плашку (или обновить ту же); возвращает её id. */
  showError: (message: string, retry: () => Promise<void>) => number;
  dismiss: (id: number) => void;
}

/** Плашка сама начинается с «Не сохранилось:» — здесь только что. */
export const LAYOUT_ERROR = "Раскладка холста";

/**
 * Записи раскладки с одной плашкой на все отказы (решение по группе «холст»,
 * Q3 разбора группы 3).
 *
 * Перетаскивание рождает много мелких записей подряд, и при лежащем сервере
 * плашка на каждую посыпалась бы пачкой. Здесь неотправленное копится по пути
 * (последнее состояние поверх прежнего), плашка одна, а «Повторить» досылает
 * всё накопленное. Удачная запись вычитает из накопленного то, что сама
 * покрыла; опустело — плашка уходит без нажатия.
 *
 * Нода на экране при отказе остаётся там, куда её поставили: откат под рукой
 * сбивает с толку сильнее, чем плашка.
 */
export function createLayoutWriter(deps: LayoutWriterDeps) {
  const pending = new Map<string, LayoutWrite>();
  let noticeId: number | null = null;

  function settle(done: LayoutWrite) {
    const left = pending.get(done.path);
    if (left) {
      const rest = subtractLayoutWrite(left, done);
      if (rest) pending.set(done.path, rest);
      else pending.delete(done.path);
    }
    if (pending.size === 0 && noticeId != null) {
      deps.dismiss(noticeId);
      noticeId = null;
    }
  }

  async function retry(): Promise<void> {
    for (const write of [...pending.values()]) {
      await deps.send(write);
      settle(write);
    }
    deps.notify();
  }

  async function put<R = unknown>(write: LayoutWrite): Promise<R | undefined> {
    try {
      const result = (await deps.send(write)) as R;
      settle(write);
      deps.notify();
      return result;
    } catch (error) {
      pending.set(write.path, mergeLayoutWrite(pending.get(write.path), write));
      const reason = error instanceof Error ? error.message : String(error ?? "");
      // Плашки склеиваются по тексту, а причина от отказа к отказу может
      // меняться (502, таймаут) — прежнюю снимаем сами, чтобы плашка была одна.
      if (noticeId != null) deps.dismiss(noticeId);
      noticeId = deps.showError(reason ? `${LAYOUT_ERROR} — ${reason}` : LAYOUT_ERROR, retry);
      return undefined;
    }
  }

  return { put, hasPending: () => pending.size > 0 };
}

export type LayoutWriter = ReturnType<typeof createLayoutWriter>;
