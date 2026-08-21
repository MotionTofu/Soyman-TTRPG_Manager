import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { SessionUnionRow, TreeAdventure } from "../types";

// «Сцены на вечер» — заготовка сессии.
//
// Живёт в подготовке, а не на пульте: набирать сцены — работа до игры, а пульт
// отвечает за игру. На пульте остаётся только заготовленное плюс экстренный
// поиск, когда партия ушла не туда.
//
// Дерево трёхуровневое — приключение → глава → сцена, — потому что в базе
// владельца 183 сцены из 194 лежат в главах, и плоский список приключений
// показывал пустые приключения вместо сцен.
//
// Галочка стоит у главы и у сцены, но НЕ у приключения: приключение — это
// десятки сцен, и отметить его целиком значит привести на вечер весь том.

const UNION_PANELS: { panel: string; title: string }[] = [
  { panel: "plot_characters", title: "Сюжетные персонажи" },
  { panel: "enemies", title: "Препятствия" },
  { panel: "loot", title: "Потенциальный лут" },
];

interface PlannedReply {
  ids: number[];
  carried: number[];
}

export function SessionSceneTree({
  sessionId,
  onChanged,
}: {
  sessionId: number;
  onChanged?: () => void;
}) {
  const [wide, setWide] = useState(false);
  const [tree, setTree] = useState<TreeAdventure[] | null>(null);
  const [planned, setPlanned] = useState<number[]>([]);
  const [carried, setCarried] = useState<number[]>([]);
  const [union, setUnion] = useState<SessionUnionRow[]>([]);
  const [openAdv, setOpenAdv] = useState<number | null>(null);
  const [openCh, setOpenCh] = useState<string | null>(null);
  // Заготовка приезжает отдельным запросом и позже дерева. Без этого флага
  // «открыть то приключение, где уже отмечено» срабатывало на пустом ещё
  // списке отметок и всегда открывало первое.
  const [plannedLoaded, setPlannedLoaded] = useState(false);

  useEffect(() => {
    api
      .get<TreeAdventure[]>(`/sessions/${sessionId}/story-tree${wide ? "?scope=setting" : ""}`)
      .then(setTree);
  }, [sessionId, wide]);

  const readPlanned = useCallback((reply: PlannedReply) => {
    setPlanned(reply.ids);
    setCarried(reply.carried);
    setPlannedLoaded(true);
  }, []);

  const refreshUnion = useCallback(() => {
    api.get<SessionUnionRow[]>(`/sessions/${sessionId}/cast-union`).then(setUnion);
  }, [sessionId]);

  useEffect(() => {
    api.get<PlannedReply>(`/sessions/${sessionId}/planned`).then(readPlanned);
    refreshUnion();
  }, [sessionId, readPlanned, refreshUnion]);

  const pickedSet = useMemo(() => new Set(planned), [planned]);
  const carriedSet = useMemo(() => new Set(carried), [carried]);

  // Первым открывается то приключение, в котором уже что-то отмечено: чаще
  // всего вечер продолжает предыдущий, и его сцены — то, к чему возвращаются.
  useEffect(() => {
    if (!tree || tree.length === 0 || openAdv != null || !plannedLoaded) return;
    const withPicked = tree.find((a) =>
      a.chapters.some((c) => c.scenes.some((s) => pickedSet.has(s.id)))
    );
    setOpenAdv((withPicked ?? tree[0]).id);
  }, [tree, pickedSet, openAdv, plannedLoaded]);

  async function toggle(ids: number[], on: boolean) {
    if (ids.length === 0) return;
    const reply = await api.post<PlannedReply>(`/sessions/${sessionId}/planned`, {
      scene_ids: ids,
      on,
    });
    readPlanned(reply);
    refreshUnion();
    onChanged?.();
  }

  if (!tree) return <p className="muted">Загрузка сцен…</p>;

  const total = planned.length;
  const carriedHere = carried.length;

  return (
    <div className="card sp-scenes">
      <div className="sp-scenes__head">
        <span className="sp-title">Сцены на вечер</span>
        <span className="sp-count">{total > 0 ? `отмечено ${total}` : "ничего не отмечено"}</span>
        <span style={{ flex: 1 }} />
        {carriedHere > 0 && (
          <span className="muted sp-note">
            {carriedHere === 1
              ? "одна переехала с прошлой сессии — её не сыграли"
              : `${carriedHere} переехали с прошлой сессии — их не сыграли`}
          </span>
        )}
        <button
          className={`sp-scope${wide ? " is-on" : ""}`}
          onClick={() => setWide((v) => !v)}
          title="Приключения кампании или весь сеттинг"
        >
          {wide ? "Только кампания" : "Показать весь сеттинг"}
        </button>
      </div>

      <div className="sp-scenes__body">
        <div className="sp-tree">
          {tree.length === 0 && (
            <span className="muted">
              У кампании нет сеттинга — дерево приключений собрать не из чего.
            </span>
          )}
          {tree.map((adv) => {
            const scenes = adv.chapters.flatMap((c) => c.scenes);
            const pickedHere = scenes.filter((s) => pickedSet.has(s.id)).length;
            const open = openAdv === adv.id;
            return (
              <div key={adv.id} className="sp-adv">
                <button className="sp-adv__head" onClick={() => setOpenAdv(open ? null : adv.id)}>
                  <span className={`sp-turn${open ? " is-open" : ""}`} aria-hidden />
                  <span className="sp-adv__name">{adv.name}</span>
                  {pickedHere > 0 && <span className="sp-count">{pickedHere} отмечено</span>}
                </button>

                {open &&
                  adv.chapters.map((ch) => {
                    const key = `${adv.id}:${ch.id ?? "own"}`;
                    const ids = ch.scenes.map((s) => s.id);
                    const on = ids.filter((id) => pickedSet.has(id)).length;
                    const all = ids.length > 0 && on === ids.length;
                    const some = on > 0 && !all;
                    const chOpen = openCh === key;
                    return (
                      <div key={key} className="sp-chapter">
                        <div className="sp-chapter__head">
                          {/* Галочка главы — не отметка, а кнопка «добавить все
                              её сцены»: хранится список сцен, и сцена,
                              добавленная в главу позже, не приедет в уже
                              собранный вечер сама. */}
                          <button
                            className={`sp-box${all ? " is-on" : ""}${some ? " is-some" : ""}`}
                            title={all ? "Убрать все сцены главы" : "Добавить все сцены главы"}
                            onClick={() => toggle(ids, !all)}
                          />
                          <button
                            className="sp-chapter__name"
                            onClick={() => setOpenCh(chOpen ? null : key)}
                          >
                            <span
                              className={`sp-turn is-small${chOpen ? " is-open" : ""}`}
                              aria-hidden
                            />
                            <span>{ch.id == null ? "Сцены приключения" : ch.name}</span>
                          </button>
                          <span className="sp-count">{on > 0 ? `${on}/${ids.length}` : ids.length}</span>
                        </div>

                        {chOpen && (
                          <div className="sp-scenes-list">
                            {ch.scenes.map((sc) => {
                              const isOn = pickedSet.has(sc.id);
                              return (
                                <button
                                  key={sc.id}
                                  className="sp-scene"
                                  onClick={() => toggle([sc.id], !isOn)}
                                >
                                  <span className={`sp-box${isOn ? " is-on" : ""}`} aria-hidden />
                                  <span className="sp-scene__name">{sc.name}</span>
                                  {carriedSet.has(sc.id) && (
                                    <span className="sp-carried">не сыграна</span>
                                  )}
                                  <span className="sp-count">{sc.cast}</span>
                                </button>
                              );
                            })}
                            {ch.scenes.length === 0 && <span className="muted">Сцен пока нет.</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>

        {/* Что приведут отмеченные сцены. Считается по отметкам, а не по
            приключениям: набирать сцены вслепую — значит узнать состав вечера
            уже за столом. */}
        <div className="sp-union">
          <span className="sp-label">Кого они приведут</span>
          {UNION_PANELS.map((p) => {
            const rows = union.filter((u) => u.panel === p.panel);
            return (
              <div key={p.panel} className="sp-union__card">
                <div className="sp-union__head">{p.title}</div>
                <div className="sp-union__body">
                  {rows.map((r) => (
                    <div key={`${r.to_type}:${r.to_id}`} className="sp-union__row">
                      <span className="sp-dot" aria-hidden />
                      <span className="sp-union__name">{r.name}</span>
                      {r.qty && <span className="qty-chip">{r.qty}</span>}
                    </div>
                  ))}
                  {rows.length === 0 && (
                    <span className="muted">
                      {total === 0 ? "Сцены не отмечены." : "Пусто — состав сцен не размечен."}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
