import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { dataKeys } from "../data/entities";
import { useAction, useResource, write } from "../data/hooks";
import { launchAffects, sessionPaths } from "../data/sessions";
import type { SessionUnionRow, TreeAdventure } from "../types";
import { ObstacleDropZone } from "./ObstacleDropZone";
import { SectionDropZone } from "./SectionDropZone";

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

// Колонка «Кого они приведут» (макет Roll-Prep, Q6): состав отмеченных сцен
// и добавленное рукой — одним списком пилюль по группам. Бывшие четыре
// карточки подготовки слиты сюда; локации — четвёртой группой.
const PLOT_CHARACTER_TYPES = ["being", "character"];
const LOCATION_TYPES = ["location"];
const LOOT_TYPES = ["resource", "artifact", "compendium_entry"];
const LOOT_COMPENDIUM_KINDS = ["equipment", "magic_item"];

interface PlannedReply {
  ids: number[];
  carried: number[];
}

const NO_IDS: number[] = [];
const NO_UNION: SessionUnionRow[] = [];

export function SessionSceneTree({
  sessionId,
  ideaNotes,
  onChanged,
}: {
  sessionId: number;
  /** Задумка: упомянутые в ней персонажи и локации встают в колонку. */
  ideaNotes?: string;
  onChanged?: () => void;
}) {
  const [wide, setWide] = useState(false);
  // Дерево, отметки и состав — из кэша слоя данных: отметка здесь и запуск на
  // пульте задевают сессию (data/sessions.ts), и всё перечитывается само, в
  // том числе в окне пульта. Дерево при смене охвата держит прежнее, пока не
  // придёт новое, — как и раньше.
  const tree = useResource<TreeAdventure[]>(sessionPaths.storyTree(sessionId, wide), { keepPrevious: true }).data ?? null;
  const plannedPath = sessionPaths.planned(sessionId);
  const plannedReply = useResource<PlannedReply>(plannedPath).data;
  const planned = plannedReply?.ids ?? NO_IDS;
  const carried = plannedReply?.carried ?? NO_IDS;
  const union = useResource<SessionUnionRow[]>(sessionPaths.castUnion(sessionId)).data ?? NO_UNION;
  const [openAdv, setOpenAdv] = useState<number | null>(null);
  const [openCh, setOpenCh] = useState<string | null>(null);
  // Заготовка приезжает отдельным запросом и позже дерева. Пока её нет,
  // «открыть то приключение, где уже отмечено» сработало бы на пустом ещё
  // списке отметок и всегда открывало первое.
  const plannedLoaded = plannedReply !== undefined;
  const client = useQueryClient();
  const run = useAction();

  const pickedSet = useMemo(() => new Set(planned), [planned]);
  const plotRows = useMemo(() => union.filter((u) => u.panel === "plot_characters"), [union]);
  const enemyRows = useMemo(() => union.filter((u) => u.panel === "enemies"), [union]);
  const lootRows = useMemo(() => union.filter((u) => u.panel === "loot"), [union]);
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
    // Набор вечера меняет и сцену на пульте, и состав панелей — задето всё под
    // сессией и её связи.
    const reply = await run(() => write.post<PlannedReply>(plannedPath, { scene_ids: ids, on }), {
      affects: launchAffects(sessionId),
    });
    if (reply) client.setQueryData(dataKeys.resource(plannedPath), reply);
    onChanged?.();
  }

  if (!tree) return <p className="muted">Загрузка сцен…</p>;

  const total = planned.length;
  const carriedHere = carried.length;

  return (
    <section className="d-focal sp-scenes">
      <div className="d-plate-row">
        <h2 className="d-plate">Сцены на вечер</h2>
        <span className="d-note">{total > 0 ? `ОТМЕЧЕНО ${total}` : "НИЧЕГО НЕ ОТМЕЧЕНО"}</span>
        <span className="d-end sp-scenes__end">
          {carriedHere > 0 && (
            <span className="d-note">
              {carriedHere === 1
                ? "одна переехала с прошлой сессии — её не сыграли"
                : `${carriedHere} переехали с прошлой сессии — их не сыграли`}
            </span>
          )}
          <button
            className="sp-scope-link"
            onClick={() => setWide((v) => !v)}
            title="Приключения кампании или весь сеттинг"
          >
            {wide ? "Только кампания" : "Показать весь сеттинг"}
          </button>
        </span>
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
            уже за столом. Свои добавления — там же, пилюлей с крестиком. */}
        <div className="sp-union">
          <span className="sp-union__label">Сюжетные персонажи</span>
          <SectionDropZone
            entityType="session"
            entityId={sessionId}
            section="plot_characters"
            acceptTypes={PLOT_CHARACTER_TYPES}
            placeholder="Перетащите из поиска"
            mentionText={ideaNotes}
            mentionTypes={PLOT_CHARACTER_TYPES}
            unionRows={plotRows}
            pills
          />
          <span className="sp-union__label">Препятствия</span>
          <ObstacleDropZone sessionId={sessionId} unionRows={enemyRows} pills />
          <span className="sp-union__label">Потенциальный лут</span>
          <SectionDropZone
            entityType="session"
            entityId={sessionId}
            section="loot"
            acceptTypes={LOOT_TYPES}
            acceptCompendiumKinds={LOOT_COMPENDIUM_KINDS}
            placeholder="Перетащите из поиска"
            unionRows={lootRows}
            pills
          />
          <span className="sp-union__label">Локации</span>
          <SectionDropZone
            entityType="session"
            entityId={sessionId}
            section="locations"
            acceptTypes={LOCATION_TYPES}
            placeholder="Перетащите из поиска"
            mentionText={ideaNotes}
            mentionTypes={LOCATION_TYPES}
            pills
          />
        </div>
      </div>
    </section>
  );
}
