import { defaultFilterVert, Filter, GlProgram, Texture } from "pixi.js";
import { WATER_GLSL, type MapWater } from "../water";
export { drawLiquidRecipes, drawWaterMask, drawWaterThings, waterFog, waterSources, waterThingSources, type MapWater } from "../water";

const fragment = `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec2 uOrigin;
uniform float uScale;
uniform float uTime;
${WATER_GLSL}
vec4 groundAt(vec2 world) { return texture(uTexture, (world * uScale + uOrigin) / uInputSize.xy); }
void main() {
  vec4 base = texture(uTexture, vTextureCoord);
  vec2 world = (vTextureCoord * uInputSize.xy - uOrigin) / uScale;
  vec4 water = waterAt(world, uTime * uWater.y);
  vec4 shore = shoreAt(world);
  finalColor = vec4(mix(mix(base.rgb, shore.rgb * base.a, shore.a) + gGlow * base.a, water.rgb * base.a, water.a), base.a);
}`;


/** Проход по слою земли: рисует воду там, где её показывает маска. */
export function createWaterFilter(mask: HTMLCanvasElement, flow: HTMLCanvasElement, blend: HTMLCanvasElement, recipes: HTMLCanvasElement, things: HTMLCanvasElement) {
  const texture = Texture.from(mask, true), stream = Texture.from(flow, true), seam = Texture.from(blend, true), recipe = Texture.from(recipes, true), around = Texture.from(things, true);
  texture.source.scaleMode = stream.source.scaleMode = around.source.scaleMode = "linear"; recipe.source.scaleMode = seam.source.scaleMode = "nearest";
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: "map-water" }),
    resources: { water: { uOrigin: { value: new Float32Array(2), type: "vec2<f32>" }, uScale: { value: 1, type: "f32" }, uTime: { value: 0, type: "f32" },
      uMap: { value: new Float32Array(2), type: "vec2<f32>" }, uWater: { value: new Float32Array(3), type: "vec3<f32>" } }, uMask: texture.source, uFlow: stream.source, uRecipe: recipe.source, uThings: around.source, uBlend: seam.source },
    resolution: 1, antialias: "off", padding: 0,
  });
  const uniforms = filter.resources.water.uniforms as { uOrigin: Float32Array; uScale: number; uTime: number; uMap: Float32Array; uWater: Float32Array };
  return {
    filter,
    /** Маску перерисовали — отдать её видеокарте. */
    refresh() { texture.source.update(); stream.source.update(); seam.source.update(); recipe.source.update(); },
    /** Перерисовали «что стоит в воде». */
    refreshThings() { around.source.update(); },
    /** `lo` — левый верхний угол карты: шейдер считает от него, как и маски воды. */
    aim(water: MapWater, x: number, y: number, scale: number, seconds: number, width: number, height: number, lo = { x: 0, y: 0 }) {
      uniforms.uOrigin[0] = x + lo.x * scale; uniforms.uOrigin[1] = y + lo.y * scale; uniforms.uScale = scale; uniforms.uTime = seconds % 3600;
      uniforms.uMap[0] = width - lo.x; uniforms.uMap[1] = height - lo.y;
      uniforms.uWater[0] = water.mode; uniforms.uWater[1] = water.speed; uniforms.uWater[2] = water.size;
    },
    destroy() { filter.destroy(); texture.destroy(true); stream.destroy(true); seam.destroy(true); recipe.destroy(true); around.destroy(true); },
  };
}
