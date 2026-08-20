import { useState } from "react";
import { NavIcon } from "../components/NavIcons";
import { SoundSetNavMenu } from "../components/SoundSetNavMenu";
import { openSecondWindow } from "../electronApi";
import { SoundIcon } from "./SoundIcon";
import { useSoundEngine } from "./engine";

// Правая часть нижней панели: состояние трёх остальных каналов и три
// одинаковые кнопки — «Заглушить всё», «Наборы», «Пульт».
//
// Кнопки с подписями, а не голые иконки: панель висит на каждой странице, и
// по одной ноте не понять, куда она ведёт. Живут они здесь, а не в самой
// панели, потому что положение у них одинаковое и когда музыка играет, и
// когда молчит — панель просто вставляет этот блок в оба своих состояния.
export function SoundBarExtras() {
  const { state, setSilence } = useSoundEngine();
  const [setsMenuOpen, setSetsMenuOpen] = useState(false);
  const data = state.data;

  const ambient = data?.ambient.find((b) => b.resource_id === state.ambientId) ?? null;
  const weather = data?.weather.find((b) => b.resource_id === state.weatherId) ?? null;
  const stinger = data?.stingers.find((b) => b.resource_id === state.duckingId) ?? null;

  // Пульт открывается вторым окном тем же механизмом, что и вынесенные
  // панели пульта сессии: в приложении это настоящее окно Electron, в
  // браузере — новое окно.
  const openConsole = () => openSecondWindow("/sound-console");

  return (
    <>
      <span className="sc-bar-channels">
        <span className={ambient && !state.silence ? "sc-bar-channel" : "sc-bar-channel off"}>
          <SoundIcon name={ambient?.icon ?? "forest"} size={14} />
          {ambient && !state.silence ? ambient.name : "—"}
        </span>
        <span className={weather && !state.silence ? "sc-bar-channel" : "sc-bar-channel off"}>
          <SoundIcon name={weather?.icon ?? "rain"} size={14} />
          {weather && !state.silence ? weather.name : "—"}
        </span>
        <span className={stinger ? "sc-bar-channel" : "sc-bar-channel off"}>
          <SoundIcon name={stinger?.icon ?? "bolt"} size={14} />
          {stinger ? stinger.name : "—"}
        </span>
      </span>

      <button
        type="button"
        className={state.silence ? "audio-player-action active" : "audio-player-action"}
        onClick={() => setSilence(!state.silence)}
      >
        <NavIcon name="volume" />
        <span>{state.silence ? "Вернуть звук" : "Заглушить всё"}</span>
      </button>

      <span className="audio-player-playlist-menu">
        <button
          type="button"
          className={setsMenuOpen ? "audio-player-action active" : "audio-player-action"}
          onClick={() => setSetsMenuOpen((open) => !open)}
        >
          <NavIcon name="folder" />
          <span>Наборы</span>
        </button>
        {setsMenuOpen && <SoundSetNavMenu onClose={() => setSetsMenuOpen(false)} />}
      </span>

      <button type="button" className="audio-player-action accent" onClick={openConsole}>
        <NavIcon name="sliders" />
        <span>Пульт</span>
      </button>
    </>
  );
}

// Левая часть панели, когда музыка молчит. Пустая строчка «Ничего не играет»
// ничего Мастеру не даёт: набор всё равно включать, и включать отсюда — на
// один шаг ближе, чем через правую кнопку.
export function SoundSetEmpty() {
  const [open, setOpen] = useState(false);
  return (
    <span className="audio-player-playlist-menu">
      <button
        type="button"
        className={open ? "audio-player-suggestion active" : "audio-player-suggestion"}
        onClick={() => setOpen((v) => !v)}
      >
        <NavIcon name="play" /> Включить набор
      </button>
      {open && <SoundSetNavMenu onClose={() => setOpen(false)} />}
    </span>
  );
}
