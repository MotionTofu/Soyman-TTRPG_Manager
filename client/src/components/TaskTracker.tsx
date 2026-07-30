import { useEffect, useState } from "react";
import { api } from "../api/client";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import type { CampaignEntry } from "../types";

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
  const [tasks, setTasks] = useState<CampaignEntry[]>([]);

  function refresh() {
    api
      .get<CampaignEntry[]>(`/campaign-entries?campaign_id=${campaignId}&category=tasks`)
      .then((rows) => setTasks(sortTasks(rows)));
  }
  useEffect(refresh, [campaignId]);

  async function addTask() {
    await api.post("/campaign-entries", {
      campaign_id: campaignId,
      category: "tasks",
      title: `Задача ${tasks.length + 1}`,
      content: "",
    });
    refresh();
  }

  async function removeTask(id: number) {
    await api.del(`/campaign-entries/${id}`);
    refresh();
  }

  return (
    <div className="stack">
      {tasks.map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          campaignId={campaignId}
          defaultSettingId={defaultSettingId}
          onChange={refresh}
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
  onChange,
  onRemove,
}: {
  task: CampaignEntry;
  campaignId: number;
  defaultSettingId?: number;
  onChange: () => void;
  onRemove: (id: number) => void;
}) {
  const [editMode, setEditMode] = useState(() => !task.content);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [content, setContent] = useState(task.content);
  const open = editMode || expanded;

  async function save() {
    await api.put(`/campaign-entries/${task.id}`, {
      title,
      content,
      status: task.status,
      priority: task.priority,
    });
    syncMentionLinks("campaign", campaignId, task.content, content);
    setEditMode(false);
    onChange();
  }

  async function toggleStatus(status: "done" | "failed") {
    const next = task.status === status ? "none" : status;
    await api.put(`/campaign-entries/${task.id}`, {
      title: task.title,
      content: task.content,
      status: next,
      priority: task.priority,
    });
    onChange();
  }

  async function togglePriority() {
    await api.put(`/campaign-entries/${task.id}`, {
      title: task.title,
      content: task.content,
      status: task.status,
      priority: task.priority ? 0 : 1,
    });
    onChange();
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
