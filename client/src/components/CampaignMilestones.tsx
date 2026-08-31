import { memo, useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { MentionText } from "./mentions/MentionText";
import type { CampaignGrouped, StoryMilestone } from "../types";

// Раздел «Вехи» кампании: ключевые точки сюжета, разложенные по приключениям,
// плюс собственные вехи кампании. Тексты вех приключения принадлежат сеттингу
// и правятся там; кампания отмечает достижение и может доложить свою веху —
// свободную или прямо в чужое импортированное приключение.
export function CampaignMilestones({
  campaignId,
  settingId,
}: {
  campaignId: number;
  settingId: number | null;
}) {
  const [data, setData] = useState<CampaignGrouped<StoryMilestone>>({ groups: [], own: [] });

  // Ссылка должна быть стабильной — см. тот же комментарий в CampaignSecrets.
  const refresh = useCallback(() => {
    api
      .get<CampaignGrouped<StoryMilestone>>(`/story/campaign-milestones?campaign_id=${campaignId}`)
      .then(setData);
  }, [campaignId]);
  useEffect(() => {
    refresh();
  }, [refresh]);

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
    setData((prev) => ({
      own: patchList(prev.own),
      groups: prev.groups.map((g) => {
        const items = patchList(g.items);
        return items === g.items ? g : { ...g, items };
      }),
    }));
  }, []);

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

  return (
    <div className="stack">
      <p className="muted">
        Отметки достижения относятся только к этой кампании. Тексты вех приключения правятся в
        сеттинге; свои вехи можно завести здесь.
      </p>

      <MilestoneGroup
        title="Вехи кампании"
        items={data.own}
        arcId={null}
        campaignId={campaignId}
        onChange={refresh}
        onAchieved={applyAchieved}
      />
      {visibleGroups.map((g) => (
        <MilestoneGroup
          key={g.arc.id}
          title={g.arc.name}
          items={g.items}
          arcId={g.arc.id}
          campaignId={campaignId}
          onChange={refresh}
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
  onChange,
  onAchieved,
}: {
  title: string;
  items: StoryMilestone[];
  arcId: number | null;
  campaignId: number;
  onChange: () => void;
  onAchieved: (id: number, achieved: boolean) => void;
}) {
  const toggle = useCallback(
    (m: StoryMilestone, achieved: boolean) => {
      onAchieved(m.id, achieved);
      void api.put(`/story/milestones/${m.id}/state`, { campaign_id: campaignId, achieved });
    },
    [campaignId, onAchieved]
  );

  const remove = useCallback(
    async (m: StoryMilestone) => {
      if (!confirm(`Удалить веху «${m.title}»?`)) return;
      await api.del(`/story/milestones/${m.id}`);
      onChange();
    },
    [onChange]
  );

  const achieved = items.filter((m) => m.state?.achieved === 1).length;

  return (
    <details className="card res-group">
      <summary className="res-group__band">
        <span className="res-group__title">{title}</span>
        <span className="res-group__count">{achieved} из {items.length}</span>
      </summary>
      <div className="res-group__body" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
        {items.map((m) => (
          <MilestoneRow key={m.id} milestone={m} onToggle={toggle} onRemove={remove} />
        ))}
        {items.length === 0 && <p className="muted">Пока пусто.</p>}
        <AddMilestoneForm arcId={arcId} campaignId={campaignId} onChange={onChange} />
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
  onChange,
}: {
  arcId: number | null;
  campaignId: number;
  onChange: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  async function add() {
    if (!title.trim()) return;
    await api.post("/story/milestones", {
      campaign_id: campaignId,
      arc_id: arcId,
      title,
      description,
    });
    setTitle("");
    setDescription("");
    onChange();
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
