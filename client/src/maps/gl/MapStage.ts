import { autoDetectRenderer, Container, Sprite, Texture, type Renderer } from "pixi.js";
import { renderMap, type RenderOptions } from "../render";
import { TILE, inRange, visibleTiles, type TileRange } from "./tiles";

/** Всё, что рисует карта, кроме камеры. Новый объект — новое содержимое плиток. */
export type MapStageContent = Omit<RenderOptions, "scale" | "ox" | "oy">;
type Frame = { content: MapStageContent; scale: number; ox: number; oy: number; cssW: number; cssH: number; dpr: number };
type Tile = { scale: number; tx: number; ty: number; content: MapStageContent; canvas: HTMLCanvasElement; sprite: Sprite };

// Пока масштаб меняется, новые плитки не рисуем: старые растягивает видеокарта.
const SETTLE_MS = 120;
// Сколько времени кадра можно отдать на дорисовку плиток нового масштаба.
const BUDGET_MS = 8;

/**
 * Гибридная сцена карты. Содержимое по-прежнему рисует `renderMap`, но не на
 * экран, а в плитки, привязанные к миру; на экран их собирает WebGL. Сдвиг и
 * масштаб — это перестановка готовых плиток, поэтому они не зависят от
 * сложности карты. Замер 2026-10-07: на обычном холсте шаг масштаба стоил
 * 60–150 мс, потому что кэши стен и поверхностей перерисовывались в том же кадре.
 */
export class MapStage {
  private readonly canvas = document.createElement("canvas");
  private readonly root = new Container();
  private readonly tiles = new Map<string, Tile>();
  private renderer: Renderer | null = null;
  private frame: Frame | null = null;
  private dead = false;
  /** Масштаб, под который сейчас рисуются плитки. */
  private target = 0;
  /** Идёт дорисовка после смены масштаба: плитки старого масштаба ещё на экране. */
  private filling = false;
  private settleAt = 0;
  private timer = 0;
  private raf = 0;
  private readonly onFail: () => void;
  private readonly onWork: (ms: number) => void;

  constructor(host: HTMLElement, onFail: () => void, onWork: (ms: number) => void) {
    this.onFail = onFail; this.onWork = onWork;
    this.canvas.className = "workspace-canvas-base";
    this.canvas.setAttribute("aria-hidden", "true");
    host.prepend(this.canvas);
    this.root.sortableChildren = true;
    autoDetectRenderer({ preference: "webgl", canvas: this.canvas, width: 1, height: 1, resolution: 1, autoDensity: false, antialias: false })
      .then((renderer) => {
        if (this.dead) { renderer.destroy(); return; }
        this.renderer = renderer;
        if (this.frame) this.draw(this.frame.content, this.frame, this.frame.cssW, this.frame.cssH, this.frame.dpr);
      })
      .catch(() => { if (!this.dead) this.onFail(); });
  }

  draw(content: MapStageContent, camera: { scale: number; ox: number; oy: number }, cssW: number, cssH: number, dpr: number): void {
    const previous = this.frame;
    this.frame = { content, scale: camera.scale, ox: camera.ox, oy: camera.oy, cssW, cssH, dpr };
    const renderer = this.renderer;
    if (!renderer) return;
    const width = Math.round(cssW * dpr), height = Math.round(cssH * dpr);
    if (renderer.width !== width || renderer.height !== height) renderer.resize(width, height);
    if (previous && previous.dpr !== dpr) this.drop(() => true);
    if (camera.scale !== this.target) {
      // Недорисованный уровень запасным быть не может: в нём дыры.
      if (this.filling) this.drop((tile) => tile.scale === this.target);
      this.settleAt = this.tiles.size ? performance.now() + SETTLE_MS : 0;
      this.target = camera.scale;
      this.filling = true;
    }
    if (this.filling) this.schedule();
    else {
      // Правка и сдвиг: рисуем сразу, иначе мазок отстаёт от руки.
      const started = performance.now();
      for (const [tx, ty] of this.pending()) this.paint(tx, ty);
      this.onWork(performance.now() - started);
      this.trim();
    }
    this.present();
  }

