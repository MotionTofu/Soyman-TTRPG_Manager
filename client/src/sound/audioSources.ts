import type { CutsceneAudioSource } from "@shared/cutscenes/types";
import { readResource } from "../data/imperative";
import type { SoundButton } from "./types";

export type AudioSourceResolver = (source: CutsceneAudioSource) => Promise<string>;
/** One fresh resource listing per restore, never a URL serialized into a return snapshot. */
export function freshAudioSources(external?: AudioSourceResolver): AudioSourceResolver {
  let resources: Promise<SoundButton[]> | null = null;
  return async source => {
    if (source.kind === "cutscene") {
      if (!external) throw new Error("Для материала катсцены нужен её проигрыватель");
      return external(source);
    }
    resources ??= readResource<SoundButton[]>("/sounds", { fresh: true });
    const sound = (await resources).find(item => item.resource_id === source.resourceId);
    if (!sound?.src || sound.missing) throw new Error(`Аудиофайл ${source.resourceId} недоступен`);
    return sound.src;
  };
}
