import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { NavIcon } from "../components/NavIcons";
import { Knob } from "../sound/Knob";
import { SoundIcon } from "../sound/SoundIcon";
import { useSoundRemote } from "../sound/remote";
import type { MissingFile, SoundButton, SoundSetSummary } from "../sound/types";
import "../soundConsole.css";

const DIGIT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const LETTER_KEYS = ["Q", "W", "E", "A", "S", "D", "Z", "X", "C"];
const LETTER_CODES = ["KeyQ", "KeyW", "KeyE", "KeyA", "KeyS", "KeyD", "KeyZ", "KeyX", "KeyC"];
const DIGIT_CODES = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9"];

function time(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function Pad({
  button,
  active,
  stopped = false,
  hotkey,
  onPick,
}: {
  button: SoundButton;
  active: boolean;
  /** Звук выбран, но канал остановлен вручную — подсветка приглушённая. */
  stopped?: boolean;
  hotkey?: string;
  onPick: () => void;
}) {
  const className = [
    "sc-pad",
    active ? "active" : "",
    active && stopped ? "stopped" : "",
    button.missing ? "missing" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={className} onClick={onPick} disabled={button.missing}>
      {hotkey ? <span className="sc-pad-key">{hotkey}</span> : null}
      {button.from_set ? <span className="sc-pad-dot" /> : null}
      <SoundIcon name={button.icon} imageUrl={button.icon_url} />
      <span>{button.name}</span>
      {button.missing ? <span className="sc-pad-note">файл не найден</span> : null}
    </button>
  );
}

// Пульт звука — отдельное окно на втором мониторе. Рендерится вне <AppShell>
// (см. App.tsx): сайдбару, поиску и нижней панели здесь места нет, а
// кнопки должны стоять на постоянных местах во всю ширину.
export function SoundConsolePage() {
  const remote = useSoundRemote();
  const { state } = remote;

  // Играющая строка подкручивается в видимую часть списка: длинный плейлист
  // уезжает за край, а искать глазами то, что и так известно приложению, —
  // работа, которой за столом быть не должно.
  const activeTrackRef = useRef<HTMLButtonElement | null>(null);
  const activeTrackName = state?.background.trackName ?? null;
  useEffect(() => {
    // Кадром позже: на первом снимке состояния список ещё не разложен.
    const frame = requestAnimationFrame(() => {
      activeTrackRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTrackName]);

  const [sets, setSets] = useState<SoundSetSummary[]>([]);
  const [missing, setMissing] = useState<MissingFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");

  const refreshSets = useCallback(() => {
    api.get<SoundSetSummary[]>("/sound-sets").then(setSets).catch(() => setSets([]));
  }, []);

  useEffect(() => {
    refreshSets();
    // Битые файлы проверяются при открытии, а не в момент нажатия: узнавать о
    // пропаже, когда звук уже нужен, — худший из возможных моментов.
    api.get<MissingFile[]>("/files/missing").then(setMissing).catch(() => setMissing([]));
  }, [refreshSets]);

  const stingers = state?.data?.stingers ?? [];

  // Клавиши работают, пока окно пульта в фокусе. Раскладка читается по
  // физическим кодам: иначе на русской раскладке QWE-вариант перестал бы
  // работать вовсе.
  useEffect(() => {
    if (!state) return;
    const codes = state.keys === "letters" ? LETTER_CODES : DIGIT_CODES;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        remote.backgroundAction("toggle");
        return;
      }
      const index = codes.indexOf(e.code);
      if (index < 0) return;
      const button = stingers[index];
      if (!button || button.missing) return;
      e.preventDefault();
      remote.fireStinger(button.resource_id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, stingers, remote]);

  if (!state) {
    return (
      <div className="sc-window" style={{ alignItems: "center", justifyContent: "center" }}>
        <p className="sc-sub">Соединяемся с главным окном…</p>
      </div>
    );
  }

  const data = state.data;
  const ambient = data?.ambient ?? [];
  const weather = data?.weather ?? [];
  const bg = state.background;
  const ducking = state.duckingId !== null;
  // Стоп Бэкграунда виден по самому снимку: очередь есть, играющего трека нет.
  // Отдельного флага у него поэтому и не заведено.
  const bgStopped = bg.tracks.length > 0 && bg.trackName === null;
  const dim = state.silence ? 0.45 : 1;

  async function saveAsSet() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const created = await api.post<SoundSetSummary>("/sound-sets", {
        name: newName.trim(),
        battle_playlist_id: data?.battle?.id ?? null,
      });
      await api.put(`/sound-sets/${created.id}/items`, {
        // Бэкграунд набора — это список треков, поэтому запоминается то, что
        // сейчас в очереди, а не то, откуда её когда-то взяли.
        tracks: bg.tracks.map((t) => t.id),
        ambient: ambient.map((b) => b.resource_id),
        weather: weather.map((b) => b.resource_id),
        stingers: stingers.filter((b) => b.from_set).map((b) => b.resource_id),
        start_ambient_id: state?.ambientId ?? null,
      });
      setNewName("");
      refreshSets();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sc-window">
      <div className="sc-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "0 0 auto" }}>
          <div className="sc-title">Пульт звука</div>
          <div className="sc-sub">4 канала · звук идёт из главного окна</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 auto", minWidth: 0, flexWrap: "wrap" }}>
          <span className="sc-label">Набор</span>
          {sets.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === state.setId ? "sc-chip active" : "sc-chip"}
              onClick={() => remote.setSet(s.id)}
            >
              {s.name}
            </button>
          ))}
          {sets.length === 0 ? <span className="sc-sub">наборов ещё нет</span> : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Имя набора"
            style={{ width: 140 }}
          />
          <button type="button" className="sc-ghost" onClick={saveAsSet} disabled={saving || !newName.trim()}>
            Сохранить как набор
          </button>
        </div>
      </div>

      {state.autoSwitch ? (
        <div className="sc-warn">
          <SoundIcon name="battle" size={16} />
          <span className="sc-label" style={{ color: "var(--accent)" }}>
            Переключил бой
          </span>
          <span className="sc-sub" style={{ flex: "1 1 auto" }}>
            Бэкграунд ушёл на «{state.autoSwitch.to}» — это сделал трекер инициативы, не вы.
          </span>
          <button type="button" className="sc-ghost" onClick={() => remote.revertAutoSwitch()}>
            Вернуть прежнее
          </button>
        </div>
      ) : null}

      {state.sceneSwitch ? (
        <div className="sc-warn">
          <NavIcon name="navCockpit" />
          <span className="sc-label" style={{ color: "var(--accent)" }}>
            Включила сцена
          </span>
          <span className="sc-sub" style={{ flex: "1 1 auto" }}>
            Набор ушёл на «{state.sceneSwitch.to}» — это запуск сцены «{state.sceneSwitch.scene}», не вы.
          </span>
          <button type="button" className="sc-ghost" onClick={() => remote.revertSceneSet()}>
            Вернуть прежний
          </button>
        </div>
      ) : null}

      {missing.length > 0 ? (
        <div className="sc-warn">
          <NavIcon name="warning" />
          <span className="sc-label" style={{ color: "var(--accent)" }}>
            {missing.length} файлов не найдено
          </span>
          <span className="sc-sub" style={{ flex: "1 1 auto" }}>
            Кнопки погашены заранее. Разобрать — в библиотеке, вкладка «Звук».
          </span>
        </div>
      ) : null}

      <div className="sc-grid">
        {/* Бэкграунд */}
        <section className="sc-channel sc-glass" style={{ opacity: dim }}>
          <div className="sc-channel-head">
            <SoundIcon name="music" size={16} />
            <span>Бэкграунд</span>
            <span style={{ flex: "1 1 auto" }} />
            <span className="sc-channel-state">
              {state.silence
                ? "тишина"
                : bg.isPlaying
                  ? "играет"
                  : bg.trackName
                    ? "пауза"
                    : bg.tracks.length
                      ? "стоп"
                      : "молчит"}
            </span>
          </div>
          <div className="sc-channel-body">
            {/* Условие по очереди, а не по играющему треку: остановленный канал
                заряжен, и список должен остаться на экране — иначе стоп
                выглядит как «набор пропал». */}
            {bg.tracks.length > 0 ? (
              <>
                <div>
                  <div className="sc-track-now">{bg.trackName ?? "Стоп"}</div>
                  {bg.sourceName ? <div className="sc-sub" style={{ marginTop: 5 }}>{bg.sourceName}</div> : null}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="sc-progress">
                    <div
                      className="sc-progress-fill"
                      style={{ width: bg.duration ? `${(bg.currentTime / bg.duration) * 100}%` : "0%" }}
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }} className="sc-sub">
                    <span>{time(bg.currentTime)}</span>
                    <span>{time(bg.duration)}</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button type="button" className="sc-ghost" onClick={() => remote.backgroundAction("prev")}>
                    <NavIcon name="prev" />
                  </button>
                  <button type="button" className="sc-chip active" onClick={() => remote.backgroundAction("toggle")}>
                    <NavIcon name={bg.isPlaying ? "pause" : "play"} />
                  </button>
                  <button type="button" className="sc-ghost" onClick={() => remote.backgroundAction("next")}>
                    <NavIcon name="next" />
                  </button>
                  <span style={{ flex: "1 1 auto" }} />
                  {/* Шаффл и повтор переехали сюда из нижней панели: панель
                      висит на каждой странице, а эти два переключателя нужны
                      ровно там, где сводят звук.

                      Повтор — одна фишка на три состояния, а не две почти
                      одинаковые: выбор между «повторять трек» и «повторять
                      плейлист» Мастер делал глазами, вглядываясь в разницу
                      между глифами. Слово рядом со значком по той же причине:
                      значок читается с вероятностью, слово — наверняка. */}
                  <button
                    type="button"
                    className={bg.shuffleMode ? "sc-chip active" : "sc-chip"}
                    title="Случайный порядок"
                    onClick={() => remote.setShuffle(!bg.shuffleMode)}
                  >
                    <NavIcon name="shuffle" />
                    <span>Вразнобой</span>
                  </button>
                  <button
                    type="button"
                    className={bg.repeatMode === "off" ? "sc-chip" : "sc-chip active"}
                    title="Повтор: выключен → по кругу → один трек"
                    onClick={() =>
                      remote.setRepeat(
                        bg.repeatMode === "off" ? "playlist" : bg.repeatMode === "playlist" ? "track" : "off"
                      )
                    }
                  >
                    <NavIcon name={bg.repeatMode === "track" ? "repeatTrack" : "repeatPlaylist"} />
                    <span>
                      {bg.repeatMode === "off" ? "Повтор" : bg.repeatMode === "playlist" ? "По кругу" : "Один трек"}
                    </span>
                  </button>
                </div>
                {/* Весь список, а не первые шесть: «поставь третий трек»
                    подразумевает, что третий видно. Строка целиком —
                    попадание в маленькую кнопку на строке за столом стоит
                    точности, которой у Мастера в этот момент нет. */}
                {bg.tracks.length > 0 ? (
                  <div className="sc-track-list">
                    {bg.tracks.map((t, i) => (
                      <button
                        key={i}
                        type="button"
                        className={t.active ? "sc-track-row active" : "sc-track-row"}
                        ref={t.active ? activeTrackRef : undefined}
                        title={t.name}
                        onClick={() => {
                          if (t.active) return; // щелчок по играющему — не обрыв текущего трека
                          remote.playBackgroundTrack(i);
                        }}
                      >
                        <span className="sc-track-num">{i + 1}</span>
                        <span className="sc-track-name">{t.name}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="sc-empty">
                Плейлист не выбран.
                <br />
                Включите набор — он приносит свой.
              </p>
            )}
            <span style={{ flex: "1 1 auto" }} />
            <Knob
              value={state.volumes.background}
              onChange={(v) => remote.setVolume("background", v)}
              stopped={bgStopped}
              stopDisabled={bg.tracks.length === 0}
              stopLabel={bgStopped ? "Играть с первого трека" : "Остановить Бэкграунд"}
              onStop={() => remote.toggleStop("background")}
            />
          </div>
        </section>

        {/* Эмбиент */}
        <section className="sc-channel sc-glass" style={{ opacity: dim }}>
          <div className="sc-channel-head">
            <SoundIcon name="forest" size={16} />
            <span>Эмбиент</span>
            <span style={{ flex: "1 1 auto" }} />
            <span className="sc-channel-state">
              {state.stopped.ambient ? "стоп" : state.ambientId && !state.silence ? "играет" : "молчит"}
            </span>
          </div>
          <div className="sc-channel-body">
            {ambient.length ? (
              <>
                <div className="sc-pads">
                  {ambient.map((b) => (
                    <Pad
                      key={b.resource_id}
                      button={b}
                      active={state.ambientId === b.resource_id && !state.silence}
                      stopped={state.stopped.ambient}
                      onPick={() => remote.playAmbient(b.resource_id)}
                    />
                  ))}
                </div>
                <button type="button" className="sc-more">
                  Ещё · вся библиотека
                </button>
              </>
            ) : (
              <p className="sc-empty">
                Звуков этой роли ещё нет.
                <br />
                Добавьте их в библиотеке, вкладка «Звук».
              </p>
            )}
            <span style={{ flex: "1 1 auto" }} />
            <Knob
              value={state.volumes.ambient}
              onChange={(v) => remote.setVolume("ambient", v)}
              stopped={state.stopped.ambient}
              stopDisabled={state.ambientId === null}
              stopLabel={state.stopped.ambient ? "Запустить эмбиент заново" : "Остановить Эмбиент"}
              onStop={() => remote.toggleStop("ambient")}
            />
          </div>
        </section>

        {/* Погода */}
        <section className="sc-channel sc-glass" style={{ opacity: dim }}>
          <div className="sc-channel-head">
            <SoundIcon name="rain" size={16} />
            <span>Погода</span>
            <span style={{ flex: "1 1 auto" }} />
            <span className="sc-channel-state">
              {state.stopped.weather ? "стоп" : state.weatherId && !state.silence ? "играет" : "молчит"}
            </span>
          </div>
          <div className="sc-channel-body">
            {weather.length ? (
              <>
                <div className="sc-pads">
                  {weather.map((b) => (
                    <Pad
                      key={b.resource_id}
                      button={b}
                      active={state.weatherId === b.resource_id && !state.silence}
                      stopped={state.stopped.weather}
                      onPick={() => remote.playWeather(b.resource_id)}
                    />
                  ))}
                </div>
                <button type="button" className="sc-more">
                  Ещё · вся библиотека
                </button>
              </>
            ) : (
              <p className="sc-empty">
                Звуков этой роли ещё нет.
                <br />
                Погода живёт отдельно от места: набор её не включает и не гасит.
              </p>
            )}
            <span style={{ flex: "1 1 auto" }} />
            <Knob
              value={state.volumes.weather}
              onChange={(v) => remote.setVolume("weather", v)}
              stopped={state.stopped.weather}
              stopDisabled={state.weatherId === null}
              stopLabel={state.stopped.weather ? "Запустить погоду заново" : "Остановить Погоду"}
              onStop={() => remote.toggleStop("weather")}
            />
          </div>
        </section>

        {/* Стингеры */}
        <section className="sc-channel sc-glass">
          <div className="sc-channel-head">
            <SoundIcon name="bolt" size={16} />
            <span>Стингеры</span>
            <span style={{ flex: "1 1 auto" }} />
            <span className="sc-channel-state">{state.stingerPlaying ? "звучит" : "готов"}</span>
          </div>
          <div className="sc-channel-body">
            {stingers.length ? (
              <>
                <div className="sc-pads three">
                  {stingers.map((b, i) => (
                    <Pad
                      key={b.resource_id}
                      button={b}
                      active={state.duckingId === b.resource_id}
                      hotkey={(state.keys === "letters" ? LETTER_KEYS : DIGIT_KEYS)[i]}
                      onPick={() => remote.fireStinger(b.resource_id)}
                    />
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="sc-label" style={{ flex: "1 1 auto" }}>
                    Клавиши
                  </span>
                  <button
                    type="button"
                    className={state.keys === "digits" ? "sc-chip active" : "sc-chip"}
                    onClick={() => remote.setKeys("digits")}
                  >
                    1–9
                  </button>
                  <button
                    type="button"
                    className={state.keys === "letters" ? "sc-chip active" : "sc-chip"}
                    onClick={() => remote.setKeys("letters")}
                  >
                    QWE
                  </button>
                </div>
                <div className={ducking ? "sc-duck on" : "sc-duck"}>
                  {ducking ? "Дакинг · остальные каналы 40%" : "Дакинг сработает на стингере"}
                </div>
              </>
            ) : (
              <p className="sc-empty">
                Стингеров ещё нет.
                <br />
                Отметьте нужные «постоянными» в библиотеке.
              </p>
            )}
            <span style={{ flex: "1 1 auto" }} />
            {/* У стингера стоп — не режим канала, а обрыв того, что звучит
                сейчас: длинный файл, вставленный ради первых пяти секунд,
                иначе играет до конца. Поэтому знак всегда «стоп», и он гаснет,
                когда обрывать нечего. */}
            <Knob
              value={state.volumes.stinger}
              onChange={(v) => remote.setVolume("stinger", v)}
              stopDisabled={!state.stingerPlaying}
              stopLabel="Оборвать стингер"
              onStop={() => remote.toggleStop("stinger")}
            />
          </div>
        </section>
      </div>

      <div className="sc-foot">
        <button
          type="button"
          className={state.silence ? "sc-silence on" : "sc-silence"}
          onClick={() => remote.setSilence(!state.silence)}
        >
          <NavIcon name="volume" />
          <span>{state.silence ? "Вернуть звук" : "Тишина"}</span>
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "1 1 auto", minWidth: 0 }}>
          <span className="sc-label">Общая громкость</span>
          <div
            className="sc-master"
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              remote.setVolume("master", (e.clientX - rect.left) / rect.width);
            }}
          >
            <div className="sc-master-fill" style={{ width: `${state.volumes.master * 100}%` }} />
          </div>
          <span className="sc-knob-value">{Math.round(state.volumes.master * 100)}%</span>
        </div>
      </div>
    </div>
  );
}
