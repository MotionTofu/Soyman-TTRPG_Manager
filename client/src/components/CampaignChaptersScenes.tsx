import { memo, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { MentionText } from "./mentions/MentionText";
import { SCENE_KIND_LABELS, SCENE_STATUSES, chapterWord, sceneWord } from "../sceneKinds";
import type { CampaignAdventureTree, SceneStatus, StoryScene } from "../types";

// Раздел «Главы и сцены» кампании: приключение → главы → сцены. Базово
// свёрнуто всё, включая сами приключения: у книжной кампании тут сотни строк,
// и раскрывать их сразу — значит сделать раздел нечитаемым.
//
// Сцена раскрывается своей сводкой и ссылкой на полную страницу: разворачивать
// весь текст сцены прямо здесь — снова бесконечный свиток, а строка без сводки
// заставляет открывать страницу только чтобы вспомнить, о чём сцена.
export function CampaignChaptersScenes({
  campaignId,
  settingId,
}: {
  campaignId: number;
  settingId: number | null;
}) {
  const [tree, setTree] = useState<CampaignAdventureTree[]>([]);

  const refresh = useCallback(() => {
    api.get<CampaignAdventureTree[]>(`/story/campaign-tree?campaign_id=${campaignId}`).then(setTree);
  }, [campaignId]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Нетронутые сцены сохраняют ссылочное равенство: вместе с memo на строке
  // это оставляет коммит React в пределах одной сцены, а не всего дерева.
  const applyStatus = useCallback((sceneId: number, status: string) => {
    // Приключения и главы, которых правка не касается, сохраняют ссылку —
    // иначе смена статуса одной сцены перерисовывала бы всё дерево.
    const patchList = (list: StoryScene[]) => {
      const i = list.findIndex((s) => s.id === sceneId);
      if (i === -1) return list;
      const next = list.slice();
      next[i] = { ...list[i], state: { status: status as SceneStatus, note: list[i].state?.note ?? "" } };
      return next;
    };
    setTree((prev) =>
      prev.map((adv) => {
        const scenes = patchList(adv.scenes);
        const chapters = adv.chapters.map((c) => {
          const chScenes = patchList(c.scenes);
          return chScenes === c.scenes ? c : { ...c, scenes: chScenes };
        });
        const chaptersChanged = chapters.some((c, i) => c !== adv.chapters[i]);
        if (scenes === adv.scenes && !chaptersChanged) return adv;
        return { ...adv, scenes, chapters };
      })
    );
  }, []);

  if (settingId == null) {
    return (
      <p className="muted">
        Приключения живут в сеттинге — выберите сеттинг кампании в разделе «Обзор».
      </p>
    );
  }

  return (
    <div className="stack">
      <p className="muted">
        Приключения кампании со своими главами и сценами. Правка сцены создаёт её версию для этой
        кампании, оригинал в сеттинге не меняется.
      </p>
      {tree.map((adv) => {
        const total =
          adv.scenes.length + adv.chapters.reduce((n, c) => n + c.scenes.length, 0);
        return (
          <details key={adv.id} className="card">
            <summary>
              <strong className="entry-title">{adv.name}</strong>
              <span className="muted">
                {" · "}
                {!!adv.chapters.length && `${adv.chapters.length} ${chapterWord(adv.chapters.length)} · `}
                {total} {sceneWord(total)}
              </span>
              {adv.is_override && <span className="badge tag"> правка кампании</span>}
            </summary>
            <div className="stack" style={{ marginTop: 8 }}>
              {/* Сцены, лежащие прямо на приключении: у книжного импорта их
                  почти не бывает, у самодельного — наоборот, все. */}
              {adv.scenes.length > 0 && (
                <SceneList
                  scenes={adv.scenes}
                  campaignId={campaignId}
                  onStatus={applyStatus}
                  title={adv.chapters.length > 0 ? "Без главы" : null}
                />
              )}
              {adv.chapters.map((c) => (
                <details key={c.id} className="card">
                  <summary>
                    <strong className="entry-title">{c.name}</strong>
                    <span className="muted">
                      {" · "}
                      {c.scenes.length} {sceneWord(c.scenes.length)}
                    </span>
                    {c.is_override && <span className="badge tag"> правка кампании</span>}
                  </summary>
                  <div style={{ marginTop: 8 }}>
                    <SceneList scenes={c.scenes} campaignId={campaignId} onStatus={applyStatus} title={null} />
                  </div>
                </details>
              ))}
              {total === 0 && <p className="muted">Сцен пока нет.</p>}
            </div>
          </details>
        );
      })}
      {tree.length === 0 && <p className="muted">В кампании пока нет приключений.</p>}
    </div>
  );
}

const SceneList = memo(function SceneList({
  scenes,
  campaignId,
  onStatus,
  title,
}: {
  scenes: StoryScene[];
  campaignId: number;
  onStatus: (sceneId: number, status: string) => void;
  title: string | null;
}) {
  // Смена статуса сцены правит одну строку: перечитывать всё дерево
  // приключений (у книжной кампании это сотни строк) из-за неё нельзя.
  const setStatus = useCallback(
    (scene: StoryScene, status: string) => {
      onStatus(scene.id, status);
      void api.put(`/story/scenes/${scene.id}/state`, { campaign_id: campaignId, status });
    },
    [campaignId, onStatus]
  );

  return (
    <div className="stack">
      {title && <span className="muted">{title}</span>}
      {scenes.map((s) => (
        <SceneRow key={s.id} scene={s} campaignId={campaignId} onStatus={setStatus} />
      ))}
      {scenes.length === 0 && <p className="muted">Сцен пока нет.</p>}
    </div>
  );
});

const SceneRow = memo(function SceneRow({
  scene: s,
  campaignId,
  onStatus,
}: {
  scene: StoryScene;
  campaignId: number;
  onStatus: (scene: StoryScene, status: string) => void;
}) {
  return (
    <details className="card">
      <summary>
        <span className="entry-title">{s.name}</span>
        <span className="muted"> · {SCENE_KIND_LABELS[s.kind] ?? s.kind}</span>
        {s.state?.status === "done" && <span className="badge tag"> пройдена</span>}
        {s.state?.status === "skipped" && <span className="badge tag"> пропущена</span>}
        {s.is_override && <span className="badge tag"> правка кампании</span>}
        {s.campaign_only && <span className="badge tag"> только в кампании</span>}
      </summary>
      <div className="stack" style={{ marginTop: 8 }}>
        {s.summary ? (
          <div style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={s.summary} />
          </div>
        ) : (
          <span className="muted">Сводки нет.</span>
        )}
        <div className="row">
          <select value={s.state?.status ?? "pending"} onChange={(e) => onStatus(s, e.target.value)}>
            {SCENE_STATUSES.map((st) => (
              <option key={st.key} value={st.key}>
                {st.label}
              </option>
            ))}
          </select>
          <Link to={`/scenes/${s.id}?campaign=${campaignId}`}>Открыть сцену →</Link>
        </div>
      </div>
    </details>
  );
});
