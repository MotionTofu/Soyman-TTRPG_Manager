/** Cancelable position restore. A superseded metadata event cannot seek a newer source. */
export function positionAfterMetadata(audio: HTMLAudioElement, seconds: number): () => void {
  const src = audio.getAttribute("src");
  const seek = () => {
    audio.removeEventListener("loadedmetadata", seek);
    if (audio.getAttribute("src") !== src) return;
    try { audio.currentTime = Math.max(0, Math.min(seconds, Number.isFinite(audio.duration) ? audio.duration : seconds)); } catch { /* browser not ready */ }
  };
  if (audio.readyState >= 1) seek(); else audio.addEventListener("loadedmetadata", seek);
  return () => audio.removeEventListener("loadedmetadata", seek);
}

/** Fades the captured voices, preserving the proportions of an interrupted crossfade. */
export function fadeAndPause(elements: (HTMLAudioElement | null)[], ms: number, valid: () => boolean): Promise<void> {
  const voices = elements.filter((el): el is HTMLAudioElement => !!el);
  const initial = voices.map(el => el.volume);
  if (ms <= 0 || voices.every(el => el.paused || el.volume === 0)) { voices.forEach(el => el.pause()); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const timer = window.setInterval(() => {
      if (!valid()) { clearInterval(timer); reject(new Error("Передача звука отменена")); return; }
      const t = Math.min(1, (performance.now() - start) / ms);
      voices.forEach((el, i) => { el.volume = initial[i] * (1 - t); });
      if (t >= 1) { clearInterval(timer); voices.forEach(el => el.pause()); resolve(); }
    }, Math.min(30, ms));
  });
}

/** Restore positions/state at zero gain, then raise only the captured application's channels. */
export function fadeInTransport(ms: number, apply: (fraction: number) => void, valid: () => boolean): Promise<void> {
  if (!valid()) return Promise.reject(new Error("Возврат звука отменён"));
  if (ms <= 0) { apply(1); return Promise.resolve(); }
  apply(0);
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const timer = setInterval(() => {
      if (!valid()) { clearInterval(timer); reject(new Error("Возврат звука отменён")); return; }
      const fraction = Math.min(1, (performance.now() - start) / ms);
      apply(fraction);
      if (fraction >= 1) { clearInterval(timer); resolve(); }
    }, Math.min(15, ms));
  });
}
