import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { notifyDataChanged } from "../dataSync";
import { dataKeys } from "../data/entities";
import { useEntity, useResource, write } from "../data/hooks";
import { sessionPaths } from "../data/sessions";
import { PresentationStage } from "../components/presentation/PresentationStage";
import { FullscreenButton } from "../components/presentation/FullscreenButton";
import { PlayerMapStage } from "../components/presentation/PlayerMapStage";
import { ScreenView } from "../components/presentation/ScreenView";
import { cameraOf } from "../components/presentation/screens";
import type { CampaignCover, ScenePresentation, SessionDetail, ShowState } from "../types";

// Окно показа игрокам — второй монитор. Рендерится вне <AppShell> (см.
// App.tsx): сайдбару и поиску здесь места нет, только кадр на чёрном —
// повёрнутый, вписанный или заполненный по настройке пульта (ScreenView).
//
// Источник правды — серверный show-state (GET /sessions/:id/show-state):
// окно переживает перезагрузку посреди сцены. Обновления подхватываются по
// сигналу слоя данных из окна пульта + опросом 2с как страховкой.
export function PresentationShowPage() {
  const { id } = useParams();
  const sessionId = Number(id);
  const client = useQueryClient();
  const showPath = sessionPaths.showState(sessionId);

  // Всё — под ключами слоя, теми же, что у пульта: запуск показа задевает
  // show-state сессии (data/sessions.ts), и сигнал другого окна доходит сюда
  // через DataLayerSync в корне приложения. Опрос раз в 2 с — страховка на
  // случай пропущенного сигнала: застывший кадр видят игроки.
  const session = useEntity<SessionDetail>("session", sessionId).data;
  const campaignId = session?.campaign_id ?? null;
  // Тестовый прогон игрокам не показывается (Q44): Пульт живёт как обычно,
  // предпросмотр у Мастера работает, а этот экран остаётся чёрным.
  const rehearsal = session?.live_mode === "rehearsal";
  const state = useResource<ShowState>(showPath, { pollMs: 2000 }).data ?? null;
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

  // Форму экрана пульт узнаёт отсюда (Q3): размер окна — при открытии и после
  // каждого изменения (на весь экран, перетащили на другой монитор). Только
  // по своему событию, не по чужой записи: два окна разного размера иначе
  // перебивали бы друг друга бесконечно.
  const displayRef = useRef(state?.display);
  displayRef.current = state?.display;
  const loaded = state != null;
  useEffect(() => {
    if (!loaded) return;
    let timer: number | undefined;
    const report = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (displayRef.current?.screen_w === w && displayRef.current?.screen_h === h) return;
      write
        .put<ShowState>(showPath, { display: { screen_w: w, screen_h: h } })
        .then((updated) => {
          client.setQueryData(dataKeys.resource(showPath), updated);
          notifyDataChanged([{ path: showPath }]);
        })
        .catch(() => {
          /* превью пульта останется на прошлой форме — экрану игроков это не мешает */
        });
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(report, 300);
    };
    schedule();
    window.addEventListener("resize", schedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", schedule);
    };
  }, [loaded, showPath, client]);

  if (!state) return <div style={{ background: "#000", minHeight: "100vh" }} />;

  const camera = cameraOf(state.display);
  const screen = { width: "100vw", height: "100vh" };
  const blank = (playKey: string, label: string) => (
    <ScreenView camera={camera} style={screen}>
      <PresentationStage
        backgroundUrl={null}
        layers={[]}
        visibleIds={[]}
        fadeMs={0}
        transition="cut"
        transitionMs={0}
        title=""
        titleSecs={0}
        playKey={playKey}
        waitingLabel={label}
      />
    </ScreenView>
  );

  // playKey — только смена кадра (режим/сцена): тоглы слоёв идут через
  // visibleIds без переигрывания перехода и титра.
  if (!state.shown || state.mode === "black" || rehearsal) return blank("blank", "Показ не запущен");

  if (state.mode === "map") {
    return (
      <>
        <FullscreenButton />
        <ScreenView camera={camera} fill style={screen}>
          {state.map_id != null && <PlayerMapStage key={state.map_id} mapId={state.map_id} />}
        </ScreenView>
      </>
    );
  }

  const data = state.mode === "cover" ? cover : scene;
  if (!data) return blank("loading", "Загрузка…");

  return (
    <>
      <FullscreenButton />
      <ScreenView camera={camera} style={screen}>
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
      </ScreenView>
    </>
  );
}
