import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { onDataChangedElsewhere } from "../dataSync";
import { PresentationStage } from "../components/presentation/PresentationStage";
import { FullscreenButton } from "../components/presentation/FullscreenButton";
import type { CampaignCover, ScenePresentation, SessionDetail, ShowState } from "../types";

// Окно показа игрокам — второй монитор. Рендерится вне <AppShell> (см.
// App.tsx): сайдбару и поиску здесь места нет, только кадр 16:9 на чёрном.
//
// Источник правды — серверный show-state (GET /sessions/:id/show-state):
// окно переживает перезагрузку посреди сцены. Обновления подхватываются по
// BroadcastChannel-пингу (dataSync.ts) + опросом 2с как страховкой: пульт
// пишет show-state обычным PUT, и тот сам рассылает пинг всем окнам.
export function PresentationShowPage() {
  const { id } = useParams();
  const sessionId = Number(id);

  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [state, setState] = useState<ShowState | null>(null);
  const [scene, setScene] = useState<ScenePresentation | null>(null);
  const [cover, setCover] = useState<CampaignCover | null>(null);

  const refreshState = useCallback(() => {
    api.get<ShowState>(`/sessions/${sessionId}/show-state`).then(setState).catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    api
      .get<SessionDetail>(`/sessions/${sessionId}`)
      .then((s) => setCampaignId(s.campaign_id))
      .catch(() => {});
    refreshState();
  }, [sessionId, refreshState]);

  useEffect(() => onDataChangedElsewhere(refreshState), [refreshState]);
  useEffect(() => {
    const timer = setInterval(refreshState, 2000);
    return () => clearInterval(timer);
  }, [refreshState]);

  useEffect(() => {
    document.title = "Показ игрокам";
    return () => {
      document.title = "SoyMan";
    };
  }, []);

  // Контент под состояние: сцена — по scene_id из show-state (там уже лежит
  // writable-строка, override или оригинал — разруливать нечего), заглавное —
  // по кампании сессии.
  const showMode = state?.mode;
  const showSceneId = state?.scene_id;
  useEffect(() => {
    if (!state || showMode !== "scene" || showSceneId == null) {
      setScene(null);
      return;
    }
    let cancelled = false;
    api
      .get<ScenePresentation>(`/story/scenes/${showSceneId}/presentation`)
      .then((p) => {
        if (!cancelled) setScene(p);
      })
      .catch(() => {
        if (!cancelled) setScene(null);
      });
    return () => {
      cancelled = true;
    };
  }, [state, showMode, showSceneId]);

  useEffect(() => {
    if (!state || showMode !== "cover" || campaignId == null) {
      setCover(null);
      return;
    }
    let cancelled = false;
    api
      .get<CampaignCover>(`/campaigns/${campaignId}/cover`)
      .then((c) => {
        if (!cancelled) setCover(c);
      })
      .catch(() => {
        if (!cancelled) setCover(null);
      });
    return () => {
      cancelled = true;
    };
  }, [state, showMode, campaignId]);

  if (!state) return <div style={{ background: "#000", minHeight: "100vh" }} />;

  // playKey — только смена кадра (режим/сцена): тоглы слоёв идут через
  // visibleIds без переигрывания перехода и титра.
  if (!state.shown || state.mode === "black") {
    return (
      <div style={{ background: "#000", minHeight: "100vh" }}>
        <PresentationStage
          backgroundUrl={null}
          layers={[]}
          visibleIds={[]}
          fadeMs={0}
          transition="cut"
          transitionMs={0}
          title=""
          titleSecs={0}
          playKey="blank"
          waitingLabel="Показ не запущен"
        />
      </div>
    );
  }

  const data = state.mode === "cover" ? cover : scene;
  if (!data) {
    return (
      <div style={{ background: "#000", minHeight: "100vh" }}>
        <PresentationStage
          backgroundUrl={null}
          layers={[]}
          visibleIds={[]}
          fadeMs={0}
          transition="cut"
          transitionMs={0}
          title=""
          titleSecs={0}
          playKey="loading"
          waitingLabel="Загрузка…"
        />
      </div>
    );
  }

  return (
    <div style={{ background: "#000", minHeight: "100vh" }}>
      <FullscreenButton />
      <PresentationStage
        backgroundUrl={data.background_url}
        layers={data.layers}
        visibleIds={state.visible_layer_ids}
        fadeMs={data.fade_ms}
        transition={data.transition}
        transitionMs={data.transition_ms}
        title={data.title}
        titleSecs={data.title_secs}
        playKey={`${state.mode}:${state.mode === "scene" ? state.scene_id : campaignId}`}
        interactive
        waitingLabel="Показ не запущен"
      />
    </div>
  );
}
