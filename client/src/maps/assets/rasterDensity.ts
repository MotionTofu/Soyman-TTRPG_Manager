/** Round backing resolution up to a quarter-octave step. Camera zoom remains
 * continuous, while nearby scales reuse artwork with at least screen density. */
export function rasterDensity(pixelsPerUnit: number): number {
  if (!(pixelsPerUnit > 0) || !Number.isFinite(pixelsPerUnit)) return pixelsPerUnit;
  return 2 ** (Math.ceil(Math.log2(pixelsPerUnit) * 4) / 4);
}
