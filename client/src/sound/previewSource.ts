import { readResource } from "../data/imperative";
import type { SoundButton } from "./types";

// /files подписаны на 60 секунд, а библиотека может оставаться открытой
// весь вечер. Перед воспроизведением получаем свежую подпись через слой данных.
export function previewSourceNeedsRefresh(src: string | null): boolean {
  if (!src?.startsWith("/files/")) return false;
  const query = new URLSearchParams(src.split("?")[1]);
  if (!query.has("sig")) return false;
  const expires = Number(query.get("exp"));
  return !Number.isFinite(expires) || expires <= Date.now() / 1000 + 10;
}

export async function refreshPreviewSound(sound: SoundButton): Promise<SoundButton> {
  const sounds = await readResource<SoundButton[]>("/sounds", { fresh: true });
  const fresh = sounds.find((item) => item.resource_id === sound.resource_id);
  if (!fresh || fresh.missing || !fresh.src) throw new Error("Аудиофайл недоступен");
  return fresh;
}
