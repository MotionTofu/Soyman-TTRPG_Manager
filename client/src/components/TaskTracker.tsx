import { useMemo, useState } from "react";
import { useAction, useResource, write } from "../data/hooks";
import { campaignEntryAffects, campaignPaths } from "../data/campaigns";
import { labelled } from "../data/notices";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import type { CampaignEntry } from "../types";
import { useConfirm } from "../hooks/useConfirm";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { DSeg } from "./DSeg";
import "./campaign-secrets.css";
import "./campaign-entries.css";

interface Props {
  campaignId: number;
  defaultSettingId?: number;
}

function sortTasks(tasks: CampaignEntry[]) {
  return [...tasks].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.created_at.localeCompare(b.created_at);
  });
}

/**
 * Задачи игрока в «Д» — по образцу вех (макет Camp-Story-Milestones):
 * голова с кислотной кнопкой, сегмент «Открытые | Закрытые», строка —
 * квадратная галочка «выполнено», название и текст, пометки машинописью, «⋯».
 */
export function TaskTracker({ campaignId, defaultSettingId }: Props) {
  const [confirmDialog, confirm] = useConfirm();
  const run = useAction();
  const rows = useResource<CampaignEntry[]>(campaignPaths.entries(campaignId, "tasks")).data;
  const tasks = useMemo(() => sortTasks(rows ?? []), [rows]);
  const [view, setView] = useState<"open" | "closed">("open");
  const open = tasks.filter((t) => t.status === "none");
  const closed = tasks.filter((t) => t.status !== "none");
  const shown = view === "open" ? open : closed;

  async function addTask() {
    setView("open");
    await run(
      labelled("Новая задача", () =>
        write.post("/campaign-entries", {
          campaign_id: campaignId,
          category: "tasks",
          title: `Задача ${tasks.length + 1}`,
          content: "",
        })
      ),
      { affects: campaignEntryAffects(campaignId), retry: false }
    );
  }

  async function removeTask(id: number) {
    if (!(await confirm({ message: "Удалить задачу?", confirmLabel: "Удалить", danger: true })))
      return;
    await run(labelled("Удаление задачи", () => write.del(`/campaign-entries/${id}`)), { affects: campaignEntryAffects(campaignId) });
  }

  return (
    <div className="entry-cards">
      {confirmDialog}
      <div className="d-head">
        <div>
          <h2>Задачи</h2>
          <div className="d-head__sub">видите только вы</div>
        </div>
        <div className="d-head__acts">
          <button type="button" className="d-btn d-btn--primary" onClick={addTask}>
            + Добавить задачу
          </button>
        </div>
      </div>
      {tasks.length > 0 && (
        <div className="entry-cards__bar">
          <DSeg
            label="Отбор задач"
            items={[
              { id: "open", label: "Открытые", count: open.length },
              { id: "closed", label: "Закрытые", count: closed.length },
            ]}
            value={view}
            onChange={setView}
          />
        </div>
      )}
      {tasks.length === 0 ? (
        <div className="entry-cards__empty">
          <p className="muted">Задач пока нет — запишите, что персонаж обещал или собирается сделать.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted">{view === "open" ? "Открытых задач нет." : "Закрытых задач пока нет."}</p>
      ) : (
        <div>
          {shown.map((t) => (
            <TaskRow key={t.id} task={t} campaignId={campaignId} defaultSettingId={defaultSettingId} onRemove={removeTask} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  campaignId,
  defaultSettingId,
  onRemove,
}: {
  task: CampaignEntry;
  campaignId: number;
  defaultSettingId?: number;
  onRemove: (id: number) => void;
}) {
  const [editMode, setEditMode] = useState(() => !task.content);
  const [title, setTitle] = useState(task.title);
  const [content, setContent] = useState(task.content);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const run = useAction();

  function put(body: Pick<CampaignEntry, "title" | "content" | "status" | "priority">) {
    return run(labelled("Задача", () => write.put(`/campaign-entries/${task.id}`, body).then(() => true)), {
      affects: campaignEntryAffects(campaignId),
    });
  }

  async function save() {
    // Форма закрывается только после записи: при отказе набранное остаётся.
    if (!(await put({ title, content, status: task.status, priority: task.priority }))) return;
    void syncMentionLinks("campaign", campaignId, task.content, content);
    setEditMode(false);
  }

  async function toggleStatus(status: "done" | "failed") {
    const next = task.status === status ? "none" : status;
    await put({ title: task.title, content: task.content, status: next, priority: task.priority });
  }

  async function togglePriority() {
    await put({ title: task.title, content: task.content, status: task.status, priority: task.priority ? 0 : 1 });
  }

  const menu: ContextMenuItem[] = [
    { label: "Редактировать", onClick: () => setEditMode(true) },
    { label: task.priority ? "Снять «важная»" : "Важная", onClick: () => void togglePriority() },
    { label: task.status === "failed" ? "Вернуть в открытые" : "Провалена", onClick: () => void toggleStatus("failed") },
    { label: "Удалить", danger: true, dividerBefore: true, onClick: () => onRemove(task.id) },
  ];
  const marks = [task.priority ? "важная" : "", task.status === "failed" ? "провалена" : ""].filter(Boolean).join(" · ");

  return (
    <div className={`campaign-check-row${task.status !== "none" ? " is-done" : ""}`}>
      <input
        type="checkbox"
        className="d-check"
        checked={task.status === "done"}
        aria-label={`Задача «${task.title}» выполнена`}
        onChange={() => void toggleStatus("done")}
      />
      {editMode ? (
        <div className="campaign-check-row__text">
          <input className="d-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Заголовок" aria-label="Заголовок" />
          <MentionTextarea value={content} onChange={setContent} rows={3} defaultSettingId={defaultSettingId} />
          <div className="entry-card__acts">
            <button type="button" className="d-btn d-btn--sm d-btn--primary" onClick={save}>
              Сохранить
            </button>
            <button type="button" className="d-btn d-btn--sm d-btn--quiet" onClick={() => setEditMode(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="campaign-check-row__text">
          <b>{task.title}</b>
          {task.content && <MentionText text={task.content} />}
        </div>
      )}
      <span className="d-mono">{marks}</span>
      <button
        type="button"
        className="d-dots"
        aria-label={`Действия с задачей «${task.title}»`}
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenuAt(menuAt ? null : { x: r.left, y: r.bottom });
        }}
      >
        ⋯
      </button>
      {menuAt && <ContextMenu x={menuAt.x} y={menuAt.y} items={menu} onClose={() => setMenuAt(null)} />}
    </div>
  );
}
