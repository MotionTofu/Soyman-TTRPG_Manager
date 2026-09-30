// Player projection (ADR-0003 §E): server-authoritative преемник
// stripCellsForPlayer. GM-документ lossless; проекция вводит ровно ту же
// дельту, что production на /api/maps/:id для роли player:
// secret-двери вон, trapped→обычная, traps вон, room type→empty (имена остаются).
// Исходный документ НЕ мутируется — строится новый canonical document.
// Висячие pairedDoorId после удаления secret-партнёра обнуляются (§35 ТЗ).

import { canonicalizeMapDocument } from "./canonicalize";
import { isPaletteIndexMaskPayload, TERRAIN_MASK_CHUNK_SIDE } from "./terrainMask";
import { flattenSplineNodes, flattenSplineWithWidths, type SplineWidthSample } from "./spline";
import type {
  GameplayDoor,
  GameplayEntity,
  MapDocumentV5,
  MapGridConfig,
  MapLayer,
  MapPath,
  TerrainMaskLayer,
  TerrainCellEntry,
} from "./types";

/** Та же проверка секретности, что doorForView + stripCellsForPlayer. */
function isSecretDoor(doorKind: string, secret: boolean): boolean {
  return doorKind === "secret" || secret;
}

function containingCell(grid: MapGridConfig, px: number, py: number): { x: number; y: number } | null {
  if (grid.type === "square") {
    const x = Math.floor((px - grid.origin.x) / grid.cellSize);
    const y = Math.floor((py - grid.origin.y) / grid.cellSize);
    return x >= 0 && y >= 0 && x < grid.columns && y < grid.rows ? { x, y } : null;
  }
  // Тот же поиск ближайшего центра pointy/odd-q, что у клиентской сетки.
  const wx = (px - grid.origin.x) / grid.cellSize;
  const wy = (py - grid.origin.y) / grid.cellSize;
  let best: { x: number; y: number } | null = null;
  let distance = Infinity;
  const row = Math.round(wy / 1.5);
  for (let y = row - 1; y <= row + 1; y++) {
    const q = Math.round(wx / Math.sqrt(3) - (y & 1 ? 0.5 : 0));
    for (let x = q - 1; x <= q + 1; x++) {
      const dx = Math.sqrt(3) * (x + (y & 1 ? 0.5 : 0)) - wx;
      const dy = 1.5 * y - wy;
      const d = dx * dx + dy * dy;
      if (d < distance) { distance = d; best = { x, y }; }
    }
  }
  return best && best.x >= 0 && best.y >= 0 && best.x < grid.columns && best.y < grid.rows ? best : null;
}

function projectGameplay(items: GameplayEntity[], visible?: (x: number, y: number) => boolean,
  pointVisible?: (x: number, y: number) => boolean): GameplayEntity[] {
  const kept: GameplayEntity[] = [];
  for (const e of items) {
    if (e.kind === "trap") continue; // ловушки — все вон
    if (visible && pointVisible) {
      if (e.kind === "room") {
        if (e.geometry.type !== "rect") continue;
        let allVisible = true;
        for (let y = e.geometry.y; y < e.geometry.y + e.geometry.h && allVisible; y++)
          for (let x = e.geometry.x; x < e.geometry.x + e.geometry.w; x++)
            if (!visible(x, y)) { allVisible = false; break; }
        if (!allVisible) continue;
      } else if (!pointVisible(e.position.x, e.position.y)) continue;
    }
    if (e.kind === "door") {
      if (isSecretDoor(e.doorKind, e.secret)) continue; // секретные — вон
      const d: GameplayDoor =
        e.doorKind === "trapped"
          ? { ...e, doorKind: "door" } // остальные поля как есть
          : { ...e };
      kept.push(d);
      continue;
    }
    if (e.kind === "room") {
      kept.push({ ...e, roomType: "empty" }); // имя сохраняется
      continue;
    }
    kept.push({ ...e });
  }
  // Нормализация пар: оставшаяся дверь не должна ссылаться на удалённую.
  const alive = new Set<string>();
  for (const e of kept) alive.add(e.id);
  return kept.map((e) => {
    if (e.kind === "door" && e.pairedDoorId !== null && !alive.has(e.pairedDoorId)) {
      return { ...e, pairedDoorId: null };
    }
    return e;
  });
}

