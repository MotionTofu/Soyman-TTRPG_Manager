import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { serializeMapDocumentV6, type MapDocumentV6 } from "@shared/maps/core";
import { useAfterWrite } from "../../data/hooks";
import { assessCurrentEditorCompatibility } from "../core";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { useMapAutosave } from "../editor/hooks/useMapAutosave";
import { useMapHistory } from "../editor/hooks/useMapHistory";
import type { MapFull } from "../mapTypes";
import { geometryView } from "./editDocument";
import { mapWorkspaceApi } from "./mapApi";

const clone = (document: MapDocumentV6 | null) => document ? structuredClone(document) : null;

/** One map's document: load, history, autosave and the guarded write path. */
export function useWorkspaceDocument({ mapId, isGm, leaving, isEditing, onReset, onLoaded }: {
  mapId: number; isGm: boolean; leaving: boolean;
  /** A stroke in progress: autosave waits for it. */
  isEditing: () => boolean;
  onReset: () => void; onLoaded: (map: MapFull, document: MapDocumentV6) => void;
}) {
  const afterWrite = useAfterWrite();
  const [map, setMap] = useState<MapFull | null>(null);
  const [document, setDocumentState] = useState<MapDocumentV6 | null>(null);
  const documentRef = useRef(document);
  const setDocument = (next: MapDocumentV6 | null) => { documentRef.current = next; setDocumentState(next); };
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [compatibilityError, setCompatibilityError] = useState<string | null>(null);
  const params = useMemo(() => ({ seed: map?.seed ?? 1, sea: map?.sea ?? 55, mountains: map?.mountains ?? 12, forest: map?.forest ?? 30 }),
    [map?.seed, map?.sea, map?.mountains, map?.forest]);
  const history = useMapHistory({ value: document, onChange: setDocument, clone, getValue: () => documentRef.current });
  // Published old maps remain readable by the existing player flow; edit a private copy.
  const publishedOldMap = !!map && map.player_visible === 1 && map.document_version !== 6;
  const disabled = !!compatibilityError || publishedOldMap || !isGm;
  const autosave = useMapAutosave({ map, value: document, getValue: () => documentRef.current, params, isEditing,
    serialize: serializeMapDocumentV6, save: mapWorkspaceApi.saveBody, buildThumbnail: () => null,
    disabled, onSaved: (savedId) => { setMap((record) => record?.id === savedId ? { ...record, document_version: 6 } : record); afterWrite([{ kind: "map", id: savedId, card: true }]); } });
  const writeBlocked = disabled || autosave.blocked || autosave.status.kind === "conflict";
  const callbacks = useRef({ onReset, onLoaded });
  callbacks.current = { onReset, onLoaded };

  useEffect(() => {
    if (!isGm) return;
    let alive = true;
    autosave.beginLoad(); history.clear(); setDocument(null); setMap(null);
    setLoadError(null); setActionError(null); setCompatibilityError(null);
    callbacks.current.onReset();
    mapWorkspaceApi.read(mapId).then((record) => {
      if (!alive) return;
      const loaded = loadStoredWorkspaceDocument(record);
      if (loaded.status !== "supported") {
        setLoadError(loaded.status === "unsupported" ? "Эта карта использует функции, которые редактор пока не поддерживает." : "Документ карты повреждён. Можно скачать исходник для восстановления.");
        return;
      }
      const compat = assessCurrentEditorCompatibility(geometryView(loaded.document));
      const missingRevision = !Number.isSafeInteger(record.revision);
      setCompatibilityError(!compat.compatible ? "Некоторые элементы этой карты пока нельзя редактировать здесь. Исходник доступен для скачивания."
        : missingRevision ? "Сервер ещё не поддерживает безопасное сохранение. Обновите приложение перед редактированием." : null);
      const full = { ...record, document_version: loaded.sourceFormat === "v6" ? 6 : record.document_version };
      setMap(full);
      setDocument(loaded.document);
      callbacks.current.onLoaded(full, loaded.document);
      autosave.markLoaded(serializeMapDocumentV6(loaded.document), JSON.stringify({ seed: record.seed, sea: record.sea, mountains: record.mountains, forest: record.forest }), false, record.revision);
    }).catch((error) => { if (alive) setLoadError(error instanceof Error ? error.message : "Не удалось открыть карту"); });
    return () => { alive = false; };
    // Lifecycle belongs to map identity/role, not to hook return objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, isGm]);

  function showError(error: unknown) { setActionError(error instanceof Error ? error.message : "Не удалось выполнить действие"); }
  /** The single write path for discrete edits: one history step, errors shown. */
  function commit(operation: (before: MapDocumentV6) => MapDocumentV6) {
    const before = documentRef.current;
    if (!before || writeBlocked || leaving) return;
    try { const next = operation(before); if (next !== before) { history.push(before); setDocument(next); } setActionError(null); }
    catch (error) { showError(error); }
  }
  return { map, setMap, document, documentRef, setDocument, history, autosave, params, loadError, actionError, setActionError, showError,
    compatibilityError, publishedOldMap, disabled, writeBlocked, commit };
}
export type WorkspaceDocument = ReturnType<typeof useWorkspaceDocument>;
export type DocumentRef = MutableRefObject<MapDocumentV6 | null>;
