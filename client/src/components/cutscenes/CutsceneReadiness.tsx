import { useEffect, useState } from "react";
import type { CutsceneLaunchContext } from "@shared/cutscenes/types";
import type { CutscenePlaybackController } from "../../cutscenes/controller";
import type { CutscenePlaybackState } from "../../cutscenes/ports";
import { getScreens, loadLastScreenId, type ScreenChoice } from "../presentation/screens";
import { MentionText } from "../mentions/MentionText";
import { Modal } from "../Modal";
import { CutsceneDraftFrame } from "./CutsceneDraftFrame";
import "./cutscene-readiness.css";

const imageResults = { restore: "Вернуть прежний показ", keep: "Оставить финальный кадр", black: "Чёрный экран" };
const audioResults = { restore: "Вернуть приостановленный звук", keep: "Оставить конечное звучание", silence: "Тишина" };

async function mayReadScreensWithoutPrompt(): Promise<boolean> {
  if (window.electronAPI?.playerDisplayScreens) return true;
  try { return (await navigator.permissions.query({ name: "window-management" as PermissionName })).state === "granted"; }
  catch { return false; }
}

export function CutsceneReadiness({ controller, state, mode, context, onClose }: {
  controller: CutscenePlaybackController; state: CutscenePlaybackState; mode: "live" | "rehearsal";
  context: CutsceneLaunchContext; onClose: () => void;
}) {
  const [screens, setScreens] = useState<ScreenChoice[] | null>(null), [screenId, setScreenId] = useState("");
  async function chooseScreen() {
    const list = await getScreens();
    setScreens(list);
    setScreenId((list.find(s => s.id === loadLastScreenId()) ?? list.find(s => !s.primary) ?? list[0])?.id ?? "");
  }
  // Reuse the remembered monitor when access is already granted; a permission prompt never blocks readiness.
  useEffect(() => {
    if (mode !== "live") return;
    let active = true;
    void mayReadScreensWithoutPrompt().then(async allowed => {
      if (!allowed || !active) return;
      const list = await getScreens();
      if (!active) return;
      setScreens(list);
      setScreenId((list.find(s => s.id === loadLastScreenId()) ?? list.find(s => !s.primary) ?? list[0])?.id ?? "");
    });
    return () => { active = false; };
  }, [mode]);
  const original = state.original, document = original?.document, first = state.preview, command = first?.audio.command;
  const settings = document?.settings, unknownStart = state.phase === "error" && !state.run;
  const canStart = state.phase === "ready" && !!original && !state.busy && !state.error && !state.issues.length;
  return <Modal ariaLabel="Готовность катсцены" className="cs-readiness" closeOnBackdropClick={false} onClose={onClose}>
    <header><p className="muted">{mode === "rehearsal" ? "Репетиция" : "Показ игрокам"}</p><h1>{document?.name ?? "Подготовка катсцены"}</h1>
      <p className="reading-text">Последняя успешно сохранённая версия. {mode === "rehearsal" ? "Второй экран останется без изменений. Звук приложения вернётся после репетиции." : "До нажатия «Начать» игроки видят прежний показ."}</p></header>
    {state.busy && <p role="status">{state.phase === "starting" ? "Запуск…" : "Проверка готовности…"}</p>}
    {original && <div className="cs-readiness__columns"><section className="stack" aria-label="Первый кадр">
      <h2>Первый кадр</h2><CutsceneDraftFrame id={original.id} composition={first?.image.composition ?? null} />
      {first?.image.composition?.title && <p>Титр: {first.image.composition.title}</p>}
      <h2>Звук и настройки</h2>
      <p>{command ? `Фрагмент: ${command.startSeconds} с — ${command.endSeconds === null ? "конец файла" : `${command.endSeconds} с`}. Громкость ${Math.round(command.volume * 100)} %. ${command.loop.enabled ? "Повтор включён" : "Без повтора"}.` : "Первый шаг без собственного трека."}</p>
      {command && <p>Смена трека: {command.transition.mode === "crossfade" ? "перекрёстная" : "последовательная"}; затухание {command.transition.fadeOutMs / 1000} с, нарастание {command.transition.fadeInMs / 1000} с.</p>}
      {settings && <dl className="cs-readiness__settings"><dt>Захват звука</dt><dd>{mode === "rehearsal" || settings.audioScope === "all" ? "Весь звук приложения" : "Только музыка"}</dd>
        <dt>Темп текста</dt><dd>{settings.wordsPerMinute} слов/мин</dd>
        <dt>Завершение изображения</dt><dd>{mode === "rehearsal" ? "Вернуть прежний показ" : imageResults[settings.finish.image]}</dd>
        <dt>Завершение звука</dt><dd>{mode === "rehearsal" ? "Вернуть приостановленный звук" : audioResults[settings.finish.audio]}</dd></dl>}
    </section><section className="stack" aria-label="Первый текст и заметки"><h2>Текст ведущего</h2>
      {first?.text.text ? <div className="reading-text rich-text cs-readiness__text"><MentionText text={first.text.text} /></div> : <p className="muted">Без текста.</p>}
      <h2>Заметки первого шага</h2>{first?.notes ? <div className="reading-text rich-text"><MentionText text={first.notes} /></div> : <p className="muted">Без заметок.</p>}
    </section></div>}
    {!!state.issues.length && <div role="alert"><h2>Нужно исправить</h2><ul>{state.issues.map((issue, i) => {
      const index = document?.steps.findIndex(step => step.id === issue.stepId) ?? -1;
      return <li key={`${issue.path}:${i}`}>{index >= 0 ? `Шаг ${index + 1}: ` : ""}{issue.message}</li>;
    })}</ul></div>}
    {state.error && <p role="alert">{state.error.message}</p>}
    {mode === "live" && <div className="cs-readiness__actions"><label>Монитор<select value={screenId} disabled={state.busy} onChange={event => setScreenId(event.target.value)}>
      <option value="">Обычное окно</option>{screens?.map(screen => <option key={screen.id} value={screen.id}>{screen.label}</option>)}
    </select></label><button type="button" disabled={state.busy} onClick={() => void chooseScreen()}>Выбрать монитор</button></div>}
    <footer className="cs-readiness__actions">
      {unknownStart ? <button type="button" disabled={state.busy} onClick={() => void controller.retry()}>Проверить результат запуска</button>
        : <><button type="button" className="primary" disabled={!canStart} onClick={() => void controller.start({ mode, context, screen: screens?.find(screen => screen.id === screenId) ?? null })}>Начать</button>
          <button type="button" disabled={state.busy || !original} onClick={() => { if (original) void controller.select(original.id); }}>Проверить снова</button></>}
      <button type="button" disabled={state.busy || unknownStart} onClick={onClose}>Закрыть</button>
    </footer>
  </Modal>;
}

import "./cutscene-studio.css";
