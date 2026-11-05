import { useState } from "react";
import { useAction, useResource, write } from "../data/hooks";
import { campaignAdventureAffects, campaignPaths } from "../data/campaigns";
import { labelled } from "../data/notices";
import { chapterWord, sceneWord } from "../sceneKinds";
import type { StoryArc } from "../types";
import { AdventureWizard } from "./AdventureWizard";
import { Modal } from "./Modal";

/** Два входа в общий каталог сеттинга из «Сюжета» кампании. */
export function CampaignAdventureActions({ campaignId, settingId, onAdded }: {
  campaignId: number;
  settingId: number;
  onAdded?: (adventureId: number) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [attaching, setAttaching] = useState<number | null>(null);
  const available = useResource<StoryArc[]>(adding ? campaignPaths.availableAdventures(campaignId) : null);
  const run = useAction();

  async function attach(arcId: number) {
    if (attaching != null) return;
    setAttaching(arcId);
    try {
      const done = await run(
        labelled("Приключение в кампанию", () => write.post("/story/campaign-adventures", { campaign_id: campaignId, arc_id: arcId }).then(() => true)),
        { affects: campaignAdventureAffects(campaignId), retry: false }
      );
      if (done) {
        setAdding(false);
        onAdded?.(arcId);
      }
    } finally {
      setAttaching(null);
    }
  }

  return (
    <>
      <div className="row campaign-adventure-actions">
        <button type="button" className="primary" onClick={() => setCreating(true)}>Создать приключение</button>
        <button type="button" onClick={() => setAdding(true)}>Добавить из сеттинга</button>
      </div>
      {creating && (
        <AdventureWizard
          settingId={settingId}
          attachToCampaignId={campaignId}
          onClose={() => setCreating(false)}
          onCreated={(arc) => onAdded?.(arc.id)}
        />
      )}
      {adding && (
        <Modal onClose={() => setAdding(false)} ariaLabel="Добавить из сеттинга" wide>
          <div className="stack">
            <h3>Добавить из сеттинга</h3>
            {available.loading && <p className="muted" role="status">Загрузка приключений…</p>}
            {available.error && (
              <p role="alert">Не удалось загрузить приключения. <button type="button" onClick={available.reload}>Повторить</button></p>
            )}
            {available.data && (
              <div className="entity-row-list">
                {available.data.map((arc) => (
                  <div className="entity-row" key={arc.id}>
                    <span className="entity-row-name">{arc.name}</span>
                    <span className="muted">
                      {!!arc.chapter_count && `${arc.chapter_count} ${chapterWord(arc.chapter_count)} · `}
                      {arc.scene_count} {sceneWord(arc.scene_count)}
                      {arc.recommended_level && ` · ${arc.recommended_level}`}
                    </span>
                    <span className="entity-row-actions">
                      <button type="button" disabled={attaching != null} onClick={() => void attach(arc.id)}>
                        {attaching === arc.id ? "Добавляю…" : "Добавить"}
                      </button>
                    </span>
                  </div>
                ))}
                {available.data.length === 0 && <p className="muted">Нет доступных приключений. Все приключения сеттинга уже добавлены в кампанию или ещё не созданы.</p>}
              </div>
            )}
            <button type="button" onClick={() => setAdding(false)}>Закрыть</button>
          </div>
        </Modal>
      )}
    </>
  );
}
