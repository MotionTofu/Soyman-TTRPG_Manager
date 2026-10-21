import { canonicalizeMapDocumentV6, upgradeMapDocumentV5, validateMapDocumentV6, type MapDocumentV6, type MapDrawingStyle } from "@shared/maps/core";
import { generateDungeon, type DungeonParams } from "../dungeon";
import { builtinMaterial, migrateLegacyMap } from "../core";
import { createSplinePath } from "../core/mutations/paths";
import { CRYPT_PACK } from "../assets/crypt";
import { editGeometry } from "./editDocument";
import { MAP_MIN_SIDE } from "../mapTypes";
/** Подземелье остаётся в прежних 100 клетках: предел карты подняли для города, генератор на большем не мерили. */
const MAP_MAX_SIDE = 100;

export interface DungeonSettings extends DungeonParams { width: number; height: number }
export const DUNGEON_PRESETS = [
  { name: "Маленькое", width: 32, height: 24, rooms: 5, corrWidth: 1, loops: 25, secrets: true, traps: "some" },
  { name: "Среднее", width: 48, height: 36, rooms: 12, corrWidth: "mixed", loops: 40, secrets: true, traps: "some" },
  { name: "Запутанное", width: 64, height: 48, rooms: 24, corrWidth: "mixed", loops: 85, secrets: true, traps: "many" },
] as const;

export function buildDungeonDocument(settings: DungeonSettings, style: MapDrawingStyle): MapDocumentV6 {
  const { width, height, rooms, seed, loops, corrWidth, traps, secrets } = settings;
  if (![width, height].every((n) => Number.isInteger(n) && n >= MAP_MIN_SIDE && n <= MAP_MAX_SIDE) ||
    !Number.isInteger(rooms) || rooms < 3 || rooms > 30 || !Number.isInteger(seed) || seed < 0 || seed > 2147483647 ||
    !Number.isInteger(loops) || loops < 0 || loops > 100 || ![1, 2, "mixed"].includes(corrWidth) ||
    !["none", "some", "many"].includes(traps) || typeof secrets !== "boolean") throw new Error("Проверьте размеры и параметры подземелья");
  const legacy = generateDungeon(width, height, settings);
  if (!legacy.rooms.length) throw new Error("Комнаты не поместились. Увеличьте поле или выберите другой вариант");
  const document = withWallLines({ ...upgradeMapDocumentV5(migrateLegacyMap({ grid: "square", width, height, cells: legacy }).document), appearance: { style } }, width, height);
  if (validateMapDocumentV6(document).length) throw new Error("Генератор дал некорректную карту. Текущая карта не изменена");
  return canonicalizeMapDocumentV6(document);
}

