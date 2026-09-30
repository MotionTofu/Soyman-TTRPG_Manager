import { glyphName } from "../typeGlyphs";

/** Знак типа сущности; цвет — цвет текста вокруг (CSS-маска). Нет знака у типа — ничего. */
export function TypeGlyph({ type }: { type: string }) {
  const name = glyphName(type);
  return name ? <span className={`type-glyph type-glyph--${name}`} aria-hidden="true" /> : null;
}
