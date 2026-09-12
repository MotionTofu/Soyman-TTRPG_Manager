import { Fragment, useEffect, useRef, type MouseEvent } from "react";
import { useResource } from "../data/hooks";
import { openPreviewDockCard } from "../previewDockStore";
import type { PartyPlaceView } from "../partyPlaceEvents";
import { NavIcon } from "./NavIcons";

/**
 * «Партия здесь» на пульте (решения 2026-09-11, §3): где стоит партия кампании
 * — из последней запущенной сцены или ручной отметки. Клик по месту кладёт его
 * карточку в докстанцию, Ctrl+клик — полная страница в новом окне.
 */
export function PartyHereStrip({ sessionId, version }: { sessionId: number; version: number }) {
  const { data, reload } = useResource<PartyPlaceView>(`/sessions/${sessionId}/party-place`);

  // Запуск сцены идёт мимо слоя данных (SceneSwitcher) и сообщает о себе
  // счётчиком страницы; первый прогон — это и есть первое чтение.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    reload();
  }, [version, reload]);

  if (!data) return null;

  function open(id: number, e: MouseEvent) {
    if (e.ctrlKey || e.metaKey) {
      window.open(`/locations/${id}`, "_blank", "noopener");
      return;
    }
    openPreviewDockCard({ type: "location", id });
  }

  const place = data.location;
  return (
    <div className="party-strip" role="status" aria-label="Где партия">
      <NavIcon name="flag" />
      <span className="party-strip__label">Партия здесь</span>
      {place ? (
        <>
          <span className="party-strip__path">
            {data.path.slice(0, -1).map((p) => (
              <Fragment key={p.id}>
                <button type="button" onClick={(e) => open(p.id, e)} title={`В док: ${p.name}`}>
                  {p.name}
                </button>
                <span aria-hidden="true">/</span>
              </Fragment>
            ))}
            <button type="button" className="party-strip__place" onClick={(e) => open(place.id, e)} title={`В док: ${place.name}`}>
              {place.name}
            </button>
          </span>
          <span className="party-strip__source">
            {data.source === "scene" && data.scene ? `· из сцены «${data.scene.name}»` : "· отмечено вручную"}
          </span>
          {data.also.length > 0 && (
            <span className="party-strip__also">
              также в сцене:{" "}
              {data.also.map((a, i) => (
                <Fragment key={a.id}>
                  {i > 0 && ", "}
                  <button type="button" onClick={(e) => open(a.id, e)} title={`В док: ${a.name}`}>
                    {a.name}
                  </button>
                </Fragment>
              ))}
            </span>
          )}
        </>
      ) : (
        <span className="party-strip__empty">
          {data.scene
            ? `у сцены «${data.scene.name}» место не указано — «Мы здесь» в карточке места`
            : "не отмечено — запустите сцену с местом или нажмите «Мы здесь» в карточке места"}
        </span>
      )}
    </div>
  );
}
