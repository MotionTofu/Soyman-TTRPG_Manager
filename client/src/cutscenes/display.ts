import type { CutsceneMediaAccess, CutsceneMediaRef } from "@shared/cutscenes/types";
import { projectCutscenePlayerFrame } from "@shared/cutscenes/projection";
import { readCutscenePreview } from "./preview";
import { rememberRehearsalFrame } from "./rehearsalFrames";
import { readOnce } from "../data/imperative";
import { closePlayerDisplayWindow, openPlayerDisplayWindow } from "../components/presentation/playerDisplayWindow";
import { isSafeImageUrl } from "../utils/safeUrl";
import type { CutsceneOutput } from "./ports";

const CHANNEL = "soyman-cutscene-visual-preparation";
interface Message {
  type: "prepare" | "ready" | "failed" | "display-error" | "display-closed";
  windowId: string;
  requestId: string;
  urls?: string[];
  error?: string;
}
function channel(receive: (message: Message) => void) {
  const port = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  const accept = (data: unknown) => {
    if (!data || typeof data !== "object") return;
    const value = data as Message;
    if (["prepare", "ready", "failed", "display-error", "display-closed"].includes(value.type) && typeof value.windowId === "string" &&
      typeof value.requestId === "string") receive(value);
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== CHANNEL || !event.newValue) return;
    try { accept(JSON.parse(event.newValue)); } catch { /* unrelated malformed message */ }
  };
  if (port) port.onmessage = event => accept(event.data); else window.addEventListener("storage", storage);
  return {
    send(value: Message) { if (port) port.postMessage(value); else localStorage.setItem(CHANNEL, JSON.stringify({ ...value, nonce: crypto.randomUUID() })); },
    dispose() { port?.close(); window.removeEventListener("storage", storage); },
  };
}
function abort(): DOMException { return new DOMException("Подготовка изображения отменена", "AbortError"); }
export function prepareImages(urls: readonly string[], signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) return Promise.reject(abort());
  const images: HTMLImageElement[] = [];
  return Promise.all(urls.map(url => new Promise<void>((resolve, reject) => {
    if (!isSafeImageUrl(url)) { reject(new Error("Недопустимое изображение катсцены")); return; }
    const image = new Image(); images.push(image);
    const finish = (error?: Error) => {
      clearTimeout(timer); signal.removeEventListener("abort", aborted);
      image.onload = null; image.onerror = null;
      if (error) reject(error); else resolve();
    };
    const aborted = () => { image.removeAttribute("src"); finish(abort()); };
    const timer = setTimeout(() => finish(new Error("Изображение катсцены не загрузилось")), 30000);
    image.onload = () => { void image.decode().then(() => finish(), error => finish(error)); };
    image.onerror = () => finish(new Error("Не удалось загрузить изображение катсцены"));
    signal.addEventListener("abort", aborted, { once: true }); image.src = url;
  }))).then(() => () => { images.forEach(image => { image.onload = null; image.onerror = null; image.removeAttribute("src"); }); });
}
export function preparePlayerWindow(windowId: string, urls: string[], signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abort()); return; }
    const requestId = crypto.randomUUID();
    const port = channel(value => {
      if (value.windowId !== windowId || value.requestId !== requestId) return;
      if (value.type === "ready") finish();
      if (value.type === "failed") finish(new Error(value.error || "Окно игроков не подготовило изображение"));
    });
    const finish = (error?: Error) => {
      clearTimeout(timeout); clearInterval(retry); signal.removeEventListener("abort", aborted); port.dispose();
      if (error) reject(error); else resolve(() => {});
    };
    const aborted = () => finish(abort());
    const timeout = setTimeout(() => finish(new Error("Окно игроков не отвечает. Откройте его и повторите попытку.")), 30000);
    const send = () => port.send({ type: "prepare", windowId, requestId, urls });
    const retry = setInterval(send, 250); // A freshly opened authenticated page may still be mounting.
    signal.addEventListener("abort", aborted, { once: true }); send();
  });
}

