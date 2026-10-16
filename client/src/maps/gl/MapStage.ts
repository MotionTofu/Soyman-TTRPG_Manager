import { autoDetectRenderer, Container, Rectangle, Sprite, Texture, type Filter, type Renderer } from "pixi.js";
import { renderMap, type RenderOptions } from "../render";
import { worldBounds } from "../grid";
import { inRange, tileSide, visibleTiles, type TileRange } from "./tiles";
import { createStyleFilter, type MapLook } from "./styleFilter";
import { anyWeather, createWeatherFilter, type MapWeather } from "./weatherFilter";
import { createWaterFilter, drawLiquidRecipes, drawWaterMask, drawWaterThings, waterFog, waterSources, waterThingSources, type MapWater } from "./waterFilter";

/** Всё, что рисует карта, кроме камеры. Новый объект — новое содержимое плиток. */
export type MapStageContent = Omit<RenderOptions, "scale" | "ox" | "oy">;
type Frame = { content: MapStageContent; scale: number; ox: number; oy: number; cssW: number; cssH: number; dpr: number };
type Tile = { scale: number; tx: number; ty: number; content: MapStageContent; canvas: HTMLCanvasElement; sprite: Sprite;
  /** Вторая половина плитки — всё, что над землёй; есть, только пока вода рисуется шейдером. */
  over?: { canvas: HTMLCanvasElement; sprite: Sprite };
  /** Правка прошла мимо плитки, и её не перерисовали. Сцена дорисует её, когда правки стихнут. */
  stale?: boolean };
/** Область мира в клетках. */
export type MapArea = { x: number; y: number; w: number; h: number };

