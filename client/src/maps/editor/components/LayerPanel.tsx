// Layer Panel (Фаза 3A, §66–74): отдельный UI слоёв, не map content modal.
// UI вызывает только typed layer mutation API (§74) — никаких splice.
// Все операции — по одному history step (§61–64); opacity drag — один step
// на жест (§65) через UI-local before snapshot (generic History не меняем).

import { useEffect, useRef, useState } from "react";
import {
  createGameplayLayer,
  createLabelLayer,
  createObjectLayer,
  createPathLayer,
  createTerrainLayer,
  createTerrainMaskLayer,
  deleteLayer,
  moveLayer,
  renameLayer,
  setLayerLocked,
  setLayerOpacity,
  setLayerVisible,
} from "../../core/mutations/layers";
import type { LayerId, MapDocumentV5, MapLayer } from "../../core/types";

export type NewLayerKind = "terrain" | "terrain-mask" | "path" | "gameplay" | "label" | "object";

const KIND_LABEL: Record<MapLayer["kind"], string> = {
  terrain: "Рельеф",
  path: "Пути",
  gameplay: "Объекты",
  label: "Подписи",
  object: "Свободные объекты",
  scatter: "Россыпь",
};

const NEW_KINDS: Array<{ kind: NewLayerKind; label: string }> = [
  { kind: "terrain", label: "Рельеф" },
  { kind: "terrain-mask", label: "Детальный рельеф" },
  { kind: "path", label: "Пути" },
  { kind: "gameplay", label: "Объекты" },
  { kind: "label", label: "Подписи" },
  { kind: "object", label: "Свободные объекты" },
];

const NEW_BASE_NAME: Record<NewLayerKind, string> = {
  terrain: "Terrain",
  "terrain-mask": "Детальный рельеф",
  path: "Paths",
  gameplay: "Gameplay",
  label: "Labels",
  object: "Map Objects",
};

