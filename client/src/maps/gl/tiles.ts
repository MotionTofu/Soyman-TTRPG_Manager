/** Сторона плитки в пикселях устройства: 256 на обычном экране, 512 на экране с
 * плотностью 2. Мелкая плитка — это и меньше лишней площади за краем экрана, и
 * короткие куски работы при дорисовке после масштаба (замер 2026-10-07: плитка
 * 1024 px рисовала в семь раз больше точек, чем видно, одним куском до 570 мс). */
export const tileSide = (dpr: number) => 256 * Math.max(1, Math.round(dpr));

export type TileRange = { x0: number; y0: number; x1: number; y1: number };

/**
 * Плитки, задевающие экран. Плитка привязана к миру: её левый край стоит на
 * `tx * tileSide(dpr)` пикселей устройства от мирового нуля при том масштабе, для
 * которого она нарисована. Размеры экрана и сдвиг камеры — в CSS-пикселях.
 */
export function visibleTiles(ox: number, oy: number, cssW: number, cssH: number, dpr: number): TileRange {
  const side = tileSide(dpr) / dpr;
  return {
    x0: Math.floor((0 - ox) / side), y0: Math.floor((0 - oy) / side),
    x1: Math.ceil((cssW - ox) / side) - 1, y1: Math.ceil((cssH - oy) / side) - 1,
  };
}

export function inRange(range: TileRange, tx: number, ty: number, margin = 0): boolean {
  return tx >= range.x0 - margin && tx <= range.x1 + margin && ty >= range.y0 - margin && ty <= range.y1 + margin;
}
