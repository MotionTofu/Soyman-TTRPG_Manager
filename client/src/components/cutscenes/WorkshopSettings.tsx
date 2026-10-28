import type { CutsceneSettings } from "@shared/cutscenes/types";
import { AudioTransitionFields, VisualTransitionFields, WorkshopNumber } from "./WorkshopFields";

export function WorkshopSettings({ value, onChange, expanded = false }: { value: CutsceneSettings; onChange: (value: CutsceneSettings) => void; expanded?: boolean }) {
  const finish = value.finish, patch = (next: Partial<CutsceneSettings['finish']>) => onChange({ ...value,finish: { ...finish,...next } });
  return <details className="cs-settings" open={expanded || undefined}><summary>Настройки катсцены</summary><div className="stack">
    <div className="cs-fields"><label>Захват звука приложения<select data-draft-path='["settings","audioScope"]' value={value.audioScope} onChange={event => onChange({ ...value,audioScope: event.target.value as CutsceneSettings['audioScope'] })}>
      <option value="all">Весь звук</option><option value="music">Только музыка</option></select></label>
      <WorkshopNumber path={['settings','wordsPerMinute']} label="Начальный темп, слов/мин" min={Number.MIN_VALUE} value={value.wordsPerMinute} onChange={number => onChange({ ...value,wordsPerMinute: number ?? 120 })} /></div>
    <h3>После завершения</h3><div className="cs-fields"><label>Результат изображения<select data-draft-path='["settings","finish","image"]' value={finish.image} onChange={event => patch({ image:event.target.value as typeof finish.image })}>
      <option value="restore">Вернуть прежний показ</option><option value="keep">Оставить финальный кадр</option><option value="black">Чёрный экран</option></select></label>
      <label>Результат звука<select data-draft-path='["settings","finish","audio"]' value={finish.audio} onChange={event => patch({ audio:event.target.value as typeof finish.audio })}>
        <option value="restore">Вернуть приостановленный звук</option><option value="keep">Оставить конечное звучание</option><option value="silence">Тишина</option></select></label></div>
    <VisualTransitionFields path={['settings','finish','imageTransition']} value={finish.imageTransition} onChange={imageTransition => patch({ imageTransition })} />
    <AudioTransitionFields path={['settings','finish','audioTransition']} value={finish.audioTransition} onChange={audioTransition => patch({ audioTransition })} />
    <p className="muted">Прерывание всегда мгновенно возвращает показ и звук до катсцены.</p>
  </div></details>;
}