function uniqueLayerName(doc: MapDocumentV5, base: string): string {
  const taken = new Set(doc.layers.map((l) => l.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Непустой ли слой (для confirmation перед удалением, §55). */
function layerNonEmpty(layer: MapLayer): boolean {
  switch (layer.kind) {
    case "terrain":
      return layer.representation === "cells" ? layer.cells.length > 0 : layer.mask.chunks.length > 0;
    case "path":
      return layer.paths.length > 0;
    case "gameplay":
      return layer.items.length > 0;
    case "label":
      return layer.items.length > 0;
    case "object":
      return layer.items.length > 0;
    case "scatter":
      return layer.areas.length > 0;
  }
}

interface LayerPanelProps {
  document: MapDocumentV5;
  activeLayerId: LayerId | null;
  onActiveLayer: (id: LayerId) => void;
  setDocument: (d: MapDocumentV5) => void;
  commitDocument: (next: MapDocumentV5, before: MapDocumentV5) => void;
  newLayerId: () => string;
  confirmDelete: (title: string, message: string) => Promise<boolean>;
  setActionError: (e: string | null) => void;
}

export function LayerPanel(p: LayerPanelProps) {
  const { document } = p;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [adding, setAdding] = useState(false);
  // §65: before snapshot opacity-жеста; live updates — без history.
  const opacityBefore = useRef<MapDocumentV5 | null>(null);
  const docRef = useRef(document);
  docRef.current = document;

  // Слой удалили/карту сменили — сбрасываем transient UI. Live opacity updates
  // структуру не меняют: before жеста живёт до commitOpacityEnd.
  const layerSig = document.layers.map((l) => l.id).join("|");
  const prevSig = useRef(layerSig);
  useEffect(() => {
    if (renamingId && !document.layers.some((l) => l.id === renamingId)) {
      setRenamingId(null);
    }
    if (prevSig.current !== layerSig) {
      prevSig.current = layerSig;
      opacityBefore.current = null;
    }
  }, [document, renamingId, layerSig]);

  function fail(r: { ok: false; issues: Array<{ message: string }> }): void {
    p.setActionError(r.issues[0]?.message ?? "Операция со слоем не удалась.");
  }

  function commitAdd(kind: NewLayerKind) {
    const name = uniqueLayerName(document, NEW_BASE_NAME[kind]);
    const id = p.newLayerId();
    const r =
      kind === "terrain"
        ? createTerrainLayer(document, { id, name })
        : kind === "terrain-mask"
          ? createTerrainMaskLayer(document, { id, name })
        : kind === "path"
          ? createPathLayer(document, { id, name })
          : kind === "gameplay"
            ? createGameplayLayer(document, { id, name })
            : kind === "object"
              ? createObjectLayer(document, { id, name })
              : createLabelLayer(document, { id, name });
    if (!r.ok || !r.changed) {
      if (!r.ok) fail(r);
      return;
    }
    p.commitDocument(r.document, document);
    p.onActiveLayer(id);
    setAdding(false);
  }

  async function commitDelete(layer: MapLayer) {
    if (layerNonEmpty(layer)) {
      const ok = await p.confirmDelete(
        "Удалить слой?",
        `Слой «${layer.name}» содержит данные — они будут удалены вместе со слоем. Шаг попадёт в историю.`,
      );
      if (!ok) return;
    }
    const r = deleteLayer(document, layer.id);
    if (!r.ok || !r.changed) {
      if (!r.ok) fail(r);
      return;
    }
    // §57–58: active перерезолвится lifecycle-эффектом страницы (слоя больше
    // нет → topmost compatible/null); selection сбросится сменой документа.
    p.commitDocument(r.document, document);
  }

  function commitMove(layerId: string, toIndex: number) {
    const r = moveLayer(document, layerId, toIndex);
    if (!r.ok) {
      fail(r);
      return;
    }
    if (r.changed) p.commitDocument(r.document, document);
  }

  function commitRename(layerId: string) {
    const text = renameText.trim();
    if (!text) {
      setRenamingId(null);
      return;
    }
    const r = renameLayer(document, layerId, text);
    if (!r.ok) {
      fail(r);
      return;
    }
    if (r.changed) p.commitDocument(r.document, document);
    setRenamingId(null);
  }

  function commitOpacityEnd() {
    const before = opacityBefore.current;
    opacityBefore.current = null;
    const live = docRef.current;
    if (before && live !== before) {
      p.commitDocument(live, before);
    }
  }

  function liveOpacity(layerId: string, value: number) {
    const live = docRef.current;
    if (!opacityBefore.current) opacityBefore.current = live;
    const r = setLayerOpacity(live, layerId, value);
    if (!r.ok) {
      fail(r);
      return;
    }
    if (r.changed) p.setDocument(r.document);
  }

  const active = document.layers.find((l) => l.id === p.activeLayerId) ?? null;
  // Верхний слой — первый в списке (layers[] хранит нижний первым).
  const rows = [...document.layers].reverse();

  return (
    <div className="card map-layer-panel" style={{ padding: "10px 12px" }} aria-label="Слои карты">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <strong>Слои</strong>
        <button type="button" title="Добавить слой" onClick={() => setAdding((v) => !v)}>
          + Слой
        </button>
      </div>
      {adding && (
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {NEW_KINDS.map((k) => (
            <button key={k.kind} type="button" onClick={() => commitAdd(k.kind)}
              disabled={k.kind === "terrain-mask" && document.grid?.type !== "square"}
              title={k.kind === "terrain-mask" ? "Детальная кисть пока доступна на квадратных картах" : undefined}>
              {k.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
        {rows.map((layer) => {
          const index = document.layers.findIndex((l) => l.id === layer.id);
          const isActive = layer.id === p.activeLayerId;
          const renaming = renamingId === layer.id;
          return (
            <div
              key={layer.id}
              className="row map-layer-row"
              style={{
                gap: 6,
                alignItems: "center",
                padding: "2px 4px",
                outline: isActive ? "2px solid var(--accent, #888)" : "none",
              }}
            >
              <button
                type="button"
                title={layer.visible ? "Скрыть" : "Показать"}
                aria-pressed={layer.visible}
                onClick={() => {
                  const r = setLayerVisible(document, layer.id, !layer.visible);
                  if (!r.ok) fail(r);
                  else if (r.changed) p.commitDocument(r.document, document);
                }}
              >
                {layer.visible ? "👁" : "🚫"}
              </button>
              <button
                type="button"
                title={layer.locked ? "Разблокировать" : "Заблокировать"}
                aria-pressed={layer.locked}
                onClick={() => {
                  const r = setLayerLocked(document, layer.id, !layer.locked);
                  if (!r.ok) fail(r);
                  else if (r.changed) p.commitDocument(r.document, document);
                }}
              >
                {layer.locked ? "🔒" : "🔓"}
              </button>
              {renaming ? (
                <input
                  className="map-layer-name"
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => commitRename(layer.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(layer.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  style={{ flex: 1, minWidth: 0 }}
                  aria-label="Имя слоя"
                />
              ) : (
                <button
                  className="map-layer-name"
                  type="button"
                  title="Выбрать слой (двойной клик — переименовать)"
                  onClick={() => p.onActiveLayer(layer.id)}
                  onDoubleClick={() => {
                    setRenamingId(layer.id);
                    setRenameText(layer.name);
                  }}
                  style={{ flex: 1, minWidth: 0, textAlign: "left", fontWeight: isActive ? 700 : 400 }}
                >
                  {layer.name}
                </button>
              )}
              <span className="muted map-layer-kind" style={{ fontSize: "var(--fs-micro)" }}>
                {layer.kind === "terrain" && layer.representation === "mask" ? "Маска" : KIND_LABEL[layer.kind]}
              </span>
              <button
                type="button"
                title="Выше"
                disabled={index >= document.layers.length - 1}
                onClick={() => commitMove(layer.id, index + 1)}
              >
                ↑
              </button>
              <button type="button" title="Ниже" disabled={index <= 0} onClick={() => commitMove(layer.id, index - 1)}>
                ↓
              </button>
              <button type="button" title="Удалить слой" onClick={() => void commitDelete(layer)}>
                ✕
              </button>
            </div>
          );
        })}
      </div>
      {active && (
        <>
        {active.kind === "terrain" && active.representation === "mask" && (
          <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
            Кисть и заливка рисуют мельче клетки; материалы имеют мягкие границы и фактуру. Ластик открывает слой под маской.
          </span>
        )}
        <label className="row map-layer-opacity" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
          <span className="map-layer-opacity-label" style={{ fontSize: "var(--fs-micro)" }}>
            Непрозрачность «{active.name}»
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(active.opacity * 100)}
            onChange={(e) => liveOpacity(active.id, Number(e.target.value) / 100)}
            onPointerUp={commitOpacityEnd}
            onBlur={commitOpacityEnd}
            style={{ flex: 1 }}
            aria-label="Непрозрачность активного слоя"
          />
          <span style={{ fontSize: "var(--fs-micro)", minWidth: 36, textAlign: "right" }}>
            {Math.round(active.opacity * 100)}%
          </span>
        </label>
        </>
      )}
    </div>
  );
}
