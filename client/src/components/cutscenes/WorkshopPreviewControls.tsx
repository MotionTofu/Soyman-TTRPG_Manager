import { useState } from "react";
import { getScreens, loadLastScreenId, type ScreenChoice } from "../presentation/screens";
import { useWorkshopPreview } from "../../cutscenes/useWorkshopPreview";

export function WorkshopPreviewControls({ blocked = false, onStep }: { blocked?: boolean; onStep: (direction: number) => void }) {
  const { controller, state } = useWorkshopPreview();
  const [screens, setScreens] = useState<ScreenChoice[]>([]), [screenId, setScreenId] = useState("");
  const busy = state.phase === "preparing" || state.phase === "returning";
  async function monitors() {
    const list = await getScreens(); setScreens(list);
    const selected = list.find(screen => screen.id === loadLastScreenId()) ?? list.find(screen => !screen.primary) ?? list[0];
    setScreenId(selected?.id ?? "");
  }
  return <section className="cs-preview-controls" aria-label="Предпросмотр катсцены" tabIndex={0} onKeyDown={event => {
    if ((event.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]') || event.repeat) return;
    if (event.code === "Space") { event.preventDefault(); if (!busy && !blocked) void controller.play("general"); }
    else if (event.code === "ArrowLeft" || event.code === "ArrowRight") { event.preventDefault(); if (!busy) onStep(event.code === "ArrowRight" ? 1 : -1); }
  }}>
    <div className="cs-toolbar"><strong role="status">{state.phase === "idle" ? "Предпросмотр" : state.phase === "preparing" ? "Подготовка…"
      : state.phase === "returning" ? "Возврат исходного состояния…" : state.phase === "paused" ? "На паузе" : state.mode === "audition" ? "Прослушивание фрагмента" : "Играет"}</strong>
      <button className="primary" disabled={busy || blocked || !!state.foreign} onClick={() => void controller.play("general")}>{state.mode === "general" && state.phase === "playing" ? "Пауза" : state.mode === "general" && state.phase === "paused" ? "Продолжить" : "Воспроизвести всё"}</button>
      <button disabled={state.phase === "idle" && !state.external && state.visualPlayback.startedAt === null} onClick={() => void controller.stop()}>Стоп</button>
      <button disabled={busy} onClick={() => void controller.repeatVisual()}>Повторить переход и титр</button>
    </div>
    <div className="cs-toolbar cs-preview-output"><label>Монитор<select value={screenId} disabled={busy} onChange={event => { void controller.stop(); setScreenId(event.target.value); }}>
      <option value="">Обычное окно</option>{screens.map(screen => <option key={screen.id} value={screen.id}>{screen.label}</option>)}</select></label>
      <button onClick={() => void monitors()} disabled={busy}>Выбрать монитор</button>
      <button disabled={busy || blocked || !!state.foreign} onClick={() => void controller.external(screens.find(screen => screen.id === screenId) ?? null)}>{state.external ? "Остановить вывод" : "Вывести на экран"}</button>
      <span className="muted">{state.external ? "Экран подключён" : "Внешний вывод выключен"}</span>
    </div>
    <p className="cs-source">Пробел — воспроизведение/пауза, стрелки — шаги, когда фокус находится в этой области.</p>
    {blocked && <p role="alert">Правка не применена. Исправьте ошибочные поля перед запуском.</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.foreign && <div role="alert"><p>Предпросмотр катсцены #{state.foreign.cutsceneId} открыт в другом окне.{state.foreign.phase === "returning" ? " Ожидается возврат звука." : ""}</p>
      <button onClick={() => void controller.stopForeign()}>Остановить другое превью</button></div>}
  </section>;
}
