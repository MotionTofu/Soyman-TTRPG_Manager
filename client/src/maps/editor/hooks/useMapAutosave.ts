import { useEffect, useRef, useState } from "react";
import type { GeneratorParams } from "../../generate";
import type { MapFull } from "../../mapTypes";
import type { MapDocumentV5 } from "../../core/types";

// Автосохранение карты (Фаза 2G: value = MapDocumentV5 вместо MapCells).
// Механизм — тот же, что раньше: debounce 800ms, эталон нормализованного
// состояния (canonical serialization), seq-защита от гонок, thumbnail
// throttle 2.5s, dirty/error/retry, beforeunload, corrupt-блок.
// Транспорт (PUT с `document`) и рендер миниатюры приходят колбэками.

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
  document: string;
  thumbnail: string | null;
  seed: number;
  sea: number;
  mountains: number;
  forest: number;
}

interface UseMapAutosaveArgs {
  map: MapFull | null;
  value: MapDocumentV5 | null;
  params: GeneratorParams;
  serialize: (v: MapDocumentV5) => string;
  save: (mapId: number, body: MapSaveBody) => Promise<unknown>;
  buildThumbnail: (m: MapFull, live: MapDocumentV5) => string | null;
  onSaved?: (mapId: number) => void;
  debounceMs?: number;
  thumbnailThrottleMs?: number;
  /** Unsupported V5 (§57 ТЗ): автосейв заблокирован независимо от corrupt-блока. */
  disabled?: boolean;
}

export const MAP_AUTOSAVE_DEBOUNCE_MS = 800;
export const MAP_AUTOSAVE_THUMB_THROTTLE_MS = 2500;

export function useMapAutosave({
  map,
  value,
  params,
  serialize,
  save,
  buildThumbnail,
  onSaved,
  debounceMs = MAP_AUTOSAVE_DEBOUNCE_MS,
  thumbnailThrottleMs = MAP_AUTOSAVE_THUMB_THROTTLE_MS,
  disabled = false,
}: UseMapAutosaveArgs) {
  const [status, setStatus] = useState<MapSaveStatus>({ kind: "saved", at: "" });
  // P1-7: после битого blob автоматический save запрещён до явного разрешения.
  // На 2G сюда же входит unsupported V5 (§57 ТЗ): валиден, но редактор
  // его не умеет — сохранять нельзя.
  const [blocked, setBlocked] = useState(false);
  // Эталон последнего сохранённого — canonical serialization (§53 ТЗ).
  const etalonRef = useRef<string>("");
  // Версии против гонки (P1-6): два overlapping PUT — побеждает поздний
  // мазок, а не поздний ответ; устаревший ответ игнорируется по seq.
  const saveSeqRef = useRef(0);
  const pendingSeqRef = useRef(0);
  // Кэш миниатюры (P1-5): печь canvas+toDataURL на каждый мазок дорого.
  const thumbCacheRef = useRef<{ doc: string; thumb: string | null; at: number }>({
    doc: "",
    thumb: null,
    at: 0,
  });
  // Живое состояние для retry (same-tick, как раньше documentRef): retry шлёт
  // актуальное, а не snapshot из debounce-замыкания.
  const liveRef = useRef({ value, params });
  liveRef.current = { value, params };
  // Транспорт — через ref: в эффектах от него не зависим (как раньше от
  // модульных write/renderThumbnail), всегда вызываем свежий.
  const transportRef = useRef({ save, buildThumbnail, onSaved });
  transportRef.current = { save, buildThumbnail, onSaved };

  const stampedNow = () =>
    new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  const keyOf = (docStr: string, paramsStr: string) => `${docStr}|${paramsStr}`;

  function pickThumbnail(m: MapFull, docStr: string, live: MapDocumentV5): string | null {
    const cached = thumbCacheRef.current;
    // Документ тот же — шлём готовое; строчим быстрее throttle — шлём null
    // (сервер COALESCE оставляет старое превью); на паузе — печём свежее.
    if (docStr === cached.doc) return cached.thumb;
    if (Date.now() - cached.at < thumbnailThrottleMs) return null;
    const thumb = transportRef.current.buildThumbnail(m, live);
    thumbCacheRef.current = { doc: docStr, thumb, at: Date.now() };
    return thumb;
  }

  function sendSave(payload: {
    docStr: string;
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
      .save(mapId, { document: payload.docStr, thumbnail: payload.thumb, ...payload.params })
      .then(() => {
        // Список карт (дата, миниатюра) — и в других окнах; привязки не задеты.
        transportRef.current.onSaved?.(mapId);
        if (pendingSeqRef.current !== seq) return;
        etalonRef.current = keyOf(payload.docStr, payload.paramsStr);
        setStatus({ kind: "saved", at: stampedNow() });
      })
      .catch(() => {
        if (pendingSeqRef.current !== seq) return;
        setStatus((s) => ({ ...s, kind: "error" }));
      });
  }

  // Debounce; пропуск, если документ равен последнему сохранённому — так
  // загрузка и undo-в-ту-же-точку ничего не шлют.
  useEffect(() => {
    if (!map || !value) return;
    if (blocked || disabled) return; // P1-7 + §57: поверх битого/unsupported — только с явного разрешения (unsupported — никогда)
    const docStr = serialize(value);
    const paramsStr = JSON.stringify(params);
    if (keyOf(docStr, paramsStr) === etalonRef.current) return;
    setStatus((s) => (s.kind === "saving" ? s : { kind: "dirty", at: s.at }));
    const snapshot = { live: value, params };
    const timer = setTimeout(() => {
      if (!map) return;
      sendSave({
        docStr,
        paramsStr,
        thumb: pickThumbnail(map, docStr, snapshot.live),
        params: snapshot.params,
      });
    }, debounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, params, map, blocked, disabled]);

  // Повтор сохранения вручную (P0-1): при kind === "error" следующий мазок
  // и так повторит, но закрытие вкладки до него теряло данные — поэтому
  // рядом со статусом есть кнопка «Повторить», а уход с несохранённым
  // тормозит beforeunload.
  function retry() {
    if (!map || !liveRef.current.value) return;
    const live = liveRef.current as { value: MapDocumentV5; params: GeneratorParams };
    const docStr = serialize(live.value);
    const paramsStr = JSON.stringify(live.params);
    if (keyOf(docStr, paramsStr) === etalonRef.current) {
      setStatus({ kind: "saved", at: stampedNow() });
      return;
    }
    sendSave({
      docStr,
      paramsStr,
      thumb: pickThumbnail(map, docStr, live.value),
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
  function markLoaded(docStr: string, paramsStr: string, corrupt: boolean) {
    etalonRef.current = keyOf(docStr, paramsStr);
    setStatus({ kind: "saved", at: "" });
    setBlocked(corrupt);
  }

  // Явное разрешение из баннера: «Понял, разрешаю перезапись».
  // Unsupported V5 не разблокирует (его сохранять нельзя, §57 ТЗ).
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
