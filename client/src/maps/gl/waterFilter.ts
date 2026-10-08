import { defaultFilterVert, Filter, GlProgram, Texture } from "pixi.js";
import { WATER_GLSL, type MapWater } from "../water";
export { drawWaterMask, waterSources, type MapWater } from "../water";

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
void main() {
  vec4 base = texture(uTexture, vTextureCoord);
  vec4 water = waterAt((vTextureCoord * uInputSize.xy - uOrigin) / uScale, uTime * uWater.y);
  finalColor = vec4(mix(base.rgb, water.rgb * base.a, water.a), base.a);
}`;


/** Проход по слою земли: рисует воду там, где её показывает маска. */
export function createWaterFilter(mask: HTMLCanvasElement) {
  const texture = Texture.from(mask, true);
  texture.source.scaleMode = "linear";
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: "map-water" }),
    resources: { water: { uOrigin: { value: new Float32Array(2), type: "vec2<f32>" }, uScale: { value: 1, type: "f32" }, uTime: { value: 0, type: "f32" },
      uMap: { value: new Float32Array(2), type: "vec2<f32>" }, uWater: { value: new Float32Array(3), type: "vec3<f32>" } }, uMask: texture.source },
    resolution: 1, antialias: "off", padding: 0,
  });
  const uniforms = filter.resources.water.uniforms as { uOrigin: Float32Array; uScale: number; uTime: number; uMap: Float32Array; uWater: Float32Array };
  return {
    filter,
    /** Маску перерисовали — отдать её видеокарте. */
    refresh() { texture.source.update(); },
    aim(water: MapWater, x: number, y: number, scale: number, seconds: number, width: number, height: number) {
      uniforms.uOrigin[0] = x; uniforms.uOrigin[1] = y; uniforms.uScale = scale; uniforms.uTime = seconds % 3600;
      uniforms.uMap[0] = width; uniforms.uMap[1] = height;
      uniforms.uWater[0] = water.mode; uniforms.uWater[1] = water.speed; uniforms.uWater[2] = water.size;
    },
    destroy() { filter.destroy(); texture.destroy(true); },
  };
}
