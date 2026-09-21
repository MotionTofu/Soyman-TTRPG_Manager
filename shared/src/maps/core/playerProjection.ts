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
  MapLayer,
} from "./types";

/** Та же проверка секретности, что doorForView + stripCellsForPlayer. */
function isSecretDoor(doorKind: string, secret: boolean): boolean {
  return doorKind === "secret" || secret;
}

function projectGameplay(items: GameplayEntity[]): GameplayEntity[] {
  const kept: GameplayEntity[] = [];
  for (const e of items) {
    if (e.kind === "trap") continue; // ловушки — все вон
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

function projectLayer(layer: MapLayer): MapLayer {
  if (layer.kind !== "gameplay") {
    // terrain/paths/objects/scatter/labels — как есть; canonicalize ниже
    // пересоберёт всё в новые объекты, вход не мутируется.
    return layer;
  }
  return { ...layer, items: projectGameplay(layer.items) };
}

export function projectMapDocumentForPlayer(doc: MapDocumentV5): MapDocumentV5 {
  const projected: MapDocumentV5 = {
    v: 5,
    world: {
      bounds: { ...doc.world.bounds },
    },
    grid: doc.grid === null ? null : { ...doc.grid, origin: { ...doc.grid.origin } },
    assetPacks: doc.assetPacks.map((p) => ({ ...p })),
    layers: doc.layers.map(projectLayer),
  };
  // Возвращаем canonical doc: стабильный порядок ключей + сортировки.
  return canonicalizeMapDocument(projected);
}
