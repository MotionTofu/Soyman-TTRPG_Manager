import { useEffect, useRef, useState, useSyncExternalStore, type FocusEvent } from "react";
import type { CutsceneOriginal, CutsceneStep, CutsceneComposition } from "@shared/cutscenes/types";
import { createCutsceneStep, createCutsceneVisualTransition, createCutsceneAudioCommand, CUTSCENE_DEFAULTS } from "@shared/cutscenes/defaults";
import { cutsceneStepLabel, cutsceneStepNameFromFile, cutsceneStepTitle as stepTitle, resolveCutsceneStep } from "@shared/cutscenes/resolve";
import { duplicateWorkshopStep, emptyComposition, imageWorkshopStep, moveWorkshopStep, workshopId, type DraftPath } from "../../cutscenes/workshopDraft";
import { workshopAutosave } from "../../cutscenes/workshopAutosave";
import { useWorkshopPreview } from "../../cutscenes/useWorkshopPreview";
import { useConfirm } from "../../hooks/useConfirm";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { Modal } from "../Modal";
import { CutsceneDraftFrame } from "./CutsceneDraftFrame";
import { CutsceneMediaPicker } from "./CutsceneMediaPicker";
import { WorkshopComposition } from "./WorkshopComposition";
import { WorkshopAudio, WorkshopAudioSummary } from "./WorkshopAudio";
import { WorkshopSettings } from "./WorkshopSettings";
import { VisualTransitionFields, WorkshopSeconds, WorkshopFieldGroup } from "./WorkshopFields";
import { WorkshopValidityContext } from "../../cutscenes/workshopValidity";
import { CutsceneLaunchActions } from "./CutsceneLaunchActions";
import { CutsceneArchiveAction } from "./CutsceneArchiveAction";
import { WorkshopPreviewControls } from "./WorkshopPreviewControls";
import { TeleprompterView } from "./CutsceneTeleprompter";
import "./cutscene-workshop.css";

