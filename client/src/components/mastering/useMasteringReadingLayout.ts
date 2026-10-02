import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** Оверлеи ограничены рабочей областью, включая режим со скрытыми панелями. */
export function useMasteringReadingLayout(reader: RefObject<HTMLDivElement | null>, toolbar: RefObject<HTMLDivElement | null>, article: RefObject<HTMLElement | null>, toc: RefObject<HTMLDivElement | null>, headings: string[]) {
  const [activeHeading, setActiveHeading] = useState(0);
  useLayoutEffect(() => {
    const root = reader.current, controls = toolbar.current;
    if (!root || !controls) return;
    const content = root.closest<HTMLElement>(".app-content");
    const measure = () => {
      const box = content?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
      const compact = box.width < 1000;
      root.dataset.compact = String(compact);
      root.style.setProperty("--reader-left", `${box.left}px`);
      root.style.setProperty("--reader-width", `${box.width}px`);
      root.style.setProperty("--reader-top", `${box.top + (compact ? 0 : 56)}px`);
      root.style.setProperty("--reader-height", `${box.height}px`);
      const bottom = box.top + (compact ? 0 : 56) + controls.offsetHeight + 24;
      root.style.setProperty("--reader-sticky-top", `${bottom - box.top}px`);
      // Тетрадь у края: 15 px под панелью и 15 px над плеером, без плеера — над низом окна (просьба владельца 2026-10-01).
      // sticky отсчитывается от отступа .app-content, а не от её края.
      const controlsBottom = controls.getBoundingClientRect().bottom, inset = content ? parseFloat(getComputedStyle(content).paddingTop) || 0 : 0;
      const dockTop = controlsBottom - box.top - inset + 15;
      root.style.setProperty("--reader-dock-top", `${dockTop}px`);
      // Пока страница не прокручена, тетрадь стоит в потоке ниже — подтягиваем её к той же точке.
      const layout = root.querySelector<HTMLElement>(".mastering-reader__layout");
      if (layout) root.style.setProperty("--reader-dock-shift", `${Math.min(0, dockTop - (layout.getBoundingClientRect().top - box.top - inset + (content?.scrollTop ?? 0)))}px`);
      const player = document.querySelector<HTMLElement>(".audio-player-bar")?.getBoundingClientRect();
      const floor = player && player.height > 0 && player.top < innerHeight ? player.top : innerHeight;
      root.style.setProperty("--reader-dock-height", `${Math.max(320, floor - 15 - controlsBottom - 15)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (content) observer.observe(content);
    observer.observe(controls);
    observer.observe(root);
    const player = document.querySelector(".audio-player-bar");
    if (player) observer.observe(player);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [reader, toolbar]);

  useEffect(() => {
    const root = article.current;
    if (!root || !headings.length) return;
    const content = root.closest<HTMLElement>(".app-content");
    const source = content ?? window;
    let frame = 0;
    const update = () => {
      const frameRoot = root.closest<HTMLElement>(".mastering-reader");
      const stickyTop = frameRoot ? parseFloat(getComputedStyle(frameRoot).getPropertyValue("--reader-sticky-top")) : 0;
      const sidebar = toc.current?.parentElement;
      if (sidebar && frameRoot?.dataset.compact !== "true") {
        const bottom = content?.getBoundingClientRect().bottom ?? innerHeight;
        sidebar.style.setProperty("--reader-toc-height", `${Math.max(0, bottom - sidebar.getBoundingClientRect().top - 8)}px`);
      }
      const threshold = Math.max((content?.getBoundingClientRect().top ?? 0) + stickyTop, toolbar.current?.getBoundingClientRect().bottom ?? 0) + 32;
      let current = 0;
      root.querySelectorAll<HTMLElement>(".rt-h").forEach((node, index) => { if (node.getBoundingClientRect().top <= threshold) current = index; });
      setActiveHeading(current);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    const player = document.querySelector(".audio-player-bar");
    if (player) observer.observe(player);
    source.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); source.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, [article, toolbar, toc, headings]);

  useEffect(() => {
    const list = toc.current;
    const item = list?.querySelector<HTMLElement>(`[data-heading-index="${activeHeading}"]`);
    if (!list || !item) return;
    const box = list.getBoundingClientRect(), row = item.getBoundingClientRect();
    if (row.top < box.top) list.scrollTo({ top: list.scrollTop + row.top - box.top - 8 });
    else if (row.bottom > box.bottom) list.scrollTo({ top: list.scrollTop + row.bottom - box.bottom + 8 });
  }, [activeHeading, headings, toc]);
  return activeHeading;
}
