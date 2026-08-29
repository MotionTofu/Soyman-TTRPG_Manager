/**
 * Безопасный URL для backgroundImage / <img src>.
 * Допускаем только /files/ (локальное хранилище), https/http и растровые data:image (png/jpeg/gif/webp/avif).
 * SVG data-URI блокируется (onload XSS). Любой URL с кавычкой, переводом строки или бэкслешем — невалиден → fallback.
 * Это закрывает CSS-injection вида url("...") + `");} body{...}` из БД.
 */
export function isSafeImageUrl(url: string): boolean {
  if (!url) return false;
  if (/["'\n\r\\]/.test(url)) return false;
  if (url.startsWith("/files/")) return true;
  if (url.startsWith("data:image/")) {
    // Только растровые data-URI, SVG с onload — блок
    return /^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,/i.test(url);
  }
  if (url.startsWith("https://") || url.startsWith("http://")) {
    try {
      const u = new URL(url);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }
  return false;
}

export function safeBackgroundImage(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (!isSafeImageUrl(url)) return undefined;
  const encoded = encodeURI(url).replace(/"/g, "%22").replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `url("${encoded}")`;
}
