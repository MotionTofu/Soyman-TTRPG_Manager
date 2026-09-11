import { toBlob } from "html-to-image";

// Снимок лицевой стороны главной карты (PNG). Постер на обороте —
// буквально лицевая: рисованный canvas-вариант (CharacterPoster.ts)
// выглядел хуже живого листа, а лист уже свёрстан — снимаем его как есть.
// html-to-image сам встраивает шрифты и картинки, двойная плотность —
// чтобы текст не мылил в чате партии.

const BG_URL_RE = /url\(["']?([^"')]+)["']?\)/g;

/** Не-data URL из вычисленного background-image (их надо подтянуть руками). */
export function collectBackgroundUrls(computedBackgroundImage: string): string[] {
  const out: string[] = [];
  for (const m of computedBackgroundImage.matchAll(BG_URL_RE)) {
    const url = m[1];
    if (url && !url.startsWith("data:") && !out.includes(url)) out.push(url);
  }
  return out;
}

/** Подмена вычисленных URL фона на готовые dataURL (остальное — как было). */
export function swapBackgroundUrls(computed: string, dataUrls: ReadonlyMap<string, string>): string {
  return computed.replace(BG_URL_RE, (full, url: string) =>
    url && dataUrls.has(url) ? `url("${dataUrls.get(url)}")` : full
  );
}

function urlToDataUrl(url: string): Promise<string> {
  return fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.blob();
    })
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        })
    );
}

// Фоновые картинки html-to-image за собой не тянет: кости d20 на лицевой —
// это background-image (векторный контур в DOM погашен, см. DndDie), и в
// снимке оставались голые числа без силуэтов. Подменяем фон на dataURL
// инлайном на время снимка — инлайн-стили библиотека клонирует как есть —
// потом возвращаем. Не подтянулось (офлайн, file://) — фон просто не
// переедет, как раньше: хуже не будет.
async function inlineBackgrounds(node: HTMLElement): Promise<() => void> {
  const els = [node, ...Array.from(node.querySelectorAll<HTMLElement>("*"))];
  const computed = new Map<HTMLElement, string>();
  const urls = new Set<string>();
  for (const el of els) {
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === "none") continue;
    const found = collectBackgroundUrls(bg);
    if (found.length === 0) continue;
    computed.set(el, bg);
    for (const u of found) urls.add(u);
  }
  const dataUrls = new Map<string, string>();
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        dataUrls.set(url, await urlToDataUrl(url));
      } catch {
        // мимо — фон останется ссылочным
      }
    })
  );
  const applied: { el: HTMLElement; prev: string }[] = [];
  for (const [el, bg] of computed) {
    const next = swapBackgroundUrls(bg, dataUrls);
    if (next === bg) continue;
    applied.push({ el, prev: el.style.backgroundImage });
    el.style.backgroundImage = next;
  }
  return () => {
    for (const { el, prev } of applied) el.style.backgroundImage = prev;
  };
}

// Текстурные кости (DndDie textured): силуэт — background-image, а векторный
// контур в DOM погашен CSS (display:none + fill:none). В снимке эти два
// правила теряются: контур встаёт дефолтной чёрной заливкой поверх текстуры —
// в постере выходят чёрные шестиугольники вместо белых костей. Поэтому кость
// на время снимка собирается руками: контур гасится инлайном, а текстура
// кладётся физическим <img> первым ребёнком (числа выше по DOM — остаются
// поверх). <img> с dataURL — самый надёжный примитив html-to-image: так же
// переезжают портрет и токены.
async function inlineDice(node: HTMLElement): Promise<() => void> {
  const dice = Array.from(node.querySelectorAll<HTMLElement>(".dnd-die.is-textured"));
  const dataUrls = new Map<string, string>();
  const jobs: { die: HTMLElement; svg: SVGElement | null; url: string }[] = [];
  for (const die of dice) {
    const bg = getComputedStyle(die).backgroundImage;
    const urls = collectBackgroundUrls(bg);
    if (urls.length === 0) continue;
    const svg = die.querySelector("svg");
    jobs.push({ die, svg, url: urls[0] });
  }
  await Promise.all(
    [...new Set(jobs.map((j) => j.url))].map(async (url) => {
      try {
        dataUrls.set(url, await urlToDataUrl(url));
      } catch {
        // мимо — кость останется как была
      }
    })
  );
  const applied: { die: HTMLElement; prevPosition: string; svg: SVGElement | null; prevDisplay: string; img: HTMLImageElement | null }[] = [];
  for (const { die, svg, url } of jobs) {
    const src = dataUrls.get(url);
    const prevDisplay = svg?.style.display ?? "";
    if (svg) svg.style.display = "none";
    let img: HTMLImageElement | null = null;
    if (src) {
      img = document.createElement("img");
      img.src = src;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      img.draggable = false;
      img.style.position = "absolute";
      img.style.inset = "0";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
      die.prepend(img);
    }
    const prevPosition = die.style.position;
    die.style.position = "relative";
    applied.push({ die, prevPosition, svg, prevDisplay, img });
  }
  return () => {
    for (const { die, prevPosition, svg, prevDisplay, img } of applied) {
      img?.remove();
      if (svg) svg.style.display = prevDisplay;
      die.style.position = prevPosition;
    }
  };
}

/** DOM-узел лицевой стороны в PNG-blob. */
export async function snapshotNodeBlob(node: HTMLElement): Promise<Blob> {
  // Кости раньше фонов: подготовка читает ссылочный фон из вычисленного
  // стиля, а общая подмена уже превратила бы его в dataURL.
  const restoreDice = await inlineDice(node);
  const restoreBackgrounds = await inlineBackgrounds(node);
  try {
    const blob = await toBlob(node, {
      pixelRatio: 2,
      cacheBust: true,
    });
    if (!blob) throw new Error("Не удалось собрать PNG");
    return blob;
  } finally {
    restoreDice();
    restoreBackgrounds();
  }
}
