import { memo, useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAction, useResource, write } from "../data/hooks";
import { dataKeys } from "../data/entities";
import { campaignPaths, milestoneAffects } from "../data/campaigns";
import { labelled } from "../data/notices";
import { MentionText } from "./mentions/MentionText";
import "./campaign-secrets.css";
import type { CampaignGrouped, StoryMilestone } from "../types";
import { useConfirm } from "../hooks/useConfirm";
import { LoadErrorCard } from "./Loadable";

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
  const source = useResource<CampaignGrouped<StoryMilestone>>(path);
  const data = source.data ?? EMPTY;
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

  // Группы монтируются после чтения: иначе временное EMPTY раскрывает
  // форму «пустой группы», даже когда следом приходят существующие записи.
  if (!source.data) return source.error
    ? <LoadErrorCard message={source.error} onRetry={source.reload} />
    : <p className="muted" role="status">Загрузка…</p>;

  return (
    <div className="campaign-check-groups">
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

  // Группа «Д» (макет Camp-Story-Milestones): плашка, «N из M», справа
  // «+ Новая веха»; форма раскрывается по ней, а у пустой группы открыта сразу
  // (§1.11a: тело пустой секции создания — приглашение).
  const [adding, setAdding] = useState(items.length === 0);
  return (
    <section className="campaign-check-group">
      {confirmDialog}
      <div className="d-gh">
        <h3 className="d-plate">{title}</h3>
        <span className="d-note">{achieved} из {items.length}</span>
        <span className="d-end">
          <button type="button" className={`d-btn d-btn--sm${arcId == null ? "" : " d-btn--quiet"}`} onClick={() => setAdding((v) => !v)}>
            {arcId == null ? "+ Новая веха" : "+ Веха приключения"}
          </button>
        </span>
      </div>
      {items.map((m) => (
        <MilestoneRow key={m.id} milestone={m} onToggle={toggle} onRemove={remove} />
      ))}
      {adding && <AddMilestoneForm arcId={arcId} campaignId={campaignId} />}
    </section>
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
  const done = m.state?.achieved === 1;
  return (
    <div className={`campaign-check-row${done ? " is-done" : ""}`}>
      <input
        type="checkbox"
        className="d-check"
        checked={done}
        aria-label={`Веха «${m.title}» достигнута`}
        onChange={(e) => onToggle(m, e.target.checked)}
      />
      <div className="campaign-check-row__text">
        <b>{m.title}</b>
        {m.description && <MentionText text={m.description} />}
      </div>
      <span className="d-mono">{m.scene_name ? `сцена «${m.scene_name}»` : ""}</span>
      {/* Веху приключения удалять отсюда нельзя: она принадлежит сеттингу и
          видна всем его кампаниям. */}
      {m.campaign_id ? (
        <button type="button" className="d-dots" aria-label={`Удалить веху «${m.title}»`} onClick={() => onRemove(m)}>
          ✕
        </button>
      ) : <span />}
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
    <form className="campaign-check-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <input className="d-input" placeholder="Название вехи" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="d-input" placeholder="Описание" value={description} onChange={(e) => setDescription(e.target.value)} />
      <button type="submit" className="d-btn d-btn--sm" disabled={!title.trim()}>
        Добавить
      </button>
    </form>
  );
});
