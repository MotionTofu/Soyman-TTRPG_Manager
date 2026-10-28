import { CUTSCENE_DEFAULTS } from "@shared/cutscenes/defaults";

/** Only the current text has a cursor. Selecting another generation discards its position. */
export interface TeleprompterCursor { identity: string | null; top: number; height: number }
export const createTeleprompterCursor = (): TeleprompterCursor => ({ identity: null, top: 0, height: 0 });
export interface TeleprompterStatus { readonly overflowing: boolean; readonly atEnd: boolean }
interface TeleprompterClock {
  now(): number;
  request(callback: (time: number) => void): number;
  cancel(id: number): void;
}
const clock: TeleprompterClock = {
  now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id),
};
export function teleprompterWordCount(text: string): number {
  return text.split(/\s+/u).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Scrolls the rendered prose, not Markdown source length or the separately rendered notes. */
export class TeleprompterScroller {
  private readonly viewport: HTMLElement;
  private readonly content: HTMLElement;
  private readonly cursor: TeleprompterCursor;
  private readonly clock: TeleprompterClock;
  private readonly manual: () => void;
  private readonly changed: (status: TeleprompterStatus) => void;
  private paused = true;
  private rate = 0;
  private wordsPerMinute: number = CUTSCENE_DEFAULTS.wordsPerMinute;
  private height = 0;
  private viewportHeight = 0;
  private maximum = 0;
  private expected = 0;
  private lastAt: number;
  private frame: number | null = null;
  private disposed = false;
  private status: TeleprompterStatus = { overflowing: false, atEnd: false };

  constructor(viewport: HTMLElement, content: HTMLElement, cursor: TeleprompterCursor,
    options: { manual: () => void; changed: (status: TeleprompterStatus) => void; clock?: TeleprompterClock }) {
    this.viewport = viewport; this.content = content; this.cursor = cursor;
    this.manual = options.manual; this.changed = options.changed; this.clock = options.clock ?? clock;
    this.lastAt = this.clock.now();
  }
  update(identity: string, paused: boolean, wordsPerMinute: number): void {
    const now = this.clock.now();
    this.advance(now);
    if (this.cursor.identity !== identity) {
      this.cursor.identity = identity; this.cursor.top = 0; this.cursor.height = 0;
    }
    this.paused = paused;
    if (Number.isFinite(wordsPerMinute) && wordsPerMinute > 0) this.wordsPerMinute = wordsPerMinute;
    this.measure(); this.lastAt = now; this.schedule();
  }
  /** Reflow keeps approximately the same reading place when font/width changes. */
  refresh(): void {
    if (this.disposed) return;
    this.advance(this.clock.now()); this.measure(); this.schedule();
  }
  private measure(): void {
    const height = this.content.scrollHeight, viewportHeight = this.viewport.clientHeight;
    const top = this.cursor.height > 0 && this.cursor.height !== height ? this.cursor.top / this.cursor.height * height : this.cursor.top;
    this.height = height; this.viewportHeight = viewportHeight;
    this.maximum = Math.max(0, this.viewport.scrollHeight - viewportHeight);
    const words = teleprompterWordCount(this.content.innerText ?? this.content.textContent ?? "");
    this.rate = words > 0 ? height / words * this.wordsPerMinute / 60 : 0;
    this.cursor.height = height; this.write(top); this.report();
  }
  private write(top: number): void {
    this.cursor.top = Math.max(0, Math.min(this.maximum, top));
    this.viewport.scrollTop = this.cursor.top;
    // Browsers may round fractional offsets. Compare future scroll events to the actual assigned value.
    this.expected = this.viewport.scrollTop;
  }
  private advance(now: number): void {
    if (!this.paused && !this.disposed) this.write(this.cursor.top + this.rate * Math.max(0, now - this.lastAt) / 1000);
    this.lastAt = now; this.report();
  }
  private schedule(): void {
    if (this.frame !== null) { this.clock.cancel(this.frame); this.frame = null; }
    if (this.disposed || this.paused || this.rate <= 0 || this.maximum <= 0 || this.cursor.top >= this.maximum) return;
    this.frame = this.clock.request(now => {
      this.frame = null; this.advance(now); this.schedule();
    });
  }
  private report(): void {
    const overflowing = this.maximum > 0, atEnd = overflowing && this.cursor.top >= this.maximum - 1;
    if (this.status.overflowing === overflowing && this.status.atEnd === atEnd) return;
    this.status = { overflowing, atEnd }; this.changed(this.status);
  }
  pauseForManualScroll = (): void => {
    if (this.disposed || this.maximum <= 0) return;
    this.advance(this.clock.now());
    this.paused = true; this.schedule(); this.manual();
  };
  scrolled = (): void => {
    if (this.disposed) return;
    if (this.content.scrollHeight !== this.height || this.viewport.clientHeight !== this.viewportHeight) { this.refresh(); return; }
    const top = this.viewport.scrollTop;
    if (Math.abs(top - this.expected) <= 1) return;
    this.paused = true; this.cursor.top = top; this.expected = top;
    this.lastAt = this.clock.now(); this.schedule(); this.report(); this.manual();
  };
  keydown = (event: KeyboardEvent): void => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) this.pauseForManualScroll();
  };
  dispose(): void {
    this.advance(this.clock.now()); this.disposed = true;
    if (this.frame !== null) this.clock.cancel(this.frame); this.frame = null;
  }
}
