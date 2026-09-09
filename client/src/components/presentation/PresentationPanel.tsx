import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { onDataChangedElsewhere } from "../../dataSync";
import { LazyDetails } from "../LazyDetails";
import { PresentationStage } from "./PresentationStage";
import { getScreens, loadLastScreenId, openOnScreen, type ScreenChoice } from "./screens";
import type { CampaignCover, ScenePresentation, SessionStage, ShowState, StorySceneDetail } from "../../types";

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
  launches,
}: {
  sessionId: number;
  campaignId: number;
  /** Счётчик запусков сцен: после launch сервер сам двинул show-state. */
  launches: number;
}) {
  const [stage, setStage] = useState<SessionStage | null>(null);
  const [show, setShow] = useState<ShowState | null>(null);
  const [currentPres, setCurrentPres] = useState<ScenePresentation | null>(null);
  const [shownPres, setShownPres] = useState<ScenePresentation | null>(null);
  const [shownName, setShownName] = useState("");
  const [cover, setCover] = useState<CampaignCover | null>(null);

  const refresh = useCallback(() => {
    api.get<SessionStage>(`/sessions/${sessionId}/stage`).then(setStage).catch(() => {});
    api.get<ShowState>(`/sessions/${sessionId}/show-state`).then(setShow).catch(() => {});
    api.get<CampaignCover>(`/campaigns/${campaignId}/cover`).then(setCover).catch(() => setCover(null));
  }, [sessionId, campaignId]);

  useEffect(refresh, [refresh, launches]);
  useEffect(() => onDataChangedElsewhere(refresh), [refresh]);

  const currentId = stage?.current?.id ?? null;
  useEffect(() => {
    if (currentId == null) {
      setCurrentPres(null);
      return;
    }
    let cancelled = false;
    api
      .get<ScenePresentation>(`/story/scenes/${currentId}/presentation?campaign_id=${campaignId}`)
      .then((p) => {
        if (!cancelled) setCurrentPres(p);
      })
      .catch(() => {
        if (!cancelled) setCurrentPres(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentId, campaignId]);

  // Висящий кадр: экран показывает не текущую сцену. show.scene_id — уже
  // writable-строка, разруливать copy-on-write нечего; имя — для пометки.
  const hangingId = show?.mode === "scene" && show.scene_id != null && show.scene_id !== currentId ? show.scene_id : null;
  useEffect(() => {
    if (hangingId == null) {
      setShownPres(null);
      setShownName("");
      return;
    }
    let cancelled = false;
    api
      .get<ScenePresentation>(`/story/scenes/${hangingId}/presentation`)
      .then((p) => {
        if (!cancelled) setShownPres(p);
      })
      .catch(() => {
        if (!cancelled) setShownPres(null);
      });
    api
      .get<StorySceneDetail>(`/story/scenes/${hangingId}`)
      .then((s) => {
        if (!cancelled) setShownName(s.name);
      })
      .catch(() => {
        if (!cancelled) setShownName("");
      });
    return () => {
      cancelled = true;
    };
  }, [hangingId]);

  const hasContent = useCallback((p: ScenePresentation | CampaignCover | null) => {
    return !!p && (!!p.background_url || p.layers.length > 0);
  }, []);

  const screenPres = useMemo(() => {
    if (!show || !show.shown) return null;
    if (show.mode === "cover") return cover;
    if (show.mode === "scene" && show.scene_id != null) {
      return show.scene_id === currentId ? currentPres : shownPres;
    }
    return null;
  }, [show, cover, currentId, currentPres, shownPres]);

  const currentHas = hasContent(currentPres);
  const coverHas = hasContent(cover);
  const screenHas = hasContent(screenPres);

  async function putShow(patch: Partial<ShowState>) {
    const updated = await api.put<ShowState>(`/sessions/${sessionId}/show-state`, patch);
    setShow(updated);
  }

  // Окно показа — сразу на выбранный монитор. Основная кнопка открывает
  // в один клик (запомненный экран, иначе не-основной, иначе основной),
  // ▾ — смена монитора.
  const [screens, setScreens] = useState<ScreenChoice[] | null>(null);
  async function openWindow(screen?: ScreenChoice) {
    if (screen) {
      openOnScreen(`/sessions/${sessionId}/live/show`, `show-${sessionId}`, screen);
      setScreens(null);
      return;
    }
    const list = await getScreens();
    const last = loadLastScreenId();
    const target = list.find((s) => s.id === last) ?? list.find((s) => !s.primary) ?? list[0] ?? null;
    openOnScreen(`/sessions/${sessionId}/live/show`, `show-${sessionId}`, target);
  }

  const showing = !!show?.shown && !!screenHas;
  const hanging = showing && show?.mode === "scene" && show.scene_id !== currentId;

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
    const cur = await api.get<ShowState>(`/sessions/${sessionId}/show-state`);
    const ids = new Set(cur.visible_layer_ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    await putShow({ visible_layer_ids: [...ids] });
  }

  // Нет контента вообще = нет блока (решение Q18). Хук-правила: ранний
  // return — после всех хуков выше.
  if (show && !currentHas && !coverHas && !(show.mode === "scene" && screenHas)) return null;

  const buttonLayers = (screenPres?.layers ?? [])
    .filter((l) => l.has_button === 1)
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const visibleSet = new Set(show?.visible_layer_ids ?? []);

  const defaultsOf = (p: ScenePresentation | CampaignCover | null) =>
    (p?.layers ?? []).filter((l) => l.has_button === 0 || l.visible_on_enter === 1).map((l) => l.id);

  return (
    <LazyDetails
      title="Представление"
      className="card stack"
      defaultOpen
      actions={
        <span className="row" style={{ gap: 4 }}>
          <button type="button" className="comp-mini" title="Окно для второго монитора" onClick={() => void openWindow()}>
            ⇱
          </button>
          <button
            type="button"
            className="comp-mini"
            title="Выбрать монитор"
            onClick={() => void getScreens().then((list) => setScreens(list))}
          >
            ▾
          </button>
        </span>
      }
    >
      {screens && (
        <div className="card" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Экран:</span>
          {screens.map((s) => (
            <button key={s.id} type="button" onClick={() => void openWindow(s)}>
              {s.label}
            </button>
          ))}
          <button type="button" className="comp-mini" onClick={() => setScreens(null)}>
            ✕
          </button>
        </div>
      )}
      <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px", minWidth: 200, maxWidth: 360 }}>
          {screenPres && showing ? (
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
        </div>
        <div className="stack" style={{ flex: "2 1 240px", minWidth: 220, gap: 8 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="comp-mini" onClick={() => void openWindow()}>
              ⇱ Окно игрокам
            </button>
            {showing ? (
              <button type="button" onClick={() => void putShow({ shown: 0 })}>
                Скрыть
              </button>
            ) : show?.mode === "scene" && show.scene_id != null ? (
              <button type="button" className="primary" onClick={() => void putShow({ shown: 1 })}>
                Показать
              </button>
            ) : currentHas ? (
              <button
                type="button"
                className="primary"
                onClick={() =>
                  void putShow({
                    mode: "scene",
                    scene_id: currentId,
                    visible_layer_ids: defaultsOf(currentPres),
                    shown: 1,
                  })
                }
              >
                Показать сцену
              </button>
            ) : coverHas ? (
              <button
                type="button"
                className="primary"
                onClick={() =>
                  void putShow({ mode: "cover", scene_id: null, visible_layer_ids: defaultsOf(cover), shown: 1 })
                }
              >
                Показать заглавное
              </button>
            ) : null}
            {coverHas && !(show?.mode === "cover" && showing) ? (
              <button
                type="button"
                onClick={() => void putShow({ mode: "cover", scene_id: null, visible_layer_ids: defaultsOf(cover), shown: 1 })}
              >
                Заглавное
              </button>
            ) : null}
          </div>
          <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>
            {showing
              ? show?.mode === "cover"
                ? "На экране: заглавное кампании"
                : hanging
                  ? `На экране — кадр из: ${shownName || "…"}`
                  : `На экране: ${stage?.current?.name ?? "…"}`
              : "Экран чёрный"}
          </span>
          {showing && buttonLayers.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {buttonLayers.map((l, i) => {
                const on = visibleSet.has(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={on ? "primary" : undefined}
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
          {showing && buttonLayers.length === 0 && (
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
              Кнопочных слоёв нет — всё видимое уже на экране.
            </span>
          )}
        </div>
      </div>
    </LazyDetails>
  );
}
