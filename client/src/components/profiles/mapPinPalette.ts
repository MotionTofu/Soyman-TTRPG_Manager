import { TYPE_COLORS } from "../../graphTypes";
import { pickTextOn } from "../../themes";

/** О-11: только карта места; ручной цвет пина сохраняет приоритет. */
export function mapPinPalette(type: string, manual?: string | null) {
  const background = manual ?? TYPE_COLORS[type] ?? "#16141c";
  return { background, color: pickTextOn(background) };
}
