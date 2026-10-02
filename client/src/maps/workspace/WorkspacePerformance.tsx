import { useEffect, useState } from "react";
import type { WorkspacePerformanceMeter } from "./performanceMeter";

function percentile95(values: number[]) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return values[Math.ceil(values.length * 0.95) - 1];
}

export function WorkspacePerformance({ meter }: { meter: WorkspacePerformanceMeter }) {
  const [enabled, setEnabled] = useState(true);
  const [reading, setReading] = useState<{ fps: number; frameP95: number | null; drawP95: number | null; redraws: number; modelMs: number } | null>(null);
  useEffect(() => {
    meter.enabled = enabled;
    meter.takeDraws();
    if (!enabled) return;
    let request = 0, last = 0, start = 0;
    let frames: number[] = [];
    const reset = () => { last = start = 0; frames = []; meter.takeDraws(); setReading(null); };
    document.addEventListener("visibilitychange", reset);
    const tick = (now: number) => {
      if (document.hidden) { last = start = 0; frames = []; meter.takeDraws(); }
      else if (!last) { last = start = now; }
      else {
        frames.push(now - last); last = now;
        if (now - start >= 1000) {
          const draws = meter.takeDraws(), elapsed = now - start;
          setReading({ fps: frames.length * 1000 / elapsed, frameP95: percentile95(frames),
            drawP95: percentile95(draws), redraws: draws.length * 1000 / elapsed, modelMs: meter.modelMs });
          start = now; frames = [];
        }
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(request); document.removeEventListener("visibilitychange", reset); meter.enabled = false; meter.takeDraws(); };
  }, [enabled, meter]);
  const ms = (value: number | null) => value === null ? "—" : `${value.toFixed(1)} мс`;
  return <div className="workspace-performance">
    <button type="button" aria-pressed={enabled} onClick={() => { setReading(null); setEnabled(value => !value); }}
      title="Включить или выключить измерение производительности">FPS{enabled && reading ? ` ${reading.fps.toFixed(0)}` : enabled ? " …" : ""}</button>
    {enabled && <output aria-label="Производительность редактора" title="FPS — частота кадров окна. P95 — время, в которое укладываются 95% измерений. Отрисовка — работа Canvas, без ожидания GPU; модель — последний пересчёт геометрии. В покое карта не перерисовывается.">
      <span>Кадр P95: {ms(reading?.frameP95 ?? null)}</span>
      <span>Карта P95: {ms(reading?.drawP95 ?? null)}</span>
      <span>Перерисовок/с: {reading?.redraws.toFixed(0) ?? "—"}</span>
      <span>Модель: {ms(reading?.modelMs ?? null)}</span>
    </output>}
  </div>;
}
