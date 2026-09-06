import { describe, it, expect } from "vitest";
import { renameFiendText } from "./renameFiend";

describe("renameFiendText", () => {
  it("renames all cases", () => {
    expect(renameFiendText("Средняя бестия").text).toBe("Средняя исчадие");
    expect(renameFiendText("культа бестии").text).toBe("культа исчадия");
    expect(renameFiendText("вижу бестию").text).toBe("вижу исчадие");
    expect(renameFiendText("стая бестий").text).toBe("стая исчадий");
    expect(renameFiendText("силой бестией").text).toBe("силой исчадием");
    expect(renameFiendText("к бестие").text).toBe("к исчадию");
    expect(renameFiendText("о бестиях").text).toBe("о исчадиях");
  });
  it("keeps first-letter case, hyphen counts as boundary", () => {
    expect(renameFiendText("Бестии идут").text).toBe("Исчадия идут");
    expect(renameFiendText("бестий-военачальников").text).toBe("исчадий-военачальников");
  });
  it("does not touch бестиарий", () => {
    const r = renameFiendText("см. Бестиарий и бестиария");
    expect(r.text).toBe("см. Бестиарий и бестиария");
    expect(r.count).toBe(0);
  });
  it("counts replacements", () => {
    expect(renameFiendText("бестии и бестий").count).toBe(2);
  });
  it("renames live samples", () => {
    expect(renameFiendText("Последователь культа бестии").text).toBe("Последователь культа исчадия");
    expect(renameFiendText("Вспышка силы бестии").text).toBe("Вспышка силы исчадия");
    expect(renameFiendText("Касанием бестии").text).toBe("Касанием исчадия");
  });
});
