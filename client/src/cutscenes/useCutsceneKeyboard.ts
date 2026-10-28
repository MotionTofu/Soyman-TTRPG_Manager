import { useLayoutEffect, useRef } from "react";
import { installCutsceneKeyboard, type CutsceneKeyCommand } from "./keyboard";

export function useCutsceneKeyboard(invoke: (command: CutsceneKeyCommand) => void): void {
  const current = useRef(invoke); current.current = invoke;
  useLayoutEffect(() => installCutsceneKeyboard().claim(command => current.current(command)), []);
}
