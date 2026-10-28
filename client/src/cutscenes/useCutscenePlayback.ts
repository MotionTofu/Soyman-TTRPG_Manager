import { useSyncExternalStore } from "react";
import { useSoundEngine } from "../sound/engine";

/** Stable controller belongs to the host, so mounting/unmounting controls cannot create a second player. */
export function useCutscenePlayback() {
  const { cutscenePlayback: controller } = useSoundEngine();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { controller, state };
}
