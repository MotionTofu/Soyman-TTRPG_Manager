import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { CutsceneAudioCommand } from "@shared/cutscenes/types";
import { readCutsceneWaveform, type CutsceneWaveformData } from "../../cutscenes/waveform";
import { useWorkshopPreview } from "../../cutscenes/useWorkshopPreview";

type Range = { start: number; end: number };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
function clock(value: number) { const minutes = Math.floor(value / 60); return `${minutes}:${(value % 60).toFixed(1).padStart(4, "0")}`; }
export function WorkshopWaveform({ id, value, readOnly = false, onChange, onDraft, onDuration }: {
  id: number; value: CutsceneAudioCommand; readOnly?: boolean; onChange: (range: Range) => void;
  onDraft: (range: Range | null) => void; onDuration: (duration: number) => void;
}) {
  const { controller } = useWorkshopPreview();
  const audioId = value.audio.id;
  const [data, setData] = useState<CutsceneWaveformData | null>(null), [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1), [offset, setOffset] = useState(0), [range, setRange] = useState<Range | null>(null), [position, setPosition] = useState<number | null>(null);
  const [width, setWidth] = useState(600), root = useRef<HTMLDivElement>(null), drag = useRef<"start" | "end" | null>(null), currentRange = useRef<Range | null>(null);
  const callbacks = useRef({ onDuration, onDraft }); callbacks.current = { onDuration, onDraft };
  useEffect(() => {
    const abort = new AbortController(); setData(null); setError(null); setZoom(1); setOffset(0);
    void readCutsceneWaveform(id, { kind: "audio", id: audioId }, abort.signal).then(result => {
      if (!abort.signal.aborted) { setData(result); callbacks.current.onDuration(result.duration); }
    }).catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { abort.abort(); controller.cancelBoundaryEdit(); callbacks.current.onDraft(null); };
  }, [controller, id, audioId]);
  useEffect(() => {
    if (!root.current) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => { if (entries[0]) setWidth(Math.max(240, entries[0].contentRect.width)); });
    observer.observe(root.current); return () => observer.disconnect();
  }, [data?.duration]);
  useEffect(() => { const timer = setInterval(() => setPosition(controller.position()), 100); return () => clearInterval(timer); }, [controller]);
  if (!data) return <div className="cs-waveform-loading" role="status">{error ? <>Волнограмма недоступна: {error}. Границы можно задать в полях.</> : "Подготовка волнограммы…"}</div>;
  const duration = data.duration, span = duration / zoom, from = clamp(offset, 0, Math.max(0, duration - span));
  const selection = range ?? { start: value.startSeconds, end: value.endSeconds ?? duration };
  const x = (time: number) => (time - from) / span * width, percent = (time: number) => (time - from) / span * 100;
  const left = clamp(percent(selection.start), 0, 100), right = clamp(percent(selection.end), 0, 100);
  const ticks = width < 400 ? 3 : 5;
  const bars = Array.from({ length: Math.floor(width / 3) }, (_, i) => {
    const t = from + i * span / Math.floor(width / 3), p = data.peaks[Math.min(data.peaks.length - 1, Math.floor(t / duration * data.peaks.length))] ?? 0;
    return <rect key={i} x={i * 3} y={82 - p * 48} width={2} height={Math.max(1, p * 96)} className={t >= selection.start && t <= selection.end ? "is-selected" : undefined} />;
  });
  const settle = (commit: boolean) => {
    const next = currentRange.current; drag.current = null; currentRange.current = null;
    if (commit && next) { const changed = next.start !== value.startSeconds || next.end !== (value.endSeconds ?? duration); controller.endBoundaryEdit(changed); if (changed) onChange(next); }
    else controller.cancelBoundaryEdit();
    setRange(null); onDraft(null);
  };
  return <section className="cs-waveform" aria-label="Выбор аудиофрагмента"><div className="cs-toolbar cs-waveform-toolbar"><h3>Фрагмент</h3><div className="cs-toolbar"><button onClick={() => { setZoom(v => Math.max(1, v / 2)); setOffset(0); }} aria-label="Уменьшить масштаб">−</button><span>{zoom}×</span><button onClick={() => setZoom(v => Math.min(32, v * 2))} aria-label="Увеличить масштаб">+</button><button onClick={() => { setZoom(1); setOffset(0); }}>Весь трек</button></div></div>
    <div ref={root} className="cs-waveform-plot" onPointerMove={event => {
      if (!drag.current) return;
      const bounds = event.currentTarget.getBoundingClientRect(), t = from + clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * span;
      const next = { ...selection, [drag.current]: Number(clamp(t, drag.current === "start" ? 0 : selection.start + .01, drag.current === "end" ? duration : selection.end - .01).toFixed(2)) };
      currentRange.current = next; setRange(next); onDraft(next);
    }} onPointerUp={() => settle(true)} onPointerCancel={() => settle(false)}>
      <svg viewBox={`0 0 ${width} 144`} role="img" aria-label={`Волнограмма: ${clock(selection.start)} — ${clock(selection.end)}`}>
        {Array.from({ length: ticks }, (_, i) => <text key={i} x={i === 0 ? 2 : i === ticks - 1 ? width - 2 : i * width / (ticks - 1)} y={15} textAnchor={i === 0 ? "start" : i === ticks - 1 ? "end" : "middle"}>{clock(from + i * span / (ticks - 1))}</text>)}
        <rect className="cs-waveform-selection" x={left / 100 * width} y={26} width={Math.max(0, right - left) / 100 * width} height={108} />{bars}
        {position !== null && x(position) >= 0 && x(position) <= width && <line className="cs-waveform-playhead" x1={x(position)} x2={x(position)} y1={26} y2={134} />}
      </svg>
      {!readOnly && (["start", "end"] as const).map(key => <button key={key} className="cs-waveform-handle" aria-label={key === "start" ? "Начало выделения" : "Конец выделения"}
        hidden={percent(selection[key]) < 0 || percent(selection[key]) > 100} style={{ "--waveform-handle": `${percent(selection[key])}%` } as CSSProperties}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = key; currentRange.current = selection; controller.beginBoundaryEdit(); }}
        onKeyDown={event => { if (!["ArrowLeft", "ArrowRight"].includes(event.code)) return; event.preventDefault(); const next = { ...selection, [key]: Number(clamp(selection[key] + (event.code === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 1 : .1), key === "start" ? 0 : selection.start + .01, key === "end" ? duration : selection.end - .01).toFixed(2)) }; onChange(next); }}><span>{clock(selection[key])}</span></button>)}
    </div>
    {zoom > 1 && <label className="cs-waveform-pan">Область просмотра<input type="range" min={0} max={Math.max(0, duration - span)} step="any" value={from} onChange={event => setOffset(Number(event.target.value))} /></label>}
  </section>;
}
