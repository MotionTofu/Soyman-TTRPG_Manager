/** Сторона плитки в пикселях устройства. */
export const TILE = 1024;

export type TileRange = { x0: number; y0: number; x1: number; y1: number };

/**
 * Плитки, задевающие экран. Плитка привязана к миру: её левый край стоит на
 * `tx * TILE` пикселей устройства от мирового нуля при том масштабе, для
 * которого она нарисована. Размеры экрана и сдвиг камеры — в CSS-пикселях.
 */
export function visibleTiles(ox: number, oy: number, cssW: number, cssH: number, dpr: number): TileRange {
  const side = TILE / dpr;
  return {
    x0: Math.floor((0 - ox) / side), y0: Math.floor((0 - oy) / side),
    x1: Math.ceil((cssW - ox) / side) - 1, y1: Math.ceil((cssH - oy) / side) - 1,
  };
}

export function inRange(range: TileRange, tx: number, ty: number, margin = 0): boolean {
  return tx >= range.x0 - margin && tx <= range.x1 + margin && ty >= range.y0 - margin && ty <= range.y1 + margin;
}
