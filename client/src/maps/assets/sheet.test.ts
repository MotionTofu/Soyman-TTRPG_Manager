import { describe, expect, it } from "vitest";
import { cutPiece, evenGuides, findPieces, guideCells, sheetBackground, trimRect, unionRect, type Pixels } from "./sheet";

/** Лист 40×20 на белом фоне: красный квадрат 6×6 с белой серединой у (4, 4) и синий 8×4 у (26, 10). */
function sheet(): Pixels {
  const width = 40, height = 20, data = new Uint8ClampedArray(width * height * 4).fill(255);
  const box = (x0: number, y0: number, w: number, h: number, color: number[]) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data.set(color, (y * width + x) * 4); };
  box(4, 4, 6, 6, [200, 0, 0, 255]); box(6, 6, 2, 2, [255, 255, 255, 255]); box(26, 10, 8, 4, [0, 0, 200, 255]);
  return { data, width, height };
}

describe("нарезка листа", () => {
  it("фон — цвет углов; у прозрачного листа фона нет", () => {
    expect(sheetBackground(sheet())).toEqual([255, 255, 255]);
    expect(sheetBackground({ data: new Uint8ClampedArray(16), width: 2, height: 2 })).toBeNull();
  });
  it("направляющие делят лист на куски, кусок обрезается по рисунку, пустой отбрасывается", () => {
    const pixels = sheet(), cells = guideCells(evenGuides(2, 40), [], 40, 20);
    expect(cells).toEqual([{ x: 0, y: 0, w: 20, h: 20 }, { x: 20, y: 0, w: 20, h: 20 }]);
    expect(cells.map((cell) => trimRect(pixels, cell, [255, 255, 255], 10))).toEqual([{ x: 4, y: 4, w: 6, h: 6 }, { x: 26, y: 10, w: 8, h: 4 }]);
    expect(trimRect(pixels, { x: 12, y: 0, w: 8, h: 20 }, [255, 255, 255], 10)).toBeNull();
    // Две линии вплотную куска не дают; линии за краем листа не считаются.
    expect(guideCells([20, 21, 99], [], 40, 20)).toHaveLength(2);
    expect(unionRect([{ x: 4, y: 4, w: 6, h: 6 }, { x: 26, y: 10, w: 8, h: 4 }])).toEqual({ x: 4, y: 4, w: 30, h: 10 });
  });
  it("«найти сами» находит оба рисунка по порядку", () => {
    expect(findPieces(sheet(), [255, 255, 255], 10)).toEqual([{ x: 4, y: 4, w: 6, h: 6 }, { x: 26, y: 10, w: 8, h: 4 }]);
  });
  it("фон убирается снаружи рисунка, белое внутри остаётся", () => {
    const piece = cutPiece(sheet(), { x: 2, y: 2, w: 10, h: 10 }, [255, 255, 255], 10), alpha = (x: number, y: number) => piece.data[(y * 10 + x) * 4 + 3];
    expect([alpha(0, 0), alpha(9, 9), alpha(2, 2), alpha(4, 4)]).toEqual([0, 0, 255, 255]);
  });
});
