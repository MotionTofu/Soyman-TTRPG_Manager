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

export type MapSaveKind = "saved" | "dirty" | "saving" | "error" | "conflict";

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
  expectedRevision?: number;
}

interface UseMapAutosaveArgs<T = MapDocumentV5> {
  map: MapFull | null;
  value: T | null;
  params: GeneratorParams;
  serialize: (v: T) => string;
  save: (mapId: number, body: MapSaveBody) => Promise<unknown>;
  buildThumbnail: (m: MapFull, live: T) => string | null;
  onSaved?: (mapId: number) => void;
  debounceMs?: number;
  thumbnailThrottleMs?: number;
  /** Unsupported V5 (§57 ТЗ): автосейв заблокирован независимо от corrupt-блока. */
  disabled?: boolean;
  getValue?: () => T | null;
  isEditing?: () => boolean;
}

export const MAP_AUTOSAVE_DEBOUNCE_MS = 800;
export const MAP_AUTOSAVE_THUMB_THROTTLE_MS = 2500;

export function useMapAutosave<T = MapDocumentV5>({
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
  getValue,
  isEditing,
}: UseMapAutosaveArgs<T>) {
  const [status, setStatus] = useState<MapSaveStatus>({ kind: "saved", at: "" });
  // P1-7: после битого blob автоматический save запрещён до явного разрешения.
  // На 2G сюда же входит unsupported V5 (§57 ТЗ): валиден, но редактор
  // его не умеет — сохранять нельзя.
  const [blocked, setBlocked] = useState(false);
  // Эталон последнего сохранённого — canonical serialization (§53 ТЗ).
  const etalonRef = useRef<string>("");
  const epochRef = useRef(0);
  const revisionRef = useRef<number | undefined>(undefined);
  const conflictRef = useRef(false);
  const failureRef = useRef(false);
  const recordWriteRef = useRef(false);
  const pendingSaveRef = useRef<Promise<void> | null>(null);
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
  const liveRef = useRef({ map, value, params, getValue, isEditing });
  liveRef.current = { map, value, params, getValue, isEditing };
  // Транспорт — через ref: в эффектах от него не зависим (как раньше от
  // модульных write/renderThumbnail), всегда вызываем свежий.
  const transportRef = useRef({ save, buildThumbnail, onSaved });
  transportRef.current = { save, buildThumbnail, onSaved };

  const stampedNow = () =>
    new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  const keyOf = (docStr: string, paramsStr: string) => `${docStr}|${paramsStr}`;

  function pickThumbnail(m: MapFull, docStr: string, live: T): string | null {
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
    const current = live.getValue ? live.getValue() : live.value;
    if (!live.map || !current) return null;
    const docStr = serialize(current);
    const paramsStr = JSON.stringify(live.params);
    return {
      map: live.map,
      value: current,
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
    failureRef.current = false;
    inFlightRef.current = { epoch, key: payload.key };
    setStatus((s) => ({ ...s, kind: "saving" }));
    const mapId = payload.map.id;
    const pending = transportRef.current
      .save(mapId, { document: payload.docStr, thumbnail: payload.thumb, ...payload.params,
        ...(revisionRef.current === undefined ? {} : { expectedRevision: revisionRef.current }) })
      .then((response) => {
        if (epochRef.current !== epoch) return;
        if (response && typeof response === "object" && "revision" in response && typeof response.revision === "number") revisionRef.current = response.revision;
        inFlightRef.current = null;
        etalonRef.current = payload.key;
        transportRef.current.onSaved?.(mapId);
        const latest = liveSnapshot();
        if (latest && latest.map.id === mapId && latest.key !== payload.key && !recordWriteRef.current && !loadingRef.current && !blockedRef.current && !disabledRef.current && !liveRef.current.isEditing?.()) {
          sendSave({ ...latest, thumb: pickThumbnail(latest.map, latest.docStr, latest.value) });
        } else {
          setStatus({ kind: latest && latest.key !== payload.key ? "dirty" : "saved", at: stampedNow() });
        }
      })
      .catch((error: unknown) => {
        if (epochRef.current !== epoch) return;
        failureRef.current = true;
        inFlightRef.current = null;
        const failure = error as { status?: number; payload?: { code?: string } } | null;
        if (failure?.status === 409 && (failure.payload?.code === "map-revision-conflict" || failure.payload?.code === "map-version-unsupported")) {
          conflictRef.current = true;
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = null;
          setStatus((s) => ({ ...s, kind: "conflict" }));
          return;
        }
        const latest = liveSnapshot();
        if (latest && latest.map.id === mapId && latest.key !== payload.key && latest.key !== etalonRef.current && !recordWriteRef.current && !loadingRef.current && !blockedRef.current && !disabledRef.current && !liveRef.current.isEditing?.()) {
          sendSave({ ...latest, thumb: pickThumbnail(latest.map, latest.docStr, latest.value) });
        } else if (latest?.key === etalonRef.current) {
          setStatus({ kind: "saved", at: stampedNow() });
        } else {
          setStatus((s) => ({ ...s, kind: "error" }));
        }
      });
    pendingSaveRef.current = pending;
  }

  function saveLatest() {
    if (loadingRef.current || blockedRef.current || disabledRef.current || conflictRef.current || recordWriteRef.current || inFlightRef.current || liveRef.current.isEditing?.()) return;
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
    if (loadingRef.current || blocked || disabled || conflictRef.current) return;
    // During a live stroke the next snapshot is deliberately unsettled. Mark
    // dirty cheaply; completion already schedules saveLatest with the final value.
    if (liveRef.current.isEditing?.()) {
      setStatus(s => s.kind === "saving" || s.kind === "dirty" ? s : { kind: "dirty", at: s.at });
      return;
    }
    const docStr = serialize(value);
    const paramsStr = JSON.stringify(params);
    if (keyOf(docStr, paramsStr) === etalonRef.current && !inFlightRef.current) {
      setStatus((s) => s.kind === "saved" ? s : { kind: "saved", at: stampedNow() });
      return;
    }
    setStatus((s) => (s.kind === "saving" || s.kind === "dirty" ? s : { kind: "dirty", at: s.at }));
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

  function schedule() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(saveLatest, debounceMs);
  }

  /** Drain the latest state, including edits made during an in-flight write.
   * Failure returns false; navigation must keep the editor mounted. */
  async function flush(): Promise<boolean> {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const epoch = epochRef.current;
    if (loadingRef.current || recordWriteRef.current || liveRef.current.isEditing?.()) return false;
    const latest = liveSnapshot();
    if (!latest) return true;
    if (conflictRef.current) return false;
    if (blockedRef.current || disabledRef.current) return latest.key === etalonRef.current;
    if (!inFlightRef.current) saveLatest();
    while (inFlightRef.current && epoch === epochRef.current) {
      await pendingSaveRef.current;
    }
    if (epoch !== epochRef.current || failureRef.current || conflictRef.current) return false;
    return liveSnapshot()?.key === etalonRef.current;
  }

  function hasPendingChanges(): boolean {
    const latest = liveSnapshot();
    return !!inFlightRef.current || !!recordWriteRef.current || (!!latest && latest.key !== etalonRef.current);
  }

  /** Metadata shares the same revision and cannot race an autosave in this window. */
  async function saveRecord<R>(write: (expectedRevision: number | undefined) => Promise<R>): Promise<R> {
    if (recordWriteRef.current) throw new Error("Дождитесь завершения сохранения карты");
    if (conflictRef.current) throw new Error("Карта изменена в другом окне. Сначала сохраните копию своих правок");
    const epoch = epochRef.current;
    recordWriteRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    try {
      if (inFlightRef.current) await pendingSaveRef.current;
      if (epoch !== epochRef.current || conflictRef.current || failureRef.current) throw new Error("Сохранение остановлено. Сначала сохраните копию своих правок");
      const result = await write(revisionRef.current);
      if (epoch === epochRef.current && result && typeof result === "object" && "revision" in result && typeof result.revision === "number") revisionRef.current = result.revision;
      return result;
    } catch (error) {
      const failure = error as { status?: number; payload?: { code?: string } } | null;
      if (epoch === epochRef.current && failure?.status === 409 && failure.payload?.code === "map-revision-conflict") {
        conflictRef.current = true;
        setStatus((s) => ({ ...s, kind: "conflict" }));
      }
      throw error;
    } finally {
      // Let the caller apply returned metadata/resize before reading live state.
      if (epoch === epochRef.current) {
        recordWriteRef.current = false;
        timerRef.current = setTimeout(saveLatest, debounceMs);
      }
    }
  }

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // P0-D: ошибка сохранения — тоже несохранённые данные (кнопка «Повторить»
      // есть, но уход до неё молча терял бы работу).
      if (hasPendingChanges()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  });

  // Начало загрузки новой карты: баннер битого blob гаснет, остальное —
  // как было (статус/эталон перепишет markLoaded по факту данных).
  function beginLoad() {
    epochRef.current += 1;
    inFlightRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    loadingRef.current = true;
    conflictRef.current = false;
    failureRef.current = false;
    revisionRef.current = undefined;
    recordWriteRef.current = false;
    pendingSaveRef.current = null;
    blockedRef.current = false;
    setBlocked(false);
  }

  // Данные с сервера применены: эталон + статус + corrupt-блок одним шагом.
  function markLoaded(docStr: string, paramsStr: string, corrupt: boolean, revision?: number) {
    revisionRef.current = revision;
    conflictRef.current = false;
    failureRef.current = false;
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

  useEffect(() => () => {
    epochRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  return {
    status,
    blocked,
    isDirty: status.kind !== "saved",
    retry,
    schedule,
    flush,
    hasPendingChanges,
    saveRecord,
    beginLoad,
    markLoaded,
    allowOverwrite,
  };
}
