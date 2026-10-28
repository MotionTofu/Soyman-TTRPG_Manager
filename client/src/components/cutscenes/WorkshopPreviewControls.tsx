import { useState } from "react";
import { getScreens, loadLastScreenId, type ScreenChoice } from "../presentation/screens";
import { useWorkshopPreview } from "../../cutscenes/useWorkshopPreview";

export function WorkshopPreviewControls({ blocked = false, position, canStep, onStep }: {
  blocked?: boolean; position: string; canStep: (direction: number) => boolean; onStep: (direction: number) => void;
}) {
  const { controller, state } = useWorkshopPreview();
  const [screens, setScreens] = useState<ScreenChoice[]>([]), [screenId, setScreenId] = useState("");
  const busy = state.phase === "preparing" || state.phase === "returning";
  const active = state.phase !== "idle" || state.external || state.visualPlayback.startedAt !== null;
  async function monitors() {
    const list = await getScreens(); setScreens(list);
    const selected = list.find(screen => screen.id === loadLastScreenId()) ?? list.find(screen => !screen.primary) ?? list[0];
    setScreenId(selected?.id ?? "");
  }
  const status = state.phase === "idle" ? null : state.phase === "preparing" ? "Подготовка…" : state.phase === "returning" ? "Возврат исходного состояния…"
    : state.phase === "paused" ? "На паузе" : state.mode === "audition" ? "Прослушивание фрагмента" : "Играет";
  return <section className="cs-preview-controls" aria-label="Предпросмотр катсцены" tabIndex={0}
    // A pressed button may disable itself while preparing and drop focus to the page; the area keeps it.
    onClickCapture={event => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.focus({ preventScroll: true }); }}
    onKeyDown={event => {
      const target = event.target as HTMLElement;
      if (target.matches("input,textarea,select,[contenteditable]") || !["Space", "ArrowLeft", "ArrowRight"].includes(event.code)) return;
      // The player bar listens for Space on window; inside this area the keys belong to the preview.
      event.stopPropagation();
      if (event.code === "Space" && target.matches("button,summary")) return;
      event.preventDefault();
      if (event.repeat) return;
      if (event.code === "Space") { if (!busy && !blocked) void controller.play("general"); }
      else if (!busy) onStep(event.code === "ArrowRight" ? 1 : -1);
    }}>
    <div className="cs-preview-strip">
      <button aria-label="Предыдущий шаг" disabled={busy || !canStep(-1)} onClick={() => onStep(-1)}>‹</button>
      <span className="cs-preview-position">{position}</span>
      <button aria-label="Следующий шаг" disabled={busy || !canStep(1)} onClick={() => onStep(1)}>›</button>
      <button className="primary" disabled={busy || blocked || !!state.foreign} onClick={() => void controller.play("general")}>
        {state.mode === "general" && state.phase === "playing" ? "Пауза" : state.mode === "general" && state.phase === "paused" ? "Продолжить" : "Воспроизвести всё"} <kbd>Пробел</kbd></button>
      {active && <button onClick={() => void controller.stop()}>Стоп</button>}
      <button disabled={busy} onClick={() => void controller.repeatVisual()}>Повторить переход и титр</button>
      {status && <strong role="status" className="cs-preview-status">{status}</strong>}
      <details className="cs-more cs-preview-screen"><summary>{state.external ? "● Экран игроков" : "Экран игроков"}</summary><div>
        <label>Монитор<select value={screenId} disabled={busy} onChange={event => { void controller.stop(); setScreenId(event.target.value); }}>
          <option value="">Обычное окно</option>{screens.map(screen => <option key={screen.id} value={screen.id}>{screen.label}</option>)}</select></label>
        <button onClick={() => void monitors()} disabled={busy}>Выбрать монитор</button>
        <button disabled={busy || blocked || !!state.foreign} onClick={() => void controller.external(screens.find(screen => screen.id === screenId) ?? null)}>{state.external ? "Остановить вывод" : "Вывести предпросмотр на экран"}</button>
        <span className="muted">{state.external ? "Игроки видят черновик." : "Внешний вывод выключен."}</span>
      </div></details>
    </div>
    {blocked && <p role="alert">Правка не применена. Исправьте ошибочные поля перед запуском.</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.foreign && <div role="alert"><p>Предпросмотр катсцены #{state.foreign.cutsceneId} открыт в другом окне.{state.foreign.phase === "returning" ? " Ожидается возврат звука." : ""}</p>
      <button onClick={() => void controller.stopForeign()}>Остановить другое превью</button></div>}
  </section>;
}
