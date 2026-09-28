import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useEntity, useResource } from "../data/hooks";
import { sessionPaths } from "../data/sessions";
import { PresentationStage } from "../components/presentation/PresentationStage";
import { FullscreenButton } from "../components/presentation/FullscreenButton";
import { PlayerMapStage } from "../components/presentation/PlayerMapStage";
import type { CampaignCover, ScenePresentation, SessionDetail, ShowState } from "../types";

// Окно показа игрокам — второй монитор. Рендерится вне <AppShell> (см.
// App.tsx): сайдбару и поиску здесь места нет, только кадр 16:9 на чёрном.
//
// Источник правды — серверный show-state (GET /sessions/:id/show-state):
// окно переживает перезагрузку посреди сцены. Обновления подхватываются по
// сигналу слоя данных из окна пульта + опросом 2с как страховкой.
export function PresentationShowPage() {
  const { id } = useParams();
  const sessionId = Number(id);

  // Всё — под ключами слоя, теми же, что у пульта: запуск показа задевает
  // show-state сессии (data/sessions.ts), и сигнал другого окна доходит сюда
  // через DataLayerSync в корне приложения. Опрос раз в 2 с — страховка на
  // случай пропущенного сигнала: застывший кадр видят игроки.
  const session = useEntity<SessionDetail>("session", sessionId).data;
  const campaignId = session?.campaign_id ?? null;
  // Тестовый прогон игрокам не показывается (Q44): Пульт живёт как обычно,
  // предпросмотр у Мастера работает, а этот экран остаётся чёрным.
  const rehearsal = session?.live_mode === "rehearsal";
  const state = useResource<ShowState>(sessionPaths.showState(sessionId), { pollMs: 2000 }).data ?? null;
  const showMode = state?.mode;
  const showSceneId = state?.scene_id;
  // Кадр держится, пока грузится следующий: переход между сценами не мигает
  // пустым экраном «Загрузка…».
  const scene =
    useResource<ScenePresentation>(state && showMode === "scene" && showSceneId != null ? `/story/scenes/${showSceneId}/presentation` : null, {
      keepPrevious: true,
    }).data ?? null;
  const cover =
    useResource<CampaignCover>(state && showMode === "cover" && campaignId != null ? sessionPaths.campaignCover(campaignId) : null).data ??
    null;

  useEffect(() => {
    document.title = "Показ игрокам";
    return () => {
      document.title = "SoyMan";
    };
  }, []);

  if (!state) return <div style={{ background: "#000", minHeight: "100vh" }} />;

  // playKey — только смена кадра (режим/сцена): тоглы слоёв идут через
  // visibleIds без переигрывания перехода и титра.
  if (!state.shown || state.mode === "black" || rehearsal) {
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

  if (state.mode === "map") {
    return <div style={{ background: "#000", width: "100vw", height: "100vh" }}>
      <FullscreenButton />
      {state.map_id != null && <PlayerMapStage key={state.map_id} mapId={state.map_id} />}
    </div>;
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
