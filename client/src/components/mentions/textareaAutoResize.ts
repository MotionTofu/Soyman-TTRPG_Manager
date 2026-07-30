// Batches the height="auto"+scrollHeight auto-grow trick across every
// mounted MentionTextarea into a single write/read/write pass per frame,
// instead of each instance doing its own read-after-write. A page with many
// textareas (session edit, with a note field per Локации/Сюжетные
// персонажи/Противники/Потенциальный лут row) previously forced one
// synchronous layout reflow *per textarea* in the same frame — classic
// layout thrashing, visible as a burst of DevTools "Forced reflow"
// violations on engines without CSS field-sizing support (this app's
// bundled Electron/Chromium predates it; see MentionTextarea.tsx).
const pending = new Set<HTMLTextAreaElement>();
let scheduled = false;

export function scheduleAutoResize(el: HTMLTextAreaElement) {
  pending.add(el);
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(flush);
}

export function cancelAutoResize(el: HTMLTextAreaElement) {
  pending.delete(el);
}

function flush() {
  scheduled = false;
  const els = Array.from(pending);
  pending.clear();
  // Write phase: reset every textarea to "auto" first...
  for (const el of els) el.style.height = "auto";
  // ...then read phase: every scrollHeight read reuses the single layout
  // pass triggered by the first read, since no writes are interleaved...
  const heights = els.map((el) => el.scrollHeight);
  // ...then write phase: apply the measured heights.
  els.forEach((el, i) => {
    el.style.height = `${heights[i]}px`;
  });
}
