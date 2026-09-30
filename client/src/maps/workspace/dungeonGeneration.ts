import { canonicalizeMapDocumentV6, upgradeMapDocumentV5, validateMapDocumentV6, type MapDocumentV6, type MapDrawingStyle } from "@shared/maps/core";
import { generateDungeon, type DungeonParams } from "../dungeon";
import { migrateLegacyMap } from "../core";
import { MAP_MIN_SIDE, MAP_MAX_SIDE } from "../mapTypes";

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
  const document = { ...upgradeMapDocumentV5(migrateLegacyMap({ grid: "square", width, height, cells: legacy }).document), appearance: { style } };
  if (validateMapDocumentV6(document).length) throw new Error("Генератор дал некорректную карту. Текущая карта не изменена");
  return canonicalizeMapDocumentV6(document);
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
  const next: MapDocumentV6 = { ...generated, layers: [...layers, ...tokens], assetPacks: before.assetPacks,
    ...(before.exploration ? { exploration: { enabled: before.exploration.enabled, revealedCells: [] } } : {}) };
  if (validateMapDocumentV6(next).length) throw new Error("Не удалось сохранить токены при замене карты");
  return canonicalizeMapDocumentV6(next);
}
