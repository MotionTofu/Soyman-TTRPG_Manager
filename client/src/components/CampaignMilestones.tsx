import { memo, useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAction, useResource, write } from "../data/hooks";
import { dataKeys } from "../data/entities";
import { campaignPaths, milestoneAffects } from "../data/campaigns";
import { labelled } from "../data/notices";
import { MentionText } from "./mentions/MentionText";
import type { CampaignGrouped, StoryMilestone } from "../types";
import { useConfirm } from "../hooks/useConfirm";

// Раздел «Вехи» кампании: ключевые точки сюжета, разложенные по приключениям,
// плюс собственные вехи кампании. Тексты вех приключения принадлежат сеттингу
// и правятся там; кампания отмечает достижение и может доложить свою веху —
// свободную или прямо в чужое импортированное приключение.
export interface MilestonesNavStats {
  own: { total: number; done: number };
  groups: { id: number; name: string; total: number; done: number }[];
}

const EMPTY: CampaignGrouped<StoryMilestone> = { groups: [], own: [] };

export function CampaignMilestones({
  campaignId,
  settingId,
  groupId,
  onStats,
}: {
  campaignId: number;
  settingId: number | null;
  // Master–Detail: показать одну группу ("own" — вехи кампании, иначе
  // id приключения). Не задано — все группы, как раньше.
  groupId?: string | null;
  onStats?: (s: MilestonesNavStats) => void;
}) {
  const path = campaignPaths.milestones(campaignId);
  const data = useResource<CampaignGrouped<StoryMilestone>>(path).data ?? EMPTY;
  const client = useQueryClient();

  // Отметка «достигнута» меняет ровно одну строку — перечитывать из-за неё
  // весь раздел (и перерисовывать все группы) незачем. Нетронутые вехи
  // сохраняют ссылочное равенство, поэтому memo на строке оставляет их в
  // покое, и коммит React касается одной записи.
  const applyAchieved = useCallback((id: number, achieved: boolean) => {
    // Нетронутая группа возвращается той же ссылкой — см. CampaignSecrets.
    const patchList = (list: StoryMilestone[]) => {
      const i = list.findIndex((m) => m.id === id);
      if (i === -1) return list;
      const next = list.slice();
      next[i] = { ...list[i], state: { achieved: achieved ? 1 : 0, note: list[i].state?.note ?? "" } };
      return next;
    };
    client.setQueryData<CampaignGrouped<StoryMilestone>>(dataKeys.resource(path), (prev) =>
      prev && {
        own: patchList(prev.own),
        groups: prev.groups.map((g) => {
          const items = patchList(g.items);
          return items === g.items ? g : { ...g, items };
        }),
      }
    );
  }, [client, path]);

  // Счётчики для левой навигации Master–Detail. Выше ранних return:
  // хуки обязаны вызываться в одном порядке каждый рендер.
  useEffect(() => {
    if (!onStats) return;
    const doneOf = (items: StoryMilestone[]) => items.filter((m) => m.state?.achieved === 1).length;
    const groups = data.groups.filter((g) => g.arc.is_default !== 1 || g.items.length > 0);
    onStats({
      own: { total: data.own.length, done: doneOf(data.own) },
      groups: groups.map((g) => ({ id: g.arc.id, name: g.arc.name, total: g.items.length, done: doneOf(g.items) })),
    });
  }, [data, onStats]);

  if (settingId == null) {
    return (
      <p className="muted">
        Приключения живут в сеттинге — выберите сеттинг кампании в разделе «Обзор».
      </p>
    );
  }

  const total = data.own.length + data.groups.reduce((n, g) => n + g.items.length, 0);
  // Пустая корзина «Сцены вне приключений» в этом разделе — чистый шум:
  // вехи и тайны в неё не кладут.
  const visibleGroups = data.groups.filter((g) => g.arc.is_default !== 1 || g.items.length > 0);

  const showOwn = groupId == null || groupId === "own";
  const showGroups = visibleGroups.filter((g) => groupId == null || groupId === String(g.arc.id));

  return (
    <div className="stack">
      <p className="muted">
        Отметки достижения относятся только к этой кампании. Тексты вех приключения правятся в
        сеттинге; свои вехи можно завести здесь.
      </p>

      {showOwn && (
        <MilestoneGroup
          title="Вехи кампании"
          items={data.own}
          arcId={null}
          campaignId={campaignId}
          onAchieved={applyAchieved}
        />
      )}
      {showGroups.map((g) => (
        <MilestoneGroup
          key={g.arc.id}
          title={g.arc.name}
          items={g.items}
          arcId={g.arc.id}
          campaignId={campaignId}
          onAchieved={applyAchieved}
        />
      ))}
      {total === 0 && <p className="muted">Вех пока нет.</p>}
    </div>
  );
}

