/** Склеить края квадратного образца: полоса шириной `seam` точек справа и снизу растворяется в начале картинки.
 * Итог короче на `seam` и повторяется без шва. Годится для россыпных фактур (трава, камень, песок);
 * крупный рисунок с чёткими формами в полосе подмеса двоится — такой образец готовят бесшовным заранее. */
export function blendSeam(data: Uint8ClampedArray, side: number, seam: number): { data: Uint8ClampedArray; side: number } {
  const out = side - seam;
  if (seam <= 0 || out <= seam) return { data, side };
  const rows = new Uint8ClampedArray(out * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < out; x++) {
    const t = x < seam ? x / seam : 1, a = (y * side + x) * 4, b = a + out * 4, o = (y * out + x) * 4;
    for (let c = 0; c < 4; c++) rows[o + c] = t === 1 ? data[a + c] : data[a + c] * t + data[b + c] * (1 - t);
  }
  const result = new Uint8ClampedArray(out * out * 4);
  for (let y = 0; y < out; y++) {
    const t = y < seam ? y / seam : 1;
    for (let x = 0; x < out; x++) {
      const a = (y * out + x) * 4, b = a + out * out * 4;
      for (let c = 0; c < 4; c++) result[a + c] = t === 1 ? rows[a + c] : rows[a + c] * t + rows[b + c] * (1 - t);
    }
  }
  return { data: result, side: out };
}

/** Образец поверхности из картинки: квадрат из середины, края склеены. `blend` — доля стороны под подмес, 0…0,4. */
export function seamlessTile(image: HTMLImageElement, blend: number, max = 1280): HTMLCanvasElement {
  const crop = Math.min(image.naturalWidth, image.naturalHeight), side = Math.min(crop, max);
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = side;
  const pen = canvas.getContext("2d", { willReadFrequently: true })!;
  pen.drawImage(image, (image.naturalWidth - crop) / 2, (image.naturalHeight - crop) / 2, crop, crop, 0, 0, side, side);
  const seam = Math.round(side * Math.max(0, Math.min(0.4, blend)));
  if (!seam) return canvas;
  const blended = blendSeam(pen.getImageData(0, 0, side, side).data, side, seam);
  canvas.width = canvas.height = blended.side;
  pen.putImageData(new ImageData(new Uint8ClampedArray(blended.data), blended.side, blended.side), 0, 0);
  return canvas;
}
