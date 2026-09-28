import type { MapSymbolAsset } from "./registry";

// Draw in a unit square centered on the object. Canvas primitives keep the
// first offline pack synchronous in editor, thumbnails, PNG, and second screen.
export function drawMapSymbol(ctx: CanvasRenderingContext2D, asset: MapSymbolAsset): void {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 0.055;
  ctx.strokeStyle = "#282922";
  if (asset.glyph === "tree") {
    ctx.fillStyle = "#7c9365";
    ctx.beginPath();
    ctx.moveTo(0, -0.46);
    ctx.lineTo(0.36, 0.18);
    ctx.lineTo(0.14, 0.18);
    ctx.lineTo(0.29, 0.34);
    ctx.lineTo(-0.29, 0.34);
    ctx.lineTo(-0.14, 0.18);
    ctx.lineTo(-0.36, 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#71523d";
    ctx.fillRect(-0.055, 0.34, 0.11, 0.12);
    ctx.strokeRect(-0.055, 0.34, 0.11, 0.12);
  } else if (asset.glyph === "tower") {
    ctx.fillStyle = "#b9a68e";
    ctx.fillRect(-0.29, -0.25, 0.58, 0.68);
    ctx.strokeRect(-0.29, -0.25, 0.58, 0.68);
    for (const x of [-0.29, -0.07, 0.15]) {
      ctx.fillRect(x, -0.42, 0.14, 0.2);
      ctx.strokeRect(x, -0.42, 0.14, 0.2);
    }
    ctx.fillStyle = "#343c43";
    ctx.fillRect(-0.065, 0.12, 0.13, 0.31);
  } else {
    ctx.fillStyle = "#b87c55";
    ctx.beginPath();
    ctx.moveTo(0, -0.39);
    ctx.lineTo(0.43, 0.3);
    ctx.lineTo(-0.43, 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -0.39);
    ctx.lineTo(0, 0.3);
    ctx.stroke();
    ctx.fillStyle = "#5d433b";
    ctx.fillRect(-0.4, 0.3, 0.8, 0.08);
  }
}