/** Keep only painted samples wholly inside revealed square cells. */
function projectTerrainMask(layer: TerrainMaskLayer, grid: MapGridConfig,
  visible: (x: number, y: number) => boolean): TerrainMaskLayer {
  const { mask } = layer;
  const plain = { type: "builtin" as const, key: "terrain/plain" };
  if (grid.type !== "square") {
    return { ...layer, defaultMaterial: plain, mask: { ...mask, materials: [plain], chunks: [] } };
  }
  const used = new Set<number>();
  const clipped: Array<{ chunk: typeof mask.chunks[number]; values: number[] }> = [];
  for (const chunk of mask.chunks) {
    if (!isPaletteIndexMaskPayload(chunk.payload, mask.materials.length)) continue;
    const values = chunk.payload.values.map((paletteIndex, index) => {
      if (paletteIndex === 0) return 0;
      const sx = chunk.cx * TERRAIN_MASK_CHUNK_SIDE + index % TERRAIN_MASK_CHUNK_SIDE;
      const sy = chunk.cy * TERRAIN_MASK_CHUNK_SIDE + Math.floor(index / TERRAIN_MASK_CHUNK_SIDE);
      const left = mask.origin.x + sx * mask.sampleSize;
      const top = mask.origin.y + sy * mask.sampleSize;
      const x = Math.floor((left - grid.origin.x) / grid.cellSize);
      const y = Math.floor((top - grid.origin.y) / grid.cellSize);
      if (x < 0 || y < 0 || x >= grid.columns || y >= grid.rows || !visible(x, y)) return 0;
      if (left < grid.origin.x + x * grid.cellSize ||
          top < grid.origin.y + y * grid.cellSize ||
          left + mask.sampleSize > grid.origin.x + (x + 1) * grid.cellSize ||
          top + mask.sampleSize > grid.origin.y + (y + 1) * grid.cellSize) return 0;
      used.add(paletteIndex);
      return paletteIndex;
    });
    if (values.some((value) => value !== 0)) clipped.push({ chunk, values });
  }
  const palette = [...used].sort((a, b) => a - b);
  const indexMap = new Map(palette.map((index, i) => [index, i + 1]));
  return { ...layer, defaultMaterial: plain, mask: {
    ...mask,
    materials: palette.length ? palette.map((index) => mask.materials[index - 1]) : [plain],
    chunks: clipped.map(({ chunk, values }) => ({ ...chunk, payload: {
      ...chunk.payload, values: values.map((index) => indexMap.get(index) ?? 0),
    } })),
  } };
}

function projectFreePath(path: MapPath, grid: MapGridConfig,
  visible: (x: number, y: number) => boolean, usedIds: Set<string>): MapPath[] {
  if (path.geometry.type !== "spline") return [];
  const hasNodeWidths = path.geometry.nodes.some((node) => node.width !== undefined);
  const pathPoints: SplineWidthSample[] = hasNodeWidths
    ? flattenSplineWithWidths(path.geometry.nodes, path.width, grid.cellSize / 48)
    : flattenSplineNodes(path.geometry.nodes, grid.cellSize / 48)
      .map((point) => ({ ...point, width: path.width }));
  const border = (from: SplineWidthSample, to: SplineWidthSample,
    cell: { x: number; y: number }, startsInside: boolean) => {
    let low = 0, high = 1;
    for (let iteration = 0; iteration < 20; iteration++) {
      const mid = (low + high) / 2;
      const owner = containingCell(grid, from.x + (to.x - from.x) * mid,
        from.y + (to.y - from.y) * mid);
      if (owner?.x === cell.x && owner.y === cell.y) {
        if (startsInside) low = mid;
        else high = mid;
      } else if (startsInside) high = mid;
      else low = mid;
    }
    const t = startsInside ? low : high;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t,
      width: from.width + (to.width - from.width) * t };
  };
  const pieces: SplineWidthSample[][] = [];
  let active: SplineWidthSample[] = [];
  let activeCell = "";
  let previous: SplineWidthSample | null = null;
  let previousCell: { x: number; y: number } | null = null;
  let budget = 20_000;
  const flush = () => {
    if (active.length >= 2) pieces.push(active);
    active = [];
    activeCell = "";
  };
  for (let i = 1; i < pathPoints.length && budget > 0; i++) {
    const from = pathPoints[i - 1];
    const to = pathPoints[i];
    const steps = Math.min(4096, Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (grid.cellSize / 12))));
    for (let j = i === 1 ? 0 : 1; j <= steps && budget > 0; j++, budget--) {
      const t = j / steps;
      const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t,
        width: from.width + (to.width - from.width) * t };
      const cell = containingCell(grid, point.x, point.y);
      const key = cell ? `${cell.x},${cell.y}` : "";
      const previousKey = previousCell ? `${previousCell.x},${previousCell.y}` : "";
      if (previous && previousCell && cell && key === previousKey && visible(cell.x, cell.y)) {
        if (activeCell !== key) {
          flush();
          activeCell = key;
          active.push(previous);
        }
        active.push(point);
      } else {
        if (previous && previousCell && visible(previousCell.x, previousCell.y)) {
          if (activeCell !== previousKey) { flush(); activeCell = previousKey; active.push(previous); }
          active.push(border(previous, point, previousCell, true));
        }
        flush();
        if (previous && cell && visible(cell.x, cell.y)) {
          activeCell = key;
          active.push(border(previous, point, cell, false), point);
        }
      }
      previous = point;
      previousCell = cell;
    }
  }
  flush();
  return pieces.map((points, index) => {
    let id = `${path.id}:player:${index}`;
    while (usedIds.has(id)) id += ":";
    usedIds.add(id);
    const { branchFrom: _branchFrom, ...visiblePath } = path;
    return { ...visiblePath, id, geometry: { type: "spline" as const,
      nodes: points.map(({ x, y, width }) => ({ position: { x, y },
        ...(hasNodeWidths ? { width } : {}) })) } };
  });
}

