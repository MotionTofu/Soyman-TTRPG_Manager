// Положение картинки в тексте — в подписи, как в Obsidian (гриллинг листа,
// Q23): `![Ирма у огня|справа|40](адрес)`. Сторона — слева/справа/по центру,
// число — ширина в процентах листа. Другие программы для Markdown покажут
// картинку, а хвост останется в подписи.

export type ImageSide = "left" | "right" | "center";

export interface ImageLayout {
  alt: string;
  side: ImageSide | null;
  /** Ширина в процентах, 1–100. */
  width: number | null;
}

const SIDE_WORDS: Record<string, ImageSide> = {
  слева: "left", left: "left",
  справа: "right", right: "right",
  "по центру": "center", центр: "center", center: "center",
};

export const SIDE_LABEL: Record<ImageSide, string> = { left: "слева", right: "справа", center: "по центру" };

export function parseImageLayout(text: string): ImageLayout {
  const [alt, ...parts] = text.split("|");
  let side: ImageSide | null = null;
  let width: number | null = null;
  for (const raw of parts) {
    const part = raw.trim().toLowerCase();
    if (SIDE_WORDS[part]) side = SIDE_WORDS[part];
    else if (/^\d{1,3}%?$/.test(part)) {
      const n = Number(part.replace("%", ""));
      if (n >= 1 && n <= 100) width = n;
    }
  }
  // Подпись без хвоста — как есть: «|» в обычной подписи тоже бывает.
  if (!side && width == null) return { alt: text, side: null, width: null };
  return { alt: alt.trim(), side, width };
}

export function formatImageAlt(layout: ImageLayout): string {
  return [layout.alt, layout.side && SIDE_LABEL[layout.side], layout.width != null && String(layout.width)]
    .filter(Boolean).join("|");
}
