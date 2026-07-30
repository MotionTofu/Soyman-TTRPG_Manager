import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ArchiveItem, ArchivedFile } from "../types";

const RESTORE_ENDPOINTS: Record<string, string> = {
  campaign: "/campaigns",
  system: "/systems",
  setting: "/settings",
  player: "/players",
  character: "/characters",
  session: "/sessions",
  resource: "/resources",
  mastering: "/mastering",
  location: "/setting-locations",
  being: "/setting-beings",
  artifact: "/artifacts",
  community: "/setting-communities",
};

const TABS = ["Сущности", "Файлы"] as const;

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${(bytes / 1024).toFixed(0)} КБ`;
}

export function ArchivePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Сущности");
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [files, setFiles] = useState<ArchivedFile[]>([]);

  function refresh() {
    api.get<ArchiveItem[]>("/archive").then(setItems);
    api.get<ArchivedFile[]>("/archived-files").then(setFiles);
  }
  useEffect(refresh, []);

  async function restore(item: ArchiveItem) {
    const base = RESTORE_ENDPOINTS[item.type];
    if (!base) return;
    await api.put(`${base}/${item.id}/restore`);
    refresh();
  }

  async function purge(item: ArchiveItem) {
    if (
      !confirm(
        `Удалить «${item.title}» НАВСЕГДА? Это необратимо — запись и все её вложенные данные (разделы, записи, вложения) будут стёрты без возможности восстановления.`
      )
    )
      return;
    await api.del(`/archive/${item.type}/${item.id}`);
    refresh();
  }

  async function purgeFile(file: ArchivedFile) {
    if (!confirm(`Удалить файл «${file.original_name}» из архива навсегда?`)) return;
    await api.del(`/archived-files/${file.id}`);
    refresh();
  }

  async function openArchiveFolder() {
    await api.get("/archived-files/open-folder");
  }

  return (
    <div className="stack">
      <h1 className="muted" style={{ fontSize: 18 }}>
        Архив
      </h1>
      <p className="muted">
        Архивированные сущности хранятся здесь и не отображаются в основных разделах. Их
        можно восстановить в любой момент.
      </p>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Сущности" && (
        <div className="stack">
          {items.map((item) => (
            <div key={`${item.type}-${item.id}`} className="archive-row">
              <span>{item.type}</span>
              <span>
                {item.title}
                {item.subtitle && ` · ${item.subtitle}`}
              </span>
              <span>{item.archived_at}</span>
              <div className="row" style={{ gap: 8 }}>
                <button onClick={() => restore(item)}>Восстановить</button>
                <button className="danger" onClick={() => purge(item)}>
                  Удалить навсегда
                </button>
              </div>
            </div>
          ))}
          {items.length === 0 && <p className="muted">Архив пуст.</p>}
        </div>
      )}

      {tab === "Файлы" && (
        <div className="stack">
          <div className="row">
            <button onClick={openArchiveFolder}>📂 Открыть папку архива</button>
          </div>
          <p className="muted">
            Отдельные файлы, удалённые из последнего места использования с выбором «отправить в
            архив» вместо «удалить навсегда».
          </p>
          {files.map((file) => (
            <div key={file.id} className="archive-row">
              <span>{file.original_owner_type}</span>
              <span>{file.original_name}</span>
              <span className="muted">{formatSize(file.size)}</span>
              <span>{file.archived_at}</span>
              <div className="row" style={{ gap: 8 }}>
                <button className="danger" onClick={() => purgeFile(file)}>
                  Удалить навсегда
                </button>
              </div>
            </div>
          ))}
          {files.length === 0 && <p className="muted">Архивированных файлов пока нет.</p>}
        </div>
      )}
    </div>
  );
}