function projectLayer(layer: MapLayer, grid: MapGridConfig | null, visible?: (x: number, y: number) => boolean,
  usedIds?: Set<string>): MapLayer {
  if (!visible || !grid) {
    if (layer.kind === "gameplay") return { ...layer, items: projectGameplay(layer.items) };
    if (layer.kind === "path") return { ...layer, paths: layer.paths.map((path) => {
      const { branchFrom: _branchFrom, ...visiblePath } = path;
      return visiblePath;
    }) };
    return layer;
  }
  const pointVisible = (px: number, py: number) => {
    const cell = containingCell(grid, px, py);
    return cell !== null && visible(cell.x, cell.y);
  };
  if (layer.kind === "terrain") {
    const plain = { type: "builtin" as const, key: "terrain/plain" };
    if (layer.representation === "mask") {
      return projectTerrainMask(layer, grid, visible);
    }
    const entries = new Map<string, TerrainCellEntry>(layer.cells.filter((cell) => visible(cell.x, cell.y))
      .map((cell) => [`${cell.x},${cell.y}`, cell] as const));
    if (layer.defaultMaterial.type !== "builtin" || layer.defaultMaterial.key !== "terrain/plain") {
      for (const cell of gridCells(grid)) {
        if (!visible(cell.x, cell.y)) continue;
        const key = `${cell.x},${cell.y}`;
        if (!entries.has(key)) entries.set(key, { ...cell, material: layer.defaultMaterial });
      }
    }
    return { ...layer, defaultMaterial: plain, cells: [...entries.values()] };
  }
  if (layer.kind === "path") {
    return { ...layer, paths: layer.paths.flatMap((path) => {
      if (path.geometry.type === "spline") return projectFreePath(path, grid, visible, usedIds!);
      const cells = path.geometry.cells.filter((cell) => visible(cell.x, cell.y));
      const { branchFrom: _branchFrom, ...visiblePath } = path;
      return cells.length ? [{ ...visiblePath, geometry: { type: "cell-network" as const, cells } }] : [];
    }) };
  }
  if (layer.kind === "object") return { ...layer, items: layer.items.filter((item) => pointVisible(item.transform.position.x, item.transform.position.y)) };
  if (layer.kind === "label") return { ...layer, items: layer.items.filter((item) => pointVisible(item.position.x, item.position.y)) };
  if (layer.kind === "scatter") return { ...layer, areas: [] };
  return { ...layer, items: projectGameplay(layer.items, visible, pointVisible) };
}

function* gridCells(grid: MapGridConfig) {
  for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.columns; x++) yield { x, y };
}

export function projectMapDocumentForPlayer(doc: MapDocumentV5): MapDocumentV5 {
  const revealed = doc.exploration?.enabled
    ? new Set(doc.exploration.revealedCells.map((cell) => `${cell.x},${cell.y}`)) : null;
  const visible = revealed ? (x: number, y: number) => revealed.has(`${x},${y}`) : undefined;
  const usedIds = new Set<string>();
  for (const layer of doc.layers) {
    usedIds.add(layer.id);
    if (layer.kind === "terrain" && layer.representation === "mask") layer.mask.chunks.forEach((item) => usedIds.add(item.id));
    if (layer.kind === "path") layer.paths.forEach((item) => usedIds.add(item.id));
    if (layer.kind === "object" || layer.kind === "label" || layer.kind === "gameplay") layer.items.forEach((item) => usedIds.add(item.id));
    if (layer.kind === "scatter") layer.areas.forEach((item) => usedIds.add(item.id));
  }
  const projected: MapDocumentV5 = {
    v: 5,
    world: {
      bounds: { ...doc.world.bounds },
    },
    grid: doc.grid === null ? null : { ...doc.grid, origin: { ...doc.grid.origin } },
    ...(doc.exploration === undefined ? {} : { exploration: doc.exploration }),
    assetPacks: doc.assetPacks.map((p) => ({ ...p })),
    layers: doc.layers.map((layer) => projectLayer(layer, doc.grid, visible, usedIds)),
  };
  // Возвращаем canonical doc: стабильный порядок ключей + сортировки.
  return canonicalizeMapDocument(projected);
}
