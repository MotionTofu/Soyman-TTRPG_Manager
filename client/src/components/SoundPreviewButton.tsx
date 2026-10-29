import { NavIcon } from "./NavIcons";
import type { SoundButton } from "../sound/types";

export function SoundPreviewButton({ sound, playing, onPreview }: {
  sound: SoundButton;
  playing: boolean;
  onPreview: (sound: SoundButton) => void;
}) {
  const label = `${playing ? "Остановить предпрослушивание" : "Прослушать"}: ${sound.name}`;
  return <button type="button" className={`sl-preview${playing ? " is-playing" : ""}`}
    aria-label={label} title={label} aria-pressed={playing}
    disabled={sound.missing || !sound.src} onClick={() => onPreview(sound)}>
    <NavIcon name={playing ? "stop" : "play"} />
  </button>;
}
