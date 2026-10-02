import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../data/hooks";
import { useSoundEngineOptional } from "../../sound/engine";
import type { SoundButton, SoundSetDetail, SoundSetSummary } from "../../sound/types";
import type { Resource } from "../../types";
import { EmptyState } from "../EmptyState";
import { guessResourceCategory } from "../../resourceCategories";

// «Аудиотека» сеттинга (разбор профиля сеттинга, Q15; макет — доска 25):
// аудионаборы сеттинга так, как они устроены в глобальной Аудиотеке, —
// набор = треки Бэкграунда, Эмбиент, Погода, Стингеры и боевая тема. Здесь
// их включают; состав правится в глобальной Аудиотеке.

const NO_SETS: SoundSetSummary[] = [];
const NO_RESOURCES: Resource[] = [];

export function SettingAudioTab({ settingId }: { settingId: number }) {
  const engine = useSoundEngineOptional();
  const all = useResource<SoundSetSummary[]>("/sound-sets").data ?? NO_SETS;
  const sets = useMemo(() => all.filter((s) => s.setting_id === settingId), [all, settingId]);
  const [openId, setOpenId] = useState<number | null>(null);
  const opened = openId ?? sets[0]?.id ?? null;
  const current = useResource<SoundSetDetail>(opened != null ? `/sound-sets/${opened}` : null).data ?? null;
  const resources = useResource<Resource[]>(`/resources?scope=setting&setting_id=${settingId}`).data ?? NO_RESOURCES;
  const loose = resources.filter((r) => r.setting_id === settingId && (r.category === "audio" || guessResourceCategory(r.file_url || r.link_url || r.name) === "audio"));
  const playing = engine?.state.setId ?? null;

  return (
    <div className="setting-audio">
      <div className="population__toolbar">
        <span className="muted">Наборы и треки этого сеттинга</span>
        <span className="population__spacer" />
        <Link to="/audio-library">Открыть в Аудиотеке ›</Link>
      </div>
      {sets.length === 0 && loose.length === 0 ? (
        <EmptyState title="Звука пока нет" hint="Аудионаборы и треки собираются в общей Аудиотеке — набор с сеттингом этого мира появится здесь." />
      ) : (
        <div className="population__split setting-audio__split">
          <div className="population__list">
            <h2 className="pop-group__head">
              Наборы <span className="pop-group__count">{sets.length}</span>
            </h2>
            <ul className="pop-rows">
              {sets.map((s) => (
                <li key={s.id}>
                  <button type="button" className={`pop-row setting-audio__set${s.id === opened ? " is-selected" : ""}`} onClick={() => setOpenId(s.id)}>
                    <span className="setting-world__title">
                      {s.name} {s.id === playing && <span className="pop-item__chip is-dark">играет</span>}
                    </span>
                    <span className="pop-row__muted">
                      {s.track_count + s.ambient_count + s.weather_count + s.stinger_count} звуков
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {loose.length > 0 && (
              <>
                <h2 className="pop-group__head">
                  Треки сеттинга <span className="pop-group__count">{loose.length}</span>
                </h2>
                <ul className="paper-rows">
                  {loose.map((r) => (
                    <li key={r.id}>
                      <span className="paper-rows__main">{r.name}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="setting-audio__set-view">
            {current && (
              <>
                <div className="setting-audio__head">
                  <h3>{current.name}</h3>
                  {current.battle_playlist && <span className="muted">боевая тема «{current.battle_playlist.name}»</span>}
                  <span className="population__spacer" />
                  {engine && (
                    <button type="button" className="primary" disabled={playing === current.id} onClick={() => engine.setSet(current.id)}>
                      {playing === current.id ? "Включён" : "Включить набор"}
                    </button>
                  )}
                  {engine && current.battle_playlist_id && (
                    <button type="button" onClick={() => engine.enterCombat(current.battle_playlist_id!)}>
                      В бой
                    </button>
                  )}
                </div>
                <div className="setting-audio__channels">
                  <Channel title="Бэкграунд" items={current.tracks} />
                  <Channel title="Эмбиент" items={current.ambient} onPlay={engine ? (b) => engine.playAmbient(b.resource_id) : undefined} />
                  <Channel title="Погода" items={current.weather} onPlay={engine ? (b) => engine.playWeather(b.resource_id) : undefined} />
                  <Channel title="Стингеры" items={current.stingers} onPlay={engine ? (b) => engine.fireStinger(b.resource_id) : undefined} />
                </div>
                <p className="muted">
                  При включении играют треки Бэкграунда и стартовый звук Эмбиента; погода и стингеры — по кнопке. Состав набора правится в Аудиотеке.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Channel({ title, items, onPlay }: { title: string; items: SoundButton[]; onPlay?: (b: SoundButton) => void }) {
  return (
    <section aria-label={title}>
      <h4 className="paper-label">
        {title} · {items.length}
      </h4>
      <ul className="setting-audio__sounds">
        {items.map((b) => (
          <li key={b.resource_id}>
            {onPlay ? (
              <button type="button" className="setting-audio__play" onClick={() => onPlay(b)} disabled={b.missing} aria-label={`Играть: ${b.name}`}>
                ▶
              </button>
            ) : (
              <span className="setting-audio__dot" aria-hidden="true" />
            )}
            <span className="setting-audio__name">{b.name}</span>
            {b.is_start && <span className="pop-item__chip">старт</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
