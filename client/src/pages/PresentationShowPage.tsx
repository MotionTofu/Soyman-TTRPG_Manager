import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { PlayerDisplayFrame, PlayerDisplayState } from "@shared/playerDisplay";
import { useCurrentUser } from "../api/currentUser";
import { useResource, write } from "../data/hooks";
import { afterWrite } from "../data/hooks";
import { PLAYER_DISPLAY_PATH, PLAYER_FRAME_PATH, selectSessionDisplay } from "../components/presentation/playerDisplay";
import { PlayerDisplaySurface } from "../components/presentation/PlayerDisplaySurface";
import { listenForPlayerWindowClose } from "../components/presentation/playerDisplayWindow";
import { listenForCutscenePreparation, reportCutsceneDisplayError } from "../cutscenes/display";
import { FullscreenButton } from "../components/presentation/FullscreenButton";

/** Shared authenticated second screen. The legacy session URL is an alias, never a separate player. */
export function PresentationShowPage() {
  const { id } = useParams();
  const { user } = useCurrentUser();
  const gm = user?.role === "gm";
  const client = useQueryClient();
  const frame = useResource<PlayerDisplayFrame>(gm ? PLAYER_FRAME_PATH : null, { pollMs: 2000 }).data ?? null;
  const size = useRef<{ w: number | null; h: number | null }>({ w: null, h: null });
  size.current = { w: frame?.display.screen_w ?? null, h: frame?.display.screen_h ?? null };
  useEffect(() => {
    document.title = "Показ игрокам";
    return () => { document.title = "SoyMan"; };
  }, []);
  useEffect(() => {
    if (gm && id) void selectSessionDisplay(Number(id), true).catch(() => {});
  }, [gm, id]);
  useEffect(() => listenForPlayerWindowClose(), []);
  useEffect(() => gm ? listenForCutscenePreparation() : undefined, [gm]);
  const loaded = !!frame;
  useEffect(() => {
    if (!gm || !loaded) return;
    let timer: number;
    const report = () => {
      const screen_w = window.innerWidth, screen_h = window.innerHeight;
      if (size.current.w === screen_w && size.current.h === screen_h) return;
      void write.put<PlayerDisplayState>("/presentation/viewport", { screen_w, screen_h }).then(updated => {
        afterWrite(client, [{ path: PLAYER_FRAME_PATH }, { path: PLAYER_DISPLAY_PATH },
          ...(updated.snapshot?.context?.kind === "session" ? [{ path: `/sessions/${updated.snapshot.context.sessionId}/show-state` }] : [])]);
      }).catch(() => {});
    };
    const schedule = () => { clearTimeout(timer); timer = window.setTimeout(report, 300); };
    schedule(); window.addEventListener("resize", schedule);
    return () => { clearTimeout(timer); window.removeEventListener("resize", schedule); };
  }, [gm, loaded, client, id, frame?.playKey]);
  return <><PlayerDisplaySurface frame={gm ? frame : null} onError={reportCutsceneDisplayError} /><FullscreenButton /></>;
}