/** Контуры пола: замкнутые ломаные по границе «пол — не пол», пол справа по ходу. */
export function floorOutlines(floor: (x: number, y: number) => boolean, width: number, height: number): { x: number; y: number }[][] {
  // Из вершины выходит до двух рёбер (клетки касаются углом); ключ — «x,y».
  const out = new Map<string, [number, number][]>();
  const edge = (ax: number, ay: number, bx: number, by: number) => { const key = `${ax},${ay}`; out.set(key, [...out.get(key) ?? [], [bx, by]]); };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (floor(x, y)) {
    if (!floor(x, y - 1)) edge(x, y, x + 1, y);
    if (!floor(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
    if (!floor(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
    if (!floor(x - 1, y)) edge(x, y + 1, x, y);
  }
  const loops: { x: number; y: number }[][] = [];
  for (const [start, ends] of out) while (ends.length) {
    const [sx, sy] = start.split(",").map(Number), loop: [number, number][] = [[sx, sy]];
    let [px, py] = [sx, sy], [cx, cy] = ends.shift()!;
    while (cx !== sx || cy !== sy) {
      loop.push([cx, cy]);
      const next = out.get(`${cx},${cy}`)!, dx = cx - px, dy = cy - py;
      // На касании углом поворачиваем направо — остаёмся у своей клетки.
      const pick = next.length > 1 ? Math.max(0, next.findIndex(([nx, ny]) => nx - cx === -dy && ny - cy === dx)) : 0;
      [px, py] = [cx, cy]; [cx, cy] = next.splice(pick, 1)[0];
    }
    // Точки на прямой не нужны: у стены остаются только углы.
    loops.push(loop.filter(([x, y], i) => { const [ax, ay] = loop.at(i - 1)!, [bx, by] = loop[(i + 1) % loop.length]; return (x - ax) * (by - y) !== (y - ay) * (bx - x); })
      .map(([x, y]) => ({ x, y })));
  }
  return loops;
}

/** Генератор отдаёт стены клетками «скалы». В редакторе стена — линия кладки на
 * слое «Стены», а пол — клетки материала, поэтому приводим результат к этому виду. */
function withWallLines(document: MapDocumentV6, width: number, height: number): MapDocumentV6 {
  const terrain = document.layers.find((layer) => layer.kind === "terrain");
  if (terrain?.kind !== "terrain" || terrain.representation !== "cells") return document;
  const rock = new Set(terrain.cells.filter((cell) => cell.material.type === "builtin" && cell.material.key === "terrain/wall").map((cell) => `${cell.x},${cell.y}`));
  const floor = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && !rock.has(`${x},${y}`);
  const painted = new Set(terrain.cells.map((cell) => `${cell.x},${cell.y}`)), stone = builtinMaterial("stone");
  const cells = terrain.cells.filter((cell) => !rock.has(`${cell.x},${cell.y}`));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (!painted.has(`${x},${y}`)) cells.push({ x, y, material: stone });
  const layers = document.layers.flatMap((layer): MapDocumentV6["layers"] => layer === terrain ? [{ ...terrain, cells }]
    : layer.id === "lyr-road" ? [layer, { id: "lyr-walls", name: "Стены", role: "walls", visible: true, locked: false, opacity: 1, kind: "path", paths: [] }] : [layer]);
  let next: MapDocumentV6 = { ...document, layers, assetPacks: [...document.assetPacks.filter((pack) => pack.id !== CRYPT_PACK.id), CRYPT_PACK] };
  floorOutlines(floor, width, height).forEach((points, index) => {
    next = editGeometry(next, (view) => createSplinePath(view, "lyr-walls", { id: `wall-${index + 1}`, kind: "wall", width: 0.36,
      styleRef: { type: "builtin", key: "path/wall" }, nodes: points.map((position) => ({ position })), properties: { closed: true } }));
  });
  return next;
}

/** Whole geometry replacement is explicit. Token layers retain identity,
 * visibility, lock, opacity, order and coordinates, including hidden tokens. */
export function replaceWithDungeon(before: MapDocumentV6, generated: MapDocumentV6): MapDocumentV6 {
  const grid = before.grid;
  if (!grid || grid.type !== "square" || grid.cellSize !== 1 || grid.origin.x !== 0 || grid.origin.y !== 0 ||
    grid.columns !== generated.grid?.columns || grid.rows !== generated.grid?.rows) {
    throw new Error("Для замены нужен данж того же размера на квадратной сетке. Создайте новую карту");
  }
  const tokens = before.layers.flatMap((layer) => layer.kind === "gameplay" && layer.items.some((item) => item.kind === "token")
    ? [{ ...layer, items: layer.items.filter((item) => item.kind === "token") }] : []);
  // Namespace generator IDs against all retained IDs; pair refs follow the map.
  const used = new Set(tokens.flatMap((layer) => [layer.id, ...layer.items.map((item) => item.id)]));
  const renamed = new Map<string, string>();
  for (const layer of generated.layers) for (const id of [layer.id, ...(layer.kind === "gameplay" ? layer.items.map((item) => item.id) : [])]) {
    let next = id;
    while (used.has(next)) next = `generated-${next}`;
    used.add(next); renamed.set(id, next);
  }
  const layers = generated.layers.map((layer) => ({ ...layer, id: renamed.get(layer.id)!,
    ...(layer.kind === "gameplay" ? { items: layer.items.map((item) => ({ ...item, id: renamed.get(item.id)!,
      ...(item.kind === "door" && item.pairedDoorId ? { pairedDoorId: renamed.get(item.pairedDoorId)! } : {}) })) } : {}) })) as MapDocumentV6["layers"];
  // Наборы карты остаются, набор кладки от новых стен добавляется.
  const packs = [...before.assetPacks, ...generated.assetPacks.filter((pack) => !before.assetPacks.some((own) => own.id === pack.id))];
  const next: MapDocumentV6 = { ...generated, layers: [...layers, ...tokens], assetPacks: packs,
    ...(before.exploration ? { exploration: { enabled: before.exploration.enabled, revealedCells: [] } } : {}) };
  if (validateMapDocumentV6(next).length) throw new Error("Не удалось сохранить токены при замене карты");
  return canonicalizeMapDocumentV6(next);
}
