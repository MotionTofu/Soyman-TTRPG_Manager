import { memo, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { MentionText } from "./mentions/MentionText";
import { EmptyState } from "./EmptyState";
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
      <div className="card" style={{ borderStyle: "dashed" }}>
        <p style={{ maxWidth: "62ch" }}>
          Приключения живут в сеттинге — выберите сеттинг кампании в разделе «Обзор → Основное», и здесь появится дерево глав и сцен.
        </p>
        <Link to={`/campaigns/${campaignId}`}><button>К обзору →</button></Link>
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <EmptyState
        title="Главы ещё не привязаны"
        hint="Привяжите приключение в разделе «Обзор → Приключения» — его главы и сцены станут планом кампании."
        action={<Link to={`/campaigns/${campaignId}`}><button className="primary">К приключениям →</button></Link>}
      />
    );
  }

  return (
    <div className="stack campaign-chapters">
      <p className="muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
        Приключения кампании со своими главами и сценами. Правка сцены создаёт её версию для этой кампании, оригинал в сеттинге не меняется.
      </p>
      {tree.map((adv) => {
        const total =
          adv.scenes.length + adv.chapters.reduce((n, c) => n + c.scenes.length, 0);
        const { done, skipped, pending } = countByStatus([
          ...adv.scenes,
          ...adv.chapters.flatMap((c) => c.scenes),
        ]);
        return (
          <details key={adv.id} className="card res-group">
            <summary className="res-group__band">
              <span className="res-group__title" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{adv.name}</span>
              <span className="res-group__count">
                {adv.chapters.length ? `${adv.chapters.length} ${chapterWord(adv.chapters.length)} · ` : ""}{total} {sceneWord(total)}
                {total > 0 && ` · ✓${done} · ○${pending} · ✕${skipped}`}
              </span>
              {adv.is_override && <span className="badge tag" style={{ marginLeft: 6 }}>правка кампании</span>}
            </summary>
            <div className="res-group__body" style={{ padding: 12, gap: 12, display: "flex", flexDirection: "column" }}>
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
              {adv.chapters.map((c) => {
                const chDone = c.scenes.filter((s) => s.state?.status === "done").length;
                const chSkipped = c.scenes.filter((s) => s.state?.status === "skipped").length;
                const chPending = c.scenes.length - chDone - chSkipped;
                return (
                  <details key={c.id} className="card res-group" open>
                    <summary className="res-group__band">
                      <span className="res-group__title" style={{ fontSize: "var(--fs-h3)" }}>{c.name}</span>
                      <span className="res-group__count">
                        {c.scenes.length} {sceneWord(c.scenes.length)}
                        {c.scenes.length > 0 && ` · ✓${chDone} ○${chPending} ✕${chSkipped}`}
                      </span>
                      {c.is_override && <span className="badge tag" style={{ marginLeft: 6 }}>правка кампании</span>}
                    </summary>
                    <div className="res-group__body" style={{ padding: 12 }}>
                      <SceneList scenes={c.scenes} campaignId={campaignId} onStatus={applyStatus} title={null} />
                    </div>
                  </details>
                );
              })}
              {total === 0 && (
                <div className="card" style={{ borderStyle: "dashed" }}>
                  <p className="muted" style={{ maxWidth: "62ch" }}>Сцен пока нет — добавьте первую в сеттинге или создайте «только в кампании».</p>
                </div>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function countByStatus(scenes: StoryScene[]) {
  let done = 0, skipped = 0, pending = 0;
  for (const s of scenes) {
    if (s.state?.status === "done") done++;
    else if (s.state?.status === "skipped") skipped++;
    else pending++;
  }
  return { done, skipped, pending };
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
    <div className="stack" style={{ gap: 4 }}>
      {title && <span className="muted" style={{ fontSize: "var(--fs-micro)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{title}</span>}
      {scenes.map((s) => (
        <SceneRow key={s.id} scene={s} campaignId={campaignId} onStatus={setStatus} />
      ))}
      {scenes.length === 0 && <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Сцен пока нет.</span>}
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
  const statusBadge =
    s.state?.status === "done" ? <span className="badge held">пройдена</span> :
    s.state?.status === "skipped" ? <span className="badge cancelled">пропущена</span> : null;
  return (
    <details className="entity-row" style={{ display: "block", padding: 0, borderBottom: "1px solid var(--line)" }}>
      <summary className="entity-row" style={{ cursor: "pointer", listStyle: "none", margin: 0, borderBottom: "none" }}>
        <span className="entity-type-chip" style={{ fontSize: "var(--fs-micro)" }}>{SCENE_KIND_LABELS[s.kind] ?? s.kind}</span>
        <span className="entity-row-name" style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-meta)", fontWeight: 600 }}>{s.name}</span>
        {statusBadge}
        {s.is_override && <span className="badge tag">правка</span>}
        {s.campaign_only && <span className="badge tag">только в кампании</span>}
      </summary>
      <div className="entity-row-expanded" style={{ marginTop: 0 }}>
        {s.summary ? (
          <div style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={s.summary} />
          </div>
        ) : (
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Сводки нет — откройте сцену, чтобы добавить.</span>
        )}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select value={s.state?.status ?? "pending"} onChange={(e) => onStatus(s, e.target.value)} style={{ fontSize: "var(--fs-meta)" }}>
            {SCENE_STATUSES.map((st) => (
              <option key={st.key} value={st.key}>
                {st.label}
              </option>
            ))}
          </select>
          <Link to={`/scenes/${s.id}?campaign=${campaignId}`} style={{ fontSize: "var(--fs-meta)" }}>Открыть сцену →</Link>
        </div>
      </div>
    </details>
  );
});
