import { useSyncExternalStore } from "react";
import { useSoundEngine } from "../sound/engine";
import { workshopPreview } from "./workshopPreview";

export function useWorkshopPreview() {
  const { cutsceneAudio, cutsceneMusic } = useSoundEngine();
  const controller = workshopPreview(cutsceneAudio, cutsceneMusic);
  return { controller, state: useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot) };
}
