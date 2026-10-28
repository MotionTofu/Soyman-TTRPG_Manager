import { audioAuthority, type AudioAuthority } from "./audioOwnership";

const installations = new WeakMap<Document, () => void>();

/** Audition is a one-shot outside the four console channels: interrupt, block, never auto-resume. */
export function installAuxiliaryAudioGuard(authority: AudioAuthority = audioAuthority, doc: Document = document): () => void {
  const existing = installations.get(doc);
  if (existing) return existing;
  const blocked = new WeakSet<HTMLMediaElement>();
  const nativeIntent = new WeakSet<HTMLMediaElement>();
  const prototype = doc.defaultView!.HTMLMediaElement.prototype;
  const originalPlay = prototype.play;
  const auxiliary = (element: unknown): element is HTMLAudioElement =>
    element instanceof doc.defaultView!.HTMLAudioElement && !element.hasAttribute("data-audio-channel");
  const allOwned = () => authority.getSnapshot()?.scope === "all";
  const interrupt = () => {
    if (!allOwned()) return;
    for (const element of doc.querySelectorAll("audio")) if (auxiliary(element)) {
      blocked.add(element); nativeIntent.delete(element); element.pause();
    }
  };
  function guardedPlay(this: HTMLMediaElement): Promise<void> {
    if (auxiliary(this) && (allOwned() || blocked.has(this))) {
      blocked.add(this); nativeIntent.delete(this); this.pause();
      return Promise.reject(new DOMException("Прослушивание приостановлено катсценой. Запустите его заново после завершения.", "NotAllowedError"));
    }
    return originalPlay.call(this);
  }
  prototype.play = guardedPlay;
  // Native audio controls do not call the JavaScript play method.
  const onPlay = (event: Event) => {
    const element = event.target;
    if (!auxiliary(element)) return;
    if (!allOwned() && nativeIntent.has(element)) { nativeIntent.delete(element); blocked.delete(element); return; }
    if (allOwned() || blocked.has(element)) { blocked.add(element); nativeIntent.delete(element); element.pause(); }
  };
  const onIntent = (event: Event) => {
    if (!event.isTrusted || !(event.target instanceof doc.defaultView!.Element)) return;
    if (event instanceof doc.defaultView!.KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    const button = target.closest(".sl-preview");
    const native = target.closest("audio[controls]:not([data-audio-channel])");
    if (!button && !native) return;
    if (allOwned()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (native && auxiliary(native)) nativeIntent.add(native);
    // The library and its modal share one audition hook/element. A new click cancels its older requests.
    if (button) for (const element of doc.querySelectorAll("audio:not([controls])")) if (auxiliary(element)) blocked.delete(element);
  };
  doc.addEventListener("play", onPlay, true);
  doc.addEventListener("click", onIntent, true);
  doc.addEventListener("keydown", onIntent, true);
  const unsubscribe = authority.subscribe(interrupt);
  const observer = new MutationObserver(interrupt);
  observer.observe(doc.documentElement, { subtree: true, childList: true });
  interrupt();
  const dispose = () => {
    unsubscribe(); observer.disconnect();
    doc.removeEventListener("play", onPlay, true); doc.removeEventListener("click", onIntent, true); doc.removeEventListener("keydown", onIntent, true);
    if (prototype.play === guardedPlay) prototype.play = originalPlay;
    installations.delete(doc);
  };
  installations.set(doc, dispose);
  return dispose;
}
