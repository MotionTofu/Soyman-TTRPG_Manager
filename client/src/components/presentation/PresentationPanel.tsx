import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { notifyDataChanged } from "../../dataSync";
import { dataKeys } from "../../data/entities";
import { errorText, useEntity, useResource, write } from "../../data/hooks";
import { readResource } from "../../data/imperative";
import { showSaveError } from "../../data/notices";
import { sessionPaths } from "../../data/sessions";
import { CutsceneBindings } from "../cutscenes/CutsceneBindings";
import { LazyDetails } from "../LazyDetails";
import { PresentationStage } from "./PresentationStage";
import { PlayerMapStage } from "./PlayerMapStage";
import { ScreenPreview } from "./ScreenPreview";
import { getScreens, loadLastScreenId, loadScreenMemory, saveLastScreenId, type ScreenChoice } from "./screens";
import { closePlayerDisplayNow, openPlayerDisplayWindow, playerDisplayStatus } from "./playerDisplayWindow";
import { playerDisplayChanged, readPlayerDisplay, selectSessionDisplay } from "./playerDisplay";
import type { CampaignCover, ScenePresentation, SessionStage, ShowDisplay, ShowState, StorySceneDetail } from "../../types";

interface SceneMapList { scene_id: number; maps: { id: number; name: string }[] }

