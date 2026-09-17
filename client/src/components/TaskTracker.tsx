import { useMemo, useState } from "react";
import { useAction, useResource, write } from "../data/hooks";
import { campaignEntryAffects, campaignPaths } from "../data/campaigns";
import { labelled } from "../data/notices";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import type { CampaignEntry } from "../types";
import { useConfirm } from "../hooks/useConfirm";

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

export function TaskTracker({ campaignId, defaultSettingId }: Props) {
  const [confirmDialog, confirm] = useConfirm();
  const run = useAction();
  const rows = useResource<CampaignEntry[]>(campaignPaths.entries(campaignId, "tasks")).data;
  const tasks = useMemo(() => sortTasks(rows ?? []), [rows]);

  async function addTask() {
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
    <div className="stack">
      {confirmDialog}
      {tasks.map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          campaignId={campaignId}
          defaultSettingId={defaultSettingId}
          onRemove={removeTask}
        />
      ))}
      <button onClick={addTask} style={{ alignSelf: "flex-start" }}>
        + Добавить задачу
      </button>
      {tasks.length === 0 && <p className="muted">Задач пока нет.</p>}
    </div>
  );
}

function TaskCard({
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
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [content, setContent] = useState(task.content);
  const open = editMode || expanded;
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

  return (
    <div className="card stack">
      <div
        className="row collapsible-header"
        style={{ justifyContent: "space-between", cursor: editMode ? "default" : "pointer" }}
        onClick={() => !editMode && setExpanded((v) => !v)}
      >
        <span className="row" style={{ alignItems: "center" }}>
          {!editMode && (
            <span className="comp-toggle" aria-hidden="true">
              {expanded ? "▾" : "▸"}
            </span>
          )}
          {editMode ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Заголовок"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <strong className="entry-title">{task.title}</strong>
          )}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(task.id);
          }}
        >
          ✕
        </button>
      </div>
      <div className="row filters">
        <label>
          <input
            type="checkbox"
            checked={task.status === "done"}
            onChange={() => toggleStatus("done")}
          />
          Выполнено
        </label>
        <label>
          <input
            type="checkbox"
            checked={task.status === "failed"}
            onChange={() => toggleStatus("failed")}
          />
          Провалено
        </label>
        <label>
          <input type="checkbox" checked={!!task.priority} onChange={togglePriority} />
          Приоритетное
        </label>
      </div>
      {open &&
        (editMode ? (
          <>
            <MentionTextarea value={content} onChange={setContent} rows={3} defaultSettingId={defaultSettingId} />
            <div className="row">
              <button className="primary" onClick={save}>
                Сохранить
              </button>
              <button onClick={() => setEditMode(false)}>Отмена</button>
            </div>
          </>
        ) : (
          <>
            {task.content && (
              <div style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={task.content} />
              </div>
            )}
            <button onClick={() => setEditMode(true)} style={{ alignSelf: "flex-start" }}>
              Редактировать
            </button>
          </>
        ))}
    </div>
  );
}
