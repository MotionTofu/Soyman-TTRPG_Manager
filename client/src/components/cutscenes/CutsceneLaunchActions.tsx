import { useEffect, useState } from "react";
import type { CutsceneLaunchContext } from "@shared/cutscenes/types";
import { useCutscenePlayback } from "../../cutscenes/useCutscenePlayback";
import { useAudioOwnership } from "../../sound/audioOwnership";
import { CutsceneReadiness } from "./CutsceneReadiness";

/** All entry points select the saved original; they never pass the workshop draft to playback. */
export function CutsceneLaunchActions({ id, context = { kind: "library" }, name, onStarted, beforeSelect, catalog }: {
  id: number; rehearsal?: boolean; context?: CutsceneLaunchContext; name?: string; catalog?: boolean; onStarted?: () => void; beforeSelect?: () => Promise<boolean>;
}) {
  const { controller, state } = useCutscenePlayback(), lease = useAudioOwnership();
  const [mode, setMode] = useState<"live" | "rehearsal" | null>(null), [loading, setLoading] = useState(false);
  useEffect(() => { if (mode && state.run && !state.run.endedAt) { setMode(null); onStarted?.(); } }, [state.run, mode, onStarted]);
  const active = !!state.run && !state.run.endedAt;
  async function select(next: "live" | "rehearsal") {
    setLoading(true);
    try {
      if (beforeSelect && !await beforeSelect()) return;
      if (await controller.discover()) return;
      setMode(next);
      await controller.select(id);
    } finally { setLoading(false); }
  }
  const playing = catalog && active && state.run?.snapshot.version.cutsceneId === id;
  const disabled = loading || state.busy || active || !!lease && !beforeSelect;
  return <>
    <button type="button" className={catalog ? `d-btn d-btn--sm${playing ? " d-btn--primary" : ""}` : "primary"} disabled={disabled} aria-label={name && !playing ? `Показать катсцену «${name}»` : undefined} onClick={() => void select("live")}>{playing ? "Идёт показ" : "Показать игрокам"}</button>
    {mode && <CutsceneReadiness controller={controller} state={state} mode={mode} context={context}
      onClose={() => { if (controller.dismiss()) setMode(null); }} />}
  </>;
}