// Пока масштаб меняется, новые плитки не рисуем: старые растягивает видеокарта.
const SETTLE_MS = 120, MASK_GAP_MS = 300;
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
  /** Земля и то, что над ней. Вода-шейдер идёт по земле, поэтому мосты и лодки остаются поверх неё. */
  private readonly ground = new Container();
  private readonly over = new Container();
  private readonly maskCanvas = document.createElement("canvas");
  private readonly maskRaw = document.createElement("canvas");
  private readonly flowCanvas = document.createElement("canvas");
  private readonly recipeCanvas = Object.assign(document.createElement("canvas"), { width: 6, height: 8 });
  private readonly thingsCanvas = document.createElement("canvas");
  private readonly waterPass = createWaterFilter(this.maskCanvas, this.flowCanvas, this.recipeCanvas, this.thingsCanvas);
  private thingsOf: readonly unknown[] = [];
  private water: MapWater | null = null;
  private recipesOf: unknown = null;
  private maskOf: readonly unknown[] = [];
  private maskAt = -Infinity;
  private readonly tiles = new Map<string, Tile>();
  private readonly style = createStyleFilter();
  private readonly weatherPass = createWeatherFilter();
  private look: MapLook | null = null;
  private weather: MapWeather | null = null;
  private anim = 0;
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
  private refreshTimer = 0;
  private readonly onFail: () => void;
  private readonly onWork: (ms: number) => void;

  constructor(host: HTMLElement, onFail: () => void, onWork: (ms: number) => void) {
    this.onFail = onFail; this.onWork = onWork;
    this.canvas.className = "workspace-canvas-base";
    this.canvas.setAttribute("aria-hidden", "true");
    host.prepend(this.canvas);
    this.ground.sortableChildren = this.over.sortableChildren = true;
    this.root.addChild(this.ground, this.over);
    autoDetectRenderer({ preference: "webgl", canvas: this.canvas, width: 1, height: 1, resolution: 1, autoDensity: false, antialias: false })
      .then((renderer) => {
        if (this.dead) { renderer.destroy(); return; }
        this.renderer = renderer;
        if (this.frame) this.draw(this.frame.content, this.frame, this.frame.cssW, this.frame.cssH, this.frame.dpr);
      })
      .catch(() => { if (!this.dead) this.onFail(); });
  }

  /**
   * `dirty` — область, которой новое содержимое отличается от прошлого вызова; без неё перерисовываются
   * все видимые плитки. Замер 2026-10-08, перетаскивание предмета: 20 плиток на каждый шаг мыши.
   */
  draw(content: MapStageContent, camera: { scale: number; ox: number; oy: number }, cssW: number, cssH: number, dpr: number, dirty?: MapArea | null): void {
    const previous = this.frame;
    if (dirty && previous && previous.content !== content) {
      const side = tileSide(previous.dpr) / previous.dpr;
      for (const tile of this.tiles.values()) {
        if (tile.content !== previous.content) continue;
        const cells = side / tile.scale, x = tile.tx * cells, y = tile.ty * cells;
        if (x < dirty.x + dirty.w && x + cells > dirty.x && y < dirty.y + dirty.h && y + cells > dirty.y) continue;
        tile.content = content; tile.stale = true;
      }
      // Рамка правки — оценка: тень или длинная подпись могут выйти за неё. Пауза в правках — и всё дорисовано точно.
      clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => this.refresh(), SETTLE_MS);
    }
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

  /** Проходы поверх карты: вид печати и погода. Плитки от них не зависят и не перерисовываются. */
  effects(look: MapLook | null, weather: MapWeather, water: MapWater | null = null): void {
    this.look = look; this.weather = anyWeather(weather) ? weather : null;
    // Плитка с водой-шейдером состоит из двух половин: при переключении все плитки рисуются заново.
    if (!water !== !this.water) {
      this.drop(() => true);
      this.water = water;
      if (this.frame && this.renderer) { this.draw(this.frame.content, this.frame, this.frame.cssW, this.frame.cssH, this.frame.dpr); this.animate(); return; }
    }
    this.water = water;
    this.present();
    this.animate();
  }

  /** Погода движется сама: пока она включена, сцена перерисовывается каждый кадр. */
  private animate(): void {
    if (this.anim || !this.weather && !this.water || this.dead) return;
    this.anim = requestAnimationFrame(() => { this.anim = 0; this.present(); this.animate(); });
  }

  destroy(): void {
    this.dead = true;
    clearTimeout(this.timer); clearTimeout(this.refreshTimer); cancelAnimationFrame(this.raf); cancelAnimationFrame(this.anim);
    this.drop(() => true);
    this.waterPass.destroy();
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
      canvas.width = canvas.height = tileSide(frame.dpr);
      const sprite = new Sprite(Texture.from(canvas, true));
      tile = { scale: this.target, tx, ty, content: frame.content, canvas, sprite };
      this.tiles.set(key, tile);
      this.ground.addChild(sprite);
      if (this.water) {
        const top = document.createElement("canvas");
        top.width = top.height = tileSide(frame.dpr);
        tile.over = { canvas: top, sprite: new Sprite(Texture.from(top, true)) };
        this.over.addChild(tile.over.sprite);
      }
    }
    const ctx = tile.canvas.getContext("2d"), top = tile.over?.canvas.getContext("2d");
    if (!ctx) return;
    const side = tileSide(frame.dpr) / frame.dpr, camera = { scale: this.target, ox: -tx * side, oy: -ty * side };
    ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
    renderMap(ctx, side, side, { ...frame.content, ...camera, ...(top ? { part: "ground" as const } : {}) });
    if (top && tile.over) {
      top.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
      renderMap(top, side, side, { ...frame.content, ...camera, part: "over" });
      tile.over.sprite.texture.source.update();
    }
    tile.content = frame.content; tile.stale = false;
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

  /** Дорисовка плиток, мимо которых прошла правка: по бюджету за кадр, пока не кончатся. */
  private refresh(): void {
    this.refreshTimer = 0;
    if (this.dead || !this.frame || !this.renderer) return;
    const started = performance.now();
    let left = false;
    for (const tile of this.tiles.values()) {
      if (!tile.stale || tile.scale !== this.target || tile.content !== this.frame.content) continue;
      if (performance.now() - started >= BUDGET_MS) { left = true; break; }
      this.paint(tile.tx, tile.ty);
    }
    this.onWork(performance.now() - started);
    this.present();
    if (left) this.refreshTimer = window.setTimeout(() => this.refresh(), 16);
  }

  /** Снимает плитки чужих масштабов и те, что ушли дальше одной плитки от экрана. */
  private trim(): void {
    const range = this.range();
    this.drop((tile) => tile.scale !== this.target || !inRange(range, tile.tx, tile.ty, 1));
  }

  private drop(test: (tile: Tile) => boolean): void {
    for (const [key, tile] of this.tiles) if (test(tile)) {
      this.tiles.delete(key);
      this.ground.removeChild(tile.sprite);
      tile.sprite.destroy({ texture: true, textureSource: true });
      if (tile.over) { this.over.removeChild(tile.over.sprite); tile.over.sprite.destroy({ texture: true, textureSource: true }); }
    }
  }

  private present(): void {
    const frame = this.frame, renderer = this.renderer;
    if (!frame || !renderer) return;
    renderer.background.color = frame.content.chrome.paper;
    // Целые пиксели устройства: при своём масштабе плитка ложится точка в точку.
    const x = Math.round(frame.ox * frame.dpr), y = Math.round(frame.oy * frame.dpr), side = tileSide(frame.dpr);
    for (const tile of this.tiles.values()) {
      const k = frame.scale / tile.scale;
      tile.sprite.position.set(x + tile.tx * side * k, y + tile.ty * side * k);
      tile.sprite.scale.set(k);
      // Плитки текущего масштаба — поверх растянутых запасных.
      tile.sprite.zIndex = tile.scale === this.target ? 1 : 0;
      if (tile.over) { tile.over.sprite.position.copyFrom(tile.sprite.position); tile.over.sprite.scale.set(k); tile.over.sprite.zIndex = tile.sprite.zIndex; }
    }
    const screen = new Rectangle(0, 0, renderer.width, renderer.height);
    if (this.water) {
      // Вода лежит в мировых координатах: у гексов карта шире и выше числа клеток.
      const { minX, minY, maxX: ww, maxY: wh } = worldBounds(frame.content.grid, frame.content.width, frame.content.height), lo = { x: minX, y: minY };
      const fog = waterFog(frame.content, frame.content.model), sources = waterSources(frame.content.model, ww, wh, this.water.shoal, lo, fog);
      // Маска воды — вся карта сразу (на крупной карте ~50–100 мс): под кистью она пересобирается не чаще раза в 300 мс,
      // остальное догоняет следующий кадр анимации воды. Первая правка после паузы — сразу.
      const now = performance.now();
      if ((sources.length !== this.maskOf.length || sources.some((source, i) => source !== this.maskOf[i])) && now - this.maskAt >= MASK_GAP_MS) {
        drawWaterMask(this.maskCanvas, this.maskRaw, this.flowCanvas, this.recipeCanvas, frame.content.model, ww, wh, this.water.shoal, lo, fog);
        this.waterPass.refresh(); this.maskOf = sources; this.recipesOf = null; this.maskAt = now;
      }
      // Что стоит в воде — своя картинка: передвинутая лодка не пересобирает маску воды всей карты.
      const things = waterThingSources(frame.content.model, ww, wh, lo);
      if (things.length !== this.thingsOf.length || things.some((source, i) => source !== this.thingsOf[i])) {
        drawWaterThings(this.thingsCanvas, frame.content.model, ww, wh, lo);
        this.waterPass.refreshThings(); this.thingsOf = things;
      }
      // Рецепты — отдельно от маски: правка цвета своей жидкости не пересобирает карту.
      const liquids = this.water.liquids ?? frame.content.model.liquids;
      if (liquids !== this.recipesOf) { drawLiquidRecipes(this.recipeCanvas, liquids); this.waterPass.refresh(); this.recipesOf = liquids; }
      this.waterPass.aim(this.water, x, y, frame.scale * frame.dpr, performance.now() / 1000, ww, wh, lo);
      this.ground.filterArea = screen;
    }
    const wet = this.ground.filters as readonly Filter[] | null | undefined;
    if (this.water ? wet?.[0] !== this.waterPass.filter : wet?.length) this.ground.filters = this.water ? [this.waterPass.filter] : null;
    const density = frame.scale * frame.dpr, passes: Filter[] = [];
    if (this.look) { this.style.aim(this.look, x, y, density); passes.push(this.style.filter); }
    if (this.weather) { this.weatherPass.aim(this.weather, x, y, density, performance.now() / 1000); passes.push(this.weatherPass.filter); }
    // Проходы идут по всему экрану, а не по границам плиток: они шире экрана.
    if (passes.length) this.root.filterArea = screen;
    const current = this.root.filters ?? [];
    if (current.length !== passes.length || passes.some((pass, i) => pass !== current[i])) this.root.filters = passes.length ? passes : null;
    renderer.render(this.root);
  }
}
