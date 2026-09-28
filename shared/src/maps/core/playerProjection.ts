// Player projection (ADR-0003 §E): server-authoritative преемник
// stripCellsForPlayer. GM-документ lossless; проекция вводит ровно ту же
// дельту, что production на /api/maps/:id для роли player:
// secret-двери вон, trapped→обычная, traps вон, room type→empty (имена остаются).
// Исходный документ НЕ мутируется — строится новый canonical document.
// Висячие pairedDoorId после удаления secret-партнёра обнуляются (§35 ТЗ).

import { canonicalizeMapDocument } from "./canonicalize";
import type {
  GameplayDoor,
  GameplayEntity,
  MapDocumentV5,
  MapGridConfig,
  MapLayer,
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

function projectLayer(layer: MapLayer, grid: MapGridConfig | null, visible?: (x: number, y: number) => boolean): MapLayer {
  if (!visible || !grid) {
    return layer.kind === "gameplay" ? { ...layer, items: projectGameplay(layer.items) } : layer;
  }
  const pointVisible = (px: number, py: number) => {
    const cell = containingCell(grid, px, py);
    return cell !== null && visible(cell.x, cell.y);
  };
  if (layer.kind === "terrain") {
    const plain = { type: "builtin" as const, key: "terrain/plain" };
    if (layer.representation === "mask") {
      // Dense samples have no cell ownership. Keep the player payload safe until
      // fog can clip sample geometry exactly; editor blocks this combination.
      return { ...layer, defaultMaterial: plain, mask: { ...layer.mask, materials: [plain], chunks: [] } };
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
      if (path.geometry.type !== "cell-network") return [];
      const cells = path.geometry.cells.filter((cell) => visible(cell.x, cell.y));
      return cells.length ? [{ ...path, geometry: { type: "cell-network" as const, cells } }] : [];
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
  const projected: MapDocumentV5 = {
    v: 5,
    world: {
      bounds: { ...doc.world.bounds },
    },
    grid: doc.grid === null ? null : { ...doc.grid, origin: { ...doc.grid.origin } },
    ...(doc.exploration === undefined ? {} : { exploration: doc.exploration }),
    assetPacks: doc.assetPacks.map((p) => ({ ...p })),
    layers: doc.layers.map((layer) => projectLayer(layer, doc.grid, visible)),
  };
  // Возвращаем canonical doc: стабильный порядок ключей + сортировки.
  return canonicalizeMapDocument(projected);
}
