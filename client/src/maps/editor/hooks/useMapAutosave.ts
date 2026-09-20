import { useEffect, useRef, useState } from "react";
import type { GeneratorParams } from "../../generate";
import type { MapFull } from "../../mapTypes";
import type { MapCells } from "../../render";

// Автосохранение карты (Фаза 1, Этап Autosave): тот же механизм, что раньше
// жил инлайном в MapEditorPage. Приоритет — гарантии, а не размер хука:
// debounce 800ms, эталон нормализованного состояния, seq-защита от гонок,
// thumbnail throttle 2.5s, dirty/error/retry, beforeunload, corrupt-блок.
// Транспорт (PUT) и рендер миниатюры приходят колбэками — хук их не знает.

// KNOWN QUIRKS (техдолг Фазы 1, НЕ исправлять здесь — зафиксировано
// владельцем после Этапа Autosave; менять только отдельным решением):
// 1. revert к эталону не шлёт PUT, но оставляет status=dirty (ранний return
//    в debounce-эффекте не сбрасывает статус обратно в saved);
// 2. debounce-таймер не перепроверяет эталон перед sendSave;
// 3. retry() не проверяет blocked (corrupt-guard);
// 4. onSaved вызывается для каждого ответа, включая проигравший seq-response
//    (проверка pendingSeq идёт после).

export type MapSaveKind = "saved" | "dirty" | "saving" | "error";

export interface MapSaveStatus {
  kind: MapSaveKind;
  at: string;
}

export interface MapSaveBody {
  cells: string;
  thumbnail: string | null;
  seed: number;
  sea: number;
  mountains: number;
  forest: number;
}

interface UseMapAutosaveArgs {
  map: MapFull | null;
  cells: MapCells;
  params: GeneratorParams;
  serializeCells: (c: MapCells) => string;
  save: (mapId: number, body: MapSaveBody) => Promise<unknown>;
  buildThumbnail: (m: MapFull, live: MapCells) => string | null;
  onSaved?: (mapId: number) => void;
  debounceMs?: number;
  thumbnailThrottleMs?: number;
}

export const MAP_AUTOSAVE_DEBOUNCE_MS = 800;
export const MAP_AUTOSAVE_THUMB_THROTTLE_MS = 2500;

