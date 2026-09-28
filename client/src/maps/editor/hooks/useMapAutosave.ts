import { useEffect, useRef, useState } from "react";
import type { GeneratorParams } from "../../generate";
import type { MapFull } from "../../mapTypes";
import type { MapDocumentV5 } from "../../core/types";

// Автосохранение карты (Фаза 2G: value = MapDocumentV5 вместо MapCells).
// Механизм: debounce 800ms, эталон нормализованного состояния
// (canonical serialization), последовательные записи, thumbnail
// throttle 2.5s, dirty/error/retry, beforeunload, corrupt-блок.
// Транспорт (PUT с `document`) и рендер миниатюры приходят колбэками.

// В каждый момент для одной страницы открыт максимум один PUT. После его
// завершения отправляется текущее состояние, если за время запроса были правки.

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
  const epochRef = useRef(0);
  const inFlightRef = useRef<{ epoch: number; key: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);
  const blockedRef = useRef(blocked);
  const disabledRef = useRef(disabled);
  blockedRef.current = blocked;
  disabledRef.current = disabled;
  // Кэш миниатюры (P1-5): печь canvas+toDataURL на каждый мазок дорого.
  const thumbCacheRef = useRef<{ doc: string; thumb: string | null; at: number }>({
    doc: "",
    thumb: null,
    at: 0,
  });
  // Живое состояние для retry (same-tick, как раньше documentRef): retry шлёт
  // актуальное, а не snapshot из debounce-замыкания.
  const liveRef = useRef({ map, value, params });
  liveRef.current = { map, value, params };
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

  function liveSnapshot() {
    const live = liveRef.current;
    if (!live.map || !live.value) return null;
    const docStr = serialize(live.value);
    const paramsStr = JSON.stringify(live.params);
    return {
      map: live.map,
      value: live.value,
      params: live.params,
      docStr,
      paramsStr,
      key: keyOf(docStr, paramsStr),
    };
  }

  function sendSave(payload: {
    map: MapFull;
    key: string;
    docStr: string;
    paramsStr: string;
    thumb: string | null;
    params: GeneratorParams;
  }) {
    const epoch = epochRef.current;
    inFlightRef.current = { epoch, key: payload.key };
    setStatus((s) => ({ ...s, kind: "saving" }));
    const mapId = payload.map.id;
    transportRef.current
      .save(mapId, { document: payload.docStr, thumbnail: payload.thumb, ...payload.params })
      .then(() => {
        if (epochRef.current !== epoch) return;
        inFlightRef.current = null;
        etalonRef.current = payload.key;
        transportRef.current.onSaved?.(mapId);
        const latest = liveSnapshot();
        if (latest && latest.map.id === mapId && latest.key !== payload.key && !loadingRef.current && !blockedRef.current && !disabledRef.current) {
          sendSave({ ...latest, thumb: pickThumbnail(latest.map, latest.docStr, latest.value) });
        } else {
          setStatus({ kind: "saved", at: stampedNow() });
        }
      })
      .catch(() => {
        if (epochRef.current !== epoch) return;
        inFlightRef.current = null;
        const latest = liveSnapshot();
        if (latest && latest.map.id === mapId && latest.key !== payload.key && latest.key !== etalonRef.current && !loadingRef.current && !blockedRef.current && !disabledRef.current) {
          sendSave({ ...latest, thumb: pickThumbnail(latest.map, latest.docStr, latest.value) });
        } else if (latest?.key === etalonRef.current) {
          setStatus({ kind: "saved", at: stampedNow() });
        } else {
          setStatus((s) => ({ ...s, kind: "error" }));
        }
      });
  }

  function saveLatest() {
    if (loadingRef.current || blockedRef.current || disabledRef.current || inFlightRef.current) return;
    const latest = liveSnapshot();
    if (!latest) return;
    if (latest.key === etalonRef.current) {
      setStatus({ kind: "saved", at: stampedNow() });
      return;
    }
    sendSave({ ...latest, thumb: pickThumbnail(latest.map, latest.docStr, latest.value) });
  }

  // Debounce; пропуск, если документ равен последнему сохранённому — так
  // загрузка и undo-в-ту-же-точку ничего не шлют.
  useEffect(() => {
    if (!map || !value) return;
    if (loadingRef.current || blocked || disabled) return;
    const docStr = serialize(value);
    const paramsStr = JSON.stringify(params);
    if (keyOf(docStr, paramsStr) === etalonRef.current && !inFlightRef.current) {
      setStatus((s) => s.kind === "saved" ? s : { kind: "saved", at: stampedNow() });
      return;
    }
    setStatus((s) => (s.kind === "saving" ? s : { kind: "dirty", at: s.at }));
    if (inFlightRef.current) return;
    const timer = setTimeout(saveLatest, debounceMs);
    timerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (timerRef.current === timer) timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, params, map, blocked, disabled]);

  // Повтор сохранения вручную после ошибки; блокировка повреждённого или
  // неподдерживаемого документа действует и для этой кнопки.
  function retry() {
    saveLatest();
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
    epochRef.current += 1;
    inFlightRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    loadingRef.current = true;
    blockedRef.current = false;
    setBlocked(false);
  }

  // Данные с сервера применены: эталон + статус + corrupt-блок одним шагом.
  function markLoaded(docStr: string, paramsStr: string, corrupt: boolean) {
    etalonRef.current = keyOf(docStr, paramsStr);
    loadingRef.current = false;
    blockedRef.current = corrupt;
    setStatus({ kind: "saved", at: "" });
    setBlocked(corrupt);
  }

  // Явное разрешение из баннера: «Понял, разрешаю перезапись».
  // Unsupported V5 не разблокирует (его сохранять нельзя, §57 ТЗ).
  function allowOverwrite() {
    blockedRef.current = false;
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
