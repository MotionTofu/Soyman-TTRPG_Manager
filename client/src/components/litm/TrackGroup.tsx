import { PipTrack } from "./PipTrack";

interface Track {
  label: string;
  value: number;
  onChange?: (v: number) => void;
}

// Pips-above-label layout for Improve/Abandon/Milestone so all three fit
// side by side inside a narrow theme card instead of overflowing it.
export function TrackGroup({ tracks, max = 3 }: { tracks: Track[]; max?: number }) {
  return (
    <div className="litm-tracks">
      {tracks.map((t) => (
        <div className="litm-track" key={t.label}>
          <PipTrack value={t.value} max={max} onChange={t.onChange} size={11} label={t.label} />
          <span className="litm-track-label">{t.label}</span>
        </div>
      ))}
    </div>
  );
}
