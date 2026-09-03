// Клиентский детерминированный генератор черновика суши: value-noise
// 4 октавы + фиксированный радиальный спад к краям (островной). Тот же
// вход — те же клетки, всегда (чистая целочисленная математика, без
// Math.random и без плавучего nondeterminism: порядок операций фиксирован).
// Ставит только воду (глубокую/мелкую), равнину, горы и лес — болото, лёд
// и дороги всегда руками. Генерация целиком — один undo-шаг (тикет 04).

import { cellKey } from "./grid";
import type { MapGrid } from "./mapTypes";
import type { MapCells } from "./render";

export interface GeneratorParams {
  seed: number;
  sea: number; // 20..80
  mountains: number; // 0..40
  forest: number; // 0..60
}

// Хэш координат+сида в [0,1): imul-миксер, детерминирован в любом движке.
function hash2(ix: number, wy: number, seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (ix | 0), 0x9e3779b1);
  h = Math.imul(h ^ (wy | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

// Value-noise в точке (fx,fy) сетки частоты baseFreq: билинейная
// интерполяция хэшей углов со сглаживанием.
function valueNoise(fx: number, fy: number, seed: number): number {
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smooth(fx - ix);
  const ty = smooth(fy - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

// fBm: 4 октавы, частота растёт вдвое от базовой (поле ~6 волн по ширине).
function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 6;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise((x * freq) / 64, (y * freq) / 64, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function generateCells(
  grid: MapGrid,
  width: number,
  height: number,
  params: GeneratorParams
): MapCells {
  void grid; // шум считается в индексах клеток — сетка влияет только на показ
  const { seed, sea, mountains, forest } = params;
  const terrain = new Map<string, string>();
  const roads: Set<string> = new Set();
  // Генератор подписей не ставит и старые не переносит (P2-2): черновик
  // перекраивает сушу, чужие названия на новой земле врали бы.

  const seaT = (sea / 100) * 1.2 - 0.35; // море 55 → ~0.31
  // Замерено: 0 → нет, 30 → ~12% поля, 60 → ~30% поля.
  const forestT = 0.95 - (forest / 60) * 0.4;

  // Горы — квантилем по суше (хвост шума слишком тонкий для абсолютного
  // порога: дефолт 12 давал ноль). Доля суши под горами: 0 → нет,
  // 40 → 30%, 12 → ~9%. Детерминировано: тот же вход — тот же порог.
  const mountainNoise: number[] = [];
  const isLand: boolean[] = [];
  // Д-1: высота считается один раз и переиспользуется во втором проходе
  // (раньше тот же fbm(x, y, seed) пекся дважды на клетку; выход бит-в-бит тот же).
  const elev: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5 - width / 2) / (Math.min(width, height) / 2);
      const ny = (y + 0.5 - height / 2) / (Math.min(width, height) / 2);
      const d = Math.sqrt(nx * nx + ny * ny);
      const e = fbm(x, y, seed) - Math.max(0, d - 0.75) * 0.9;
      const land = e >= seaT;
      isLand.push(land);
      elev.push(e);
      mountainNoise.push(land ? fbm(x, y, seed + 7919) : -1);
    }
  }
  const landNoises = mountainNoise.filter((v) => v >= 0).sort((a, b) => b - a);
  const mountainCount = Math.floor(landNoises.length * (mountains / 40) * 0.3);
  const mountainT = mountainCount > 0 ? landNoises[mountainCount - 1] : Infinity;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = elev[y * width + x];

      if (e < seaT) {
        const depth = seaT - e;
        if (depth > 0.18) terrain.set(cellKey(x, y), "deep_water");
        else terrain.set(cellKey(x, y), "shallow_water");
        continue;
      }
      if (mountainNoise[y * width + x] >= mountainT) {
        terrain.set(cellKey(x, y), "mountains");
        continue;
      }
      const f = fbm(x, y, seed + 1543);
      if (f > forestT) {
        terrain.set(cellKey(x, y), "forest");
        continue;
      }
      // равнина в blob не пишется
    }
  }
  return { terrain, roads, rivers: new Set(), labels: [], rooms: [], doors: [], traps: [], markers: [], start: null, finish: null };
}