const MilestoneGroup = memo(function MilestoneGroup({
  title,
  items,
  arcId,
  campaignId,
  onAchieved,
}: {
  title: string;
  items: StoryMilestone[];
  arcId: number | null;
  campaignId: number;
  onAchieved: (id: number, achieved: boolean) => void;
}) {
  const [confirmDialog, confirm] = useConfirm();
  const run = useAction();
  // Как у тайн: галочка меняется сразу, при отказе возвращается с плашкой.
  const toggle = useCallback(
    async (m: StoryMilestone, achieved: boolean) => {
      onAchieved(m.id, achieved);
      const saved = await run(
        labelled("Отметка вехи", () => write.put(`/story/milestones/${m.id}/state`, { campaign_id: campaignId, achieved }).then(() => true)),
        { affects: milestoneAffects(campaignId) }
      );
      if (!saved) onAchieved(m.id, !achieved);
    },
    [campaignId, onAchieved, run]
  );

  const remove = useCallback(
    async (m: StoryMilestone) => {
      if (!(await confirm({ message: `Удалить веху «${m.title}»?`, confirmLabel: "Удалить", danger: true })))
        return;
      await run(labelled("Удаление вехи", () => write.del(`/story/milestones/${m.id}`)), { affects: milestoneAffects(campaignId) });
    },
    [campaignId, confirm, run]
  );

  const achieved = items.filter((m) => m.state?.achieved === 1).length;

  return (
    <details className="card res-group">
      {confirmDialog}
      <summary className="res-group__band">
        <span className="res-group__title">{title}</span>
        <span className="res-group__count">{achieved} из {items.length}</span>
      </summary>
      <div className="res-group__body" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
        {items.map((m) => (
          <MilestoneRow key={m.id} milestone={m} onToggle={toggle} onRemove={remove} />
        ))}
        {/* §1.11a: пустое тело секции создания — это приглашение к действию, а
            не строка «пока пусто». Приглашение здесь уже есть — форма ниже с
            кнопкой «+ Своя веха»; отдельный EmptyState был бы вторым зовом
            рядом с первым, а приглушённая строка не звала вовсе. */}
        <AddMilestoneForm arcId={arcId} campaignId={campaignId} />
      </div>
    </details>
  );
});

const MilestoneRow = memo(function MilestoneRow({
  milestone,
  onToggle,
  onRemove,
}: {
  milestone: StoryMilestone;
  onToggle: (m: StoryMilestone, achieved: boolean) => void;
  onRemove: (m: StoryMilestone) => void;
}) {
  const m = milestone;
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <span>
        <input
          type="checkbox"
          checked={m.state?.achieved === 1}
          onChange={(e) => onToggle(m, e.target.checked)}
        />{" "}
        <strong>{m.title}</strong>
        {m.campaign_id && <span className="badge tag"> веха кампании</span>}
        {m.scene_name && <span className="muted"> · сцена «{m.scene_name}»</span>}
        {m.description && (
          <div className="muted">
            <MentionText text={m.description} />
          </div>
        )}
      </span>
      {/* Веху приключения удалять отсюда нельзя: она принадлежит сеттингу и
          видна всем его кампаниям. */}
      {!!m.campaign_id && (
        <button className="danger" onClick={() => onRemove(m)}>
          ✕
        </button>
      )}
    </div>
  );
});

// Отдельно от списка — по той же причине, что и у тайн: поля формы не должны
// переписываться на каждую отметку «достигнута».
const AddMilestoneForm = memo(function AddMilestoneForm({
  arcId,
  campaignId,
}: {
  arcId: number | null;
  campaignId: number;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const run = useAction();

  async function add() {
    if (!title.trim()) return;
    // Поля очищаются только после записи: при отказе набранное остаётся.
    const created = await run(
      labelled("Новая веха", () => write.post("/story/milestones", { campaign_id: campaignId, arc_id: arcId, title, description }).then(() => true)),
      { affects: milestoneAffects(campaignId), retry: false }
    );
    if (!created) return;
    setTitle("");
    setDescription("");
  }

  return (
    <div className="row">
      <input placeholder="Название вехи" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input
        placeholder="Описание"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <button className="primary" onClick={add}>
        + Своя веха
      </button>
    </div>
  );
});
