import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { CampaignGroup } from "../types";

interface CampaignGroupTabsProps {
  activeTab: string | null;
  onTabChange: (tab: string | null) => void;
  onGroupsChanged: () => void;
}

export function CampaignGroupTabs({ activeTab, onTabChange, onGroupsChanged }: CampaignGroupTabsProps) {
  const [groups, setGroups] = useState<CampaignGroup[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [contextMenu, setContextMenu] = useState<{ groupId: number; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ groupId: number; name: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  async function loadGroups() {
    try {
      const data = await api.get<CampaignGroup[]>("/campaign-groups");
      setGroups(data);
    } catch {
      // silent
    }
  }

  useEffect(() => { loadGroups(); }, []);

  useEffect(() => {
    if (creating && inputRef.current) inputRef.current.focus();
  }, [creating]);

  useEffect(() => {
    if (renaming && renameRef.current) renameRef.current.focus();
  }, [renaming]);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.post("/campaign-groups", { name });
      setNewName("");
      setCreating(false);
      await loadGroups();
      onGroupsChanged();
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    }
  }

  async function handleRename() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    try {
      await api.put(`/campaign-groups/${renaming.groupId}`, { name });
      setRenaming(null);
      await loadGroups();
      onGroupsChanged();
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    }
  }

  async function handleDelete(groupId: number) {
    try {
      await api.del(`/campaign-groups/${groupId}`);
      setDeleteConfirm(null);
      if (activeTab === String(groupId)) onTabChange(null);
      await loadGroups();
      onGroupsChanged();
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="tabs" role="tablist" aria-label="Кампании">
      <button
        role="tab"
        aria-selected={activeTab === null}
        className={activeTab === null ? "active" : ""}
        onClick={() => onTabChange(null)}
      >
        Все
      </button>

      <button
        role="tab"
        aria-selected={activeTab === "role:gm"}
        className={activeTab === "role:gm" ? "active" : ""}
        onClick={() => onTabChange("role:gm")}
      >
        Я мастер
      </button>

      <button
        role="tab"
        aria-selected={activeTab === "role:player"}
        className={activeTab === "role:player" ? "active" : ""}
        onClick={() => onTabChange("role:player")}
      >
        Я игрок
      </button>

      {groups.map((g) => (
        <button
          key={g.id}
          role="tab"
          aria-selected={activeTab === String(g.id)}
          className={activeTab === String(g.id) ? "active" : ""}
          onClick={() => onTabChange(String(g.id))}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ groupId: g.id, x: e.clientX, y: e.clientY });
          }}
        >
          {renaming?.groupId === g.id ? (
            <input
              ref={renameRef}
              className="setting-group-tab-rename-input"
              value={renaming.name}
              onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setRenaming(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            g.name
          )}
        </button>
      ))}

      <button
        role="tab"
        aria-selected={activeTab === "ungrouped"}
        className={activeTab === "ungrouped" ? "active" : ""}
        onClick={() => onTabChange("ungrouped")}
      >
        Вне групп
      </button>

      <button
        role="tab"
        aria-selected={creating}
        className={creating ? "active" : ""}
        onClick={() => { setCreating(!creating); setNewName(""); }}
      >
        +
      </button>

      {creating && (
        <div className="setting-group-create-inline">
          <input
            ref={inputRef}
            className="setting-group-create-input"
            placeholder="Название группы…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setCreating(false);
            }}
          />
          <button className="primary small" onClick={handleCreate} disabled={!newName.trim()}>
            Создать
          </button>
          <button className="small" onClick={() => setCreating(false)}>Отмена</button>
        </div>
      )}

      {contextMenu && (
        <div
          ref={menuRef}
          className="setting-group-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button onClick={() => {
            const g = groups.find((gr) => gr.id === contextMenu.groupId);
            if (g) setRenaming({ groupId: g.id, name: g.name });
            setContextMenu(null);
          }}>
            Переименовать
          </button>
          <button className="danger" onClick={() => {
            setDeleteConfirm(contextMenu.groupId);
            setContextMenu(null);
          }}>
            Удалить
          </button>
        </div>
      )}

      {deleteConfirm !== null && (
        <div className="modal-backdrop" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Удалить группу?</h3>
            <p>Кампании не будут удалены — они останутся в разделе «Все кампании».</p>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setDeleteConfirm(null)}>Отмена</button>
              <button className="danger" onClick={() => handleDelete(deleteConfirm)}>Удалить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
