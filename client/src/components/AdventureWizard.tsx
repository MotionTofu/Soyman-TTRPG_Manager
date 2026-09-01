import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "./Modal";
import type { StoryArc } from "../types";

// Визард создания приключения — 4 шага:
//  1 — Название (обязательно, можно создать сразу)
//  2 — Мета: Уровень, Число игроков, Длительность, Источник, Теги
//  3 — Логлайн
//  4 — Завязка
//
// Кнопки: Создать и вернуться, Создать и перейти, (Создать и открыть холст — на полотне), Отмена.

interface Props {
  settingId: number;
  campaignId?: number;
  onClose: () => void;
  onCreated?: (arc: StoryArc) => void;
  /** Кнопка "Создать и открыть холст" — только на полотне. */
  onCreatedAndOpenCanvas?: (arc: StoryArc) => void;
}

const STEPS = [
  { key: "name", title: "Название" },
  { key: "meta", title: "Мета" },
  { key: "logline", title: "Логлайн" },
  { key: "hook", title: "Завязка" },
] as const;

export function AdventureWizard({ settingId, campaignId, onClose, onCreated, onCreatedAndOpenCanvas }: Props) {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [recommendedLevel, setRecommendedLevel] = useState("");
  const [playerCount, setPlayerCount] = useState("");
  const [duration, setDuration] = useState("");
  const [source, setSource] = useState("");
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");
  const [hook, setHook] = useState("");

  const totalSteps = STEPS.length;
  const current = STEPS[stepIndex];
  const canCreate = name.trim().length > 0 && !saving;

  async function create(then: "close" | "adventure" | "canvas") {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<StoryArc>("/story/arcs", {
        setting_id: settingId,
        name: name.trim(),
        description,
        hook,
        recommended_level: recommendedLevel,
        player_count: playerCount,
        duration,
        source,
        tags,
        ...(campaignId ? { campaign_id: campaignId } : {}),
      });
      onCreated?.(created);
      if (then === "adventure") navigate(`/adventures/${created.id}`);
      else if (then === "canvas") onCreatedAndOpenCanvas?.(created);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} closeOnBackdropClick={false}>
      <div className="stack wizard">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ margin: 0 }}>Новое приключение</h3>
          <span className="muted">
            Шаг {stepIndex + 1} из {totalSteps} — {current?.title}
          </span>
        </div>

        {current?.key === "name" && (
          <div className="stack">
            <label className="stack editable-card-field">
              <span>Название</span>
              <input
                autoFocus
                value={name}
                maxLength={80}
                placeholder="Как называется приключение"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && canCreate) create("close"); }}
              />
            </label>
          </div>
        )}

        {current?.key === "meta" && (
          <div className="stack">
            <label className="stack editable-card-field">
              <span>Уровень персонажей</span>
              <input value={recommendedLevel} placeholder="напр. 5-10" onChange={(e) => setRecommendedLevel(e.target.value)} />
            </label>
            <label className="stack editable-card-field">
              <span>Число игроков</span>
              <input value={playerCount} placeholder="напр. 3-5" onChange={(e) => setPlayerCount(e.target.value)} />
            </label>
            <label className="stack editable-card-field">
              <span>Длительность</span>
              <input value={duration} placeholder="напр. 3-4 сессии" onChange={(e) => setDuration(e.target.value)} />
            </label>
            <label className="stack editable-card-field">
              <span>Источник</span>
              <input value={source} placeholder="напр. DMG, homebrew" onChange={(e) => setSource(e.target.value)} />
            </label>
            <label className="stack editable-card-field">
              <span>Теги</span>
              <input value={tags} placeholder="напр. хоррор, подземелье" onChange={(e) => setTags(e.target.value)} />
            </label>
          </div>
        )}

        {current?.key === "logline" && (
          <div className="stack">
            <label className="stack editable-card-field">
              <span>Логлайн</span>
              <textarea
                value={description}
                rows={5}
                placeholder="Краткое описание сути приключения"
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </div>
        )}

        {current?.key === "hook" && (
          <div className="stack">
            <label className="stack editable-card-field">
              <span>Завязка</span>
              <textarea
                value={hook}
                rows={4}
                placeholder="Как партия попадает в это приключение"
                onChange={(e) => setHook(e.target.value)}
              />
            </label>
          </div>
        )}

        {error && <span className="backup-info error">{error}</span>}

        <div className="row wizard-steps-nav">
          <button disabled={stepIndex === 0} onClick={() => setStepIndex((i) => i - 1)}>
            Назад
          </button>
          <button disabled={stepIndex >= totalSteps - 1} onClick={() => setStepIndex((i) => i + 1)}>
            Далее
          </button>
        </div>
        <div className="row wizard-actions">
          <button className="primary" disabled={!canCreate} onClick={() => create("close")}>
            {saving ? "Создаю…" : "Создать и вернуться"}
          </button>
          <button disabled={!canCreate} onClick={() => create("adventure")}>
            Создать и перейти в приключение
          </button>
          {onCreatedAndOpenCanvas && (
            <button disabled={!canCreate} onClick={() => create("canvas")}>
              Создать и открыть холст
            </button>
          )}
          <button onClick={onClose} disabled={saving}>
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  );
}
