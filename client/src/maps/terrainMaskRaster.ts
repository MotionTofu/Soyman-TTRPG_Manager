import type { RenderTerrainView } from "./renderModel";

type RenderMask = NonNullable<RenderTerrainView["mask"]>;

export interface TerrainMaskRaster {
  /** Source pixel at (0, 0) belongs to this mask sample. */
  minSX: number;
  minSY: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

const MAX_RASTER_SIDE = 1024;
const MAX_RASTER_SAMPLES = 1024 * 1024;

function colorBytes(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** One pixel per painted sample. Canvas scaling softens the border between samples. */
export function buildTerrainMaskRaster(
  mask: RenderMask,
  mapWidth: number,
  mapHeight: number,
  colors: Readonly<Record<string, string>>,
  textured = false,
): TerrainMaskRaster | null {
  const { sampleSize: size, origin, entries } = mask;
  if (entries.size === 0 || !Number.isFinite(size) || size <= 0) return null;
  const mapMinSX = Math.ceil((0 - origin.x) / size - 0.5);
  const mapMaxSX = Math.ceil((mapWidth - origin.x) / size - 0.5) - 1;
  const mapMinSY = Math.ceil((0 - origin.y) / size - 0.5);
  const mapMaxSY = Math.ceil((mapHeight - origin.y) / size - 0.5) - 1;
  let minSX = Infinity;
  let minSY = Infinity;
  let maxSX = -Infinity;
  let maxSY = -Infinity;
  const painted: Array<{ sx: number; sy: number; code: string }> = [];
  for (const [key, code] of entries) {
    const comma = key.indexOf(",");
    const sx = Number(key.slice(0, comma));
    const sy = Number(key.slice(comma + 1));
    if (!Number.isInteger(sx) || !Number.isInteger(sy) ||
      sx < mapMinSX || sx > mapMaxSX || sy < mapMinSY || sy > mapMaxSY) continue;
    painted.push({ sx, sy, code });
    minSX = Math.min(minSX, sx);
    minSY = Math.min(minSY, sy);
    maxSX = Math.max(maxSX, sx);
    maxSY = Math.max(maxSY, sy);
  }
  if (painted.length === 0) return null;
  // A transparent sample around the painted bounds lets the edge fade out.
  minSX--;
  minSY--;
  const width = maxSX - minSX + 2;
  const height = maxSY - minSY + 2;
  if (width > MAX_RASTER_SIDE || height > MAX_RASTER_SIDE || width * height > MAX_RASTER_SAMPLES) return null;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const colorCache = new Map<string, [number, number, number]>();
  const write = (sx: number, sy: number, code: string, textureSX = sx, textureSY = sy) => {
    const offset = ((sy - minSY) * width + sx - minSX) * 4;
    let rgb = colorCache.get(code);
    if (!rgb) {
      rgb = colorBytes(colors[code] ?? colors.plain);
      colorCache.set(code, rgb);
    }
    const [r, g, b] = rgb;
    const delta = textured ? textureDelta(code, textureSX, textureSY) : 0;
    pixels[offset] = r + delta;
    pixels[offset + 1] = g + delta;
    pixels[offset + 2] = b + delta;
    pixels[offset + 3] = 255;
  };
  for (const { sx, sy, code } of painted) write(sx, sy, code);

  // At the map perimeter, extend the nearest interior sample instead of fading
  // the terrain into the lower layer right on the boundary of the map.
  const edgeSample = (sx: number, sy: number) => {
    if (sx >= mapMinSX && sx <= mapMaxSX && sy >= mapMinSY && sy <= mapMaxSY) return;
    const nearX = Math.max(mapMinSX, Math.min(mapMaxSX, sx));
    const nearY = Math.max(mapMinSY, Math.min(mapMaxSY, sy));
    const code = entries.get(`${nearX},${nearY}`);
    if (code) write(sx, sy, code, nearX, nearY);
  };
  for (let sx = minSX; sx < minSX + width; sx++) {
    edgeSample(sx, minSY);
    edgeSample(sx, minSY + height - 1);
  }
  for (let sy = minSY + 1; sy < minSY + height - 1; sy++) {
    edgeSample(minSX, sy);
    edgeSample(minSX + width - 1, sy);
  }
  return { minSX, minSY, width, height, pixels };
}

type TextureKind = "grain" | "flecks" | "ripple" | "rock";
const TEXTURE_PROFILE: Readonly<Record<string, { kind: TextureKind; strength: number }>> = {
  plain: { kind: "grain", strength: 5 },
  forest: { kind: "flecks", strength: 8 },
  hills: { kind: "grain", strength: 6 },
  mountains: { kind: "rock", strength: 8 },
  desert: { kind: "flecks", strength: 7 },
  swamp: { kind: "flecks", strength: 8 },
  deep_water: { kind: "ripple", strength: 6 },
  shallow_water: { kind: "ripple", strength: 5 },
  earth: { kind: "grain", strength: 7 },
  stone: { kind: "rock", strength: 5 },
  ice: { kind: "rock", strength: 3 },
  wood: { kind: "grain", strength: 5 },
  necro: { kind: "rock", strength: 5 },
};

function textureHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495) ^ salt;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

function textureDelta(code: string | undefined, x: number, y: number): number {
  if (!code) return 0;
  const profile = TEXTURE_PROFILE[code];
  if (!profile) return 0;
  const grain = textureHash(x, y, 0x36a39e7d) * 2 - 1;
  if (profile.kind === "ripple") {
    const streak = textureHash(Math.floor(x / 4), y, 0x58f15c4d) > 0.72 ? 1 : 0;
    return profile.strength * (grain * 0.35 + streak * 0.8 - 0.15);
  }
  if (profile.kind === "flecks") {
    const fleck = textureHash(x, y, 0x47e7b324) > 0.88 ? 1 : 0;
    return profile.strength * (grain * 0.5 + (code === "desert" ? fleck : -fleck));
  }
  if (profile.kind === "rock") {
    const seam = textureHash(Math.floor(x / 3), Math.floor(y / 2), 0x5a1d429f) * 2 - 1;
    return profile.strength * (grain * 0.45 + seam * 0.55);
  }
  return profile.strength * grain;
}