/** Only image URLs cross this channel. It never carries narration, notes, audio or a return snapshot. */
export const browserCutsceneOutput: CutsceneOutput = {
  open: openPlayerDisplayWindow,
  close: closePlayerDisplayWindow,
  async prepare(run, step, signal) {
    if (run.snapshot.mode === "rehearsal") {
      const composition = step.image.composition;
      if (!composition) return () => {};
      const data = await readCutscenePreview(run.snapshot.version.cutsceneId, composition, signal);
      const dispose = await prepareImages([data.background_url, ...data.layers.map(layer => layer.image_url)].filter((url): url is string => !!url), signal);
      if (signal.aborted) { dispose(); throw abort(); }
      rememberRehearsalFrame(run, step, data);
      return dispose;
    }
    const frame = projectCutscenePlayerFrame(step), composition = frame.composition;
    const refs: CutsceneMediaRef<"image">[] = composition ? [
      ...(composition.background ? [composition.background] : []), ...composition.layers.filter(layer => layer.visible).map(layer => layer.image),
    ] : [];
    const access = await Promise.all(refs.map(ref => readOnce<CutsceneMediaAccess>(
      `/cutscenes/${run.snapshot.version.cutsceneId}/media/${encodeURIComponent(ref.id)}/access`, { signal })));
    if (signal.aborted) throw abort();
    const urls = [...new Set(access.map(item => item.url))];
    const windowId = run.snapshot.returnState.window.windowId;
    if (!windowId) throw new Error("У запуска нет идентификатора окна игроков");
    return preparePlayerWindow(windowId, urls, signal);
  },
  subscribeErrors(listener) {
    const port = channel(value => { if (value.type === "display-error") listener(value.windowId, value.error || "Ошибка изображения в окне игроков"); });
    return () => port.dispose();
  },
};

/** Installed only by the authenticated, silent players' page. Preparing never changes its visible frame. */
export function subscribePreviewWindowClose(listener: (windowId: string) => void): () => void {
  const port = channel(value => { if (value.type === "display-closed") listener(value.windowId); });
  return () => port.dispose();
}

export function listenForCutscenePreparation(): () => void {
  const windowId = new URL(window.location.href).searchParams.get("windowId");
  if (!windowId) return () => {};
  const pending = new Map<string, { controller: AbortController; ready?: boolean; error?: string; dispose?: () => void }>();
  const port = channel(value => {
    if (value.type !== "prepare" || value.windowId !== windowId || !Array.isArray(value.urls) ||
      !value.urls.every(url => typeof url === "string")) return;
    const old = pending.get(value.requestId);
    if (old) {
      if (old.ready || old.error) port.send({ type: old.ready ? "ready" : "failed", windowId, requestId: value.requestId, error: old.error });
      return;
    }
    // Only the latest preparation is useful; a slow older decode must never publish anything.
    for (const entry of pending.values()) { entry.controller.abort(); entry.dispose?.(); }
    pending.clear();
    const entry: { controller: AbortController; ready?: boolean; error?: string; dispose?: () => void } = { controller: new AbortController() };
    pending.set(value.requestId, entry);
    void prepareImages(value.urls, entry.controller.signal).then(dispose => {
      entry.dispose = dispose;
      if (entry.controller.signal.aborted) { dispose(); return; }
      entry.ready = true; port.send({ type: "ready", windowId, requestId: value.requestId });
    }).catch(error => {
      if (entry.controller.signal.aborted) return;
      entry.error = error instanceof Error ? error.message : String(error);
      port.send({ type: "failed", windowId, requestId: value.requestId, error: entry.error });
    });
  });
  const closed = () => port.send({ type: "display-closed", windowId, requestId: crypto.randomUUID() });
  window.addEventListener("beforeunload", closed);
  return () => { window.removeEventListener("beforeunload", closed); for (const entry of pending.values()) { entry.controller.abort(); entry.dispose?.(); } port.dispose(); };
}
export function reportCutsceneDisplayError(reason: string): void {
  const windowId = new URL(window.location.href).searchParams.get("windowId");
  if (!windowId) return;
  const port = channel(() => {});
  port.send({ type: "display-error", windowId, requestId: crypto.randomUUID(), error: reason }); port.dispose();
}