// Блок «Представление» пульта сессии: превью того, что на экране игроков
// (тот же PresentationStage, только маленький), тумблер показа, кнопки слоёв
// и заглавное кампании. Скрыт полностью, когда контента нет нигде.
//
// Превью зеркалит ЭКРАН (show-state), а не текущую сцену: при пустой сцене
// висит последний кадр — с пометкой «кадр из». Каждое действие — PUT
// show-state; окна игроков подхватывают его сами.
export function PresentationPanel({
  sessionId,
  campaignId,
}: {
  sessionId: number;
  campaignId: number;
}) {
  // Сцена, экран и заглавное — из кэша слоя данных. После запуска сцены сервер
  // сам двигает экран, а запуск задевает сессию целиком (data/sessions.ts):
  // блок перечитывается без счётчика запусков и без своего слушателя других
  // окон. Сцену вечера читает и переключатель — одним запросом на двоих.
  const client = useQueryClient();
  const showPath = sessionPaths.showState(sessionId);
  const stage = useResource<SessionStage>(sessionPaths.stage(sessionId)).data ?? null;
  const show = useResource<ShowState>(showPath).data ?? null;
  const cover = useResource<CampaignCover>(sessionPaths.campaignCover(campaignId)).data ?? null;

  const currentId = stage?.current?.id ?? null;
  const currentPres =
    useResource<ScenePresentation>(
      currentId != null ? `/story/scenes/${currentId}/presentation?campaign_id=${campaignId}` : null
    ).data ?? null;
  const currentPresentationSceneId = currentPres?.scene_id ?? currentId;
  const currentMapsData = useResource<SceneMapList>(
    currentId != null ? `/story/scenes/${currentId}/maps?campaign_id=${campaignId}` : null
  ).data ?? null;
  const currentMaps = currentMapsData?.maps ?? [];
  const currentMapSceneId = currentMapsData?.scene_id ?? currentId;

  // Висящий кадр: экран показывает не текущую сцену. show.scene_id — уже
  // writable-строка, разруливать copy-on-write нечего; имя — для пометки.
  const hangingId = show?.mode === "scene" && show.scene_id != null && show.scene_id !== currentPresentationSceneId ? show.scene_id : null;
  const shownPres =
    useResource<ScenePresentation>(hangingId != null ? `/story/scenes/${hangingId}/presentation` : null).data ?? null;
  const shownName = useEntity<StorySceneDetail>("scene", hangingId).data?.name ?? "";
  const hangingMapSceneId = show?.mode === "map" && show.scene_id != null && show.scene_id !== currentMapSceneId ? show.scene_id : null;
  const hangingMaps = useResource<SceneMapList>(
    hangingMapSceneId != null ? `/story/scenes/${hangingMapSceneId}/maps` : null
  ).data?.maps ?? [];
  const shownMap = (show?.scene_id === currentMapSceneId ? currentMaps : hangingMaps).find((m) => m.id === show?.map_id);
  const shownMapSceneName = useEntity<StorySceneDetail>("scene", hangingMapSceneId).data?.name ?? "";

  const hasContent = useCallback((p: ScenePresentation | CampaignCover | null) => {
    return !!p && (!!p.background_url || p.layers.length > 0);
  }, []);

  const screenPres = useMemo(() => {
    if (!show || !show.shown) return null;
    if (show.mode === "cover") return cover;
    if (show.mode === "scene" && show.scene_id != null) {
      return show.scene_id === currentPresentationSceneId ? currentPres : shownPres;
    }
    return null;
  }, [show, cover, currentPresentationSceneId, currentPres, shownPres]);

  const currentHas = hasContent(currentPres);
  const coverHas = hasContent(cover);
  const screenHas = show?.mode === "map" ? !!show.map_id : hasContent(screenPres);

  async function putShow(patch: Omit<Partial<ShowState>, "display"> & { display?: Partial<ShowDisplay> }) {
    try {
      const updated = await write.put<ShowState>(`/sessions/${sessionId}/show-state`, patch);
      client.setQueryData(dataKeys.resource(showPath), updated);
      // В этом окне экран уже в кэше — перечитывать незачем; окну показа и
      // другим окнам пульта уходит адресный сигнал.
      notifyDataChanged([{ path: showPath }]);
      playerDisplayChanged();
    } catch (e) {
      showSaveError(`Экран игрокам не переключился: ${errorText(e)}`);
    }
  }

  // Окно показа — сразу на выбранный монитор. Основная кнопка открывает
  // в один клик (запомненный экран, иначе не-основной, иначе основной),
  // ▾ — смена монитора.
  // На новом мониторе — его поворот и вписывание из памяти (Q2), размер —
  // догадкой по монитору, пока окно не сообщит свой.
  // Монитор на виду (Q2 2026-10-29): выбор — до показа, а главная кнопка
  // держится за то, открыто ли окно игроков. Состояние окна спрашиваем раз в
  // 2 с: закрыть его могут крестиком, и Пульт должен это увидеть.
  const [screens, setScreens] = useState<ScreenChoice[]>([]);
  const [screenId, setScreenId] = useState(loadLastScreenId);
  const [windowOpen, setWindowOpen] = useState(false);
  const loadScreens = () => void getScreens().then(setScreens);
  useEffect(() => {
    // В браузере список мониторов спрашивает разрешение — только по щелчку.
    if (window.electronAPI) loadScreens();
    let alive = true;
    const poll = () => void playerDisplayStatus().then((s) => alive && setWindowOpen(s.open));
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  async function openWindow(screen?: ScreenChoice) {
    let target: ScreenChoice | null;
    if (screen) {
      target = screen;
    } else {
      const list = await getScreens();
      const last = loadLastScreenId();
      target = list.find((s) => s.id === last) ?? list.find((s) => !s.primary) ?? list[0] ?? null;
    }
    const opened = await openPlayerDisplayWindow(target);
    if (!opened.ok) { showSaveError(opened.reason); return; }
    setWindowOpen(true);
    try {
      const state = await readPlayerDisplay();
      if (state.owner) return; // Reuse a runtime-owned screen without replacing its frame.
      await selectSessionDisplay(sessionId);
    } catch (error) { showSaveError(errorText(error)); return; }
    if (!target) return;
    const mem = loadScreenMemory(target.id);
    void putShow({
      display: { rotation: mem?.rotation ?? 0, fit: mem?.fit ?? "contain", screen_w: target.width, screen_h: target.height },
    });
  }

  const showing = !!show?.shown && !!screenHas;
  const hanging = showing && show?.mode === "scene" && show.scene_id !== currentPresentationSceneId;

  // --- Хоткеи: 1–9 — слои экрана. Esc — пропуск титра превью, и только
  // тогда перехватываем событие в capture-фазе, чтобы SceneSwitcher не снял
  // заодно выбор сцены. В полях ввода не срабатываем, как и переключатель.
  const titleVisibleRef = useRef(false);
  const [skipSignal, setSkipSignal] = useState(0);
  const buttonLayerIds = useMemo(
    () =>
      (screenPres?.layers ?? [])
        .filter((l) => l.has_button === 1)
        .sort((a, b) => a.position - b.position || a.id - b.id)
        .map((l) => l.id),
    [screenPres]
  );
  const visibleKey = (show?.visible_layer_ids ?? []).join(",");
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      if (e.key === "Escape" && titleVisibleRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setSkipSignal((n) => n + 1);
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= 9 && showing) {
        const lid = buttonLayerIds[n - 1];
        if (lid != null) {
          e.preventDefault();
          void toggleLayer(lid);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing, screenPres, visibleKey]);

  async function toggleLayer(id: number) {
    let cur: ShowState;
    try {
      // Экран — свежий, мимо кэша: поверх него сразу пишут.
      cur = await readResource<ShowState>(showPath, { fresh: true });
    } catch (e) {
      showSaveError(`Экран игрокам не прочитался: ${errorText(e)}`);
      return;
    }
    const ids = new Set(cur.visible_layer_ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    await putShow({ visible_layer_ids: [...ids] });
  }

  // Нет контента вообще = нет блока (решение Q18). Хук-правила: ранний
  // return — после всех хуков выше.
  // The shared panel also launches cutscenes, including when this session has no scene/cover images.

  const [mapPick, setMapPick] = useState(false);
  const [cutscenesOpen, setCutscenesOpen] = useState(false);
  const [toolsEl, setToolsEl] = useState<HTMLSpanElement | null>(null);

  const buttonLayers = (screenPres?.layers ?? [])
    .filter((l) => l.has_button === 1)
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const visibleSet = new Set(show?.visible_layer_ids ?? []);

  const defaultsOf = (p: ScenePresentation | CampaignCover | null) =>
    (p?.layers ?? []).filter((l) => l.has_button === 0 || l.visible_on_enter === 1).map((l) => l.id);

  const showScene = () =>
    void putShow({ mode: "scene", scene_id: currentPresentationSceneId, visible_layer_ids: defaultsOf(currentPres), shown: 1 });
  const showCover = () => void putShow({ mode: "cover", scene_id: null, visible_layer_ids: defaultsOf(cover), shown: 1 });
  const showMap = (id: number) =>
    void putShow({ mode: "map", scene_id: currentMapSceneId, map_id: id, visible_layer_ids: [], shown: 1 });

  // Что сейчас на экране — одной строкой (макет Roll-Pult, Q13).
  const onScreen = showing
    ? show?.mode === "cover"
      ? "Заглавное кампании"
      : show?.mode === "map"
        ? show.scene_id !== currentMapSceneId
          ? `Карта «${shownMap?.name ?? "…"}» из: ${shownMapSceneName || "…"}`
          : `${stage?.current?.name ?? "Сцена"} · карта «${shownMap?.name ?? "…"}»`
        : hanging
          ? `Кадр из: ${shownName || "…"}`
          : `${stage?.current?.name ?? "…"} · картинка`
    : "Экран чёрный";
  const onMap = showing && show?.mode === "map";

  const fallbackLabel = screenId?.startsWith("screen-") ? screenId.slice(7) : "Основной экран";
  function pickScreen(value: string) {
    if (value === "__close") {
      void closePlayerDisplayNow().then(() => setWindowOpen(false));
      return;
    }
    setScreenId(value);
    saveLastScreenId(value);
    const screen = screens.find((s) => s.id === value);
    // Открытое окно переезжает на выбранный монитор сразу.
    if (windowOpen && screen) void openWindow(screen);
  }

  return (
    <LazyDetails title="Экран игроков" summaryClassName="pult-drag-handle" className="card stack" defaultOpen>
      <div className="pp">
        <div className="pp-strip">
          <div className="pp-strip__pv">
            <ScreenPreview
              show={show}
              adjustable={showing && show?.mode !== "map"}
              fill={show?.mode === "map" && showing}
              onDisplay={(display) => putShow({ display })}
              toolsTarget={toolsEl}
            >
              {show?.mode === "map" && show.map_id != null && showing ? (
                <PlayerMapStage mapId={show.map_id} />
              ) : screenPres && showing ? (
                <PresentationStage
                  backgroundUrl={screenPres.background_url}
                  layers={screenPres.layers}
                  visibleIds={show?.visible_layer_ids ?? []}
                  fadeMs={screenPres.fade_ms}
                  transition={screenPres.transition}
                  transitionMs={screenPres.transition_ms}
                  title={screenPres.title}
                  titleSecs={screenPres.title_secs}
                  playKey={`${show?.mode}:${show?.scene_id ?? "cover"}`}
                  waitingLabel="Показ не запущен"
                  skipTitleSignal={skipSignal}
                  onTitleVisibility={(v) => {
                    titleVisibleRef.current = v;
                  }}
                />
              ) : (
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
                  waitingLabel={show && !show.shown ? "Показ остановлен" : "Показ не запущен"}
                />
              )}
            </ScreenPreview>
          </div>
          <div className="pp-strip__ctl">
            <div className="pp-strip__tx">
              <small>На экране игроков{windowOpen ? "" : " · окно не открыто"}</small>
              <b>{onScreen}</b>
            </div>
            {/* Монитор и его настройки: поворот и вписывание — свойства
                монитора (2026-10-23, Q10), поэтому в этой же строке. */}
            <div className="pp-strip__line">
              <label className="pp-strip__screen">
                <span className="d-note">Экран</span>
                <select value={screenId ?? ""} onFocus={() => screens.length === 0 && loadScreens()} onChange={(e) => pickScreen(e.target.value)}>
                  {screens.length === 0 && <option value={screenId ?? ""}>{fallbackLabel}</option>}
                  {screens.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                      {s.primary ? " (основной)" : ""}
                    </option>
                  ))}
                  {windowOpen && <option value="__close">Закрыть окно игрокам</option>}
                </select>
              </label>
              <span ref={setToolsEl} className="pp-strip__tools" />
            </div>
            <div className="pp-strip__line">
              <span className="d-seg" role="group" aria-label="Что показать">
                <button
                  type="button"
                  className={showing && show?.mode === "scene" ? "active" : undefined}
                  disabled={!currentHas}
                  onClick={showScene}
                >
                  Картинка
                </button>
                <button
                  type="button"
                  className={onMap || mapPick ? "active" : undefined}
                  disabled={currentMaps.length === 0}
                  onClick={() => (currentMaps.length === 1 ? showMap(currentMaps[0].id) : setMapPick((v) => !v))}
                >
                  Карта
                </button>
                <button type="button" className={cutscenesOpen ? "active" : undefined} onClick={() => setCutscenesOpen((v) => !v)}>
                  Катсцена
                </button>
                <button
                  type="button"
                  className={showing && show?.mode === "cover" ? "active" : undefined}
                  disabled={!coverHas}
                  onClick={showCover}
                >
                  Заглавное
                </button>
              </span>
              {/* Без окна показывать некуда: главная кнопка сначала открывает его. */}
              {!windowOpen ? (
                <button
                  type="button"
                  className="d-btn d-btn--sm is-on"
                  onClick={() => void openWindow(screens.find((s) => s.id === screenId))}
                >
                  Открыть окно игрокам
                </button>
              ) : showing ? (
                <button type="button" className="d-btn d-btn--sm" onClick={() => void putShow({ shown: 0 })}>
                  Погасить
                </button>
              ) : (show?.mode === "map" && show.map_id != null && shownMap) || (show?.mode === "scene" && show.scene_id != null) ? (
                <button type="button" className="d-btn d-btn--sm is-on" onClick={() => void putShow({ shown: 1 })}>
                  Показать
                </button>
              ) : currentHas ? (
                <button type="button" className="d-btn d-btn--sm is-on" onClick={showScene}>
                  Показать сцену
                </button>
              ) : coverHas ? (
                <button type="button" className="d-btn d-btn--sm is-on" onClick={showCover}>
                  Показать заглавное
                </button>
              ) : null}
            </div>
            {mapPick && currentMaps.length > 1 && (
              <div className="pp-strip__line">
                {currentMaps.map((map) => (
                  <button
                    key={map.id}
                    type="button"
                    className={`d-btn d-btn--sm${onMap && show?.map_id === map.id ? " is-on" : ""}`}
                    onClick={() => {
                      showMap(map.id);
                      setMapPick(false);
                    }}
                  >
                    {map.name}
                  </button>
                ))}
              </div>
            )}
            {/* Слои — только когда есть: их жмут посреди сцены (клавиши 1–9). */}
            {showing && buttonLayers.length > 0 && (
              <div className="pp-strip__line">
                {buttonLayers.map((l, i) => {
                  const on = visibleSet.has(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      className={`d-btn d-btn--sm${on ? " is-on" : ""}`}
                      title={i < 9 ? `Горячая клавиша ${i + 1}` : undefined}
                      onClick={() => void toggleLayer(l.id)}
                    >
                      {i < 9 ? `${i + 1} · ` : ""}
                      {on ? "◉ " : "◎ "}
                      {l.name || "Слой"}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {cutscenesOpen && <CutsceneBindings context={{ kind: "session", sessionId, campaignId }} mode="launch" />}
      </div>
    </LazyDetails>
  );
}