  destroy(): void {
    this.dead = true;
    clearTimeout(this.timer); cancelAnimationFrame(this.raf);
    this.drop(() => true);
    this.renderer?.destroy();
    this.canvas.remove();
  }

  private range(): TileRange {
    const frame = this.frame!;
    return visibleTiles(frame.ox, frame.oy, frame.cssW, frame.cssH, frame.dpr);
  }

  /** Видимые плитки текущего масштаба, которых нет или которые устарели; от центра экрана к краям. */
  private pending(): [number, number][] {
    const frame = this.frame!, range = this.range(), out: [number, number][] = [];
    for (let ty = range.y0; ty <= range.y1; ty++) for (let tx = range.x0; tx <= range.x1; tx++) {
      const tile = this.tiles.get(`${this.target}:${tx}:${ty}`);
      if (!tile || tile.content !== frame.content) out.push([tx, ty]);
    }
    const cx = (range.x0 + range.x1) / 2, cy = (range.y0 + range.y1) / 2;
    return out.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
  }

  private paint(tx: number, ty: number): void {
    const frame = this.frame!, key = `${this.target}:${tx}:${ty}`;
    let tile = this.tiles.get(key);
    if (!tile) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = TILE;
      const sprite = new Sprite(Texture.from(canvas, true));
      tile = { scale: this.target, tx, ty, content: frame.content, canvas, sprite };
      this.tiles.set(key, tile);
      this.root.addChild(sprite);
    }
    const ctx = tile.canvas.getContext("2d");
    if (!ctx) return;
    const side = TILE / frame.dpr;
    ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
    renderMap(ctx, side, side, { ...frame.content, scale: this.target, ox: -tx * side, oy: -ty * side });
    tile.content = frame.content;
    tile.sprite.texture.source.update();
  }

  private schedule(): void {
    if (this.timer || this.raf) return;
    const wait = this.settleAt - performance.now();
    if (wait > 0) this.timer = window.setTimeout(() => { this.timer = 0; this.schedule(); }, wait);
    else this.raf = requestAnimationFrame(() => { this.raf = 0; this.fill(); });
  }

  /** Дорисовка после смены масштаба: по кусочку за кадр, чтобы не подвешивать интерфейс. */
  private fill(): void {
    if (this.dead || !this.frame || !this.renderer || !this.filling) return;
    if (performance.now() < this.settleAt) { this.schedule(); return; }
    const started = performance.now(), todo = this.pending();
    do { const next = todo.shift(); if (next) this.paint(next[0], next[1]); }
    while (todo.length && performance.now() - started < BUDGET_MS);
    this.onWork(performance.now() - started);
    if (todo.length) this.schedule();
    else { this.filling = false; this.trim(); }
    this.present();
  }

  /** Снимает плитки чужих масштабов и те, что ушли дальше одной плитки от экрана. */
  private trim(): void {
    const range = this.range();
    this.drop((tile) => tile.scale !== this.target || !inRange(range, tile.tx, tile.ty, 1));
  }

  private drop(test: (tile: Tile) => boolean): void {
    for (const [key, tile] of this.tiles) if (test(tile)) {
      this.tiles.delete(key);
      this.root.removeChild(tile.sprite);
      tile.sprite.destroy({ texture: true, textureSource: true });
    }
  }

  private present(): void {
    const frame = this.frame, renderer = this.renderer;
    if (!frame || !renderer) return;
    renderer.background.color = frame.content.chrome.paper;
    // Целые пиксели устройства: при своём масштабе плитка ложится точка в точку.
    const x = Math.round(frame.ox * frame.dpr), y = Math.round(frame.oy * frame.dpr);
    for (const tile of this.tiles.values()) {
      const k = frame.scale / tile.scale;
      tile.sprite.position.set(x + tile.tx * TILE * k, y + tile.ty * TILE * k);
      tile.sprite.scale.set(k);
      // Плитки текущего масштаба — поверх растянутых запасных.
      tile.sprite.zIndex = tile.scale === this.target ? 1 : 0;
    }
    renderer.render(this.root);
  }
}