export function useMapAutosave({
  map,
  cells,
  params,
  serializeCells,
  save,
  buildThumbnail,
  onSaved,
  debounceMs = MAP_AUTOSAVE_DEBOUNCE_MS,
  thumbnailThrottleMs = MAP_AUTOSAVE_THUMB_THROTTLE_MS,
}: UseMapAutosaveArgs) {
  const [status, setStatus] = useState<MapSaveStatus>({ kind: "saved", at: "" });
  // P1-7: после битого blob автоматический save запрещён до явного разрешения.
  const [blocked, setBlocked] = useState(false);
  // Эталон последнего сохранённого — в нормализованной форме (порядок
  // ключей/пробелы сырого blob'а иначе давали бы ложное «изменено»).
  const etalonRef = useRef<string>("");
  // Версии против гонки (P1-6): два overlapping PUT — побеждает поздний
  // мазок, а не поздний ответ; устаревший ответ игнорируется по seq.
  const saveSeqRef = useRef(0);
  const pendingSeqRef = useRef(0);
  // Кэш миниатюры (P1-5): печь canvas+toDataURL на каждый мазок дорого.
  const thumbCacheRef = useRef<{ cells: string; thumb: string | null; at: number }>({
    cells: "",
    thumb: null,
    at: 0,
  });
  // Живое состояние для retry (same-tick, как раньше cellsRef): retry шлёт
  // актуальное, а не snapshot из debounce-замыкания.
  const liveRef = useRef({ cells, params });
  liveRef.current = { cells, params };
  // Транспорт — через ref: в эффектах от него не зависим (как раньше от
  // модульных write/renderThumbnail), всегда вызываем свежий.
  const transportRef = useRef({ save, buildThumbnail, onSaved });
  transportRef.current = { save, buildThumbnail, onSaved };

  const stampedNow = () =>
    new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  const keyOf = (cellsStr: string, paramsStr: string) => `${cellsStr}|${paramsStr}`;

  function pickThumbnail(m: MapFull, cellsStr: string, live: MapCells): string | null {
    const cached = thumbCacheRef.current;
    // Клетки те же — шлём готовое; строчим быстрее throttle — шлём null
    // (сервер COALESCE оставляет старое превью); на паузе — печём свежее.
    if (cellsStr === cached.cells) return cached.thumb;
    if (Date.now() - cached.at < thumbnailThrottleMs) return null;
    const thumb = transportRef.current.buildThumbnail(m, live);
    thumbCacheRef.current = { cells: cellsStr, thumb, at: Date.now() };
    return thumb;
  }

  function sendSave(payload: {
    cellsStr: string;
    paramsStr: string;
    thumb: string | null;
    params: GeneratorParams;
  }) {
    if (!map) return;
    const seq = ++saveSeqRef.current;
    pendingSeqRef.current = seq;
    setStatus((s) => ({ ...s, kind: "saving" }));
    const mapId = map.id;
    transportRef.current
      .save(mapId, { cells: payload.cellsStr, thumbnail: payload.thumb, ...payload.params })
      .then(() => {
        // Список карт (дата, миниатюра) — и в других окнах; привязки не задеты.
        transportRef.current.onSaved?.(mapId);
        if (pendingSeqRef.current !== seq) return;
        etalonRef.current = keyOf(payload.cellsStr, payload.paramsStr);
        setStatus({ kind: "saved", at: stampedNow() });
      })
      .catch(() => {
        if (pendingSeqRef.current !== seq) return;
        setStatus((s) => ({ ...s, kind: "error" }));
      });
  }

  // Debounce; пропуск, если клетки равны последним сохранённым — так загрузка
  // и undo-в-ту-же-точку ничего не шлют.
  useEffect(() => {
    if (!map) return;
    if (blocked) return; // P1-7: поверх битого — только с явного разрешения
    const cellsStr = serializeCells(cells);
    const paramsStr = JSON.stringify(params);
    if (keyOf(cellsStr, paramsStr) === etalonRef.current) return;
    setStatus((s) => (s.kind === "saving" ? s : { kind: "dirty", at: s.at }));
    const snapshot = { live: cells, params };
    const timer = setTimeout(() => {
      if (!map) return;
      sendSave({
        cellsStr,
        paramsStr,
        thumb: pickThumbnail(map, cellsStr, snapshot.live),
        params: snapshot.params,
      });
    }, debounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, params, map, blocked]);

  // Повтор сохранения вручную (P0-1): при kind === "error" следующий мазок
  // и так повторит, но закрытие вкладки до него теряло данные — поэтому
  // рядом со статусом есть кнопка «Повторить», а уход с несохранённым
  // тормозит beforeunload.
  function retry() {
    if (!map) return;
    const live = liveRef.current;
    const cellsStr = serializeCells(live.cells);
    const paramsStr = JSON.stringify(live.params);
    if (keyOf(cellsStr, paramsStr) === etalonRef.current) {
      setStatus({ kind: "saved", at: stampedNow() });
      return;
    }
    sendSave({
      cellsStr,
      paramsStr,
      thumb: pickThumbnail(map, cellsStr, live.cells),
      params: live.params,
    });
  }

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // P0-D: ошибка сохранения — тоже несохранённые данные (кнопка «Повторить»
      // есть, но уход до неё молча терял бы работу).
      if (status.kind === "dirty" || status.kind === "saving" || status.kind === "error") {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [status.kind]);

  // Начало загрузки новой карты: баннер битого blob гаснет, остальное —
  // как было (статус/эталон перепишет markLoaded по факту данных).
  function beginLoad() {
    setBlocked(false);
  }

  // Данные с сервера применены: эталон + статус + corrupt-блок одним шагом.
  function markLoaded(cellsStr: string, paramsStr: string, corrupt: boolean) {
    etalonRef.current = keyOf(cellsStr, paramsStr);
    setStatus({ kind: "saved", at: "" });
    setBlocked(corrupt);
  }

  // Явное разрешение из баннера: «Понял, разрешаю перезапись».
  function allowOverwrite() {
    setBlocked(false);
  }

  return {
    status,
    blocked,
    isDirty: status.kind !== "saved",
    retry,
    beginLoad,
    markLoaded,
    allowOverwrite,
  };
}