type Channel = "image" | "audio" | "text";
const actions = { keep: "Продолжить", replace: "Заменить", clear: "Убрать" } as const;
const marks = { keep: "←", replace: "+", clear: "—" };
export function CutsceneWorkshopEditor({ original }: { original: CutsceneOriginal }) {
  const [manager] = useState(() => workshopAutosave(original)), state = useSyncExternalStore(manager.subscribe, manager.snapshot), document = state.draft;
  const { controller: preview, state: playback } = useWorkshopPreview();
  const [selected, setSelected] = useState<string | null>(document.steps[0]?.id ?? null), [tab, setTab] = useState<Channel>("image");
  const [picker, setPicker] = useState<"steps" | "audio" | null>(null), [drag, setDrag] = useState<string | null>(null);
  const [settings, setSettings] = useState(false), [font, setFont] = useState(26), [textTempo, setTextTempo] = useState(document.settings.wordsPerMinute);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const rawFields = useRef(new Map<string, string>());
  const [confirmDialog, confirm] = useConfirm();
  const step = document.steps.find(row => row.id === selected) ?? document.steps[0], index = step ? document.steps.indexOf(step) : -1;
  const resolved = step ? resolveCutsceneStep(document, step.id) : null;
  useEffect(() => { manager.receive(original); }, [manager, original]);
  useEffect(() => { setTextTempo(document.settings.wordsPerMinute); }, [document.settings.wordsPerMinute]);
  useEffect(() => { if (step) preview.configure(original.id, document, step.id); }, [preview, original.id, document, step]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { void preview.stop(); if (manager.dirty()) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leave);
    return () => { window.removeEventListener("beforeunload", leave); manager.setFocus(null); preview.leave(); };
  }, [manager, preview]);
  const relevant = [step?.id, resolved?.audio.sourceStepId, resolved?.image.sourceStepId, resolved?.text.sourceStepId].filter(Boolean);
  const blocked = [...invalid].some(key => key.startsWith('["settings"') || relevant.some(id => key.includes(`"${id}"`)));
  const reportValidity = (key: string, value: boolean) => setInvalid(current => { const next = new Set(current); if (value) next.add(key); else next.delete(key); return next.size === current.size && [...next].every(item => current.has(item)) ? current : next; });
  function patchStep(id: string, update: (current: CutsceneStep) => CutsceneStep) { manager.edit(current => ({ ...current, steps: current.steps.map(row => row.id === id ? update(row) : row) })); }
  const patch = (fields: Partial<CutsceneStep>) => { if (step) patchStep(step.id, current => ({ ...current, ...fields })); };
  function structural(update: Parameters<typeof manager.edit>[0], select?: string) { void preview.stop(); manager.edit(update); if (select) setSelected(select); }
  function setAction(channel: Channel, action: "keep" | "replace" | "clear") {
    if (!step || action === step[channel].action) return;
    if (channel !== "audio" || action !== "replace") {
      const prefix = JSON.stringify(["steps", step.id, channel]).slice(0, -1);
      for (const key of rawFields.current.keys()) if (key.startsWith(prefix)) rawFields.current.delete(key);
      setInvalid(current => new Set([...current].filter(key => !key.startsWith(prefix))));
    }
    if (channel === "image") patch({ image: action === "keep" ? { action } : action === "clear" ? { action, transition: createCutsceneVisualTransition() } : { action, transition: createCutsceneVisualTransition(), composition: emptyComposition() } });
    if (channel === "text") patch({ text: action === "replace" ? { action, text: "" } : { action } });
    if (channel === "audio") { if (action === "replace") setPicker("audio"); else patch({ audio: action === "keep" ? { action } : { action, fadeOutMs: CUTSCENE_DEFAULTS.audioFadeOutMs } }); }
  }
  function focus(event: FocusEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement, path = target.matches("input,textarea,select,[contenteditable]") ? target.closest<HTMLElement>("[data-draft-path]")?.dataset.draftPath : null;
    manager.setFocus(path ? JSON.parse(path) as DraftPath : null);
  }
  function source(channel: Channel) {
    const sourceId = resolved?.[channel].sourceStepId, i = document.steps.findIndex(row => row.id === sourceId);
    return i < 0 ? channel === "image" ? "Чёрный экран" : channel === "audio" ? "Без собственного трека" : "Без текста" : `Источник: шаг ${i + 1}${sourceId === step?.id ? " (этот)" : ""}`;
  }
  async function remove() {
    if (!step) return;
    if (!await confirm({ title: `Убрать шаг ${index + 1}?`, message: "Шаг будет удалён из оригинала. Работающий показ сохранит свою версию.", confirmLabel: "Убрать шаг", danger: true })) return;
    structural(current => ({ ...current, steps: current.steps.filter(row => row.id !== step.id) }));
    setSelected(document.steps[index + 1]?.id ?? document.steps[index - 1]?.id ?? null);
  }
  const playingImage = playback.mode === "general" && ["playing", "paused"].includes(playback.phase) || playback.phase === "idle" && playback.visualPlayback.startedAt !== null;
  const textView = resolved && <TeleprompterView identity={`workshop:${step?.id}:${playback.textGeneration}`} hideNotes
    narration={{ text: resolved.text.text, sourceStepId: resolved.text.sourceStepId, generation: playback.textGeneration,
      paused: playback.mode !== "general" || playback.phase !== "playing" || playback.textPaused, locallyPaused: playback.textPaused, wordsPerMinute: textTempo }}
    notes="" fontSize={font} controlsEnabled onFontSize={setFont} onWordsPerMinute={setTextTempo} onTextPaused={value => preview.textPause(value)} />;
  return <WorkshopValidityContext.Provider value={{ read: key => rawFields.current.get(key), invalid: prefix => [...invalid].some(key => key.startsWith(prefix.slice(0, -1))), report: (key, raw, bad) => { if (bad) rawFields.current.set(key, raw); else rawFields.current.delete(key); reportValidity(key, bad); } }}><div className="cs-workshop" onFocusCapture={focus} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) manager.setFocus(null); }}>
    {confirmDialog}<header className="cs-workshop-header"><div className="cs-autosave"><span role="status">{state.status === "error" ? "Ошибка сохранения" : state.status === "saved" ? "Сохранено" : "Сохраняется…"}</span>
      {state.status === "error" && <button onClick={() => void manager.flush()}>Повторить сохранение</button>}</div><div className="cs-toolbar">
      <button onClick={() => setSettings(true)}>Настройки</button>{!original.archivedAt && <CutsceneLaunchActions id={original.id} beforeSelect={() => preview.stop()} />}
      <details className="cs-more"><summary aria-label="Другие действия катсцены">⋯</summary><div><CutsceneArchiveAction id={original.id} name={document.name} archived={!!original.archivedAt} /></div></details></div></header>
    {state.status !== "saved" && <p className="cs-source">Предпросмотр использует черновик; настоящий показ — последнюю сохранённую версию.</p>}
    <div className="cs-workspace"><aside className="cs-steps" aria-label="Шаги катсцены"><div className="cs-toolbar"><h2>Шаги · {document.steps.length}</h2><button onClick={() => { const next = createCutsceneStep(workshopId()); structural(current => ({ ...current, steps: [...current.steps, next] }), next.id); }}>Добавить шаг</button><button onClick={() => setPicker("steps")}>Шаги из изображений</button></div>
      <ol>{document.steps.map((row, i) => { const result = resolveCutsceneStep(document, row.id); return <li key={row.id} draggable onDragStart={() => setDrag(row.id)} onDragEnd={() => setDrag(null)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (drag) structural(current => moveWorkshopStep(current, drag, row.id)); setDrag(null); }}>
        <button className={`cs-step${step?.id === row.id ? " is-selected" : ""}`} aria-pressed={step?.id === row.id} aria-label={`Открыть шаг ${i + 1}`} onClick={() => { setSelected(row.id); }}><CutsceneDraftFrame id={original.id} composition={result?.image.composition ?? null} /><strong>{stepTitle(row, i)}</strong><span>Кадр {marks[row.image.action]} · Звук {marks[row.audio.action]} · Текст {marks[row.text.action]}</span></button>
        <div className="cs-step-move"><button aria-label={`Шаг ${i + 1} выше`} disabled={i === 0} onClick={() => structural(current => moveWorkshopStep(current, row.id, document.steps[i - 1].id))}>↑</button><button aria-label={`Шаг ${i + 1} ниже`} disabled={i === document.steps.length - 1} onClick={() => structural(current => moveWorkshopStep(current, row.id, document.steps[i + 1].id))}>↓</button></div></li>; })}</ol>
      {!document.steps.length && <p className="muted">Пустой черновик сохранён. Добавьте первый шаг.</p>}</aside>
      {step && resolved ? <section className="cs-step-editor" aria-label={`Редактор шага ${index + 1}`}><div className="cs-toolbar cs-step-heading"><h2>Шаг {index + 1} из {document.steps.length}</h2><WorkshopFieldGroup path={["steps", step.id, "name"]} className="cs-step-name"><input aria-label="Имя шага" value={step.name ?? ""} placeholder={`Имя шага — сейчас «${cutsceneStepLabel({ ...step, name: "" }, index)}»`} onChange={event => patch({ name: event.target.value })} /></WorkshopFieldGroup><details className="cs-more"><summary>Действия шага</summary><div><button onClick={() => { const copy = duplicateWorkshopStep(step); structural(current => { const rows = [...current.steps]; rows.splice(rows.findIndex(row => row.id === step.id) + 1, 0, copy); return { ...current, steps: rows }; }, copy.id); }}>Дублировать шаг</button><button className="danger" onClick={() => void remove()}>Убрать шаг</button></div></details></div>
        <div className="cs-tabs" role="group" aria-label="Каналы шага">{([["image", "Изображение"], ["text", "Текст и заметки"], ["audio", "Звук"]] as const).map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
        <WorkshopPreviewControls blocked={blocked} onStep={direction => { const next = document.steps[index + direction]; if (next) setSelected(next.id); }} />
        <div className={`cs-channel-layout${tab === "audio" ? " cs-channel-layout--audio" : ""}`}><WorkshopFieldGroup path={["steps", step.id, tab]} className="cs-channel"><div className="cs-channel-command" role="group" aria-label={`Действие: ${tab === "image" ? "изображение" : tab === "audio" ? "звук" : "текст"}`}>{Object.entries(actions).map(([key, label]) => <button key={key} aria-pressed={step[tab].action === key} onClick={() => setAction(tab, key as keyof typeof actions)}>{label}</button>)}</div><p className="cs-source">{source(tab)}{resolved[tab].sourceStepId && resolved[tab].sourceStepId !== step.id && <button onClick={() => setSelected(resolved[tab].sourceStepId)}>Открыть источник</button>}</p>
          {tab === "image" && <>{step.image.action === "replace" ? <WorkshopComposition key={step.id} id={original.id} stepId={step.id} value={step.image.composition}
            playback={playingImage ? playback.visualPlayback : undefined} previewKey={playingImage ? `visual:${playback.playKey}` : undefined} transition={resolved.image.transition}
            extra={<VisualTransitionFields path={["steps", step.id, "image", "transition"]} value={step.image.transition} onChange={transition => patchStep(step.id, current => current.image.action === "replace" ? { ...current, image: { ...current.image, transition } } : current)} />}
            onChange={update => { patchStep(step.id, current => current.image.action === "replace" ? { ...current, image: { ...current.image, composition: update(current.image.composition) } } : current); }} />
            : <><CutsceneDraftFrame id={original.id} composition={resolved.image.composition} playback={playingImage ? playback.visualPlayback : undefined} playKey={playingImage ? `visual:${playback.playKey}` : "edit"} transition={resolved.image.transition} />{step.image.action === "clear" && <VisualTransitionFields path={["steps", step.id, "image", "transition"]} value={step.image.transition} onChange={transition => patch({ image: { action: "clear", transition } })} />}</>}
            </>}
          {tab === "audio" && <>{step.audio.action === "replace" && <WorkshopAudio id={original.id} stepId={step.id} value={step.audio.command} onChange={command => patch({ audio: { action: "replace", command } })} />}
            {step.audio.action === "clear" && <WorkshopSeconds path={["steps", step.id, "audio", "fadeOutMs"]} label="Затухание собственного трека" ms={step.audio.fadeOutMs} onChange={fadeOutMs => patch({ audio: { action: "clear", fadeOutMs } })} />}
            {step.audio.action === "keep" && <WorkshopAudioSummary id={original.id} stepId={resolved.audio.sourceStepId ?? step.id} command={resolved.audio.command} />}</>}
          {tab === "text" && <div className="cs-text-workspace">{step.text.action === "replace" && <div className="cs-text-source"><label htmlFor={`narration-${step.id}`}>Редактирование · Только ведущему</label><MentionTextarea key={step.id} id={`narration-${step.id}`} rows={12} value={step.text.text} onChange={text => patch({ text: { action: "replace", text } })} /></div>}<div className="cs-workshop-reader">{textView}</div></div>}
        </WorkshopFieldGroup>
        {tab !== "image" && <section className="cs-preview-stage" aria-label="Результат для игроков"><CutsceneDraftFrame id={original.id} composition={resolved.image.composition} playback={playingImage ? playback.visualPlayback : undefined} playKey={playingImage ? `visual:${playback.playKey}` : "edit"} transition={resolved.image.transition} />{tab === "audio" && <div className="cs-workshop-reader">{textView}</div>}</section>}

        </div>{tab === "image" && <details className="cs-inline-reader" open={playback.mode === "general" && playback.phase !== "idle"}><summary>Телесуфлёр · Только ведущему</summary>{textView}</details>}
        <WorkshopFieldGroup path={["steps", step.id, "notes"]} className="cs-workshop-notes"><label htmlFor={`notes-${step.id}`}>Заметки к шагу · Только ведущему</label><MentionTextarea key={`notes-${step.id}`} id={`notes-${step.id}`} rows={2} value={step.notes} onChange={notes => patch({ notes })} /></WorkshopFieldGroup>
      </section> : <section className="cs-step-editor"><h2>Мастерская шагов</h2><p>Добавьте шаг вручную или выберите несколько изображений.</p></section>}
    </div>
    {settings && <Modal className="cs-settings-dialog" ariaLabel="Настройки катсцены" onClose={() => setSettings(false)}><header className="cs-toolbar"><h2>Настройки катсцены</h2><button onClick={() => setSettings(false)}>Закрыть</button></header><div className="cs-fields cs-metadata"><WorkshopFieldGroup path={["name"]}><label>Название<input required value={document.name} onChange={event => manager.edit(current => ({ ...current, name: event.target.value }))} /></label></WorkshopFieldGroup><WorkshopFieldGroup path={["description"]}><label>Описание<textarea rows={2} value={document.description} onChange={event => manager.edit(current => ({ ...current, description: event.target.value }))} /></label></WorkshopFieldGroup></div><WorkshopFieldGroup path={["settings"]}><WorkshopSettings expanded value={document.settings} onChange={value => manager.edit(current => ({ ...current, settings: value }))} /></WorkshopFieldGroup><p className="cs-source">Предпросмотр всегда приостанавливает весь звук. Стоп возвращает пульт и прежний кадр.</p></Modal>}
    {picker && <CutsceneMediaPicker id={original.id} kind={picker === "steps" ? "image" : "audio"} multiple={picker === "steps"} title={picker === "steps" ? "Шаги из изображений" : "Музыка шага"} onClose={() => setPicker(null)} onPick={items => {
      if (picker === "steps") { const steps = items.map(item => imageWorkshopStep(item.ref as CutsceneComposition["background"], cutsceneStepNameFromFile(item.name))); structural(current => ({ ...current, steps: [...current.steps, ...steps] }), steps[0]?.id); }
      else if (step) patch({ audio: { action: "replace", command: createCutsceneAudioCommand(workshopId(), { kind: "audio", id: items[0].ref.id }) } });
    }} />}
  </div></WorkshopValidityContext.Provider>;
}

import "./cutscene-studio.css";
