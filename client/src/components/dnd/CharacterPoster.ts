import { abilityModifier, formatModifier } from "./AbilityScores";
import type { DndAbilityScores } from "../../types";

// Постер персонажа (PNG + системный шаринг). Рисуется на canvas готовой
// палитрой зина — вне тем приложения, чтобы картинка одинаково читалась
// в чате партии что из панка, что из нуара. Шрифты — те же, что в системе
// (Anton/Oswald/JetBrains Mono), с откатом на системные: в чате их всё
// равно нет, а document.fonts обычно успевает.

export interface PosterAbility {
  label: string;
  value: number;
}

export interface PosterData {
  name: string;
  subtitle: string;
  hp: string;
  ac: string;
  pb: string;
  extra?: { label: string; value: string };
  abilities: PosterAbility[];
  portraitSrc?: string | null;
  accent?: string;
}

const PAPER = "#EDE7D9";
const INK = "#12100E";
const MUTED = "#6E675C";
const DEFAULT_ACCENT = "#D6321E";

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // same-origin/blob: без crossOrigin, иначе упадёт на подписанных URL.
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  base: number,
  family: string,
  weight = ""
): string {
  let size = base;
  const prefix = weight ? `${weight} ` : "";
  ctx.font = `${prefix}${size}px ${family}`;
  while (size > 20 && ctx.measureText(text).width > maxWidth) {
    size -= 4;
    ctx.font = `${prefix}${size}px ${family}`;
  }
  return ctx.font;
}

export async function renderPosterBlob(d: PosterData): Promise<Blob> {
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise((resolve) => window.setTimeout(resolve, 1000)),
    ]);
  } catch {
    // шрифты не дождались — рисуем откатными, постер всё равно собирается
  }
  const S = 2;
  const W = 900;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas недоступен");
  ctx.scale(S, S);

  const accent = d.accent || DEFAULT_ACCENT;

  // Фон + рамка.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, W - 16, H - 16);
  // Акцентная полоса сверху.
  ctx.fillStyle = accent;
  ctx.fillRect(8, 8, W - 16, 14);

  const name = d.name.trim() || "Без имени";
  const img = d.portraitSrc ? await loadImage(d.portraitSrc) : null;
  let y = 60;

  if (img) {
    drawCover(ctx, img, 48, y, W - 96, 440);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.strokeRect(48, y, W - 96, 440);
    y += 440 + 36;
  } else {
    // Без портрета — инициалы на чернильной плашке вместо дыры.
    const initials = name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase();
    ctx.fillStyle = INK;
    ctx.fillRect(48, y, W - 96, 200);
    ctx.fillStyle = PAPER;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    fitFont(ctx, initials || "?", W - 160, 110, "'Anton', sans-serif");
    ctx.fillText(initials || "?", W / 2, y + 100);
    y += 200 + 36;
  }

  // Имя + подзаголовок.
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  fitFont(ctx, name.toUpperCase(), W - 120, 72, "'Anton', sans-serif");
  ctx.fillText(name.toUpperCase(), W / 2, y + 60);
  y += 60 + 18;
  if (d.subtitle.trim()) {
    ctx.fillStyle = MUTED;
    fitFont(ctx, d.subtitle.toUpperCase(), W - 160, 30, "'Oswald', sans-serif", "600");
    ctx.fillText(d.subtitle.toUpperCase(), W / 2, y + 28);
    y += 28 + 10;
  } else {
    y += 6;
  }

  // Разделитель.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(48, y);
  ctx.lineTo(W - 48, y);
  ctx.stroke();
  y += 30;

  // Ключевые числа.
  const stats: [string, string][] = [
    ["ХИТЫ", d.hp || "—"],
    ["КД", d.ac || "—"],
    ["БМ", d.pb || "—"],
  ];
  if (d.extra && d.extra.value.trim()) stats.push([d.extra.label, d.extra.value]);
  const cellW = (W - 96) / stats.length;
  ctx.textAlign = "center";
  stats.forEach(([label, value], i) => {
    const cx = 48 + cellW * (i + 0.5);
    ctx.fillStyle = MUTED;
    ctx.font = "600 24px 'Oswald', sans-serif";
    ctx.fillText(label, cx, y + 24);
    ctx.fillStyle = INK;
    fitFont(ctx, value, cellW - 24, 52, "'JetBrains Mono', monospace");
    ctx.fillText(value, cx, y + 24 + 56);
  });
  y += 24 + 56 + 30;

  // Характеристики: шесть плиток.
  const n = Math.max(1, d.abilities.length);
  const gap = 12;
  const boxW = (W - 96 - gap * (n - 1)) / n;
  const boxH = 150;
  d.abilities.forEach((a, i) => {
    const x = 48 + i * (boxW + gap);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, boxW, boxH);
    ctx.fillStyle = MUTED;
    ctx.font = "600 22px 'Oswald', sans-serif";
    ctx.fillText(a.label, x + boxW / 2, y + 30);
    ctx.fillStyle = INK;
    fitFont(ctx, String(a.value), boxW - 12, 56, "'JetBrains Mono', monospace");
    ctx.fillText(String(a.value), x + boxW / 2, y + 30 + 58);
    ctx.fillStyle = MUTED;
    ctx.font = "28px 'JetBrains Mono', monospace";
    ctx.fillText(formatModifier(abilityModifier(a.value)), x + boxW / 2, y + 30 + 58 + 34);
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Не удалось собрать PNG");
  return blob;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function posterFileName(base: string): string {
  const clean = base.trim().replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_").slice(0, 60);
  return `${clean || "personazh"}_poster.png`;
}

export async function downloadPoster(d: PosterData, fileBase: string): Promise<void> {
  const blob = await renderPosterBlob(d);
  downloadBlob(blob, posterFileName(fileBase));
}

/** Шаринг с фолбэком на скачивание: десктоп без Web Share и отказ —
 *  молча уходят в файл, AbortError (свайп «отмена») — тишина. */
export async function sharePoster(d: PosterData, fileBase: string): Promise<"shared" | "downloaded"> {
  const blob = await renderPosterBlob(d);
  const file = new File([blob], posterFileName(fileBase), { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  try {
    if (typeof navigator.share === "function" && (!nav.canShare || nav.canShare({ files: [file] }))) {
      await navigator.share({ files: [file], title: d.name });
      return "shared";
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    // share упал — падаем в скачивание ниже
  }
  downloadBlob(blob, posterFileName(fileBase));
  return "downloaded";
}
